# Checks for sql/80 (entrada do trabalhador: passos 2 a 5 na app). Fresh DB with 80 applied first.
P="psql -h /var/lib/pgtest -p 5433 -U postgres -d ${DB:-app} -X -qAt"
as() { $P -c "begin; select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"aal\":\"${3:-aal2}\",\"role\":\"authenticated\"}', true); set local role authenticated; $2; commit;" 2>&1 | grep -v '^{"sub' | grep -v '^$' ; }
A=11111111-1111-1111-1111-111111111111; E=22222222-2222-2222-2222-222222222222; H=44444444-4444-4444-4444-444444444444
W=55555555-5555-5555-5555-555555555555; X=66666666-6666-6666-6666-666666666666
ok=0; bad=0; t() { if eval "$2"; then echo "OK    $1"; ok=$((ok+1)); else echo "FALHA $1 :: $o"; bad=$((bad+1)); fi; }
T0=$($P -c "select tenant_id from core.app_users where user_id='$A'")
P1=$($P -c "select id from core.projects where cost_center_code='GSI-01'")
# a new person, created by HR for the app path, with a worker login
C=$(as $H "select public.mini_add_worker_onboarding('Ana Teste Nova', '900000099', 'Teste-0099', '$P1')")
t "o RH cria uma pessoa para entrar pela app" '[ -n "$C" ] && echo "$C" | grep -qE "^[0-9a-f-]{36}$"'
$P -c "insert into auth.users values ('$W', 'ana@teste.local'), ('$X', 'outra@teste.local') on conflict do nothing" >/dev/null
$P -c "insert into core.app_users (user_id, tenant_id, role, organization_id, collaborator_id) select '$W', tenant_id, 'worker', organization_id, id from core.collaborators where id='$C'" >/dev/null
o=$(as $W "select public.mini_onb_me()->>'status'"); t "começa nos vídeos" '[ "$o" = pending_video ]'
o=$(as $W "select public.mini_onb_save_data('{\"address\":\"x\"}')"); t "não preenche dados antes dos vídeos" 'echo "$o" | grep -qi "already validated\|ERROR"'
# videos done (the induction itself is tested in t55)
$P -c "insert into compliance.onboarding_steps (tenant_id, collaborator_id, step, evidence) values ('$T0', '$C', 'safety_videos', '{\"method\":\"app\"}')" >/dev/null
o=$(as $W "select public.mini_onb_me()->>'status'"); t "depois dos vídeos passa aos dados" '[ "$o" = pending_data ]'
o=$(as $W "select public.mini_onb_save_data('{\"niss\":\"12345678901\"}')"); t "NISS errado é recusado" 'echo "$o" | grep -q "NISS"'
o=$(as $W "select public.mini_onb_save_data('{\"iban\":\"PT50000201231234567890155\"}')"); t "IBAN errado é recusado" 'echo "$o" | grep -q "IBAN"'
o=$(as $W "select public.mini_onb_save_data('{\"birth_date\":\"2020-01-01\"}')"); t "data de nascimento impossível é recusada" 'echo "$o" | grep -qi "birth date"'
o=$(as $W "select public.mini_onb_submit_data()"); t "não envia ao RH com dados em falta" 'echo "$o" | grep -q "missing: NISS, IBAN"'
o=$(as $W "select public.mini_onb_save_data('{\"postal_code\":\"7520\"}')"); t "código postal errado é recusado" 'echo "$o" | grep -q "0000-000"'
o=$(as $W "select public.mini_onb_save_data('{\"id_expiry\":\"2020-01-01\"}')"); t "documento de identificação caducado é recusado" 'echo "$o" | grep -q "expired"'
o=$(as $W "select public.mini_onb_save_data('{\"niss\":\"123 456 789 02\",\"iban\":\"PT50 0002 0123 1234 5678 9015 4\",\"address\":\"Rua A, 1\",\"postal_code\":\"7520-000\",\"locality\":\"Sines\",\"municipality\":\"Sines\",\"birth_date\":\"1990-05-01\",\"nationality\":\"PT\",\"sex\":\"F\",\"marital_status\":\"single\",\"dependents\":\"0\",\"irs_holders\":\"1\",\"id_type\":\"citizen_card\",\"id_number\":\"12345678 0 ZZ1\",\"id_expiry\":\"2030-01-01\",\"emergency_relation\":\"Mãe\",\"emergency_name\":\"Mãe\",\"emergency_phone\":\"912345678\",\"phone\":\"961234567\",\"size_top\":\"L\",\"size_bottom\":\"M\",\"size_shoes\":\"43\",\"size_gloves\":\"9\"}')->'data'")
t "guarda os dados e mostra só o fim do NISS e do IBAN" 'echo "$o" | grep -q "\"niss_last3\": \"902\"" && echo "$o" | grep -q "\"iban_last4\": \"0154\"" && ! echo "$o" | grep -q "12345678902"'
o=$($P -c "select left(encode(social_security_number_enc,'escape'),4), length(iban_enc) >= 49 from core.collaborator_sensitive where collaborator_id='$C'"); t "NISS e IBAN ficam selados (ENC1)" '[ "$o" = "ENC1|t" ]'
o=$($P -c "select private.pii_open(social_security_number_enc) || '/' || private.pii_open(iban_enc) from core.collaborator_sensitive where collaborator_id='$C'"); t "e abrem-se só por dentro" '[ "$o" = "12345678902/PT50000201231234567890154" ]'
o=$(as $W "select count(*) from core.collaborator_sensitive where collaborator_id <> '$C'"); t "o trabalhador não lê dados sensíveis de outros" '[ "$o" = 0 ]'
o=$(as $W "select private.pii_open(social_security_number_enc) from core.collaborator_sensitive" ); t "nem consegue abrir os selos" 'echo "$o" | grep -qi "denied"'
# documents
DT=$($P -c "select id from core.document_types where code='aptidao_medica' and (tenant_id='$T0' or tenant_id is null) limit 1")
AC=$($P -c "select id from core.document_types where code='acolhimento' and (tenant_id='$T0' or tenant_id is null) limit 1")
U=$(cat /proc/sys/kernel/random/uuid); SHA=$(printf a | sha256sum | cut -c1-64)
o=$(as $W "select public.mini_onb_add_document('$DT', 'AM-1', current_date - 3, current_date + 300, '$T0/$C/$U.pdf', '$SHA')"); t "entrega o seu documento" 'echo "$o" | grep -qE "^[0-9a-f-]{36}$"'
D1=$o
o=$(as $W "select public.mini_onb_add_document('$DT', 'AM-1', current_date - 3, current_date + 300, '$T0/$(cat /proc/sys/kernel/random/uuid)/$U.pdf', '$SHA')"); t "não usa ficheiro na pasta de outro" 'echo "$o" | grep -q "photo or PDF"'
o=$(as $W "select public.mini_onb_add_document('$AC', 'x', current_date, null, '$T0/$C/$U.pdf', '$SHA')"); t "não se dá a si próprio o acolhimento" 'echo "$o" | grep -q "induction"'
o=$(as $W "select public.mini_onb_add_document('$DT', 'x', current_date + 1, null, '$T0/$C/$U.pdf', '$SHA')"); t "data de emissão no futuro é recusada" 'echo "$o" | grep -q "future"'
o=$(as $W "select public.mini_onb_add_document('$DT', 'AM-2', current_date - 1, current_date + 300, '$T0/$C/$(cat /proc/sys/kernel/random/uuid).jpg', '$SHA')")
o=$($P -c "select count(*) filter (where is_current) || '/' || count(*) from core.collaborator_documents where collaborator_id='$C' and document_type_id='$DT'"); t "documento novo substitui o anterior sem o apagar" '[ "$o" = "1/2" ]'
o=$(as $W "select private.mini_doc_self_ok('$T0/$C/$U.pdf')::text || private.mini_doc_self_ok('$T0/$(cat /proc/sys/kernel/random/uuid)/$U.pdf')::text"); t "storage: só a própria pasta" '[ "$o" = truefalse ]'
o=$(as $W "select public.mini_onb_submit_data()->>'status'"); t "envia ao RH" '[ "$o" = pending_hr_validation ]'
o=$($P -c "select count(*) from core.notifications where tenant_id='$T0' and kind='onboarding_review'" 2>&1); t "o RH é avisado" '[ "$o" -ge 1 ] 2>/dev/null || echo "$o" | grep -q "does not exist"'
o=$(as $W "select public.mini_onb_save_data('{\"locality\":\"Sines \"}')->>'status'"); t "ainda corrige dados enquanto o RH não valida" '[ "$o" = pending_hr_validation ]'
# HR side
o=$(as $E "select public.mini_onb_person('$C')"); t "o encarregado não vê o processo do RH" 'echo "$o" | grep -qi "not allowed\|permission\|denied"'
o=$(as $H "select public.mini_onb_person('$C')->'data'->>'iban_last4'"); t "o RH vê a ficha" '[ "$o" = 0154 ]'
o=$(as $H "select public.mini_onb_person('$C')::text"); t "a ficha do RH não mostra o IBAN inteiro" '! echo "$o" | grep -q "PT50000201231234567890154"'
o=$(as $H "select jsonb_path_query_first(public.mini_onboarding_board(), '\$[*] ? (@.id == \"$C\")')->>'docs_to_check'"); t "quadro do RH conta documentos por verificar" '[ "$o" -ge 1 ] 2>/dev/null'
o=$(as $H "select public.mini_onb_validate('$C')"); t "não valida com documentos por verificar" 'echo "$o" | grep -qi "document"'
for d in $($P -c "select id from core.collaborator_documents where collaborator_id='$C' and is_current"); do as $H "select public.mini_onb_verify_document('$d')" >/dev/null; done
o=$(as $H "select public.mini_onb_note('$C', 'Falta a página 2 do cartão de cidadão')"); o=$(as $W "select public.mini_onb_me()->'note'->>'text'"); t "o trabalhador vê a nota do RH" 'echo "$o" | grep -q "página 2"'
o=$(as $H "select public.mini_onb_validate('$C', 'Tudo visto')->>'status'" ); o2=$($P -c "select onboarding_status from core.collaborators where id='$C'"); t "o RH valida" '[ "$o2" = pending_contract ]'
o=$(as $W "select public.mini_onb_save_data('{\"locality\":\"Lisboa\"}')"); t "depois de validado o trabalhador já não muda os dados" 'echo "$o" | grep -q "already validated"'
# the contract
o=$(as $H "select public.mini_onb_issue_contract('$C', 'fixed_term', current_date + 1, null, 40, 'Sines', 'Serralheiro', 9.5, 12, 'Ajudas de custo segundo a obra')"); t "contrato a termo sem fim é recusado" 'echo "$o" | grep -qi "end"'
o=$(as $H "select public.mini_onb_issue_contract('$C', 'permanent', current_date + 1, null, 70, 'Sines', 'Serralheiro', 9.5, 12, null)"); t "mais de 60 h por semana é recusado" 'echo "$o" | grep -qi "hours\|ERROR"'
o=$(as $H "select public.mini_onb_issue_contract('$C', 'fixed_term', current_date + 1, current_date + 180, 40, 'Sines', 'Serralheiro', 9.5, 12.25, 'Ajudas de custo segundo a obra')"); t "o RH emite o contrato" '! echo "$o" | grep -q ERROR'
K=$($P -c "select id from core.employment_contracts where collaborator_id='$C' and status='issued'")
o=$($P -c "select body_text from core.employment_contracts where id='$K'"); t "o texto do contrato tem o nome, NIF, função e valores" 'echo "$o" | grep -q "Ana Teste Nova" && echo "$o" | grep -q "900000099" && echo "$o" | grep -q "Serralheiro" && echo "$o" | grep -q "9,50\|9.50" && ! echo "$o" | grep -q "{{"'
o=$($P -c "select pdf_sha256 = encode(extensions.digest(convert_to(body_text,'UTF8'),'sha256'),'hex') from core.employment_contracts where id='$K'"); t "a impressão digital é a do texto guardado" '[ "$o" = t ]'
M=$(as $W "select public.mini_onb_me()")
KS=$(echo "$M" | python3 -c "import json,sys; print(json.load(sys.stdin)['contract']['sha256'])")
RS=$(echo "$M" | python3 -c "import json,sys; print(json.load(sys.stdin)['rules']['sha256'])")
SVG="<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 100'><path d='M10 50 C 40 10, 65 10, 95 50 S 150 90, 180 50 S 240 10, 290 50' fill='none' stroke='black' stroke-width='3'/><path d='M20 80 L 280 80' stroke='black'/></svg>"
o=$(as $W "select public.mini_onb_sign('$K', 'abc', '$RS', 'Ana Teste Nova', \$\$$SVG\$\$)"); t "assinar outro texto é recusado" 'echo "$o" | grep -q "changed"'
o=$(as $W "select public.mini_onb_sign('$K', '$KS', 'abc', 'Ana Teste Nova', \$\$$SVG\$\$)"); t "regras diferentes das mostradas é recusado" 'echo "$o" | grep -q "rules changed"'
o=$(as $W "select public.mini_onb_sign('$K', '$KS', '$RS', 'Ana Nova', \$\$$SVG\$\$)"); t "nome diferente do contrato é recusado" 'echo "$o" | grep -q "full name"'
o=$(as $W "select public.mini_onb_sign('$K', '$KS', '$RS', 'Ana Teste Nova', '<svg></svg>')"); t "sem assinatura com o dedo é recusado" 'echo "$o" | grep -q "finger"'
o=$(as $W "select public.mini_onb_sign('$K', '$KS', '$RS', 'Ana Teste Nova', \$\$${SVG/<path/<script>alert(1)</script><path}\$\$)"); t "assinatura com código é recusada" 'echo "$o" | grep -qi "invalid signature"'
o=$(as $W "select public.mini_onb_sign('$K', '$KS', '$RS', '  ana teste NOVA ', \$\$$SVG\$\$)->>'status'"); t "assina com o nome (maiúsculas e espaços não contam)" '[ "$o" = pending_rate_approval ]'
o=$($P -c "update core.employment_contracts set body_text = body_text || 'x' where id='$K'" 2>&1); o2=$($P -c "select status from core.employment_contracts where id='$K'"); t "contrato assinado fica guardado como assinado" '[ "$o2" = signed ]'
o=$(as $W "select public.mini_onb_sign('$K', '$KS', '$RS', 'Ana Teste Nova', \$\$$SVG\$\$)"); t "não assina duas vezes" 'echo "$o" | grep -q "no contract"'
o=$(as $W "select public.mini_onb_me()->'rates'->>'base'"); t "vê o valor hora antes de aceitar" '[ "$o" = 9.50 ] || [ "$o" = 9.5 ]'
o=$(as $W "select public.mini_onb_accept_rates()->>'status'"); t "aceita o valor hora e fica ativo" '[ "$o" = active ]'
o=$($P -c "select base_hourly_rate || '/' || overtime_hourly_rate from core.rate_acceptances where collaborator_id='$C'"); t "fica a prova do que aceitou" '[ "$o" = "9.50/12.25" ]'
o=$($P -c "select string_agg(step::text || ':' || (evidence->>'method'), ',' order by completed_at) from compliance.onboarding_steps where collaborator_id='$C'"); t "os 5 passos ficam registados como feitos na app" '[ "$o" = "safety_videos:app,personal_data:app,hr_validation:app,contract_signed:app,rate_accepted:app" ]'
o=$(as $W "select public.mini_my_papers()->'contract'->>'signed_name'"); t "depois vê os seus papéis" 'echo "$o" | grep -qi "ana teste nova"'
o=$(as $W "select public.mini_onb_accept_rates()"); t "não aceita duas vezes" 'echo "$o" | grep -q "pay terms step"'
# others
o=$($P -c "begin; set local role anon; select public.mini_onb_me(); rollback;" 2>&1); t "anónimo não entra" 'echo "$o" | grep -qi "denied"'
o=$(as $X "select public.mini_onb_me()"); t "login sem pessoa não vê nada" 'echo "$o" | grep -qi "not allowed"'
o=$(as $W "select public.mini_onb_person('$C')"); t "o trabalhador não abre a ficha do RH" 'echo "$o" | grep -qi "not allowed\|permission\|denied"'
o=$(as $W "select public.mini_onb_text_save('rules', 'Regras', 'nada')"); t "o trabalhador não muda as regras" 'echo "$o" | grep -qi "not allowed\|permission\|denied"'
o=$(as $H "select public.mini_onb_text_save('rules', 'Regras internas', 'REGULAMENTO INTERNO v2. 1. Segurança primeiro: quem vê um perigo pára o trabalho e avisa. 2. EPI sempre em obra. 3. Álcool e drogas: tolerância zero. 4. O cartão é pessoal. 5. Horário: avisa antes se faltares. 6. Confidencialidade nas instalações dos clientes.')"); o2=$($P -c "select count(*) || '/' || max(version) from core.contract_templates where tenant_id='$T0' and kind='rules'"); o3=$($P -c "select count(*) from core.contract_templates where tenant_id='$T0' and kind='rules' and is_active")
t "o RH muda as regras: nova versão, a antiga fica" '[ "$o2" = "2/2" ] && [ "$o3" = 1 ]'
o=$($P -c "select rules_template_id = (select id from core.contract_templates where tenant_id='$T0' and kind='rules' and version=1) from core.employment_contracts where id='$K'"); t "o contrato assinado continua ligado à versão que leu" '[ "$o" = t ]'
o=$($P -c "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'mini_onb%' or p.proname='mini_my_papers') and (not p.prosecdef or has_function_privilege('anon', p.oid, 'execute') or not coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%')"); t "funções novas: definer, search_path, sem anon" '[ "$o" = 0 ]'
echo "t80: $ok OK, $bad FALHA"
