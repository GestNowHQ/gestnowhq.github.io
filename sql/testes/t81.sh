# Checks for sql/81 (correções da auditoria 2026-10-19: A2 versão atual, A4 MFA para mudar de perfil, C3 número escrito à
# mão, C2 papel honesto, A1 acolhimento abre o portão). Fresh DB + sql/81 first:
#   DB=app_fixes .../reset.sh sql/81_correcoes_auditoria.sql && DB=app_fixes bash t81.sh      (default DB app). All data invented.
DB=${DB:-app}
P="psql -h /var/lib/pgtest -p 5433 -U postgres -d $DB -X -qAt"
as() { $P -c "begin; select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"aal\":\"${3:-aal2}\",\"role\":\"authenticated\"}', true); set local role authenticated; $2; commit;" 2>&1 | grep -v '^{"sub' | grep -v '^$' ; }
A=11111111-1111-1111-1111-111111111111; E=22222222-2222-2222-2222-222222222222; R=44444444-4444-4444-4444-444444444444
WL=81000000-0000-0000-0000-0000000000a1; NL=81000000-0000-0000-0000-0000000000a2; O=81000000-0000-0000-0000-0000000000a3
ok=0; bad=0; t() { if eval "$2"; then echo "OK    $1"; ok=$((ok+1)); else echo "FALHA $1 :: $o"; bad=$((bad+1)); fi; }
J() { as $1 "$2" | tail -1; }
U() { cat /proc/sys/kernel/random/uuid; }
T0=$($P -c "select tenant_id from core.app_users where user_id='$A'")
SITE=$($P -c "select id from core.projects where cost_center_code='GSI-01'")
C() { $P -c "select id from core.collaborators where employee_number='$1'"; }
W1=$(C Teste-0001); W2=$(C Teste-0002)
ACO=$($P -c "select id from core.document_types where tenant_id='$T0' and code='acolhimento'")
TODAY=$($P -c "select private.local_date(now())")
# Teste-0001 and 0002 get valid documents, so their taps are accepted
$P -c "insert into core.collaborator_documents (tenant_id, collaborator_id, document_type_id, file_url, issue_date, expiration_date, is_current, verified_at)
       select c.tenant_id, c.id, d.id, 'teste/doc.pdf', current_date - 10, current_date + 300, true, now()
       from core.collaborators c cross join core.document_types d where c.id in ('$W1','$W2') and d.is_blocking" >/dev/null
# another company with its own admin
$P -c "insert into core.tenants (tax_id, legal_name, simple_mode) values ('500000181','Outra 81 (inventada)',true) on conflict do nothing" >/dev/null
T1=$($P -c "select id from core.tenants where tax_id='500000181'")
O1=$($P -c "insert into core.organizations (tenant_id, kind, legal_name, tax_id) values ('$T1','own','Outra 81','500000181') returning id" | head -1)
$P -c "insert into auth.users (id, email) values ('$O','o81@t81.local') on conflict do nothing; insert into core.app_users (user_id, tenant_id, role, organization_id) values ('$O','$T1','admin','$O1') on conflict do nothing" >/dev/null

echo "== A2: só a versão atual do documento abre o portão"
as $A "select public.mini_add_worker('Pessoa 81-1', '900081001', 'Teste-0811', '04810001', '$SITE', 'Dados inventados para o teste 81')" >/dev/null
P1=$(C Teste-0811)
$P -c "insert into core.collaborator_documents (tenant_id, collaborator_id, document_type_id, file_url, issue_date, expiration_date, is_current, verified_at)
       values ('$T0', '$P1', '$ACO', 'papel:teste-81', current_date - 30, current_date + 300, true, now())" >/dev/null
o=$($P -c "select private.has_valid_document('$P1', '$ACO', current_date)"); t "versão atual válida: conta" '[ "$o" = t ]'
# HR corrects the validity: the new version expired yesterday; the old one is no longer current
$P -c "insert into core.collaborator_documents (tenant_id, collaborator_id, document_type_id, file_url, issue_date, expiration_date, is_current, verified_at)
       values ('$T0', '$P1', '$ACO', 'papel:teste-81b', current_date - 30, current_date - 1, true, now())" >/dev/null
