-- ============================================================================
-- 81. CORREÇÕES DA AUDITORIA DE 2026-10-19: PORTÃO, PERFIS, CARTÃO ESCRITO À MÃO, PAPEL, ACOLHIMENTO
-- ============================================================================
-- Auditoria 2026-10-19 (gestnow/auditoria/auditoria-2026-10-19.md and anexos). Small fixes, nothing renamed or taken away.
--   A2  A corrected document (a new version) replaces the old one at the gate: private.has_valid_document counts only
--       the current version (is_current).
--   A4  An account that holds an office profile (admin, hr, finance, hse, project_manager) changes profile only with
--       the phone code (aal2): a password-only session can no longer switch itself to supervisor (mini_switch_role).
--       The company setting require_mfa_for_privileged is respected, as in private.has_role.
--   C3  A card number typed by hand is not a card tap. The app calls a «typed» twin of each card RPC, which sets the
--       transaction-local flag app.card_typed and calls the original:
--         public.mini_clock_typed       -> clock_event: anomaly flag 'typed_number'; mini_manual_taps lists it for the
--                                          office to approve; mini_day_events says «número do cartão escrito à mão».
--         public.mini_wh_issue_typed    -> warehouse.stock_movements / tool_custody.card_typed
--         public.mini_lmra_sign_typed   -> safety.lmra_signatures.card_typed
--         public.mini_muster_scan_typed -> muster.muster_scans.card_typed
--       The flag only records what the honest app knows; the server cannot tell a typed number from a read one.
--   C2  «Vi em papel» (mini_activate_worker) records on every step it marks {"method":"paper","statement","by"}, and
--       mini_worker_profile returns how each step was done, so the file says «verificado em papel por X».
--   A1  Passing the last induction item (private.induction_check_done -> step safety_videos) also makes a current,
--       verified collaborator document of type 'acolhimento' (when the company has one) dated today, so the gate opens.
--       Its validity comes from the new column core.document_types.valid_months (empty = does not expire).
-- Replaced here (CREATE OR REPLACE, same signature), each copied from its live definition (sql/16, 31, 37, 45, 49, 55,
-- 64, 65 and the permission rewrite of sql/47) with only the marked lines changed: private.has_valid_document,
-- public.mini_switch_role, public.clock_event, public.mini_lmra_sign, public.mini_muster_scan, public.mini_wh_issue,
-- public.mini_activate_worker, private.induction_check_done, public.mini_worker_profile, public.mini_day_events,
-- public.mini_manual_taps.

-- ---------------------------------------------------------------- columns
ALTER TABLE core.document_types ADD COLUMN IF NOT EXISTS valid_months INT
    CONSTRAINT chk_document_types_valid_months CHECK (valid_months IS NULL OR valid_months BETWEEN 1 AND 240);
COMMENT ON COLUMN core.document_types.valid_months IS 'Default validity in months of a document made by the system (sql/81: digital induction); NULL = does not expire';
ALTER TABLE warehouse.stock_movements ADD COLUMN IF NOT EXISTS card_typed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE warehouse.tool_custody ADD COLUMN IF NOT EXISTS card_typed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE safety.lmra_signatures ADD COLUMN IF NOT EXISTS card_typed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE muster.muster_scans ADD COLUMN IF NOT EXISTS card_typed BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------- C3: was this card number typed by hand?
-- Set only by the *_typed wrappers below, for their own transaction.
CREATE OR REPLACE FUNCTION private.card_typed()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT coalesce(current_setting('app.card_typed', true), '') = 'on';
$$;

-- ---------------------------------------------------------------- A2
CREATE OR REPLACE FUNCTION private.has_valid_document(p_collab UUID, p_type UUID, p_day DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM core.collaborator_documents d
                   WHERE d.collaborator_id = p_collab AND d.document_type_id = p_type AND d.is_current
                     AND d.issue_date <= p_day AND (d.expiration_date IS NULL OR d.expiration_date >= p_day)
                     AND (SELECT private.document_counts(d.verified_at, d.ai_extracted, d.uploaded_by, d.collaborator_id)));
$$;

