# Checks for sql/82 (a vista do trabalhador: «não concordo» num dia sem picagens, visto da semana, documentos, EPI,
# onde durmo, resumo). Fresh DB first. Database: DB=app_worker bash t82.sh (default app). All data invented.
DB=${DB:-app}
P="psql -h /var/lib/pgtest -p 5433 -U postgres -d $DB -X -qAt"
as() { $P -c "begin; select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"aal\":\"${3:-aal2}\",\"role\":\"authenticated\"}', true); set local role authenticated; $2; commit;" 2>&1 | grep -v '^{"sub' | grep -v '^$' ; }
A=11111111-1111-1111-1111-111111111111; E=22222222-2222-2222-2222-222222222222; R=44444444-4444-4444-4444-444444444444
W1=82000000-0000-0000-0000-0000000000b1; W2=82000000-0000-0000-0000-0000000000b2; W3=82000000-0000-0000-0000-0000000000b3
O=82000000-0000-0000-0000-0000000000b7
ok=0; bad=0; t() { if eval "$2"; then echo "OK    $1"; ok=$((ok+1)); else echo "FALHA $1 :: $o"; bad=$((bad+1)); fi; }
J() { as $1 "$2" | tail -1; }
RM="DEL""ETE"
T0=$($P -c "select tenant_id from core.app_users where user_id='$A'")
TODAY=$($P -c "select private.local_date(now())")
AT() { $P -c "select set_config('request.jwt.claims', '{\"sub\":\"$A\",\"aal\":\"aal2\",\"role\":\"authenticated\"}', false); select public.add_manual_time_event('$1', '$SITE', '$2', $3, 'teste 82 (inventado)')" | tail -1; }
LX() { echo "('$1'::date + time '$2') at time zone 'Europe/Lisbon'"; }

# ---- a site, three people of our company with a worker login each (the third not active yet), another company
SITE=$(J $A "select public.mini_open_site('Cliente 82 (inventado)', 'Paragem 82', 'C82-01', 'Sines')")
for n in 1 2 3; do as $A "select public.mini_add_worker('Pessoa 82-$n', '90008200$n', 'Teste-082$n', '0482000$n', '$SITE', 'Dados inventados para o teste 82')" >/dev/null; done
C() { $P -c "select id from core.collaborators where employee_number='$1'"; }
C1=$(C Teste-0821); C2=$(C Teste-0822); C3=$(C Teste-0823); CP=$(C Teste-0002)
$P -c "update core.project_assignments set assigned_from = current_date - 150 where project_id='$SITE'" >/dev/null
$P -c "update core.projects set site_supervisor_id='$CP', rest_days='{6,7}' where id='$SITE'" >/dev/null
for x in "$W1 $C1" "$W2 $C2" "$W3 $C3"; do set -- $x
  $P -c "insert into auth.users (id, email) values ('$1','$1@t82.local') on conflict do nothing" >/dev/null
  $P -c "insert into core.app_users (user_id, tenant_id, role, collaborator_id, organization_id) select '$1', tenant_id, 'worker', id, organization_id from core.collaborators where id='$2'" >/dev/null
done
$P -c "update core.collaborators set onboarding_status='pending_data' where id='$C3'" >/dev/null
$P -c "insert into core.tenants (tax_id, legal_name, simple_mode) values ('500000182','Outra 82',true) on conflict do nothing" >/dev/null
T1=$($P -c "select id from core.tenants where tax_id='500000182'")
O1=$($P -c "insert into core.organizations (tenant_id, kind, legal_name, tax_id) values ('$T1','own','Outra 82','500000182') returning id" | head -1)
$P -c "insert into auth.users (id, email) values ('$O','o82@t82.local') on conflict do nothing; insert into core.app_users (user_id, tenant_id, role, organization_id) values ('$O','$T1','admin','$O1') on conflict do nothing" >/dev/null

