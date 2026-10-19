-- ============================================================================
-- 80. ENTRADA DO TRABALHADOR NA APP: PASSOS 2 A 5 DO ACOLHIMENTO (v48)
-- ============================================================================
-- Diogo, 2026-10-19: «um colaborador que chegou à empresa passa por aqueles passos todos, trata do contrato e vai para a obra».
-- Step 1 (videos, manuals, quiz) is sql/55. This file makes steps 2 to 5 real, on the person's own phone, on top of the
-- v6 onboarding funnel (sql/03: compliance.onboarding_steps drives core.collaborators.onboarding_status):
--   2  Os meus dados: NISS, IBAN, address, emergency contact, birth date, nationality, sizes, and the documents
--      (photo or PDF of each). NISS and IBAN are sealed (S1) before they are stored; HR only ever sees the last digits.
--   3  HR checks the data and each document (verify, or send back with a note) and validates.
--   4  HR issues the contract from the company's model (the text is generated here, so its SHA-256 is what is signed).
--      The person reads the contract and the internal rules to the end, types their full name and signs with the finger.
--   5  The person accepts the pay terms (hourly rate, overtime, other terms): a snapshot that never changes.
-- After step 5 the person is active; the gate still asks for the blocking documents and a card.
-- Evidence (E1): every act stores who, when, from where (IP, browser) and the SHA-256 of the exact text accepted.
-- Texts (E2): the contract model and the internal rules are versioned; a change is a new version, the old one stays.
-- Default texts are MODELS only, clearly marked, to be replaced by the company's own (a labour lawyer should check them).

-- ---------------------------------------------------------------- columns
-- (birth date, nationality, address, ID document, IRS fields already exist since the HR card; only the NISS hint is new)
ALTER TABLE core.collaborator_sensitive ADD COLUMN IF NOT EXISTS niss_last3 VARCHAR(3);
ALTER TABLE core.collaborator_sensitive ADD COLUMN IF NOT EXISTS irs_disability BOOLEAN;

ALTER TABLE core.contract_templates ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'contract';
ALTER TABLE core.contract_templates ADD COLUMN IF NOT EXISTS created_by UUID;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_template_kind') THEN
        ALTER TABLE core.contract_templates ADD CONSTRAINT chk_template_kind CHECK (kind IN ('contract', 'rules'));
    END IF;
END $$;

ALTER TABLE core.employment_contracts ADD COLUMN IF NOT EXISTS body_text TEXT;
ALTER TABLE core.employment_contracts ADD COLUMN IF NOT EXISTS job_title VARCHAR(255);
ALTER TABLE core.employment_contracts ADD COLUMN IF NOT EXISTS rules_template_id UUID;
ALTER TABLE core.employment_contracts ADD COLUMN IF NOT EXISTS rules_sha256 TEXT;
ALTER TABLE core.employment_contracts ADD COLUMN IF NOT EXISTS signed_name TEXT;
ALTER TABLE core.employment_contracts ADD COLUMN IF NOT EXISTS signature_svg TEXT;
ALTER TABLE core.employment_contracts ADD COLUMN IF NOT EXISTS signature_agent TEXT;