o=$($P -c "select count(*) filter (where is_current)||'/'||count(*) from core.collaborator_documents where collaborator_id='$P1' and document_type_id='$ACO'"); t "a versão nova substitui a antiga" '[ "$o" = 1/2 ]'
o=$($P -c "select private.has_valid_document('$P1', '$ACO', current_date)"); t "versão antiga (não atual) já não abre o portão" '[ "$o" = f ]'
o=$(J $E "select public.clock_event('$SITE', 'card_on_supervisor_phone', '04810001', 'in', now(), '$(U)')->>'reasons'"); t "e a picagem de entrada é recusada" 'echo "$o" | grep -q "\["  && [ "$o" != "[]" ]'
o=$($P -c "select has_function_privilege('authenticated', 'private.has_valid_document(uuid,uuid,date)', 'execute')::text || has_function_privilege('anon', 'private.has_valid_document(uuid,uuid,date)', 'execute')::text"); t "ajudante do portão fechado a anónimos" '[ "$o" = truefalse ]'

echo "== A4: mudar de perfil pede o código do telemóvel a contas de escritório"
$P -c "update core.app_users set allowed_roles = '{hr,supervisor}' where user_id='$R'" >/dev/null
o=$(as $R "select public.mini_switch_role('supervisor')" aal1); t "RH só com palavra-passe não passa a encarregado" 'echo "$o" | grep -qi "phone code"'
o=$($P -c "select role from core.app_users where user_id='$R'"); t "e continua RH" '[ "$o" = hr ]'
o=$(J $R "select public.mini_switch_role('supervisor')"); t "com o código (aal2): muda" '[ "$o" = supervisor ]'
o=$(as $R "select public.mini_switch_role('hr')" aal1); t "voltar ao escritório sem código: recusado" 'echo "$o" | grep -qi "phone code"'
o=$(J $R "select public.mini_switch_role('hr')"); t "com o código volta a RH" '[ "$o" = hr ]'
$P -c "insert into auth.users (id, email) values ('$NL','n81@t81.local') on conflict do nothing" >/dev/null
$P -c "insert into core.app_users (user_id, tenant_id, role, allowed_roles, collaborator_id, organization_id) select '$NL', tenant_id, 'supervisor', '{supervisor,worker}', id, organization_id from core.collaborators where id='$P1'" >/dev/null
o=$(J $NL "select public.mini_switch_role('worker')" aal1); t "encarregado/colaborador (sem escritório): muda sem código" '[ "$o" = worker ]'
o=$(J $NL "select public.mini_switch_role('supervisor')" aal1); t "e volta" '[ "$o" = supervisor ]'
o=$(as $NL "select public.mini_switch_role('hr')"); t "perfil que não é seu: recusado" 'echo "$o" | grep -qi "not yours"'
o=$(as $O "select public.mini_switch_role('supervisor')"); t "outra empresa: só os perfis da própria conta" 'echo "$o" | grep -qi "not yours"'
$P -c "update core.tenants set require_mfa_for_privileged = false where id='$T0'" >/dev/null
o=$(J $R "select public.mini_switch_role('supervisor')" aal1); t "empresa que desligou o MFA: segue a regra dela" '[ "$o" = supervisor ]'
$P -c "update core.tenants set require_mfa_for_privileged = true where id='$T0'; update core.app_users set role='hr', allowed_roles=null where user_id='$R'" >/dev/null
o=$($P -c "begin; set local role anon; select public.mini_switch_role('admin'); commit;" 2>&1); t "sem login: recusado" 'echo "$o" | grep -qi "permission denied"'