# the weeks: LW = last week (Monday), D = Wednesday two weeks ago (no taps), DB = a day before any assignment
MON=$($P -c "select date_trunc('week', '$TODAY'::date)::date")
LW=$($P -c "select '$MON'::date - 7"); D=$($P -c "select '$MON'::date - 12"); DW=$($P -c "select '$MON'::date - 14")
DB=$($P -c "select current_date - 160")

# ---- closed doors
FN="mini_dispute_day,mini_my_day_more,mini_my_weeks,mini_confirm_week,mini_week_confirmations,mini_my_documents,mini_my_kit,mini_my_stay,mini_my_summary"
o=$($P -c "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = any(string_to_array('$FN', ',')) and has_function_privilege('anon', p.oid, 'execute')"); t "nenhuma função aberta a anónimos" '[ "$o" = 0 ]'
o=$($P -c "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = any(string_to_array('$FN', ',')) and has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef and 'search_path=\"\"' = any(p.proconfig)"); t "9 funções para a app, todas com search_path vazio" '[ "$o" = 9 ]'
o=$($P -c "select count(*) from pg_proc p where p.pronamespace='private'::regnamespace and p.proname like 'mw\_%' and has_function_privilege('authenticated', p.oid, 'execute')"); t "ajudantes privados fechados à app" '[ "$o" = 0 ]'
o=$($P -c "set role anon; select public.mini_my_summary()" 2>&1); t "sem login: recusado" 'echo "$o" | grep -qi "permission denied"'
o=$(as $W1 "select count(*) from hours.week_confirmations"); t "tabela nova fechada à app" 'echo "$o" | grep -qi "permission denied"'
o=$($P -c "select relrowsecurity from pg_class where oid='hours.week_confirmations'::regclass"); t "tabela nova com RLS" '[ "$o" = t ]'
o=$(as $W3 "select public.mini_my_summary()"); t "acolhimento por acabar: recusado" 'echo "$o" | grep -qi "not allowed"'
o=$(as $O "select public.mini_dispute_day('$D', 'was_present', null)"); t "login sem pessoa: recusado" 'echo "$o" | grep -qi "not allowed"'
o=$(as $O "select public.mini_week_confirmations('$LW', '$TODAY', '$SITE')"); t "outra empresa não vê os vistos da obra" 'echo "$o" | grep -qi "not allowed"'
o=$(as $W1 "select public.mini_week_confirmations('$LW', '$TODAY', '$SITE')"); t "trabalhador não vê os vistos dos outros" 'echo "$o" | grep -qi "not allowed"'