-- HR notes to the person during steps 2-3 («falta a foto do verso do cartão»). Append-only: the last one is shown.
CREATE TABLE IF NOT EXISTS core.onboarding_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    collaborator_id UUID NOT NULL,
    note TEXT NOT NULL CHECK (length(trim(note)) BETWEEN 3 AND 1000),
    written_by UUID NOT NULL,
    written_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (collaborator_id, tenant_id) REFERENCES core.collaborators (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_onboarding_notes_collab ON core.onboarding_notes (collaborator_id, written_at DESC);
ALTER TABLE core.onboarding_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON core.onboarding_notes FROM anon, authenticated, PUBLIC;

-- ---------------------------------------------------------------- sealing (S1) without an outside key vault
-- The envelope keeps the S1 format ("ENC1" + key id + 12 random bytes + ciphertext). The key material lives in a
-- private table no login can read (RLS on, no grants); the key row in core.encryption_keys says where (kms_ref).
-- Moving the material to Supabase Vault or a KMS later only changes private.pii_secret().
CREATE TABLE IF NOT EXISTS private.pii_keys (
    key_id UUID PRIMARY KEY REFERENCES core.encryption_keys (id),
    secret BYTEA NOT NULL CHECK (length(secret) = 32)
);
ALTER TABLE private.pii_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pii_keys FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION private.pii_key(p_tenant UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id UUID;
BEGIN
    SELECT k.id INTO v_id FROM core.encryption_keys k JOIN private.pii_keys s ON s.key_id = k.id
    WHERE k.tenant_id = p_tenant AND k.purpose = 'pii_db_key' AND k.state = 'active' ORDER BY k.created_at DESC LIMIT 1;
    IF v_id IS NULL THEN
        INSERT INTO core.encryption_keys (id, tenant_id, purpose, kms_ref, state)
        VALUES (gen_random_uuid(), p_tenant, 'pii_db_key', 'db:private.pii_keys', 'active') RETURNING id INTO v_id;
        INSERT INTO private.pii_keys (key_id, secret) VALUES (v_id, extensions.gen_random_bytes(32));
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.pii_seal(p_tenant UUID, p_value TEXT)
RETURNS BYTEA LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_key UUID; v_secret BYTEA;
BEGIN
    IF p_value IS NULL THEN RETURN NULL; END IF;
    v_key := private.pii_key(p_tenant);
    SELECT secret INTO v_secret FROM private.pii_keys WHERE key_id = v_key;
    RETURN '\x454e4331'::bytea || uuid_send(v_key) || extensions.gen_random_bytes(12)
        || extensions.pgp_sym_encrypt_bytea(convert_to(p_value, 'UTF8'), encode(v_secret, 'hex'), 'cipher-algo=aes256');
END;
$$;

CREATE OR REPLACE FUNCTION private.pii_open(p_sealed BYTEA)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_secret BYTEA;
BEGIN
    IF p_sealed IS NULL THEN RETURN NULL; END IF;
    SELECT secret INTO v_secret FROM private.pii_keys WHERE key_id = private.envelope_key(p_sealed);
    IF v_secret IS NULL THEN RAISE EXCEPTION 'the key of this value is not here'; END IF;
    RETURN convert_from(extensions.pgp_sym_decrypt_bytea(substring(p_sealed FROM 33), encode(v_secret, 'hex')), 'UTF8');
END;
$$;

-- ---------------------------------------------------------------- checks of what people type
CREATE OR REPLACE FUNCTION private.iban_ok(p TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE s TEXT := upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')); r TEXT := ''; ch TEXT; m INT := 0; i INT;
BEGIN
    IF s !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' THEN RETURN FALSE; END IF;
    IF left(s, 2) = 'PT' AND length(s) <> 25 THEN RETURN FALSE; END IF;
    s := substring(s FROM 5) || left(s, 4);
    FOR i IN 1 .. length(s) LOOP
        ch := substring(s FROM i FOR 1);
        r := CASE WHEN ch ~ '[A-Z]' THEN (ascii(ch) - 55)::text ELSE ch END;
        FOR j IN 1 .. length(r) LOOP m := (m * 10 + substring(r FROM j FOR 1)::int) % 97; END LOOP;
    END LOOP;
    RETURN m = 1;
END;
$$;

-- Portuguese NISS: 11 digits, check digit with the weights 29,23,19,17,13,11,7,5,3,2.
CREATE OR REPLACE FUNCTION private.niss_ok(p TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE s TEXT := regexp_replace(coalesce(p, ''), '\s', '', 'g'); w INT[] := ARRAY[29, 23, 19, 17, 13, 11, 7, 5, 3, 2]; t INT := 0;
BEGIN
    IF s !~ '^[12][0-9]{10}$' THEN RETURN FALSE; END IF;
    FOR i IN 1 .. 10 LOOP t := t + substring(s FROM i FOR 1)::int * w[i]; END LOOP;
    RETURN 9 - (t % 10) = substring(s FROM 11 FOR 1)::int;
END;
$$;

-- «João  Silva» = «joão silva»: names compared without case, accents or double spaces.
CREATE OR REPLACE FUNCTION private.name_key(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT lower(regexp_replace(translate(trim(coalesce(p, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                                                                'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION private.sha256_text(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT encode(extensions.digest(convert_to(coalesce(p, ''), 'UTF8'), 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------------- the company's texts (models)
CREATE OR REPLACE FUNCTION private.onb_default_texts(p_tenant UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM core.contract_templates WHERE tenant_id = p_tenant AND kind = 'contract') THEN
        INSERT INTO core.contract_templates (tenant_id, name, version, kind, body_template) VALUES (p_tenant, 'Contrato de trabalho', 1, 'contract',
'CONTRATO DE TRABALHO ({{tipo}})

[MODELO DA GESTNOW: a empresa deve substituir este texto pelo seu contrato, revisto por um advogado do trabalho.]

Entre {{empresa}}, NIF {{nif_empresa}}, adiante «Empregador», e {{nome}}, NIF {{nif}}, adiante «Trabalhador», é celebrado o presente contrato de trabalho, que se rege pelas cláusulas seguintes e pelo Código do Trabalho.

1.ª Funções. O Trabalhador é contratado para exercer as funções de {{funcao}}, e as que lhe sejam afins ou funcionalmente ligadas, para as quais tenha qualificação adequada.

2.ª Local de trabalho. O trabalho é prestado em {{local}} e nas obras do Empregador para onde seja destacado, de acordo com o artigo 194.º do Código do Trabalho.

3.ª Duração. O contrato tem início em {{inicio}}{{fim}}.

4.ª Período normal de trabalho. O período normal de trabalho é de {{horas_semana}} horas por semana, distribuídas segundo o horário em vigor em cada obra. O tempo de trabalho é registado pelo cartão pessoal do Trabalhador (artigo 202.º).

5.ª Retribuição. O Trabalhador aufere {{preco_hora}} por hora de trabalho normal. O trabalho suplementar é pago a {{preco_extra}} por hora, nos termos legais. {{condicoes}}

6.ª Segurança. O Trabalhador obriga-se a cumprir as regras de segurança e saúde no trabalho, o regulamento interno e as regras de cada cliente e obra, e a usar o equipamento de proteção individual que lhe é entregue, sem qualquer custo para si.

7.ª Dados pessoais. O Empregador trata os dados pessoais do Trabalhador para a execução deste contrato e para cumprir obrigações legais, nos termos do RGPD. O Trabalhador recebeu a informação sobre esse tratamento.

8.ª Assinatura. Este contrato é assinado eletronicamente na aplicação GestNow. O texto assinado fica guardado com a sua impressão digital (SHA-256), data, hora e origem da assinatura.

Feito em {{data}}.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM core.contract_templates WHERE tenant_id = p_tenant AND kind = 'rules') THEN
        INSERT INTO core.contract_templates (tenant_id, name, version, kind, body_template) VALUES (p_tenant, 'Regulamento interno', 1, 'rules',
'REGULAMENTO INTERNO

[MODELO DA GESTNOW: a empresa deve substituir este texto pelo seu regulamento.]

1. Segurança primeiro. Ninguém começa um trabalho sem fazer a análise de risco do dia (LMRA). Quem vê um perigo pára o trabalho e avisa o encarregado. Ninguém é penalizado por parar um trabalho inseguro.
2. Álcool e drogas: tolerância zero. Pode haver testes nas obras dos clientes.
3. Equipamento de proteção: capacete, óculos, botas, luvas e roupa de trabalho são obrigatórios em obra. São entregues pela empresa e não se pagam.
4. Cartão pessoal. O cartão serve para picar a entrada e a saída. É pessoal: picar por outra pessoa é falta grave.
5. Horário. Cumpre o horário da obra. Se faltares ou chegares atrasado, avisa o encarregado antes do início.
6. Telemóvel. Nas zonas ATEX e onde o cliente proibir, o telemóvel não entra.
7. Alojamento e viaturas da empresa. Cuida deles como se fossem teus. Danos e multas são comunicados no próprio dia.
8. Confidencialidade. O que vês nas instalações dos clientes não se fotografa nem se partilha.
9. Respeito. Assédio e discriminação não são tolerados.
10. Dúvidas. Fala com o teu encarregado ou com o RH.');
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.onb_template(p_tenant UUID, p_kind TEXT)
RETURNS core.contract_templates LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t core.contract_templates;
BEGIN
    PERFORM private.onb_default_texts(p_tenant);
    SELECT * INTO t FROM core.contract_templates WHERE tenant_id = p_tenant AND kind = p_kind AND is_active
    ORDER BY version DESC LIMIT 1;
    RETURN t;
END;
$$;

-- ---------------------------------------------------------------- what the person sees (steps 2-5)
CREATE OR REPLACE FUNCTION private.onb_docs(p_collab UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object('type_id', t.id, 'code', t.code, 'name', t.name, 'required', t.required_for_all,
              'blocking', t.is_blocking, 'automatic', t.code = 'acolhimento',
              'doc', (SELECT jsonb_build_object('id', d.id, 'number', d.document_number, 'issue', d.issue_date, 'expiry', d.expiration_date,
                         'verified', d.verified_at IS NOT NULL, 'has_file', d.file_url IS NOT NULL,
                         'expired', d.expiration_date IS NOT NULL AND d.expiration_date < current_date)
                      FROM core.collaborator_documents d WHERE d.collaborator_id = c.id AND d.document_type_id = t.id AND d.is_current
                      ORDER BY d.created_at DESC LIMIT 1))
              ORDER BY NOT t.required_for_all, t.code = 'acolhimento', t.name), '[]'::jsonb)
    FROM core.collaborators c JOIN core.document_types t ON (t.tenant_id = c.tenant_id OR t.tenant_id IS NULL) AND t.applies_to = 'collaborator'
    WHERE c.id = p_collab;
$$;

-- The person's data as the onboarding screens show it (same keys as the HR card, mini_save_worker_profile). Never the NISS/IBAN.
CREATE OR REPLACE FUNCTION private.onb_data(p_collab UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object('phone', c.phone, 'email', c.email,
        'address', s.address, 'postal_code', s.postal_code, 'locality', s.locality, 'municipality', s.municipality,
        'birth_date', s.birth_date, 'birthplace', s.birthplace, 'nationality', s.nationality, 'sex', s.sex,
        'marital_status', s.marital_status, 'dependents', s.irs_dependents, 'irs_holders', s.irs_holders, 'irs_disability', s.irs_disability,
        'education', s.education_level, 'id_type', s.id_document_type, 'id_number', s.id_document_number, 'id_expiry', s.id_document_expiry,
        'emergency_name', s.emergency_contact_name, 'emergency_relation', s.emergency_contact_relation, 'emergency_phone', s.emergency_contact_phone,
        'niss_set', s.social_security_number_enc IS NOT NULL, 'niss_last3', s.niss_last3,
        'iban_set', s.iban_enc IS NOT NULL, 'iban_last4', s.iban_last4,
        'size_top', c.size_top, 'size_bottom', c.size_bottom, 'size_shoes', c.size_shoes, 'size_gloves', c.size_gloves,
        'language', c.preferred_language)
    FROM core.collaborators c LEFT JOIN core.collaborator_sensitive s ON s.collaborator_id = c.id
    WHERE c.id = p_collab
$$;

CREATE OR REPLACE FUNCTION public.mini_onb_me()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_me UUID := (SELECT private.me());
    c core.collaborators;
    s core.collaborator_sensitive;
    k core.employment_contracts;
    r core.contract_templates;
    v_ext BOOLEAN;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = v_me;
    IF NOT c.is_active THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT o.kind = 'subcontractor' INTO v_ext FROM core.organizations o WHERE o.id = c.organization_id;
    SELECT * INTO s FROM core.collaborator_sensitive WHERE collaborator_id = v_me;
    SELECT * INTO k FROM core.employment_contracts WHERE collaborator_id = v_me AND status IN ('issued', 'signed')
    ORDER BY issued_at DESC LIMIT 1;
    IF k.id IS NOT NULL AND k.rules_template_id IS NOT NULL THEN
        SELECT * INTO r FROM core.contract_templates WHERE id = k.rules_template_id;
    ELSE
        r := private.onb_template(c.tenant_id, 'rules');
    END IF;
    RETURN jsonb_build_object(
        'status', c.onboarding_status, 'external', v_ext, 'name', c.full_name, 'tax_number', c.tax_number,
        'company', (SELECT t.legal_name FROM core.tenants t WHERE t.id = c.tenant_id),
        'steps', (SELECT coalesce(jsonb_object_agg(x.step, jsonb_build_object('at', x.completed_at, 'paper', x.evidence ->> 'method' = 'paper')), '{}'::jsonb)
                  FROM compliance.onboarding_steps x WHERE x.collaborator_id = v_me),
        'data', private.onb_data(v_me),
        'documents', private.onb_docs(v_me),
        'note', (SELECT jsonb_build_object('text', n.note, 'at', n.written_at) FROM core.onboarding_notes n
                 WHERE n.collaborator_id = v_me ORDER BY n.written_at DESC LIMIT 1),
        'contract', CASE WHEN k.id IS NOT NULL THEN jsonb_build_object('id', k.id, 'status', k.status, 'body', k.body_text, 'sha256', k.pdf_sha256,
            'type', k.contract_type, 'start', k.start_date, 'end', k.end_date, 'weekly_hours', k.weekly_hours, 'location', k.work_location,
            'job_title', k.job_title, 'issued_at', k.issued_at, 'signed_at', k.signed_at) END,
        'rules', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('id', r.id, 'title', r.name, 'version', r.version, 'body', r.body_template,
            'sha256', private.sha256_text(r.body_template)) END,
        'rates', CASE WHEN s.base_hourly_rate IS NOT NULL THEN jsonb_build_object('base', s.base_hourly_rate, 'overtime', s.overtime_hourly_rate,
            'terms', s.allowance_terms) END,
        'accepted', (SELECT jsonb_build_object('at', a.accepted_at, 'base', a.base_hourly_rate, 'overtime', a.overtime_hourly_rate)
                     FROM core.rate_acceptances a WHERE a.collaborator_id = v_me ORDER BY a.accepted_at DESC LIMIT 1),
        'server_now', now());
END;
$$;

-- Step 2: the person's own data. Allowed while HR has not validated yet (so a note from HR can be answered).
CREATE OR REPLACE FUNCTION public.mini_onb_save_data(p JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_me UUID := (SELECT private.me());
    c core.collaborators;
    v_niss TEXT := nullif(regexp_replace(coalesce(p ->> 'niss', ''), '\s', '', 'g'), '');
    v_iban TEXT := nullif(upper(regexp_replace(coalesce(p ->> 'iban', ''), '\s', '', 'g')), '');
    v_birth DATE; v_expiry DATE; v_dep SMALLINT; v_hold SMALLINT;
    v TEXT;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = v_me FOR UPDATE;
    IF NOT c.is_active THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF c.onboarding_status NOT IN ('pending_data', 'pending_hr_validation') THEN
        RAISE EXCEPTION 'your data is already validated: ask HR to change it';
    END IF;
    IF v_niss IS NOT NULL AND NOT private.niss_ok(v_niss) THEN RAISE EXCEPTION 'the social security number (NISS) is not valid: check the 11 digits'; END IF;
    IF v_iban IS NOT NULL AND NOT private.iban_ok(v_iban) THEN RAISE EXCEPTION 'the IBAN is not valid: check it on your bank card or app'; END IF;
    BEGIN
        v_birth := nullif(p ->> 'birth_date', '')::date;
        v_expiry := nullif(p ->> 'id_expiry', '')::date;
        v_dep := nullif(p ->> 'dependents', '')::smallint;
        v_hold := nullif(p ->> 'irs_holders', '')::smallint;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'check the dates and numbers';
    END;
    -- same rules as the HR card (mini_save_worker_profile)
    IF v_birth IS NOT NULL AND (v_birth > current_date - interval '16 years' OR v_birth < current_date - interval '90 years') THEN
        RAISE EXCEPTION 'birth date: the person must be 16 to 90 years old';
    END IF;
    IF v_expiry IS NOT NULL AND v_expiry < current_date THEN RAISE EXCEPTION 'your ID document has expired: renew it before starting'; END IF;
    IF coalesce(nullif(p ->> 'nationality', ''), 'PT') !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'nationality: country code of 2 letters'; END IF;
    IF coalesce(nullif(p ->> 'sex', ''), 'M') NOT IN ('M', 'F') THEN RAISE EXCEPTION 'sex: M or F'; END IF;
    IF coalesce(nullif(p ->> 'marital_status', ''), 'single') NOT IN ('single', 'married', 'civil_union', 'divorced', 'widowed') THEN
        RAISE EXCEPTION 'marital status not valid';
    END IF;
    IF coalesce(nullif(p ->> 'education', ''), 'basic') NOT IN ('basic', 'secondary', 'vocational', 'higher', 'other') THEN
        RAISE EXCEPTION 'education level not valid';
    END IF;
    IF coalesce(nullif(p ->> 'id_type', ''), 'other') NOT IN ('citizen_card', 'passport', 'residence_permit', 'other') THEN
        RAISE EXCEPTION 'document type not valid';
    END IF;
    IF v_dep IS NOT NULL AND v_dep NOT BETWEEN 0 AND 20 THEN RAISE EXCEPTION 'dependents: 0 to 20'; END IF;
    IF v_hold IS NOT NULL AND v_hold NOT IN (1, 2) THEN RAISE EXCEPTION 'IRS holders: 1 or 2'; END IF;
    IF coalesce(nullif(p ->> 'size_top', ''), 'M') NOT IN ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL') THEN RAISE EXCEPTION 'shirt size: XS to XXXL'; END IF;
    IF coalesce(nullif(p ->> 'size_bottom', ''), 'M') NOT IN ('XS', 'S', 'M', 'L', 'XL', 'XXL') THEN RAISE EXCEPTION 'trousers size: XS to XXL'; END IF;
    IF coalesce(nullif(p ->> 'size_shoes', ''), '42') !~ '^(3[4-9]|4[0-9]|50)$' THEN RAISE EXCEPTION 'boots size: 34 to 50'; END IF;
    IF coalesce(nullif(p ->> 'size_gloves', ''), '9') !~ '^([6-9]|1[0-2])$' THEN RAISE EXCEPTION 'gloves size: 6 to 12'; END IF;
    FOREACH v IN ARRAY ARRAY[p ->> 'phone', p ->> 'emergency_phone'] LOOP
        IF nullif(trim(v), '') IS NOT NULL AND trim(v) !~ '^\+?[0-9 ]{9,20}$' THEN RAISE EXCEPTION 'phone: digits only, 9 to 20'; END IF;
    END LOOP;
    IF nullif(trim(p ->> 'postal_code'), '') IS NOT NULL AND coalesce(nullif(p ->> 'nationality', ''), 'PT') = 'PT'
       AND trim(p ->> 'postal_code') !~ '^[0-9]{4}-[0-9]{3}$' THEN
        RAISE EXCEPTION 'postal code: 0000-000';
    END IF;
    IF length(coalesce(p ->> 'address', '')) > 200 OR length(coalesce(p ->> 'id_number', '')) > 30
       OR length(coalesce(p ->> 'emergency_name', '')) > 80 OR length(coalesce(p ->> 'emergency_relation', '')) > 40
       OR length(coalesce(p ->> 'locality', '')) > 80 OR length(coalesce(p ->> 'municipality', '')) > 80 OR length(coalesce(p ->> 'birthplace', '')) > 80 THEN
        RAISE EXCEPTION 'a field is too long';
    END IF;
    PERFORM set_config('app.reason', 'Acolhimento: o próprio preencheu os seus dados', true);
    UPDATE core.collaborators SET
        phone = coalesce(nullif(trim(p ->> 'phone'), ''), phone),
        size_top = coalesce(nullif(p ->> 'size_top', ''), size_top),
        size_bottom = coalesce(nullif(p ->> 'size_bottom', ''), size_bottom),
        size_shoes = coalesce(nullif(p ->> 'size_shoes', ''), size_shoes),
        size_gloves = coalesce(nullif(p ->> 'size_gloves', ''), size_gloves),
        preferred_language = coalesce(nullif(trim(p ->> 'language'), ''), preferred_language),
        updated_at = now()
    WHERE id = v_me;
    INSERT INTO core.collaborator_sensitive (collaborator_id, tenant_id) VALUES (v_me, c.tenant_id) ON CONFLICT (collaborator_id) DO NOTHING;
    UPDATE core.collaborator_sensitive SET
        address = coalesce(nullif(trim(p ->> 'address'), ''), address),
        postal_code = coalesce(nullif(trim(p ->> 'postal_code'), ''), postal_code),
        locality = coalesce(nullif(trim(p ->> 'locality'), ''), locality),
        municipality = coalesce(nullif(trim(p ->> 'municipality'), ''), municipality),
        birth_date = coalesce(v_birth, birth_date),
        birthplace = coalesce(nullif(trim(p ->> 'birthplace'), ''), birthplace),
        nationality = coalesce(nullif(p ->> 'nationality', ''), nationality),
        sex = coalesce(nullif(p ->> 'sex', ''), sex),
        marital_status = coalesce(nullif(p ->> 'marital_status', ''), marital_status),
        irs_dependents = coalesce(v_dep, irs_dependents),
        irs_holders = coalesce(v_hold, irs_holders),
        irs_disability = coalesce((nullif(p ->> 'irs_disability', ''))::boolean, irs_disability),
        education_level = coalesce(nullif(p ->> 'education', ''), education_level),
        id_document_type = coalesce(nullif(p ->> 'id_type', ''), id_document_type),
        id_document_number = coalesce(nullif(trim(p ->> 'id_number'), ''), id_document_number),
        id_document_expiry = coalesce(v_expiry, id_document_expiry),
        emergency_contact_name = coalesce(nullif(trim(p ->> 'emergency_name'), ''), emergency_contact_name),
        emergency_contact_relation = coalesce(nullif(trim(p ->> 'emergency_relation'), ''), emergency_contact_relation),
        emergency_contact_phone = coalesce(nullif(trim(p ->> 'emergency_phone'), ''), emergency_contact_phone),
        social_security_number_enc = CASE WHEN v_niss IS NOT NULL THEN private.pii_seal(c.tenant_id, v_niss) ELSE social_security_number_enc END,
        niss_last3 = CASE WHEN v_niss IS NOT NULL THEN right(v_niss, 3) ELSE niss_last3 END,
        iban_enc = CASE WHEN v_iban IS NOT NULL THEN private.pii_seal(c.tenant_id, v_iban) ELSE iban_enc END,
        iban_last4 = CASE WHEN v_iban IS NOT NULL THEN right(v_iban, 4) ELSE iban_last4 END,
        updated_at = now()
    WHERE collaborator_id = v_me;
    RETURN public.mini_onb_me();
END;
$$;

-- Step 2: a document of their own (the file is already in the private bucket, under the person's own folder).
CREATE OR REPLACE FUNCTION public.mini_onb_add_document(p_type UUID, p_number TEXT, p_issue DATE, p_expiry DATE,
    p_file TEXT, p_sha256 TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_me UUID := (SELECT private.me());
    c core.collaborators;
    t core.document_types;
    v_prev UUID;
    v_id UUID;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = v_me;
    IF NOT c.is_active OR c.onboarding_status NOT IN ('pending_data', 'pending_hr_validation') THEN
        RAISE EXCEPTION 'documents are now handled by HR';
    END IF;
    SELECT * INTO t FROM core.document_types WHERE id = p_type AND (tenant_id = c.tenant_id OR tenant_id IS NULL) AND applies_to = 'collaborator';
    IF NOT FOUND THEN RAISE EXCEPTION 'document type not found'; END IF;
    IF t.code = 'acolhimento' THEN RAISE EXCEPTION 'the safety induction is recorded by the app itself'; END IF;
    IF coalesce(p_file, '') !~ ('^' || c.tenant_id::text || '/' || v_me::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$') THEN
        RAISE EXCEPTION 'add the photo or PDF of the document';
    END IF;
    IF coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid file fingerprint'; END IF;
    IF p_issue IS NULL THEN RAISE EXCEPTION 'the issue date is required'; END IF;
    IF p_issue > current_date THEN RAISE EXCEPTION 'the issue date cannot be in the future'; END IF;
    IF p_expiry IS NOT NULL AND p_expiry < p_issue THEN RAISE EXCEPTION 'the expiry date is before the issue date'; END IF;
    SELECT id INTO v_prev FROM core.collaborator_documents WHERE collaborator_id = v_me AND document_type_id = t.id AND is_current;
    PERFORM set_config('app.reason', 'Acolhimento: o próprio entregou o documento', true);
    IF v_prev IS NOT NULL THEN UPDATE core.collaborator_documents SET is_current = FALSE WHERE id = v_prev; END IF;
    INSERT INTO core.collaborator_documents (tenant_id, collaborator_id, document_type_id, document_number, file_url, file_sha256,
        issue_date, expiration_date, supersedes_id, is_current, uploaded_by)
    VALUES (c.tenant_id, v_me, t.id, nullif(trim(p_number), ''), p_file, p_sha256, p_issue, p_expiry, v_prev, TRUE, auth.uid())
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Step 2 done: send to HR. Everything the law and the payroll need must be there.
CREATE OR REPLACE FUNCTION public.mini_onb_submit_data()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_me UUID := (SELECT private.me());
    c core.collaborators;
    s core.collaborator_sensitive;
    v_missing TEXT[] := '{}';
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = v_me FOR UPDATE;
    IF NOT c.is_active THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF c.onboarding_status <> 'pending_data' THEN RAISE EXCEPTION 'not at the personal data step (%)', c.onboarding_status; END IF;
    SELECT * INTO s FROM core.collaborator_sensitive WHERE collaborator_id = v_me;
    IF s.social_security_number_enc IS NULL THEN v_missing := v_missing || 'NISS'::text; END IF;
    IF s.iban_enc IS NULL THEN v_missing := v_missing || 'IBAN'::text; END IF;
    IF s.address IS NULL OR s.postal_code IS NULL OR s.locality IS NULL THEN v_missing := v_missing || 'morada'::text; END IF;
    IF s.birth_date IS NULL THEN v_missing := v_missing || 'data de nascimento'::text; END IF;
    IF s.nationality IS NULL THEN v_missing := v_missing || 'nacionalidade'::text; END IF;
    IF s.id_document_type IS NULL OR s.id_document_number IS NULL OR s.id_document_expiry IS NULL THEN
        v_missing := v_missing || 'documento de identificação'::text;
    END IF;
    IF s.marital_status IS NULL OR s.irs_dependents IS NULL THEN v_missing := v_missing || 'estado civil e dependentes (IRS)'::text; END IF;
    IF s.emergency_contact_name IS NULL OR s.emergency_contact_phone IS NULL THEN v_missing := v_missing || 'contacto de emergência'::text; END IF;
    IF c.size_top IS NULL OR c.size_shoes IS NULL THEN v_missing := v_missing || 'tamanhos'::text; END IF;
    IF cardinality(v_missing) > 0 THEN RAISE EXCEPTION 'missing: %', array_to_string(v_missing, ', '); END IF;
    INSERT INTO compliance.onboarding_steps (tenant_id, collaborator_id, step, completed_by, evidence)
    VALUES (c.tenant_id, v_me, 'personal_data', auth.uid(), jsonb_build_object('method', 'app', 'ip', private.request_ip()));
    PERFORM private.notify(c.tenant_id, 'hr', NULL, NULL, 'onboarding_review', 'medium',
        'Dados e documentos para validar: ' || c.full_name, jsonb_build_object('collaborator_id', v_me));
    RETURN public.mini_onb_me();
END;
$$;

-- Step 4: sign. The text signed is the one stored (same SHA-256), and the rules shown with it are accepted too.
CREATE OR REPLACE FUNCTION public.mini_onb_sign(p_contract UUID, p_sha256 TEXT, p_rules_sha256 TEXT, p_name TEXT,
    p_signature_svg TEXT, p_agent TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_me UUID := (SELECT private.me());
    c core.collaborators;
    k core.employment_contracts;
    r core.contract_templates;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = v_me;
    IF NOT c.is_active OR c.onboarding_status <> 'pending_contract' THEN RAISE EXCEPTION 'there is no contract waiting for your signature'; END IF;
    SELECT * INTO k FROM core.employment_contracts WHERE id = p_contract AND collaborator_id = v_me FOR UPDATE;
    IF NOT FOUND OR k.status <> 'issued' THEN RAISE EXCEPTION 'contract not found or not open for signature'; END IF;
    IF k.pdf_sha256 IS DISTINCT FROM p_sha256 OR private.sha256_text(k.body_text) IS DISTINCT FROM k.pdf_sha256 THEN
        RAISE EXCEPTION 'the contract changed: open it again';
    END IF;
    SELECT * INTO r FROM core.contract_templates WHERE id = k.rules_template_id;
    IF r.id IS NOT NULL AND private.sha256_text(r.body_template) IS DISTINCT FROM p_rules_sha256 THEN
        RAISE EXCEPTION 'the internal rules changed: open them again';
    END IF;
    IF private.name_key(p_name) <> private.name_key(c.full_name) THEN
        RAISE EXCEPTION 'write your full name exactly as in the contract: %', c.full_name;
    END IF;
    IF coalesce(p_signature_svg, '') !~ '^<svg[^>]*>.*</svg>$' OR length(p_signature_svg) NOT BETWEEN 200 AND 60000 THEN
        RAISE EXCEPTION 'sign with your finger in the box';
    END IF;
    IF p_signature_svg ~* '(script|onload|onerror|href|foreignobject)' THEN RAISE EXCEPTION 'invalid signature'; END IF;
    PERFORM set_config('app.reason', 'Acolhimento: contrato assinado na app', true);
    UPDATE core.employment_contracts SET status = 'signed', signed_at = now(), signed_name = trim(p_name), signature_svg = p_signature_svg,
        signature_agent = left(p_agent, 300), signature_ip = private.request_ip(), rules_sha256 = p_rules_sha256
    WHERE id = k.id;
    INSERT INTO compliance.onboarding_steps (tenant_id, collaborator_id, step, completed_by, evidence)
    VALUES (c.tenant_id, v_me, 'contract_signed', auth.uid(), jsonb_build_object('method', 'app', 'contract_id', k.id, 'contract_sha256', k.pdf_sha256,
        'rules_template_id', r.id, 'rules_version', r.version, 'rules_sha256', p_rules_sha256, 'ip', private.request_ip(), 'agent', left(p_agent, 300)));
    PERFORM private.notify(c.tenant_id, 'hr', NULL, NULL, 'contract_signed', 'low',
        'Contrato assinado: ' || c.full_name, jsonb_build_object('collaborator_id', v_me, 'contract_id', k.id));
    RETURN public.mini_onb_me();
END;
$$;

-- Step 5: the pay terms, as a snapshot. After this the person is active.
CREATE OR REPLACE FUNCTION public.mini_onb_accept_rates()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_me UUID := (SELECT private.me());
    c core.collaborators;
    s core.collaborator_sensitive;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = v_me;
    IF NOT c.is_active OR c.onboarding_status <> 'pending_rate_approval' THEN RAISE EXCEPTION 'not at the pay terms step'; END IF;
    SELECT * INTO s FROM core.collaborator_sensitive WHERE collaborator_id = v_me;
    IF s.base_hourly_rate IS NULL THEN RAISE EXCEPTION 'HR has not set the pay terms yet'; END IF;
    INSERT INTO core.rate_acceptances (tenant_id, collaborator_id, base_hourly_rate, overtime_hourly_rate, allowance_terms, ip)
    VALUES (c.tenant_id, v_me, s.base_hourly_rate, coalesce(s.overtime_hourly_rate, s.base_hourly_rate), s.allowance_terms, private.request_ip());
    INSERT INTO compliance.onboarding_steps (tenant_id, collaborator_id, step, completed_by, evidence)
    VALUES (c.tenant_id, v_me, 'rate_accepted', auth.uid(), jsonb_build_object('method', 'app', 'base', s.base_hourly_rate,
        'overtime', s.overtime_hourly_rate, 'ip', private.request_ip()));
    PERFORM private.notify(c.tenant_id, 'hr', NULL, NULL, 'onboarding_done', 'low',
        'Acolhimento concluído: ' || c.full_name || '. Falta dar-lhe o cartão.', jsonb_build_object('collaborator_id', v_me));
    RETURN public.mini_onb_me();
END;
$$;

-- After onboarding: the person's own papers (contract, rules, pay terms), for «O meu contrato».
CREATE OR REPLACE FUNCTION public.mini_my_papers()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_me UUID := (SELECT private.me());
    k core.employment_contracts;
    r core.contract_templates;
    a core.rate_acceptances;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO k FROM core.employment_contracts WHERE collaborator_id = v_me AND status = 'signed' ORDER BY signed_at DESC LIMIT 1;
    SELECT * INTO r FROM core.contract_templates WHERE id = k.rules_template_id;
    SELECT * INTO a FROM core.rate_acceptances WHERE collaborator_id = v_me ORDER BY accepted_at DESC LIMIT 1;
    RETURN jsonb_build_object(
        'contract', CASE WHEN k.id IS NOT NULL THEN jsonb_build_object('status', k.status, 'title', 'Contrato de trabalho', 'type', k.contract_type,
            'start', k.start_date, 'end', k.end_date, 'weekly_hours', k.weekly_hours, 'location', k.work_location, 'job_title', k.job_title,
            'signed_at', k.signed_at, 'signed_name', k.signed_name, 'signature_svg', k.signature_svg, 'sha256', k.pdf_sha256, 'body', k.body_text) END,
        'rules', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('title', r.name, 'version', r.version, 'accepted_at', k.signed_at,
            'body', r.body_template) END,
        'rates', CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('base_hourly_rate', a.base_hourly_rate,
            'overtime_hourly_rate', a.overtime_hourly_rate, 'terms', a.allowance_terms, 'accepted_at', a.accepted_at) END,
        'paper', EXISTS (SELECT 1 FROM compliance.onboarding_steps x WHERE x.collaborator_id = v_me AND x.evidence ->> 'method' = 'paper'));
END;
$$;

-- ---------------------------------------------------------------- HR (pessoas.gerir: always with the phone code)
CREATE OR REPLACE FUNCTION public.mini_onb_person(p_collab UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('pessoas.gerir');
    c core.collaborators;
    s core.collaborator_sensitive;
    k core.employment_contracts;
BEGIN
    SELECT * INTO c FROM core.collaborators WHERE id = p_collab AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'collaborator not found'; END IF;
    SELECT * INTO s FROM core.collaborator_sensitive WHERE collaborator_id = c.id;
    SELECT * INTO k FROM core.employment_contracts WHERE collaborator_id = c.id AND status IN ('issued', 'signed') ORDER BY issued_at DESC LIMIT 1;
    RETURN jsonb_build_object('id', c.id, 'name', c.full_name, 'tax_number', c.tax_number, 'status', c.onboarding_status,
        'job_title', c.job_title, 'phone', c.phone,
        'steps', (SELECT coalesce(jsonb_object_agg(x.step, jsonb_build_object('at', x.completed_at, 'paper', x.evidence ->> 'method' = 'paper')), '{}'::jsonb)
                  FROM compliance.onboarding_steps x WHERE x.collaborator_id = c.id),
        'data', CASE WHEN (SELECT private.can('pessoas.dados_pessoais')) THEN private.onb_data(c.id) END,
        'data_ready', s.social_security_number_enc IS NOT NULL AND s.iban_enc IS NOT NULL AND s.address IS NOT NULL,
        'documents', private.onb_docs(c.id),
        'notes', (SELECT coalesce(jsonb_agg(jsonb_build_object('text', n.note, 'at', n.written_at) ORDER BY n.written_at DESC), '[]'::jsonb)
                  FROM core.onboarding_notes n WHERE n.collaborator_id = c.id),
        'contract', CASE WHEN k.id IS NOT NULL THEN jsonb_build_object('id', k.id, 'status', k.status, 'type', k.contract_type, 'start', k.start_date,
            'end', k.end_date, 'weekly_hours', k.weekly_hours, 'location', k.work_location, 'job_title', k.job_title, 'issued_at', k.issued_at,
            'signed_at', k.signed_at, 'signed_name', k.signed_name, 'signature_svg', k.signature_svg, 'sha256', k.pdf_sha256, 'body', k.body_text) END,
        'rates', jsonb_build_object('base', s.base_hourly_rate, 'overtime', s.overtime_hourly_rate, 'terms', s.allowance_terms),
        'accepted', (SELECT jsonb_build_object('at', a.accepted_at, 'base', a.base_hourly_rate, 'overtime', a.overtime_hourly_rate)
                     FROM core.rate_acceptances a WHERE a.collaborator_id = c.id ORDER BY a.accepted_at DESC LIMIT 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.mini_onb_note(p_collab UUID, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant UUID := private.simple_mode_perm('pessoas.gerir');
BEGIN
    IF NOT EXISTS (SELECT 1 FROM core.collaborators WHERE id = p_collab AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'collaborator not found'; END IF;
    IF length(trim(coalesce(p_note, ''))) < 3 THEN RAISE EXCEPTION 'write what is missing'; END IF;
    INSERT INTO core.onboarding_notes (tenant_id, collaborator_id, note, written_by) VALUES (v_tenant, p_collab, trim(p_note), auth.uid());
END;
$$;

-- HR checks one document (has seen the file and the dates are right).
CREATE OR REPLACE FUNCTION public.mini_onb_verify_document(p_doc UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant UUID := private.simple_mode_perm('pessoas.gerir', 'documentos.gerir');
BEGIN
    PERFORM set_config('app.reason', 'Acolhimento: o RH conferiu o documento', true);
    UPDATE core.collaborator_documents SET verified_by = auth.uid(), verified_at = now()
    WHERE id = p_doc AND tenant_id = v_tenant AND is_current AND verified_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'document not found or already checked'; END IF;
END;
$$;

-- Step 3: HR validates. Each required document must be there, current, not expired and checked one by one.
CREATE OR REPLACE FUNCTION public.mini_onb_validate(p_collab UUID, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('pessoas.gerir');
    c core.collaborators;
    v_missing TEXT;
BEGIN
    SELECT * INTO c FROM core.collaborators WHERE id = p_collab AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'collaborator not found'; END IF;
    IF c.onboarding_status <> 'pending_hr_validation' THEN RAISE EXCEPTION 'not waiting for HR (%)', c.onboarding_status; END IF;
    SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO v_missing FROM core.document_types t
    WHERE (t.tenant_id IS NULL OR t.tenant_id = c.tenant_id) AND t.applies_to = 'collaborator' AND t.required_for_all AND t.code <> 'acolhimento'
      AND NOT EXISTS (SELECT 1 FROM core.collaborator_documents d
                      WHERE d.collaborator_id = c.id AND d.document_type_id = t.id AND d.is_current AND d.verified_at IS NOT NULL
                        AND (d.expiration_date IS NULL OR d.expiration_date >= current_date));
    IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'check these documents first (open each one and confirm it): %', v_missing; END IF;
    INSERT INTO compliance.onboarding_steps (tenant_id, collaborator_id, step, completed_by, evidence)
    VALUES (c.tenant_id, c.id, 'hr_validation', auth.uid(), jsonb_build_object('method', 'app', 'notes', nullif(trim(p_note), '')));
    RETURN public.mini_onb_person(c.id);
END;
$$;

-- Step 4 (HR side): the contract, generated from the company's model with the person's data. Issuing again replaces
-- an unsigned contract (the old one is kept as void).
CREATE OR REPLACE FUNCTION public.mini_onb_issue_contract(p_collab UUID, p_type TEXT, p_start DATE, p_end DATE, p_weekly_hours NUMERIC,
    p_location TEXT, p_job_title TEXT, p_base NUMERIC, p_overtime NUMERIC, p_terms TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('pessoas.gerir');
    c core.collaborators;
    t core.tenants;
    m core.contract_templates;
    r core.contract_templates;
    s core.collaborator_sensitive;
    v_body TEXT;
    v_id UUID;
    v_type_pt TEXT;
BEGIN
    SELECT * INTO c FROM core.collaborators WHERE id = p_collab AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'collaborator not found'; END IF;
    IF c.onboarding_status <> 'pending_contract' THEN RAISE EXCEPTION 'the contract comes after HR validates the data (%)', c.onboarding_status; END IF;
    IF p_type NOT IN ('permanent', 'fixed_term', 'unfixed_term', 'temporary') THEN RAISE EXCEPTION 'choose the type of contract'; END IF;
    IF p_start IS NULL THEN RAISE EXCEPTION 'the start date is required'; END IF;
    IF p_type = 'fixed_term' AND (p_end IS NULL OR p_end <= p_start) THEN RAISE EXCEPTION 'a fixed-term contract needs an end date after the start'; END IF;
    IF p_weekly_hours IS NULL OR p_weekly_hours <= 0 OR p_weekly_hours > 60 THEN RAISE EXCEPTION 'weekly hours between 1 and 60'; END IF;
    IF p_base IS NULL OR p_base <= 0 OR p_base > 500 THEN RAISE EXCEPTION 'hourly rate missing or not valid'; END IF;
    IF p_overtime IS NOT NULL AND p_overtime < p_base THEN RAISE EXCEPTION 'overtime cannot be paid below the normal rate'; END IF;
    IF length(trim(coalesce(p_location, ''))) < 2 OR length(trim(coalesce(p_job_title, ''))) < 2 THEN RAISE EXCEPTION 'place of work and job title are required'; END IF;
    SELECT * INTO t FROM core.tenants WHERE id = v_tenant;
    m := private.onb_template(v_tenant, 'contract');
    r := private.onb_template(v_tenant, 'rules');
    v_type_pt := CASE p_type WHEN 'permanent' THEN 'sem termo' WHEN 'fixed_term' THEN 'a termo certo'
                             WHEN 'unfixed_term' THEN 'a termo incerto' ELSE 'temporário' END;
    -- pay terms first (a change of a rate already set goes through the 4-eyes approval of sql/24)
    INSERT INTO core.collaborator_sensitive (collaborator_id, tenant_id) VALUES (c.id, v_tenant) ON CONFLICT (collaborator_id) DO NOTHING;
    SELECT * INTO s FROM core.collaborator_sensitive WHERE collaborator_id = c.id;
    PERFORM set_config('app.reason', 'Acolhimento: o RH emitiu o contrato', true);
    UPDATE core.collaborator_sensitive SET base_hourly_rate = p_base, overtime_hourly_rate = coalesce(p_overtime, round(p_base * 1.5, 2)),
        allowance_terms = CASE WHEN nullif(trim(p_terms), '') IS NULL THEN allowance_terms ELSE jsonb_build_object('text', trim(p_terms)) END,
        updated_at = now()
    WHERE collaborator_id = c.id;
    UPDATE core.collaborators SET job_title = trim(p_job_title) WHERE id = c.id;
    v_body := m.body_template;
    v_body := replace(v_body, '{{tipo}}', upper(v_type_pt));
    v_body := replace(v_body, '{{empresa}}', t.legal_name);
    v_body := replace(v_body, '{{nif_empresa}}', coalesce(t.tax_id, '—'));
    v_body := replace(v_body, '{{nome}}', c.full_name);
    v_body := replace(v_body, '{{nif}}', coalesce(c.tax_number, '—'));
    v_body := replace(v_body, '{{funcao}}', trim(p_job_title));
    v_body := replace(v_body, '{{local}}', trim(p_location));
    v_body := replace(v_body, '{{inicio}}', to_char(p_start, 'DD/MM/YYYY'));
    v_body := replace(v_body, '{{fim}}', CASE WHEN p_end IS NOT NULL THEN ' e termina em ' || to_char(p_end, 'DD/MM/YYYY') ELSE '' END);
    v_body := replace(v_body, '{{horas_semana}}', trim(to_char(p_weekly_hours, 'FM990.##')));
    v_body := replace(v_body, '{{preco_hora}}', replace(trim(to_char(p_base, 'FM9990.00')), '.', ',') || ' €');
    v_body := replace(v_body, '{{preco_extra}}', replace(trim(to_char(coalesce(p_overtime, round(p_base * 1.5, 2)), 'FM9990.00')), '.', ',') || ' €');
    v_body := replace(v_body, '{{condicoes}}', coalesce(nullif(trim(p_terms), ''), ''));
    v_body := replace(v_body, '{{data}}', to_char((now() AT TIME ZONE 'Europe/Lisbon')::date, 'DD/MM/YYYY'));
    UPDATE core.employment_contracts SET status = 'void' WHERE collaborator_id = c.id AND status = 'issued';
    INSERT INTO core.employment_contracts (tenant_id, collaborator_id, template_id, pdf_url, pdf_sha256, status, issued_by, issued_at,
        contract_type, start_date, end_date, weekly_hours, work_location, job_title, body_text, rules_template_id)
    VALUES (v_tenant, c.id, m.id, 'gestnow:text', private.sha256_text(v_body), 'issued', auth.uid(), now(),
        p_type, p_start, CASE WHEN p_type IN ('fixed_term') THEN p_end ELSE p_end END, p_weekly_hours, trim(p_location), trim(p_job_title), v_body, r.id)
    RETURNING id INTO v_id;
    PERFORM private.notify(c.tenant_id, 'worker', (SELECT u.user_id FROM core.app_users u WHERE u.collaborator_id = c.id AND u.is_active LIMIT 1),
        NULL, 'contract_issued', 'medium', 'O teu contrato está pronto para leres e assinares.', jsonb_build_object('contract_id', v_id));
    RETURN public.mini_onb_person(c.id);
END;
$$;

-- The company's texts: HR sees the current ones and saves a new version (the old one stays, E2).
CREATE OR REPLACE FUNCTION public.mini_onb_texts()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant UUID := private.simple_mode_perm('pessoas.gerir');
BEGIN
    PERFORM private.onb_default_texts(v_tenant);
    RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'title', t.name, 'version', t.version, 'body', t.body_template,
              'created_at', t.created_at, 'model', t.body_template LIKE '%[MODELO DA GESTNOW%') ORDER BY t.kind), '[]'::jsonb)
            FROM core.contract_templates t WHERE t.tenant_id = v_tenant AND t.is_active
              AND t.version = (SELECT max(x.version) FROM core.contract_templates x WHERE x.tenant_id = v_tenant AND x.kind = t.kind AND x.is_active));
END;
$$;

CREATE OR REPLACE FUNCTION public.mini_onb_text_save(p_kind TEXT, p_title TEXT, p_body TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('pessoas.gerir');
    v_next INT;
    v_id UUID;
BEGIN
    IF p_kind NOT IN ('contract', 'rules') THEN RAISE EXCEPTION 'unknown text'; END IF;
    IF length(trim(coalesce(p_body, ''))) < 200 THEN RAISE EXCEPTION 'the text is too short'; END IF;
    IF p_kind = 'contract' AND (p_body NOT LIKE '%{{nome}}%' OR p_body NOT LIKE '%{{preco_hora}}%') THEN
        RAISE EXCEPTION 'the contract model must keep at least {{nome}} and {{preco_hora}}';
    END IF;
    PERFORM private.onb_default_texts(v_tenant);
    SELECT coalesce(max(version), 0) + 1 INTO v_next FROM core.contract_templates
    WHERE tenant_id = v_tenant AND kind = p_kind;
    UPDATE core.contract_templates SET is_active = FALSE WHERE tenant_id = v_tenant AND kind = p_kind AND is_active;
    INSERT INTO core.contract_templates (tenant_id, name, version, kind, body_template, is_active, created_by)
    VALUES (v_tenant, coalesce(nullif(trim(p_title), ''), CASE p_kind WHEN 'contract' THEN 'Contrato de trabalho' ELSE 'Regulamento interno' END),
            v_next, p_kind, p_body, TRUE, auth.uid())
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- HR board: who is where in steps 1 to 5 (replaces the step-1-only view of sql/55).
CREATE OR REPLACE FUNCTION public.mini_onboarding_board()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant UUID := private.simple_mode_perm('pessoas.gerir', 'acolhimento.gerir');
BEGIN
    RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.full_name, 'number', c.employee_number, 'status', c.onboarding_status,
              'since', c.created_at, 'has_login', EXISTS (SELECT 1 FROM core.app_users u WHERE u.collaborator_id = c.id AND u.is_active),
              'items', (SELECT count(*) FROM private.induction_required(c.id)),
              'passed', (SELECT count(*) FROM private.induction_required(c.id) i JOIN compliance.induction_progress p
                           ON p.collaborator_id = c.id AND p.item_id = i.id AND p.version = i.version AND p.passed_at IS NOT NULL),
              'last', (SELECT max(greatest(p.opened_at, p.passed_at)) FROM compliance.induction_progress p WHERE p.collaborator_id = c.id),
              'docs_to_check', (SELECT count(*) FROM core.collaborator_documents d WHERE d.collaborator_id = c.id AND d.is_current AND d.verified_at IS NULL),
              'contract', (SELECT k.status FROM core.employment_contracts k WHERE k.collaborator_id = c.id AND k.status <> 'void' ORDER BY k.issued_at DESC LIMIT 1),
              'waiting_hr', (c.onboarding_status = 'pending_hr_validation' OR (c.onboarding_status = 'pending_contract' AND NOT EXISTS (SELECT 1 FROM core.employment_contracts k WHERE k.collaborator_id = c.id AND k.status = 'issued'))))
              ORDER BY (c.onboarding_status = 'pending_hr_validation' OR (c.onboarding_status = 'pending_contract' AND NOT EXISTS (SELECT 1 FROM core.employment_contracts k WHERE k.collaborator_id = c.id AND k.status = 'issued'))) DESC, c.created_at DESC), '[]'::jsonb)
            FROM core.collaborators c WHERE c.tenant_id = v_tenant AND c.is_active AND c.onboarding_status <> 'active');
END;
$$;

-- ---------------------------------------------------------------- files: the person's own documents (bucket «documentos»)
CREATE OR REPLACE FUNCTION private.mini_doc_self_ok(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(p_name, '') ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'
       AND (SELECT private.me()) IS NOT NULL
       AND split_part(p_name, '/', 2) = (SELECT private.me())::text
       AND split_part(p_name, '/', 1) = (SELECT c.tenant_id::text FROM core.collaborators c WHERE c.id = (SELECT private.me()) AND c.is_active);
$$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documentos_proprio_enviar') THEN
        CREATE POLICY documentos_proprio_enviar ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (bucket_id = 'documentos' AND (SELECT private.mini_doc_self_ok(name)));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documentos_proprio_ver') THEN
        CREATE POLICY documentos_proprio_ver ON storage.objects FOR SELECT TO authenticated
            USING (bucket_id = 'documentos' AND (SELECT private.mini_doc_self_ok(name)));
    END IF;
END $$;

-- ---------------------------------------------------------------- grants
REVOKE EXECUTE ON FUNCTION private.pii_key(uuid), private.pii_seal(uuid, text), private.pii_open(bytea),
    private.onb_default_texts(uuid), private.onb_template(uuid, text), private.onb_docs(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION private.iban_ok(text), private.niss_ok(text), private.name_key(text), private.sha256_text(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION private.mini_doc_self_ok(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.mini_doc_self_ok(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mini_onb_me(), public.mini_onb_save_data(jsonb),
    public.mini_onb_add_document(uuid, text, date, date, text, text), public.mini_onb_submit_data(),
    public.mini_onb_sign(uuid, text, text, text, text, text), public.mini_onb_accept_rates(), public.mini_my_papers(),
    public.mini_onb_person(uuid), public.mini_onb_note(uuid, text), public.mini_onb_verify_document(uuid), public.mini_onb_validate(uuid, text),
    public.mini_onb_issue_contract(uuid, text, date, date, numeric, text, text, numeric, numeric, text),
    public.mini_onb_texts(), public.mini_onb_text_save(text, text, text), public.mini_onboarding_board() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mini_onb_me(), public.mini_onb_save_data(jsonb),
    public.mini_onb_add_document(uuid, text, date, date, text, text), public.mini_onb_submit_data(),
    public.mini_onb_sign(uuid, text, text, text, text, text), public.mini_onb_accept_rates(), public.mini_my_papers(),
    public.mini_onb_person(uuid), public.mini_onb_note(uuid, text), public.mini_onb_verify_document(uuid), public.mini_onb_validate(uuid, text),
    public.mini_onb_issue_contract(uuid, text, date, date, numeric, text, text, numeric, numeric, text),
    public.mini_onb_texts(), public.mini_onb_text_save(text, text, text), public.mini_onboarding_board() TO authenticated, service_role;