-- ---------------------------------------------------------------- A4
CREATE OR REPLACE FUNCTION public.mini_switch_role(p_role user_role_enum)
 RETURNS user_role_enum
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE a core.app_users;
BEGIN
    SELECT * INTO a FROM core.app_users WHERE user_id = auth.uid() AND is_active;
    IF NOT FOUND OR NOT (SELECT private.is_fully_active()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF a.role = p_role THEN RETURN p_role; END IF;
    IF NOT p_role = ANY (coalesce(a.allowed_roles, ARRAY[a.role])) THEN RAISE EXCEPTION 'this profile is not yours'; END IF;
    -- A4 (sql/81): an account that holds an office profile changes hat only after the phone code (aal2),
    -- so a password-only session cannot work as a supervisor either.
    IF (coalesce(a.allowed_roles, '{}') || a.role) && '{admin,hr,finance,hse,project_manager}'::public.user_role_enum[]
       AND coalesce((SELECT t.require_mfa_for_privileged FROM core.tenants t WHERE t.id = a.tenant_id), TRUE)
       AND (SELECT private.jwt_aal()) IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'confirm the phone code before changing profile' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM set_config('app.reason', 'Mini: mudou de perfil para ' || p_role, true);
    UPDATE core.app_users SET role = p_role, updated_at = now() WHERE user_id = a.user_id;
    RETURN p_role;
END;
$$;

-- ---------------------------------------------------------------- C3: clock_event and the other card signatures
CREATE OR REPLACE FUNCTION public.clock_event(
    p_project UUID,
    p_capture capture_mode_enum,
    p_raw TEXT,                                 -- card UID, "uid:otp", "emp:pin", QR token; NULL for self_app
    p_direction clock_direction_enum,
    p_event_time TIMESTAMPTZ,                   -- when it happened (offline taps keep the original time)
    p_client_event_id UUID,                     -- idempotency key from the phone's queue
    p_device_id UUID DEFAULT NULL,
    p_device_time TIMESTAMPTZ DEFAULT NULL,
    p_ntp_synced BOOLEAN DEFAULT TRUE,
    p_was_offline BOOLEAN DEFAULT FALSE,
    p_lat NUMERIC DEFAULT NULL,
    p_lng NUMERIC DEFAULT NULL,
    p_accuracy_m NUMERIC DEFAULT NULL,
    p_zone UUID DEFAULT NULL,
    p_checkpoint UUID DEFAULT NULL,
    p_wbs UUID DEFAULT NULL,
    p_device_seq BIGINT DEFAULT NULL)          -- the device's own counter (planta E6)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_tenant UUID := (SELECT private.tenant_id());
    v_user UUID := auth.uid();
    p core.projects;
    rules hours.work_rules;
    d core.devices;
    cred core.credentials;
    v_collab UUID;
    v_status public.clock_status_enum := 'accepted';
    v_reasons TEXT[] := '{}';
    v_flags TEXT[] := '{}';
    v_within BOOLEAN;
    v_id UUID;
    v_prev core.time_events;
    c core.collaborators;
    v_day DATE;
BEGIN
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'client_event_id is required'; END IF;

    -- Idempotent replay from the offline queue (T-08): answer with what was stored.
    SELECT * INTO v_prev FROM core.time_events WHERE tenant_id = v_tenant AND client_event_id = p_client_event_id;
    IF FOUND THEN
        RETURN jsonb_build_object('event_id', v_prev.id, 'status', v_prev.status, 'reasons', to_jsonb(v_prev.reasons),
                                  'anomalies', to_jsonb(v_prev.anomaly_flags), 'replayed', true);
    END IF;

    SELECT * INTO p FROM core.projects WHERE id = p_project AND tenant_id = v_tenant;
    IF NOT FOUND OR NOT (SELECT private.can_see_project(p_project)) THEN
        RAISE EXCEPTION 'project not found' USING ERRCODE = 'insufficient_privilege';
    END IF;
    rules := private.rules_for(p_project);

    -- Device (X-06): must be this user's, not revoked, and pass the integrity attestation.
    IF p_device_id IS NOT NULL THEN
        SELECT * INTO d FROM core.devices WHERE id = p_device_id AND tenant_id = v_tenant;
        IF NOT FOUND OR d.is_revoked OR d.user_id IS DISTINCT FROM v_user THEN
            RAISE EXCEPTION 'device not authorised' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF d.integrity_ok IS FALSE THEN
            RAISE EXCEPTION 'device failed integrity check (rooted/jailbroken)' USING ERRCODE = 'insufficient_privilege';
        END IF;
        UPDATE core.devices SET last_seen_at = now() WHERE id = d.id;
    END IF;

    -- Who may record what (T-01..T-03, D-05).
    IF p_capture = 'manual_correction' THEN
        RAISE EXCEPTION 'use add_manual_time_event() for manual entries';
    ELSIF p_capture = 'self_app' THEN
        IF p.operation_mode <> 'advanced' OR NOT p.allow_self_clock THEN
            RAISE EXCEPTION 'self clock-in is not enabled on this site (restricted mode)';
        END IF;
        IF p_device_id IS NULL THEN RAISE EXCEPTION 'self clock-in requires a registered device'; END IF;
        v_collab := (SELECT private.me());
        IF v_collab IS NULL THEN RAISE EXCEPTION 'this login is not a person'; END IF;
    ELSE
        IF NOT (SELECT private.can('ponto.picar'))
           AND NOT (p_capture = 'fixed_reader' AND d.project_id = p_project) THEN
            RAISE EXCEPTION 'only a supervisor or a site reader can record clock-ins' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF p_capture IN ('worker_phone_hce', 'wallet_pass') AND p.operation_mode <> 'advanced' THEN
            RAISE EXCEPTION 'phone and wallet credentials are only accepted in advanced mode';
        END IF;
        cred := private.resolve_credential(v_tenant, p_capture, p_raw, p_event_time);
        v_collab := cred.collaborator_id;
    END IF;

    -- Time sanity (T-09, T-10).
    IF p_event_time > now() + make_interval(secs => rules.max_clock_drift_seconds) THEN
        RAISE EXCEPTION 'event time is in the future';
    END IF;
    IF p_device_time IS NOT NULL AND abs(extract(epoch FROM p_device_time - p_event_time)) > rules.max_clock_drift_seconds THEN
        v_flags := v_flags || 'clock_drift'::text;
    END IF;
    IF NOT coalesce(p_ntp_synced, FALSE) THEN v_flags := v_flags || 'device_clock_unsynced'::text; END IF;
    IF p_was_offline AND now() - p_event_time > interval '72 hours' THEN v_flags := v_flags || 'late_sync'::text; END IF;
    -- C3 (sql/81): a card number typed by hand is not a card tap; the office sees it and approves it.
    IF p_capture <> 'self_app' AND (SELECT private.card_typed()) THEN v_flags := v_flags || 'typed_number'::text; END IF;

    IF v_collab IS NULL THEN
        v_status := 'rejected';
        v_reasons := ARRAY['unknown_credential'];
    ELSE
        SELECT * INTO c FROM core.collaborators WHERE id = v_collab;
        -- Debounce (T-07): same person, same direction, within N seconds = duplicate tap.
        IF EXISTS (SELECT 1 FROM core.time_events e
                   WHERE e.collaborator_id = v_collab AND e.direction = p_direction AND e.status = 'accepted'
                     AND abs(extract(epoch FROM e.event_time - p_event_time)) < rules.debounce_seconds) THEN
            v_status := 'duplicate';
            v_reasons := ARRAY['debounce'];
        -- The gate applies to entering. Leaving is never blocked (safety).
        ELSIF p_direction IN ('in', 'zone_entry', 'break_end') THEN
            v_reasons := private.access_check(v_collab, p_project, p_zone, p_event_time, p_direction, p_wbs);
            IF cardinality(v_reasons) > 0 THEN v_status := 'rejected'; END IF;
        END IF;
    END IF;

    -- Geofence (T-13): flagged and reported, not blocked.
    IF p_lat IS NOT NULL AND p.latitude IS NOT NULL THEN
        v_within := private.distance_m(p_lat, p_lng, p.latitude, p.longitude)
                    <= p.geofence_radius_m + least(coalesce(p_accuracy_m, 0), 100);
        IF NOT v_within THEN v_flags := v_flags || 'outside_geofence'::text; END IF;
    END IF;

    INSERT INTO core.time_events (tenant_id, project_id, zone_id, checkpoint_id, wbs_id, collaborator_id, credential_id,
        raw_uid, direction, capture_mode, event_time, device_time, ntp_synced, was_offline, latitude, longitude,
        accuracy_m, within_geofence, device_id, recorded_by, client_event_id, device_seq, status, reasons, anomaly_flags)
    VALUES (v_tenant, p_project, p_zone, p_checkpoint, p_wbs, v_collab, cred.id,
        CASE WHEN p_capture IN ('pin', 'worker_phone_hce', 'wallet_pass') THEN split_part(p_raw, ':', 1)
             WHEN p_capture = 'self_app' THEN NULL ELSE private.normalize_uid(p_raw) END,
        p_direction, p_capture, p_event_time, p_device_time, coalesce(p_ntp_synced, FALSE), coalesce(p_was_offline, FALSE),
        p_lat, p_lng, p_accuracy_m, v_within, p_device_id, v_user, p_client_event_id, p_device_seq, v_status, v_reasons, v_flags)
    RETURNING id, status, reasons INTO v_id, v_status, v_reasons;   -- a module rule on the table (e.g. site alert) may still refuse

    IF v_status = 'accepted' THEN
        v_day := (p_event_time AT TIME ZONE p.timezone)::date;
        BEGIN
            PERFORM private.compute_work_day(v_collab, p_project, v_day);
            PERFORM private.compute_work_day(v_collab, p_project, v_day - 1);     -- night shift that started yesterday
        EXCEPTION WHEN raise_exception THEN
            PERFORM private.notify(v_tenant, 'hr', NULL, p_project, 'locked_day_changed', 'high',
                'Picagem chegou para um dia já enviado para salários',
                jsonb_build_object('event_id', v_id, 'collaborator_id', v_collab, 'error', SQLERRM));
        END;
    END IF;
    IF 'outside_geofence' = ANY (v_flags) THEN
        PERFORM private.notify(v_tenant, 'supervisor', NULL, p_project, 'outside_geofence', 'medium',
            'Picagem fora da área da obra', jsonb_build_object('event_id', v_id, 'collaborator_id', v_collab));
    END IF;
    IF 'suspended_safety' = ANY (v_reasons) THEN
        PERFORM private.notify(v_tenant, 'hse', NULL, p_project, 'suspended_worker_attempt', 'critical',
            'Trabalhador com cartão vermelho tentou entrar', jsonb_build_object('event_id', v_id, 'collaborator_id', v_collab));
    END IF;
    IF v_collab IS NULL THEN
        PERFORM private.notify(v_tenant, 'supervisor', NULL, p_project, 'unknown_credential', 'medium',
            'Cartão desconhecido na obra', jsonb_build_object('event_id', v_id));
    END IF;

    RETURN jsonb_build_object('event_id', v_id, 'status', v_status, 'reasons', to_jsonb(v_reasons),
        'anomalies', to_jsonb(v_flags), 'collaborator_id', v_collab,
        'name', c.full_name, 'photo_url', c.photo_url, 'employee_number', c.employee_number, 'replayed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.mini_lmra_sign(p_lmra uuid, p_uid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('seguranca.lmra');
    r safety.lmra_records;
    k core.credentials;
    c core.collaborators;
BEGIN
    SELECT * INTO r FROM safety.lmra_records WHERE id = p_lmra AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'not allowed'; END IF;
    PERFORM private.mini_site_guard(v_tenant, r.project_id);
    IF NOT r.is_safe_to_work THEN RAISE EXCEPTION 'this LMRA failed (stop work); it cannot be signed'; END IF;
    IF r.performed_at < now() - interval '16 hours' THEN RAISE EXCEPTION 'this LMRA is from another shift: do a new one'; END IF;
    SELECT * INTO k FROM core.credentials
    WHERE tenant_id = v_tenant AND kind IN ('physical_card', 'client_card') AND is_active AND uid = private.normalize_uid(p_uid)
      AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now());
    IF NOT FOUND THEN RAISE EXCEPTION 'this card is not known'; END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = k.collaborator_id;
    IF EXISTS (SELECT 1 FROM safety.lmra_signatures WHERE lmra_id = r.id AND collaborator_id = c.id) THEN
        RETURN jsonb_build_object('name', c.full_name, 'again', true);
    END IF;
    INSERT INTO safety.lmra_signatures (tenant_id, lmra_id, collaborator_id, credential_id, card_typed)
    VALUES (v_tenant, r.id, c.id, k.id, (SELECT private.card_typed()));
    RETURN jsonb_build_object('name', c.full_name, 'again', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.mini_muster_scan(p_event uuid, p_point uuid, p_uid text, p_client_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('seguranca.emergencia');
    e muster.emergency_events;
    k core.credentials;
    c core.collaborators;
    v_at TIMESTAMPTZ := least(coalesce(p_at, now()), now());
BEGIN
    SELECT * INTO e FROM muster.emergency_events WHERE id = p_event AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'emergency not found'; END IF;
    PERFORM private.mini_site_guard(v_tenant, e.project_id);
    IF NOT EXISTS (SELECT 1 FROM muster.assembly_points WHERE id = p_point AND project_id = e.project_id) THEN RAISE EXCEPTION 'assembly point not found'; END IF;
    IF p_client_id IS NULL THEN RAISE EXCEPTION 'tap the card'; END IF;
    IF EXISTS (SELECT 1 FROM muster.muster_scans WHERE tenant_id = v_tenant AND client_event_id = p_client_id) THEN
        RETURN jsonb_build_object('replayed', true);
    END IF;
    IF length(trim(coalesce(p_uid, ''))) < 4 THEN RAISE EXCEPTION 'tap the card'; END IF;
    -- any card of the company, even of a blocked person: we need to know they are safe
    SELECT * INTO k FROM core.credentials WHERE tenant_id = v_tenant AND uid = private.normalize_uid(p_uid) ORDER BY is_active DESC LIMIT 1;
    SELECT * INTO c FROM core.collaborators WHERE id = k.collaborator_id;
    INSERT INTO muster.muster_scans (tenant_id, event_id, assembly_point_id, collaborator_id, credential_id, raw_uid,
                                     scanned_by, scanned_at, was_offline, client_event_id, card_typed)
    VALUES (v_tenant, e.id, p_point, c.id, k.id, private.normalize_uid(p_uid), auth.uid(), v_at, v_at < now() - interval '1 minute', p_client_id,
            (SELECT private.card_typed()));
    RETURN jsonb_build_object('name', c.full_name, 'known', c.id IS NOT NULL, 'replayed', false,
        'expected', EXISTS (SELECT 1 FROM muster.muster_expected x WHERE x.event_id = e.id AND x.collaborator_id = c.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.mini_wh_issue(p_warehouse uuid, p_collab uuid, p_lines jsonb, p_tools uuid[], p_uid text, p_project uuid, p_due timestamp with time zone, p_reason text, p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('armazem.entregar');
    w warehouse.warehouses := private.wh_guard(v_tenant, p_warehouse);
    c core.collaborators;
    k core.credentials;
    i warehouse.items;
    t warehouse.tools;
    x JSONB;
    v_qty NUMERIC;
    v_why TEXT[] := '{}';
    v_n INT := 0;
    v_tool UUID;
    v_due TIMESTAMPTZ := coalesce(p_due, private.wht_due(NULL));
BEGIN
    IF p_client_id IS NULL THEN RAISE EXCEPTION 'tap the card'; END IF;
    IF EXISTS (SELECT 1 FROM warehouse.stock_movements WHERE tenant_id = v_tenant AND batch_id = p_client_id)
       OR EXISTS (SELECT 1 FROM warehouse.tool_custody WHERE tenant_id = v_tenant AND batch_id = p_client_id) THEN
        RETURN jsonb_build_object('replayed', true);
    END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = p_collab AND tenant_id = v_tenant AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'collaborator not found'; END IF;
    -- the signature: this person's own card, tapped now
    SELECT * INTO k FROM core.credentials WHERE tenant_id = v_tenant AND collaborator_id = c.id AND is_active
        AND uid = private.normalize_uid(p_uid) AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now());
    IF NOT FOUND THEN RAISE EXCEPTION 'the card is not this person''s: the person who receives taps their own card'; END IF;
    IF p_project IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.projects WHERE id = p_project AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'site not found'; END IF;
    IF jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) + coalesce(cardinality(p_tools), 0) = 0 THEN
        RAISE EXCEPTION 'choose what to deliver';
    END IF;
    IF jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 40 OR coalesce(cardinality(p_tools), 0) > 40 THEN RAISE EXCEPTION 'too many lines (40 at most)'; END IF;
    IF length(coalesce(p_reason, '')) > 300 THEN RAISE EXCEPTION 'a field is too long'; END IF;
    IF v_due < now() OR v_due > now() + interval '400 days' THEN RAISE EXCEPTION 'return date out of range'; END IF;

    FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
        SELECT * INTO i FROM warehouse.items WHERE id = (x ->> 'item')::uuid AND tenant_id = v_tenant AND is_active AND category <> 'tool';
        IF NOT FOUND THEN RAISE EXCEPTION 'item not found'; END IF;
        v_qty := (x ->> 'qty')::numeric;
        IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 1000 THEN RAISE EXCEPTION 'quantity out of range'; END IF;
        IF v_qty > coalesce((SELECT s.quantity FROM warehouse.stock_levels s WHERE s.warehouse_id = w.id AND s.item_id = i.id), 0)
           - coalesce((SELECT sum((y ->> 'qty')::numeric) FROM jsonb_array_elements(p_lines) y WHERE y ->> 'item' = i.id::text), 0) + v_qty THEN
            RAISE EXCEPTION 'not enough stock of % (there are %)', i.name,
                coalesce((SELECT s.quantity FROM warehouse.stock_levels s WHERE s.warehouse_id = w.id AND s.item_id = i.id), 0)::int;
        END IF;
        IF i.category IN ('ppe', 'workwear') AND EXISTS (SELECT 1 FROM warehouse.ppe_assignments a JOIN warehouse.items j ON j.id = a.item_id
                WHERE a.collaborator_id = c.id AND a.retired_at IS NULL AND coalesce(j.family, j.name) = coalesce(i.family, i.name)
                  AND a.replace_after > current_date) AND i.allowance_per_year IS NULL THEN
            v_why := v_why || ('early:' || coalesce(i.family, i.name));
        END IF;
        IF i.allowance_per_year IS NOT NULL AND v_qty + coalesce((SELECT sum(m.quantity) FROM warehouse.stock_movements m JOIN warehouse.items j ON j.id = m.item_id
                WHERE m.collaborator_id = c.id AND m.movement_type = 'issue' AND coalesce(j.family, j.name) = coalesce(i.family, i.name)
                  AND m.occurred_at >= date_trunc('year', now())), 0) > i.allowance_per_year THEN
            v_why := v_why || ('allowance:' || coalesce(i.family, i.name));
        END IF;
    END LOOP;
    IF cardinality(v_why) > 0 AND length(trim(coalesce(p_reason, ''))) < 5 THEN
        RAISE EXCEPTION 'needs a reason: %', array_to_string(v_why, ', ');
    END IF;

    FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
        SELECT * INTO i FROM warehouse.items WHERE id = (x ->> 'item')::uuid;
        v_qty := (x ->> 'qty')::numeric;
        -- the one it replaces leaves the person's list (the record keeps it)
        IF i.category IN ('ppe', 'workwear') AND i.allowance_per_year IS NULL THEN
            UPDATE warehouse.ppe_assignments a SET retired_at = now(), retire_reason = 'worn'
            FROM warehouse.items j WHERE j.id = a.item_id AND a.collaborator_id = c.id AND a.retired_at IS NULL
              AND coalesce(j.family, j.name) = coalesce(i.family, i.name);
        END IF;
        INSERT INTO warehouse.stock_movements (tenant_id, warehouse_id, item_id, movement_type, quantity, project_id, collaborator_id,
                                               credential_id, performed_by, notes, batch_id, card_typed)
        VALUES (v_tenant, w.id, i.id, 'issue', v_qty, p_project, c.id, k.id, auth.uid(), nullif(trim(p_reason), ''), p_client_id,
                (SELECT private.card_typed()));
        v_n := v_n + 1;
    END LOOP;
    FOREACH v_tool IN ARRAY coalesce(p_tools, '{}'::uuid[]) LOOP
        SELECT * INTO t FROM warehouse.tools WHERE id = v_tool AND tenant_id = v_tenant FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'tool not found'; END IF;
        IF t.status <> 'available' THEN RAISE EXCEPTION 'tool % is not available (status %)', t.asset_tag, t.status; END IF;
        IF t.requires_calibration AND (t.calibration_due_date IS NULL OR t.calibration_due_date < current_date) THEN
            RAISE EXCEPTION 'tool % calibration expired on %', t.asset_tag, coalesce(t.calibration_due_date::text, '-');
        END IF;
        INSERT INTO warehouse.tool_custody (tenant_id, tool_id, collaborator_id, project_id, due_back_at, out_credential_id, issued_by, batch_id, out_note,
                                            card_typed)
        VALUES (v_tenant, t.id, c.id, p_project, v_due, k.id, auth.uid(), p_client_id, nullif(trim(p_reason), ''), (SELECT private.card_typed()));
        v_n := v_n + 1;
    END LOOP;
    RETURN jsonb_build_object('name', c.full_name, 'lines', v_n, 'replayed', false);
END;
$$;

-- the office and the supervisor see the typed taps
CREATE OR REPLACE FUNCTION public.mini_day_events(p_collab uuid, p_project uuid, p_day date)
 RETURNS TABLE(event_id uuid, direction clock_direction_enum, effective_time timestamp with time zone, status text, manual boolean, manual_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('horas.ver');
    tz TEXT;
BEGIN
    IF NOT (SELECT private.can_see_time_of(p_collab, p_project)) THEN RAISE EXCEPTION 'not allowed'; END IF;
    SELECT p.timezone INTO tz FROM core.projects p WHERE p.id = p_project AND p.tenant_id = v_tenant;
    RETURN QUERY
    SELECT e.id, e.direction, e.effective_time, e.status::text, e.capture_mode = 'manual_correction',
           CASE WHEN e.capture_mode <> 'manual_correction' AND 'typed_number' = ANY (e.anomaly_flags)
                THEN 'número do cartão escrito à mão' ELSE e.manual_reason END   -- C3 (sql/81)
    FROM public.effective_time_events e
    WHERE e.collaborator_id = p_collab AND e.project_id = p_project AND NOT e.is_void AND e.status = 'accepted'
      AND (e.effective_time AT TIME ZONE tz)::date BETWEEN p_day - 1 AND p_day + 1
    ORDER BY e.effective_time;
END;
$$;

CREATE OR REPLACE FUNCTION public.mini_manual_taps(p_from date, p_to date)
 RETURNS TABLE(work_day_id uuid, direction clock_direction_enum, effective_time timestamp with time zone, added_by text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE v_tenant UUID := private.simple_mode_perm('horas.aprovar');
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 62 THEN
        RAISE EXCEPTION 'choose a period of up to 2 months';
    END IF;
    RETURN QUERY
    SELECT w.id, e.direction, e.effective_time,
           (SELECT coalesce(ac.full_name, au.email)::text FROM auth.users au
            LEFT JOIN core.app_users aa ON aa.user_id = au.id
            LEFT JOIN core.collaborators ac ON ac.id = aa.collaborator_id
            WHERE au.id = e.recorded_by),
           CASE WHEN e.capture_mode = 'manual_correction' THEN e.manual_reason
                WHEN 'self_recorded' = ANY (e.anomaly_flags) THEN 'picou o próprio cartão'
                WHEN 'typed_number' = ANY (e.anomaly_flags) THEN 'número do cartão escrito à mão'   -- C3 (sql/81)
                ELSE 'sem rede: chegou ' || to_char(e.received_at - e.event_time, 'FMHH24"h"MI') || ' depois' END
    FROM hours.work_days w
    JOIN public.effective_time_events e ON e.collaborator_id = w.collaborator_id AND e.project_id = w.project_id
         AND NOT e.is_void AND e.status = 'accepted'
         AND (e.capture_mode = 'manual_correction' OR e.anomaly_flags && ARRAY['offline_late', 'self_recorded', 'typed_number'])
         AND e.effective_time >= coalesce(w.first_in, w.last_out) AND e.effective_time <= coalesce(w.last_out, w.first_in)
    WHERE w.tenant_id = v_tenant AND w.shift_date BETWEEN p_from AND p_to
    ORDER BY w.id, e.effective_time;
END;
$$;

-- ---------------------------------------------------------------- C2
CREATE OR REPLACE FUNCTION public.mini_activate_worker(p_collab uuid, p_statement text)
 RETURNS onboarding_status_enum
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('pessoas.gerir');
    v_external BOOLEAN;
    v_steps public.onboarding_step_enum[];
    v_status public.onboarding_status_enum;
BEGIN
    IF length(trim(coalesce(p_statement, ''))) < 10 THEN
        RAISE EXCEPTION 'write what was checked on paper (at least 10 characters)';
    END IF;
    SELECT o.kind = 'subcontractor' INTO v_external
    FROM core.collaborators c JOIN core.organizations o ON o.id = c.organization_id
    WHERE c.id = p_collab AND c.tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'collaborator not found'; END IF;
    v_steps := CASE WHEN v_external THEN ARRAY['safety_videos', 'hr_validation']::public.onboarding_step_enum[]
                    ELSE enum_range(NULL::public.onboarding_step_enum) END;
    INSERT INTO compliance.onboarding_steps (tenant_id, collaborator_id, step, completed_by, evidence)
    -- C2 (sql/81): the evidence says what it is: seen on paper, by whom. The person signed nothing in the app.
    SELECT v_tenant, p_collab, s, auth.uid(),
           jsonb_build_object('method', 'paper', 'statement', trim(p_statement), 'by', auth.uid(), 'simple_mode', TRUE)
    FROM unnest(v_steps) s
    ON CONFLICT (collaborator_id, step) DO NOTHING;
    SELECT onboarding_status INTO v_status FROM core.collaborators WHERE id = p_collab;
    RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.mini_worker_profile(p_collab uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('pessoas.ver');
    c core.collaborators;
    s core.collaborator_sensitive;
BEGIN
    SELECT * INTO c FROM core.collaborators WHERE id = p_collab AND tenant_id = v_tenant;
    IF NOT FOUND OR NOT (SELECT private.can_see_collaborator(p_collab)) THEN RAISE EXCEPTION 'not allowed'; END IF;
    SELECT * INTO s FROM core.collaborator_sensitive WHERE collaborator_id = p_collab;
    RETURN jsonb_build_object(
        'work', jsonb_build_object('phone', c.phone, 'email', c.email, 'job_title', c.job_title, 'category', c.category_code,
                                   'size_top', c.size_top, 'size_bottom', c.size_bottom, 'size_shoes', c.size_shoes, 'size_gloves', c.size_gloves),
        'can_edit', (SELECT private.can('pessoas.gerir')),
        -- C2 (sql/81): how each onboarding step was done: in the app, or seen on paper by someone (old paper rows say simple_mode).
        'onboarding', (SELECT coalesce(jsonb_agg(jsonb_build_object('step', o.step, 'at', o.completed_at,
                'method', CASE WHEN o.evidence ->> 'method' = 'paper' OR o.evidence ? 'simple_mode' THEN 'paper' ELSE 'app' END,
                'by', (SELECT coalesce(bc.full_name, bu.email)::text FROM auth.users bu
                       LEFT JOIN core.app_users ba ON ba.user_id = bu.id LEFT JOIN core.collaborators bc ON bc.id = ba.collaborator_id
                       WHERE bu.id = o.completed_by),
                'statement', CASE WHEN (SELECT private.can('pessoas.gerir')) THEN o.evidence ->> 'statement' END)
                ORDER BY o.completed_at, o.step), '[]'::jsonb)
            FROM compliance.onboarding_steps o WHERE o.collaborator_id = c.id),
        'personal', CASE WHEN (SELECT private.can('pessoas.dados_pessoais')) THEN jsonb_build_object(
            'address', s.address, 'locality', s.locality, 'municipality', s.municipality, 'postal_code', s.postal_code,
            'birth_date', s.birth_date, 'birthplace', s.birthplace, 'nationality', s.nationality, 'sex', s.sex,
            'marital_status', s.marital_status, 'dependents', s.irs_dependents, 'education', s.education_level,
            'id_type', s.id_document_type, 'id_number', s.id_document_number, 'id_expiry', s.id_document_expiry,
            'emergency_name', s.emergency_contact_name, 'emergency_relation', s.emergency_contact_relation,
            'emergency_phone', s.emergency_contact_phone, 'notes', s.notes) END);
END;
$$;

-- ---------------------------------------------------------------- A1
CREATE OR REPLACE FUNCTION private.induction_check_done(p_collab uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE v_tenant UUID; v_ev JSONB; v_type core.document_types; v_day DATE := private.local_date(now());
BEGIN
    IF NOT EXISTS (SELECT 1 FROM private.induction_required(p_collab)) THEN RETURN FALSE; END IF;   -- nothing to see yet: wait
    IF EXISTS (SELECT 1 FROM private.induction_required(p_collab) i
               WHERE NOT EXISTS (SELECT 1 FROM compliance.induction_progress p WHERE p.collaborator_id = p_collab
                                   AND p.item_id = i.id AND p.version = i.version AND p.passed_at IS NOT NULL)) THEN
        RETURN FALSE;
    END IF;
    SELECT c.tenant_id INTO v_tenant FROM core.collaborators c WHERE c.id = p_collab;
    SELECT jsonb_build_object('items', jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'kind', i.kind, 'version', i.version,
             'passed_at', p.passed_at, 'attempts', p.attempts, 'questions', jsonb_array_length(i.questions)) ORDER BY i.position))
      INTO v_ev
    FROM private.induction_required(p_collab) i
    JOIN compliance.induction_progress p ON p.collaborator_id = p_collab AND p.item_id = i.id AND p.version = i.version;
    INSERT INTO compliance.onboarding_steps (tenant_id, collaborator_id, step, completed_by, evidence)
    VALUES (v_tenant, p_collab, 'safety_videos', auth.uid(), v_ev)
    ON CONFLICT (collaborator_id, step) DO NOTHING;
    -- A1 (sql/81): the gate asks for the document «acolhimento»; finishing the digital induction makes it,
    -- current and verified (the server counted the time and checked the answers), unless a valid one is there.
    SELECT * INTO v_type FROM core.document_types t WHERE t.tenant_id = v_tenant AND t.code = 'acolhimento' ORDER BY t.created_at LIMIT 1;
    IF FOUND AND NOT (SELECT private.has_valid_document(p_collab, v_type.id, v_day)) THEN
        INSERT INTO core.collaborator_documents (tenant_id, collaborator_id, document_type_id, document_number, file_url, issue_date,
            expiration_date, is_current, verified_at, ai_extracted, uploaded_by)
        VALUES (v_tenant, p_collab, v_type.id, 'Acolhimento digital', 'app:acolhimento-digital', v_day,
            CASE WHEN v_type.valid_months IS NOT NULL THEN (v_day + make_interval(months => v_type.valid_months))::date END,
            TRUE, now(), FALSE, auth.uid());
    END IF;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------- C3: the typed twins (same arguments as the originals)
CREATE OR REPLACE FUNCTION public.mini_clock_typed(
    p_project UUID, p_capture capture_mode_enum, p_raw TEXT, p_direction clock_direction_enum, p_event_time TIMESTAMPTZ,
    p_client_event_id UUID, p_device_id UUID DEFAULT NULL, p_device_time TIMESTAMPTZ DEFAULT NULL, p_ntp_synced BOOLEAN DEFAULT TRUE,
    p_was_offline BOOLEAN DEFAULT FALSE, p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL, p_accuracy_m NUMERIC DEFAULT NULL,
    p_zone UUID DEFAULT NULL, p_checkpoint UUID DEFAULT NULL, p_wbs UUID DEFAULT NULL, p_device_seq BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v JSONB;
BEGIN
    PERFORM private.simple_mode_perm('ponto.picar');
    IF p_capture IN ('self_app', 'manual_correction') THEN RAISE EXCEPTION 'a typed number is only for a card'; END IF;
    PERFORM set_config('app.card_typed', 'on', true);
    v := public.clock_event(p_project, p_capture, p_raw, p_direction, p_event_time, p_client_event_id, p_device_id, p_device_time,
                            p_ntp_synced, p_was_offline, p_lat, p_lng, p_accuracy_m, p_zone, p_checkpoint, p_wbs, p_device_seq);
    PERFORM set_config('app.card_typed', '', true);
    RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.mini_lmra_sign_typed(p_lmra UUID, p_uid TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v JSONB;
BEGIN
    PERFORM private.simple_mode_perm('seguranca.lmra');
    PERFORM set_config('app.card_typed', 'on', true);
    v := public.mini_lmra_sign(p_lmra, p_uid);
    PERFORM set_config('app.card_typed', '', true);
    RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.mini_muster_scan_typed(p_event UUID, p_point UUID, p_uid TEXT, p_client_id UUID, p_at TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v JSONB;
BEGIN
    PERFORM private.simple_mode_perm('seguranca.emergencia');
    PERFORM set_config('app.card_typed', 'on', true);
    v := public.mini_muster_scan(p_event, p_point, p_uid, p_client_id, p_at);
    PERFORM set_config('app.card_typed', '', true);
    RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.mini_wh_issue_typed(p_warehouse UUID, p_collab UUID, p_lines JSONB, p_tools UUID[], p_uid TEXT,
                                                      p_project UUID, p_due TIMESTAMPTZ, p_reason TEXT, p_client_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v JSONB;
BEGIN
    PERFORM private.simple_mode_perm('armazem.entregar');
    PERFORM set_config('app.card_typed', 'on', true);
    v := public.mini_wh_issue(p_warehouse, p_collab, p_lines, p_tools, p_uid, p_project, p_due, p_reason, p_client_id);
    PERFORM set_config('app.card_typed', '', true);
    RETURN v;
END;
$$;

-- ---------------------------------------------------------------- access
REVOKE EXECUTE ON FUNCTION private.card_typed() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION private.card_typed() TO service_role;
REVOKE EXECUTE ON FUNCTION
    public.mini_clock_typed(UUID, capture_mode_enum, TEXT, clock_direction_enum, TIMESTAMPTZ, UUID, UUID, TIMESTAMPTZ, BOOLEAN, BOOLEAN,
                            NUMERIC, NUMERIC, NUMERIC, UUID, UUID, UUID, BIGINT),
    public.mini_lmra_sign_typed(UUID, TEXT),
    public.mini_muster_scan_typed(UUID, UUID, TEXT, UUID, TIMESTAMPTZ),
    public.mini_wh_issue_typed(UUID, UUID, JSONB, UUID[], TEXT, UUID, TIMESTAMPTZ, TEXT, UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION
    public.mini_clock_typed(UUID, capture_mode_enum, TEXT, clock_direction_enum, TIMESTAMPTZ, UUID, UUID, TIMESTAMPTZ, BOOLEAN, BOOLEAN,
                            NUMERIC, NUMERIC, NUMERIC, UUID, UUID, UUID, BIGINT),
    public.mini_lmra_sign_typed(UUID, TEXT),
    public.mini_muster_scan_typed(UUID, UUID, TEXT, UUID, TIMESTAMPTZ),
    public.mini_wh_issue_typed(UUID, UUID, JSONB, UUID[], TEXT, UUID, TIMESTAMPTZ, TEXT, UUID) TO authenticated, service_role;