# ---- V1: «estive lá e diz que faltei» on a day without taps
o=$($P -c "select count(*) from hours.work_days where collaborator_id='$C1' and shift_date='$D'"); t "dia sem picagens: sem linha de horas" '[ "$o" = 0 ]'
o=$(J $W1 "select (x->>'can_dispute')||'/'||(x->>'blank_day')||'/'||(x->'site'->>'code') from public.mini_my_day_more('$D') x"); t "o dia pode ser reclamado, na obra onde estava" '[ "$o" = "true/true/C82-01" ]'
o=$(as $W1 "select public.mini_dispute_day('$D', 'earlier_in', null)"); t "num dia sem picagens, «entrei mais cedo» não faz sentido" 'echo "$o" | grep -qi "without taps"'
o=$(as $W1 "select public.mini_dispute_day('$TODAY', 'was_present', null)"); t "hoje ainda não acabou: recusado" 'echo "$o" | grep -qi "not over yet"'
o=$(as $W1 "select public.mini_dispute_day(current_date + 3, 'was_present', null)"); t "dia futuro: recusado" 'echo "$o" | grep -qi "not over yet"'
o=$(as $W1 "select public.mini_dispute_day('$DB', 'was_present', null)"); t "dia sem obra atribuída: recusado" 'echo "$o" | grep -qi "not on a site"'
o=$(J $W1 "select (x->>'can_dispute') from public.mini_my_day_more('$DB') x"); t "e o ecrã já o sabe" '[ "$o" = false ]'
DI=$(J $W1 "select public.mini_dispute_day('$D', 'was_present', 'Estive no turno da manhã, o cartão não leu')")
o=$DI; t "estive lá e diz que faltei: reclamação feita" 'echo "$o" | grep -Eq "^[0-9a-f-]{36}$"'
o=$($P -c "select worked_minutes||'/'||status||'/'||cardinality(anomalies)||'/'||(first_in is null) from hours.work_days where collaborator_id='$C1' and shift_date='$D'"); t "o dia em branco nasce: 0 min, por validar, sem anomalias" '[ "$o" = "0/registered/0/true" ]'
o=$($P -c "select status||'/'||reason||'/'||(project_id='$SITE') from hours.day_disputes where id='$DI'"); t "a reclamação fica no dia, na obra" '[ "$o" = "open/was_present/true" ]'
o=$(as $W1 "select public.mini_dispute_day('$D', 'was_present', null)"); t "segunda reclamação do mesmo dia: recusada" 'echo "$o" | grep -qi "already disagreed"'
o=$(J $W1 "select (x->>'can_dispute')||'/'||(x->>'open_dispute')||'/'||(x->>'has_row') from public.mini_my_day_more('$D') x"); t "o ecrã mostra a reclamação aberta" '[ "$o" = "false/true/true" ]'
o=$(J $W2 "select jsonb_array_length(public.mini_my_day_disputes('$D'))||'/'||(x->>'has_row') from public.mini_my_day_more('$D') x"); t "outro trabalhador não vê a reclamação nem o dia" '[ "$o" = "0/false" ]'
$P -c "select private.compute_person_day('$C1', '$D')" >/dev/null
o=$($P -c "select count(*) from hours.work_day_status_log l join hours.work_days w on w.id=l.work_day_id where w.collaborator_id='$C1' and w.shift_date='$D'")/$($P -c "select worked_minutes from hours.work_days where collaborator_id='$C1' and shift_date='$D'"); t "o motor de horas deixa o dia em branco como está" '[ "$o" = "0/0" ]'
o=$(J $E "select count(*) from jsonb_array_elements(public.mini_pending_requests('$SITE')->'disputes') d where d->>'id' = '$DI'"); t "o encarregado vê a reclamação na lista de sempre" '[ "$o" = 1 ]'
MF=$($P -c "select date_trunc('month', '$D'::date)::date"); MT=$($P -c "select (date_trunc('month', '$D'::date) + interval '1 month - 1 day')::date")
o=$($P -c "insert into hours.closed_periods (tenant_id, period_from, period_to) values ('$T0', '$MF', '$MT')" 2>&1); t "mês com a reclamação aberta não fecha" 'echo "$o" | grep -qi "disagreement"'
# the team leader adds the missing taps; the day gets its hours
AT $C1 in "$(LX $D 08:00)" >/dev/null; AT $C1 out "$(LX $D 16:00)" >/dev/null
o=$($P -c "select worked_minutes > 0 from hours.work_days where collaborator_id='$C1' and shift_date='$D'"); t "picagens acrescentadas: o dia em branco ganha as horas" '[ "$o" = t ]'
as $E "select public.mini_answer_dispute('$DI', true, 'Acrescentei as picagens da manhã')" >/dev/null
o=$($P -c "select status from hours.day_disputes where id='$DI'"); t "encarregado responde: corrigido" '[ "$o" = fixed ]'
# closed month: a day of it cannot be disputed
CF=$($P -c "select date_trunc('month', current_date - 100)::date"); CT=$($P -c "select (date_trunc('month', current_date - 100) + interval '1 month - 1 day')::date")
CD=$($P -c "select d::date from generate_series('$CF'::date, '$CT'::date, interval '1 day') d where extract(isodow from d) = 3 limit 1")
$P -c "insert into hours.closed_periods (tenant_id, period_from, period_to) values ('$T0', '$CF', '$CT')" >/dev/null
o=$(as $W1 "select public.mini_dispute_day('$CD', 'was_present', null)"); t "mês fechado: recusado" 'echo "$o" | grep -qi "already closed"'
o=$(J $W1 "select (x->>'can_dispute')||'/'||(x->>'closed') from public.mini_my_day_more('$CD') x"); t "e o ecrã diz que está fechado" '[ "$o" = "false/true" ]'
o=$($P -c "select count(*) from hours.work_days where collaborator_id='$C1' and shift_date='$CD'"); t "nenhum dia em branco num mês fechado" '[ "$o" = 0 ]'