echo "== C3: número do cartão escrito à mão"
o=$(J $E "select public.mini_clock_typed('$SITE', 'card_on_supervisor_phone', '04E233AAB91090', 'in', now(), '$(U)')->>'status'"); t "picagem escrita: aceite" '[ "$o" = accepted ]'
o=$($P -c "select 'typed_number' = any (anomaly_flags) from core.time_events where collaborator_id='$W1' order by received_at desc limit 1"); t "fica marcada «typed_number»" '[ "$o" = t ]'
o=$(J $E "select public.clock_event('$SITE', 'card_on_supervisor_phone', '04000002', 'in', now(), '$(U)')->>'status'"); t "picagem lida no cartão: aceite" '[ "$o" = accepted ]'
o=$($P -c "select 'typed_number' = any (anomaly_flags) from core.time_events where collaborator_id='$W2' order by received_at desc limit 1"); t "e não fica marcada" '[ "$o" = f ]'
# the flag never leaks into the next call of the same transaction
o=$(as $E "select public.mini_clock_typed('$SITE', 'card_on_supervisor_phone', '04E233AAB91090', 'out', now(), '$(U)')->>'event_id'; select public.clock_event('$SITE', 'card_on_supervisor_phone', '04000002', 'out', now(), '$(U)')->>'event_id'" | tr '\n' ',' | sed 's/,$//')
o=$($P -c "select string_agg(('typed_number' = any (anomaly_flags))::text, ',' order by array_position(string_to_array('$o', ',')::uuid[], id)) from core.time_events where id = any (string_to_array('$o', ',')::uuid[])"); t "a marca não passa para a picagem seguinte" '[ "$o" = "true,false" ]'
R1=$(U); o=$(J $E "select public.mini_clock_typed('$SITE', 'card_on_supervisor_phone', '04E233AAB91090', 'in', now() - interval '1 hour', '$R1', null, null, true, true)->>'status'")
o=$(J $E "select public.mini_clock_typed('$SITE', 'card_on_supervisor_phone', '04E233AAB91090', 'in', now() - interval '1 hour', '$R1', null, null, true, true)->>'replayed'"); t "fila sem rede: repetir não duplica" '[ "$o" = true ]'
o=$(J $E "select count(*) from public.mini_day_events('$W1', '$SITE', current_date) where not manual and manual_reason = 'número do cartão escrito à mão'"); t "o dia mostra as picagens escritas à mão (encarregado)" '[ "$o" -ge 2 ]'
o=$(J $E "select count(*) from public.mini_day_events('$W2', '$SITE', current_date) where manual_reason is not null"); t "e não marca as lidas" '[ "$o" = 0 ]'
o=$(J $R "select count(*) from public.mini_manual_taps(current_date - 1, current_date + 1) where reason = 'número do cartão escrito à mão'"); t "o escritório vê-as para aprovar" '[ "$o" -ge 1 ]'
o=$(as $E "select public.mini_clock_typed('$SITE', 'self_app', null, 'in', now(), '$(U)')"); t "sem cartão (self_app): recusado" 'echo "$o" | grep -qi "only for a card"'
o=$($P -c "begin; set local role anon; select public.mini_clock_typed('$SITE', 'card_on_supervisor_phone', '04E233AAB91090', 'in', now(), '$(U)'); commit;" 2>&1); t "sem login: recusado" 'echo "$o" | grep -qi "permission denied"'
o=$(as $O "select public.mini_clock_typed('$SITE', 'card_on_supervisor_phone', '04E233AAB91090', 'in', now(), '$(U)')"); t "outra empresa: não encontra a obra" 'echo "$o" | grep -qi "project not found"'
$P -c "insert into auth.users (id, email) values ('$WL','w81@t81.local') on conflict do nothing; insert into core.app_users (user_id, tenant_id, role, collaborator_id, organization_id) select '$WL', tenant_id, 'worker', id, organization_id from core.collaborators where id='$W1' on conflict do nothing" >/dev/null
o=$(as $WL "select public.mini_clock_typed('$SITE', 'card_on_supervisor_phone', '04000002', 'in', now(), '$(U)')"); t "colaborador não pica pelos outros" 'echo "$o" | grep -qi "not allowed"'
o=$(as $A "select private.card_typed()"); t "ajudante privado fechado à app" 'echo "$o" | grep -qi "permission denied"'
o=$($P -c "select string_agg(proname, ',' order by proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'mini\_%\_typed' and p.proname <> 'mini_clock_typed' or p.proname = 'mini_clock_typed'"); t "4 funções «escrito à mão»" '[ "$o" = "mini_clock_typed,mini_lmra_sign_typed,mini_muster_scan_typed,mini_wh_issue_typed" ]'
o=$($P -c "select count(*) from pg_proc p where p.proname in ('mini_clock_typed','mini_lmra_sign_typed','mini_muster_scan_typed','mini_wh_issue_typed') and p.prosecdef and 'search_path=\"\"' = any(p.proconfig) and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')"); t "todas com search_path vazio, para logins, não anónimos" '[ "$o" = 4 ]'