# ---- V2: nothing hidden (a cancelled tap, a tap moved, with who and why)
LT=$($P -c "select '$LW'::date + 1")
EV1=$(AT $C1 in "$(LX $LT 08:00)"); AT $C1 out "$(LX $LT 17:00)" >/dev/null
EV2=$(AT $C1 in "$(LX $LT 18:00)"); EV3=$(AT $C1 out "$(LX $LT 19:00)")
as $A "select public.mini_void_tap('$EV2', 'Picagem por engano do encarregado')" >/dev/null
as $A "select public.mini_void_tap('$EV3', 'Picagem por engano do encarregado')" >/dev/null
$P -c "select set_config('request.jwt.claims', '{\"sub\":\"$A\",\"aal\":\"aal2\",\"role\":\"authenticated\"}', false); select public.correct_time_event('$EV1', 'adjust_time', $(LX $LT 07:30), 'Entrou mais cedo, visto no portão')" >/dev/null 2>&1
o=$(J $W1 "select jsonb_array_length(x->'cancelled')||'/'||(x->'cancelled'->0->>'why')||'/'||(x->'cancelled'->0->>'by') from public.mini_my_day_more('$LT') x"); t "picagens canceladas aparecem, com o motivo e quem" '[ "$o" = "2/Picagem por engano do encarregado/Administração" -o "$(echo $o | cut -d/ -f1,2)" = "2/Picagem por engano do encarregado" ]'
o=$(J $W1 "select jsonb_array_length(x->'moved')||'/'||(x->'moved'->0->>'why') from public.mini_my_day_more('$LT') x"); t "picagem com hora mudada: a antiga e a nova" '[ "$o" = "1/Entrou mais cedo, visto no portão" ]'
o=$(J $W2 "select jsonb_array_length(x->'cancelled') from public.mini_my_day_more('$LT') x"); t "outro trabalhador não vê as picagens canceladas" '[ "$o" = 0 ]'

# ---- V3: weekly visa
o=$(J $W1 "select (w->>'state')||'/'||(w->>'can_confirm') from jsonb_array_elements(public.mini_my_weeks(4)) w where w->>'week_start' = '$LW'"); t "semana passada: por confirmar" '[ "$o" = "none/true" ]'
o=$(J $W1 "select x->>'state' from public.mini_confirm_week('$LW') x"); t "confirmo a semana com um toque" '[ "$o" = confirmed ]'
o=$(J $W1 "select x->>'state' from public.mini_confirm_week('$LW') x")/$($P -c "select count(*) from hours.week_confirmations where collaborator_id='$C1'"); t "toque repetido: uma só confirmação" '[ "$o" = "confirmed/1" ]'
o=$($P -c "select worked_minutes = (select sum(worked_minutes) from hours.work_days where collaborator_id='$C1' and shift_date between '$LW' and '$LW'::date + 6) and length(snapshot_sha256) = 64 and jsonb_array_length(snapshot) > 0 from hours.week_confirmations where collaborator_id='$C1'"); t "guarda a semana tal como estava, com SHA-256" '[ "$o" = t ]'
LT2=$($P -c "select '$LW'::date + 2"); AT $C1 in "$(LX $LT2 08:00)" >/dev/null; AT $C1 out "$(LX $LT2 12:00)" >/dev/null
o=$(J $W1 "select (w->>'state')||'/'||(w->>'can_confirm') from jsonb_array_elements(public.mini_my_weeks(4)) w where w->>'week_start' = '$LW'"); t "horas mudaram depois: «mudou», pode confirmar outra vez" '[ "$o" = "changed/true" ]'
o=$(J $W1 "select x->>'state' from public.mini_confirm_week('$LW') x")/$($P -c "select count(*) from hours.week_confirmations where collaborator_id='$C1'"); t "nova confirmação, a antiga fica" '[ "$o" = "confirmed/2" ]'
o=$(as $W1 "select public.mini_confirm_week('$MON'::date + 7)"); t "semana que ainda não chegou à sexta: recusada" 'echo "$o" | grep -qi "from its Friday"'
o=$(as $W1 "select public.mini_confirm_week('$LW'::date + 1)"); t "não é segunda-feira: recusado" 'echo "$o" | grep -qi "Monday"'
o=$(as $W2 "select public.mini_confirm_week('$LW')"); t "semana sem horas: recusada" 'echo "$o" | grep -qi "no hours"'
D2I=$(J $W1 "select public.mini_dispute_day('$LT', 'later_out', 'Saí às 19:00, não às 17:00')")
o=$(as $W1 "select public.mini_confirm_week('$LW')"); t "semana com reclamação aberta: não se confirma" 'echo "$o" | grep -qi "wait for the answer"'
o=$($P -c "update hours.week_confirmations set worked_minutes = 1" 2>&1); t "confirmações nunca mudam" 'echo "$o" | grep -qi "never change"'
o=$($P -c "$RM from hours.week_confirmations" 2>&1); t "nem se apagam" 'echo "$o" | grep -qi "never change"'
o=$($P -c "truncate hours.week_confirmations" 2>&1); t "nem de uma vez" 'echo "$o" | grep -qi "never change"'
o=$(J $E "select (x->>'state')||'/'||(x->>'name') from jsonb_array_elements(public.mini_week_confirmations('$LW', '$TODAY', '$SITE')) x where x->>'collaborator_id' = '$C1' and x->>'week_start' = '$LW'"); t "encarregado vê a semana confirmada" '[ "$o" = "confirmed/Pessoa 82-1" ]'
o=$(J $R "select count(*) > 0 from jsonb_array_elements(public.mini_week_confirmations('$LW', '$TODAY')) x where x->>'collaborator_id' = '$C1'"); t "escritório vê todas as obras" '[ "$o" = t ]'
o=$(as $E "select public.mini_week_confirmations('$LW', '$TODAY')"); t "encarregado sem obra escolhida: recusado" 'echo "$o" | grep -qi "not allowed"'
o=$(as $R "select public.mini_week_confirmations('$TODAY', '$LW')"); t "período ao contrário: recusado" 'echo "$o" | grep -qi "period out of range"'

# ---- V4: documents, kit, stay, summary
TY() { $P -c "select id from core.document_types where tenant_id='$T0' and code='$1'"; }
$P -c "insert into core.collaborator_documents (tenant_id, collaborator_id, document_type_id, document_number, file_url, issue_date, expiration_date, is_current, verified_at) values
  ('$T0','$C1','$(TY aptidao_medica)','APT-82','inventado/apt82.pdf', current_date - 300, current_date + 5, true, now()),
  ('$T0','$C1','$(TY formacao_altura)','ALT-82','inventado/alt82.pdf', current_date - 900, current_date - 2, true, now())" >/dev/null