echo "== C3: LMRA, ponto de encontro e armazém"
YES='{"task_clear":true,"hazards":true,"permit":true,"ppe":true,"tools":true,"area":true,"isolation":true,"neighbours":true,"escape":true,"fit":true}'
L1=$(as $E "select public.mini_lmra_save('$SITE', 'Bomba P-181', 'Trocar vedante', '$YES')->>'id'")
o=$(J $E "select public.mini_lmra_sign_typed('$L1', '04E233AAB91090')->>'name'"); t "LMRA assinado com número escrito" '[ "$o" = "Diogo Teste" ]'
o=$(J $E "select public.mini_lmra_sign('$L1', '04000002')->>'name'"); t "LMRA assinado com o cartão" '[ -n "$o" ] && ! echo "$o" | grep -qi error'
o=$($P -c "select string_agg(c.employee_number || ':' || s.card_typed, ',' order by c.employee_number) from safety.lmra_signatures s join core.collaborators c on c.id=s.collaborator_id where s.lmra_id='$L1'"); t "a assinatura guarda se foi escrita" '[ "$o" = "Teste-0001:true,Teste-0002:false" ]'
o=$(as $O "select public.mini_lmra_sign_typed('$L1', '04E233AAB91090')"); t "outra empresa: recusado" 'echo "$o" | grep -qi "not allowed"'
o=$($P -c "begin; set local role anon; select public.mini_lmra_sign_typed('$L1', '04E233AAB91090'); commit;" 2>&1); t "sem login: recusado" 'echo "$o" | grep -qi "permission denied"'
EV=$(as $E "select public.mini_emergency_start('$SITE', 'drill', 'simulacro do teste 81')")
PE=$($P -c "select id from muster.assembly_points where project_id='$SITE' order by code limit 1")
o=$(J $E "select public.mini_muster_scan_typed('$EV', '$PE', '04E233AAB91090', '$(U)')->>'known'"); t "ponto de encontro: número escrito conta" '[ "$o" = true ]'
o=$(J $E "select public.mini_muster_scan('$EV', '$PE', '04000002', '$(U)')->>'known'"); t "ponto de encontro: cartão" '[ "$o" = true ]'
o=$($P -c "select string_agg(c.employee_number || ':' || s.card_typed, ',' order by c.employee_number) from muster.muster_scans s join core.collaborators c on c.id=s.collaborator_id where s.event_id='$EV'"); t "a contagem guarda se foi escrito" '[ "$o" = "Teste-0001:true,Teste-0002:false" ]'
o=$(as $O "select public.mini_muster_scan_typed('$EV', '$PE', '04E233AAB91090', '$(U)')"); t "outra empresa: recusado" 'echo "$o" | grep -qi "not found"'
o=$($P -c "begin; set local role anon; select public.mini_muster_scan_typed('$EV', '$PE', '04E233AAB91090', '$(U)'); commit;" 2>&1); t "sem login: recusado" 'echo "$o" | grep -qi "permission denied"'
as $E "select public.mini_emergency_end('$EV')" >/dev/null 2>&1
WH=$(J $A "select public.mini_wh_home()->>'central'")
as $A "select public.mini_wh_item_save(null, '{\"category\":\"consumable\",\"family\":\"Luvas 81\",\"unit\":\"par\",\"unit_cost\":0.8}')" >/dev/null
LV=$($P -c "select id from warehouse.items where family='Luvas 81'")
as $A "select public.mini_wh_stock_in('$WH', '$LV', 100, null, null)" >/dev/null
B1=$(U); B2=$(U)
o=$(J $E "select public.mini_wh_issue_typed('$WH', '$W1', '[{\"item\":\"$LV\",\"qty\":2}]', null, '04E233AAB91090', '$SITE', null, null, '$B1')->>'lines'"); t "entrega assinada com número escrito" '[ "$o" = 1 ]'
o=$(J $E "select public.mini_wh_issue('$WH', '$W1', '[{\"item\":\"$LV\",\"qty\":2}]', null, '04E233AAB91090', '$SITE', null, null, '$B2')->>'lines'"); t "entrega assinada com o cartão" '[ "$o" = 1 ]'
o=$($P -c "select (select card_typed from warehouse.stock_movements where batch_id='$B1')::text || '/' || (select card_typed from warehouse.stock_movements where batch_id='$B2')::text"); t "o movimento guarda se foi escrito" '[ "$o" = true/false ]'
o=$(as $E "select public.mini_wh_issue_typed('$WH', '$W1', '[{\"item\":\"$LV\",\"qty\":1}]', null, '04000002', '$SITE', null, null, '$(U)')"); t "número de outra pessoa: recusado na mesma" 'echo "$o" | grep -qi "not this person"'
o=$(as $O "select public.mini_wh_issue_typed('$WH', '$W1', '[{\"item\":\"$LV\",\"qty\":1}]', null, '04E233AAB91090', null, null, null, '$(U)')"); t "outra empresa: recusado" 'echo "$o" | grep -qi "not found\|not allowed"'
o=$(as $R "select public.mini_wh_issue_typed('$WH', '$W1', '[{\"item\":\"$LV\",\"qty\":1}]', null, '04E233AAB91090', null, null, null, '$(U)')"); t "RH não entrega" 'echo "$o" | grep -qi "not allowed"'
o=$($P -c "begin; set local role anon; select public.mini_wh_issue_typed('$WH', '$W1', '[]', null, '04E233AAB91090', null, null, null, '$(U)'); commit;" 2>&1); t "sem login: recusado" 'echo "$o" | grep -qi "permission denied"'

echo "== C2: «vi em papel» fica escrito como papel"
o=$($P -c "select count(*) filter (where evidence->>'method' = 'paper' and evidence->>'by' = '$A' and length(evidence->>'statement') > 10)||'/'||count(*) from compliance.onboarding_steps where collaborator_id='$P1'"); t "os 5 passos dizem papel, quem e o quê" '[ "$o" = 5/5 ]'
o=$($P -c "select onboarding_status from core.collaborators where id='$P1'"); t "e a pessoa fica ativa (continua a funcionar)" '[ "$o" = active ]'
o=$(J $R "select string_agg(distinct x->>'method', ',') || '/' || string_agg(distinct x->>'by', ',') from jsonb_array_elements(public.mini_worker_profile('$P1')->'onboarding') x"); t "a ficha diz «em papel» e por quem" 'echo "$o" | grep -q "^paper/"'
o=$(J $R "select jsonb_array_length(public.mini_worker_profile('$P1')->'onboarding')"); t "a ficha mostra os 5 passos" '[ "$o" = 5 ]'
o=$(as $O "select public.mini_worker_profile('$P1')"); t "outra empresa: não vê a ficha" 'echo "$o" | grep -qi "not allowed"'
o=$(as $WL "select public.mini_worker_profile('$P1')"); t "colaborador: não vê a ficha de outro" 'echo "$o" | grep -qi "not allowed"'
o=$(as $O "select public.mini_activate_worker('$P1', 'Tentativa de outra empresa')"); t "outra empresa não ativa pessoas daqui" 'echo "$o" | grep -qi "not found\|not allowed"'
o=$($P -c "begin; set local role anon; select public.mini_activate_worker('$P1', 'sem login nenhum aqui'); commit;" 2>&1); t "sem login: recusado" 'echo "$o" | grep -qi "permission denied"'