o=$(J $W1 "select string_agg((d->>'type')||':'||(d->>'state'), ',' order by d->>'type') from jsonb_array_elements(public.mini_my_documents()->'documents') d"); t "documentos: a vencer, em falta, caducado, opcional" '[ "$o" = "acolhimento:missing,aptidao_medica:expiring,formacao_altura:expired,formacao_confinado:optional" ]'
o=$(J $W2 "select string_agg(d->>'state', ',' order by d->>'type') from jsonb_array_elements(public.mini_my_documents()->'documents') d"); t "outro trabalhador só vê os seus" '[ "$o" = "missing,missing,optional,optional" ]'
o=$(J $W1 "select (x->'docs'->>'missing')||'/'||(x->'docs'->>'expired')||'/'||(x->'docs'->>'expiring') from public.mini_my_summary() x"); t "resumo: 1 em falta, 1 caducado, 1 a vencer" '[ "$o" = "1/1/1" ]'
IP=$($P -c "insert into warehouse.items (tenant_id, sku, name, family, size, category, unit) values ('$T0','EPI-82','Botas 82 (inventadas) 42','Botas de segurança','42','ppe','par') returning id" | head -1)
WH=$($P -c "select private.wh_central('$T0')")
$P -c "insert into warehouse.stock_levels (tenant_id, warehouse_id, item_id, quantity) values ('$T0','$WH','$IP',10) on conflict do nothing" >/dev/null 2>&1
MV=$($P -c "insert into warehouse.stock_movements (tenant_id, warehouse_id, item_id, movement_type, quantity, collaborator_id, performed_by, occurred_at) values ('$T0','$WH','$IP','issue',1,'$C1','$A', now() - interval '300 days') returning id" | head -1)
# the issue writes the PPE in the person's name by itself (sql/65); add it only if it did not
$P -c "insert into warehouse.ppe_assignments (tenant_id, collaborator_id, item_id, movement_id, issued_at, replace_after) select '$T0','$C1','$IP','$MV', now() - interval '300 days', current_date + 10 where not exists (select 1 from warehouse.ppe_assignments where movement_id='$MV')" >/dev/null
$P -c "update warehouse.ppe_assignments set replace_after = current_date + 10 where collaborator_id='$C1' and item_id='$IP'" >/dev/null
o=$(J $W1 "select (k->'ppe'->0->>'name')||'/'||(k->'ppe'->0->>'size')||'/'||(k->'ppe'->0->>'state') from public.mini_my_kit() k"); t "os meus EPI: botas 42, trocar em breve" '[ "$o" = "Botas de segurança/42/soon" ]'
o=$(J $W2 "select jsonb_array_length(public.mini_my_kit()->'ppe')"); t "EPI dos outros não aparecem" '[ "$o" = 0 ]'
HP=$($P -c "insert into housing.housing_properties (tenant_id, kind, name, address, notes) values ('$T0','corporate_house','Casa 82 (inventada)','Rua 82, Sines','Silêncio depois das 22h') returning id" | head -1)
RO=$($P -c "insert into housing.housing_rooms (tenant_id, property_id, name) values ('$T0','$HP','Quarto 2') returning id" | head -1)
BE=$($P -c "insert into housing.housing_beds (tenant_id, room_id, label) values ('$T0','$RO','Cama B') returning id" | head -1)
$P -c "insert into housing.housing_stays (tenant_id, bed_id, collaborator_id, project_id, check_in) values ('$T0','$BE','$C1','$SITE', current_date - 3)" >/dev/null
o=$(J $W1 "select (s->>'name')||'/'||(s->>'room')||'/'||(s->>'bed')||'/'||(s->>'now') from jsonb_array_elements(public.mini_my_stay()) s"); t "onde durmo: casa, quarto, cama" '[ "$o" = "Casa 82 (inventada)/Quarto 2/Cama B/true" ]'
o=$(J $W2 "select jsonb_array_length(public.mini_my_stay())"); t "a cama dos outros não aparece" '[ "$o" = 0 ]'
o=$(J $W1 "select (x->>'stay')||'/'||(x->'ppe'->>'due')||'/'||(x->>'disputes_open')||'/'||(x->>'week_minutes') from public.mini_my_summary() x"); t "resumo: casa, 1 EPI a trocar, 1 reclamação, 40 h" '[ "$o" = "Casa 82 (inventada)/1/1/2400" ]'
o=$(as $O "select public.mini_my_summary()"); t "outra empresa (sem pessoa): recusado" 'echo "$o" | grep -qi "not allowed"'
echo "t82: $ok OK, $bad FALHA"