echo "== A1: acabar o acolhimento cria o documento «acolhimento»"
Q='[{"q":"Na obra usas capacete?","options":["Sim","Não"],"correct":0}]'
IT=$(J $R "select public.mini_induction_save(null, 'Regras da obra 81', 'document', null, 'Na obra usas sempre capacete, botas e colete. Dados inventados.', 20, '$Q'::jsonb)")
t "parte do acolhimento criada" '[ ${#IT} = 36 ]'
NW=$(J $R "select public.mini_add_worker_onboarding('Pessoa 81-2', '900081002', 'Teste-0812', '$SITE')")
P2=$(C Teste-0812)
NWL=81000000-0000-0000-0000-0000000000a4
$P -c "insert into auth.users (id, email) values ('$NWL','p81@t81.local') on conflict do nothing; insert into core.app_users (user_id, tenant_id, role, collaborator_id, organization_id) select '$NWL', tenant_id, 'worker', id, organization_id from core.collaborators where id='$P2'" >/dev/null
o=$($P -c "select private.has_valid_document('$P2', '$ACO', current_date)"); t "antes: sem acolhimento, o portão fecha" '[ "$o" = f ]'
$P -c "update core.document_types set valid_months = 12 where id='$ACO'" >/dev/null
as $NWL "select public.mini_induction_open('$IT')" aal1 >/dev/null
$P -c "update compliance.induction_progress set opened_at = opened_at - interval '30 seconds' where item_id='$IT' and collaborator_id='$P2'" >/dev/null
as $NWL "select public.mini_induction_seen('$IT')" aal1 >/dev/null
o=$(J $NWL "select public.mini_induction_answer('$IT', '{1}')->>'passed'" aal1); t "resposta errada: não passa, nem documento" '[ "$o" = false ] && [ "$($P -c "select count(*) from core.collaborator_documents where collaborator_id='"'$P2'"'")" = 0 ]'
as $NWL "select public.mini_induction_open('$IT')" aal1 >/dev/null
$P -c "update compliance.induction_progress set opened_at = opened_at - interval '30 seconds' where item_id='$IT' and collaborator_id='$P2'" >/dev/null
as $NWL "select public.mini_induction_seen('$IT')" aal1 >/dev/null
o=$(J $NWL "select public.mini_induction_answer('$IT', '{0}')->>'step_done'" aal1); t "tudo certo: passo 1 feito" '[ "$o" = true ]'
o=$($P -c "select document_number || '|' || issue_date || '|' || expiration_date || '|' || is_current || '|' || (verified_at is not null) || '|' || ai_extracted from core.collaborator_documents where collaborator_id='$P2' and document_type_id='$ACO'")
EXP=$($P -c "select ('$TODAY'::date + interval '12 months')::date")
t "documento «acolhimento» atual, verificado, de hoje, válido 12 meses" '[ "$o" = "Acolhimento digital|$TODAY|$EXP|true|true|false" ]'
o=$($P -c "select private.has_valid_document('$P2', '$ACO', current_date)"); t "e o portão abre" '[ "$o" = t ]'
o=$($P -c "select private.induction_check_done('$P2')"); t "verificar outra vez não duplica" '[ "$o" = t ] && [ "$($P -c "select count(*) from core.collaborator_documents where collaborator_id='"'$P2'"'")" = 1 ]'
# a company without the document type: the step is done, nothing else is made
as $R "select public.mini_add_worker_onboarding('Pessoa 81-3', '900081003', 'Teste-0813', '$SITE')" >/dev/null
P3=$(C Teste-0813); P3L=81000000-0000-0000-0000-0000000000a5
$P -c "insert into auth.users (id, email) values ('$P3L','q81@t81.local') on conflict do nothing; insert into core.app_users (user_id, tenant_id, role, collaborator_id, organization_id) select '$P3L', tenant_id, 'worker', id, organization_id from core.collaborators where id='$P3'" >/dev/null
$P -c "update core.document_types set code = 'acolhimento_81_off' where id='$ACO'" >/dev/null
as $P3L "select public.mini_induction_open('$IT')" aal1 >/dev/null
$P -c "update compliance.induction_progress set opened_at = opened_at - interval '30 seconds' where item_id='$IT' and collaborator_id='$P3'" >/dev/null
as $P3L "select public.mini_induction_seen('$IT')" aal1 >/dev/null
o=$(J $P3L "select public.mini_induction_answer('$IT', '{0}')->>'step_done'" aal1); t "empresa sem o tipo «acolhimento»: o passo fica feito" '[ "$o" = true ]'
o=$($P -c "select count(*) from core.collaborator_documents where collaborator_id='$P3'"); t "e não se inventa documento nenhum" '[ "$o" = 0 ]'
$P -c "update core.document_types set code = 'acolhimento', valid_months = null where id='$ACO'" >/dev/null
o=$(J $R "select string_agg((x->>'step') || ':' || (x->>'method'), ',') from jsonb_array_elements(public.mini_worker_profile('$P2')->'onboarding') x"); t "na ficha: acolhimento feito na app (não em papel)" '[ "$o" = "safety_videos:app" ]'
$P -c "insert into compliance.onboarding_steps (tenant_id, collaborator_id, step, completed_by, evidence) values ('$T0', '$P3', 'personal_data', '$A', '{\"simple_mode\": true, \"statement\": \"registo antigo em papel (inventado)\"}')" >/dev/null
o=$(J $R "select x->>'method' from jsonb_array_elements(public.mini_worker_profile('$P3')->'onboarding') x where x->>'step' = 'personal_data'"); t "registos antigos de papel (antes do 81) também dizem papel" '[ "$o" = paper ]'

echo "== t81: $bad problemas ($ok OK)"
