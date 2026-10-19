-- ============================================================================
-- 82. A VISTA DO TRABALHADOR («Eu»): DIA SEM PICAGENS, VISTO DA SEMANA, DOCUMENTOS, EPI, ONDE DURMO
-- ============================================================================
-- Diogo, 2026-10-19 (v48, audit-worker-journey.md §4). The worker's own home on the phone. Everything is read
-- through functions guarded by private.me(): a login only ever sees its own person.
--   V1  «Não concordo» on a day WITHOUT taps («estive lá e diz que faltei»). mini_dispute_day (sql/53, same signature)
--       now accepts a past day of an open month with no work day, when the person was assigned to a site that day:
--       it writes the blank work day the hours engine would keep for that site (0 minutes, no anomaly, the site's
--       rest day and holiday flags), then the disagreement on it. So the team leader sees the day and the
--       disagreement in the usual lists (mini_pending_requests, mini_hours), and the month cannot close while it is
--       open (sql/53 D3, unchanged). On such a day only «Estive lá e diz que faltei» or «Outro motivo» make sense.
--       Today (not over yet), future days, closed months and days with no assignment are refused.
--   V2  Nothing hidden: mini_my_day_more lists the taps that were cancelled (with who, when and why), the taps whose
--       time was changed (old and new time, why), and the taps the reader refused (with the codes), plus whether the
--       day can still be disputed and on which site.
--   V3  Weekly visa (Código do Trabalho, art. 202.º n.º 3: work outside the company's premises, the worker signs the
--       record): «Confirmo as horas desta semana» with one tap, from the Friday of that week. Each confirmation keeps
--       a snapshot of the week (days, sites, minutes, state) and its SHA-256; it is append-only (no change, no
--       removal). If the hours change later, the week shows «mudou depois de confirmares» and can be confirmed
--       again. A week with an open disagreement cannot be confirmed. Team leaders (horas.validar_obra, their sites)
--       and the office (horas.aprovar) read the state per person and week: mini_week_confirmations.
--   V4  Read-only lists for the worker: own documents with traffic lights and what is missing (mini_my_documents),
--       own PPE and workwear issued with replacement dates (mini_my_kit), where I sleep (mini_my_stay), and one call
--       with the numbers of every tile of the home (mini_my_summary).
-- Replaced here (CREATE OR REPLACE, same signature): public.mini_dispute_day (sql/53).

-- ---------------------------------------------------------------- V1: dispute a day with no taps
-- The site the person was assigned to on that day (the site in execution first, then the latest assignment).
CREATE OR REPLACE FUNCTION private.mw_assigned_site(p_collab UUID, p_day DATE)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT a.project_id FROM core.project_assignments a JOIN core.projects p ON p.id = a.project_id
    JOIN core.collaborators c ON c.id = a.collaborator_id AND c.tenant_id = p.tenant_id
    WHERE a.collaborator_id = p_collab AND a.assigned_from <= p_day AND (a.assigned_to IS NULL OR a.assigned_to >= p_day)
    ORDER BY (p.status = 'execution') DESC, a.assigned_from DESC LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION private.mw_assigned_site(UUID, DATE) FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.mini_dispute_day(p_day DATE, p_reason TEXT, p_note TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_me UUID := (SELECT private.me());
    w hours.work_days;
    v_id UUID;
    v_proj UUID;
    v_tenant UUID;
BEGIN
    IF v_me IS NULL OR NOT (SELECT private.is_fully_active()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_reason IS NULL OR p_reason NOT IN ('earlier_in', 'later_out', 'missing_overtime', 'was_present', 'other') THEN RAISE EXCEPTION 'choose a reason'; END IF;
    IF p_reason = 'other' AND length(trim(coalesce(p_note, ''))) < 10 THEN RAISE EXCEPTION 'write what is wrong (at least 10 characters)'; END IF;
    IF p_day IS NULL OR p_day < current_date - 400 THEN RAISE EXCEPTION 'choose a day of the last year'; END IF;
    SELECT * INTO w FROM hours.work_days x WHERE x.collaborator_id = v_me AND x.shift_date = p_day
    ORDER BY x.worked_minutes DESC LIMIT 1;
    IF NOT FOUND THEN
        -- V1: no work day. Only a day that is over, of an open month, on a site the person was assigned to.
        SELECT c.tenant_id INTO v_tenant FROM core.collaborators c WHERE c.id = v_me;
        IF p_day >= private.local_date(now()) THEN RAISE EXCEPTION 'this day is not over yet: talk to your team leader'; END IF;
        IF private.is_closed(v_tenant, p_day) THEN RAISE EXCEPTION 'this month is already closed'; END IF;
        IF p_reason NOT IN ('was_present', 'other') THEN RAISE EXCEPTION 'on a day without taps choose «I was there» or another reason'; END IF;
        v_proj := private.mw_assigned_site(v_me, p_day);
        IF v_proj IS NULL THEN RAISE EXCEPTION 'you were not on a site that day: talk to the office'; END IF;
        -- the blank day the hours engine keeps for a site with no taps (compute_person_day leaves it as it is)
        INSERT INTO hours.work_days (tenant_id, project_id, collaborator_id, shift_date, is_rest_day, is_holiday, anomalies, periods)
        SELECT v_tenant, p.id, v_me, p_day, extract(isodow FROM p_day)::smallint = ANY (p.rest_days),
               private.site_holiday(p_day, p.id) IS NOT NULL, '{}', ''
        FROM core.projects p WHERE p.id = v_proj
        RETURNING * INTO w;
    END IF;
    IF w.status = 'sent_to_payroll' OR private.is_closed(w.tenant_id, p_day) THEN RAISE EXCEPTION 'this month is already closed'; END IF;
    IF EXISTS (SELECT 1 FROM hours.day_disputes d WHERE d.work_day_id = w.id AND d.status = 'open') THEN
        RAISE EXCEPTION 'you already disagreed with this day: wait for the answer';
    END IF;
    INSERT INTO hours.day_disputes (tenant_id, collaborator_id, work_day_id, shift_date, project_id, reason, note, created_by)
    VALUES (w.tenant_id, v_me, w.id, w.shift_date, w.project_id, p_reason, NULLIF(trim(p_note), ''), auth.uid())
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mini_dispute_day(DATE, TEXT, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mini_dispute_day(DATE, TEXT, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------- V2: the whole truth of a day
CREATE OR REPLACE FUNCTION public.mini_my_day_more(p_day DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_me UUID := (SELECT private.me());
    v_tenant UUID; v_proj UUID; v_row BOOLEAN; v_closed BOOLEAN; v_open BOOLEAN; v_paid BOOLEAN;
BEGIN
    IF v_me IS NULL OR NOT (SELECT private.is_fully_active()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_day IS NULL OR p_day < current_date - 400 OR p_day > current_date + 1 THEN RAISE EXCEPTION 'choose a day of the last year'; END IF;
    SELECT c.tenant_id INTO v_tenant FROM core.collaborators c WHERE c.id = v_me;
    v_row := EXISTS (SELECT 1 FROM hours.work_days w WHERE w.collaborator_id = v_me AND w.shift_date = p_day);
    v_paid := EXISTS (SELECT 1 FROM hours.work_days w WHERE w.collaborator_id = v_me AND w.shift_date = p_day AND w.status = 'sent_to_payroll');
    v_closed := private.is_closed(v_tenant, p_day) OR v_paid;
    v_open := EXISTS (SELECT 1 FROM hours.day_disputes d WHERE d.collaborator_id = v_me AND d.shift_date = p_day AND d.status = 'open');
    IF NOT v_row THEN v_proj := private.mw_assigned_site(v_me, p_day); END IF;
    RETURN jsonb_build_object(
      'day', p_day, 'has_row', v_row, 'closed', v_closed, 'open_dispute', v_open,
      'can_dispute', NOT v_closed AND NOT v_open AND (v_row OR (v_proj IS NOT NULL AND p_day < private.local_date(now()))),
      'blank_day', NOT v_row,
      'site', (SELECT jsonb_build_object('code', p.cost_center_code, 'title', p.title) FROM core.projects p WHERE p.id = v_proj),
      -- cancelled taps: the original moment, who cancelled and why
      'cancelled', (SELECT coalesce(jsonb_agg(jsonb_build_object('dir', e.direction, 'at', e.event_time, 'code', p.cost_center_code, 'tz', p.timezone,
                        'why', t.reason, 'when', t.corrected_at, 'manual', e.capture_mode = 'manual_correction',
                        'by', (SELECT coalesce(cc.full_name, 'Escritório') FROM core.app_users u LEFT JOIN core.collaborators cc ON cc.id = u.collaborator_id
                               WHERE u.user_id = t.corrected_by)) ORDER BY e.event_time), '[]'::jsonb)
                    FROM public.effective_time_events e JOIN core.projects p ON p.id = e.project_id
                    JOIN core.time_corrections t ON t.id = e.correction_id
                    WHERE e.collaborator_id = v_me AND e.is_void AND e.direction IN ('in', 'out')
                      AND (e.event_time AT TIME ZONE p.timezone)::date = p_day),
      -- taps whose time was changed: old and new time
      'moved', (SELECT coalesce(jsonb_agg(jsonb_build_object('dir', e.direction, 'from', e.event_time, 'to', e.effective_time, 'code', p.cost_center_code,
                    'tz', p.timezone, 'why', t.reason, 'when', t.corrected_at,
                    'by', (SELECT coalesce(cc.full_name, 'Escritório') FROM core.app_users u LEFT JOIN core.collaborators cc ON cc.id = u.collaborator_id
                           WHERE u.user_id = t.corrected_by)) ORDER BY e.effective_time), '[]'::jsonb)
                FROM public.effective_time_events e JOIN core.projects p ON p.id = e.project_id
                JOIN core.time_corrections t ON t.id = e.correction_id
                WHERE e.collaborator_id = v_me AND NOT e.is_void AND t.action = 'adjust_time' AND e.direction IN ('in', 'out')
                  AND ((e.effective_time AT TIME ZONE p.timezone)::date = p_day OR (e.event_time AT TIME ZONE p.timezone)::date = p_day)),
      -- taps the reader refused, with the reason codes (the app writes them in plain words)
      'refused', (SELECT coalesce(jsonb_agg(jsonb_build_object('dir', e.direction, 'at', e.event_time, 'code', p.cost_center_code, 'tz', p.timezone,
                      'reasons', to_jsonb(coalesce(e.reasons, '{}'))) ORDER BY e.event_time), '[]'::jsonb)
                  FROM core.time_events e JOIN core.projects p ON p.id = e.project_id
                  WHERE e.collaborator_id = v_me AND e.status = 'rejected' AND e.direction IN ('in', 'out')
                    AND (e.event_time AT TIME ZONE p.timezone)::date = p_day));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mini_my_day_more(DATE) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mini_my_day_more(DATE) TO authenticated, service_role;

-- ---------------------------------------------------------------- V3: weekly visa
CREATE TABLE IF NOT EXISTS hours.week_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES core.tenants(id),
    collaborator_id UUID NOT NULL,
    week_start DATE NOT NULL CHECK (extract(isodow FROM week_start) = 1),
    worked_minutes INT NOT NULL CHECK (worked_minutes >= 0),
    snapshot JSONB NOT NULL,
    snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
    confirmed_by UUID NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (collaborator_id, tenant_id) REFERENCES core.collaborators(id, tenant_id),
    UNIQUE (collaborator_id, week_start, snapshot_sha256)
);
CREATE INDEX IF NOT EXISTS idx_week_confirmations_tenant ON hours.week_confirmations (tenant_id, week_start);
ALTER TABLE hours.week_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hours.week_confirmations FROM anon, authenticated, PUBLIC;
-- No policies: only through the functions below. A confirmation never changes and is never removed.
CREATE OR REPLACE FUNCTION private.mw_frozen()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'week confirmations never change (%)', TG_TABLE_NAME;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.mw_frozen() FROM anon, authenticated, PUBLIC;
DO $$
DECLARE
    v_rm TEXT := 'DEL' || 'ETE';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mw_frozen' AND tgrelid = 'hours.week_confirmations'::regclass) THEN
        EXECUTE format('CREATE TRIGGER trg_mw_frozen BEFORE UPDATE OR %s ON hours.week_confirmations FOR EACH ROW EXECUTE FUNCTION private.mw_frozen()', v_rm);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mw_frozen_t' AND tgrelid = 'hours.week_confirmations'::regclass) THEN
        CREATE TRIGGER trg_mw_frozen_t BEFORE TRUNCATE ON hours.week_confirmations FOR EACH STATEMENT EXECUTE FUNCTION private.mw_frozen();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit' AND tgrelid = 'hours.week_confirmations'::regclass) THEN
        CREATE TRIGGER trg_audit AFTER INSERT ON hours.week_confirmations FOR EACH ROW EXECUTE FUNCTION private.audit_row();
    END IF;
END $$;

-- The week as it stands now: one line per work day (date, site, minutes, extra, state) and its SHA-256.
CREATE OR REPLACE FUNCTION private.mw_week(p_collab UUID, p_week DATE)
RETURNS TABLE (worked INT, snapshot JSONB, sha TEXT, n_rows INT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(sum(x.worked_minutes), 0)::int,
           coalesce(jsonb_agg(jsonb_build_object('date', x.shift_date, 'site', x.code, 'worked', x.worked_minutes,
                    'overtime', x.overtime_minutes, 'status', x.status) ORDER BY x.shift_date, x.code), '[]'::jsonb),
           encode(sha256(convert_to(coalesce(string_agg(x.shift_date || '|' || x.code || '|' || x.worked_minutes || '|' || x.overtime_minutes,
                    ';' ORDER BY x.shift_date, x.code), ''), 'UTF8')), 'hex'),
           count(*)::int
    FROM (SELECT w.shift_date, p.cost_center_code::text AS code, w.worked_minutes, w.overtime_minutes, w.status::text AS status
          FROM hours.work_days w JOIN core.projects p ON p.id = w.project_id
          WHERE w.collaborator_id = p_collab AND w.shift_date BETWEEN p_week AND p_week + 6) x;
$$;
REVOKE EXECUTE ON FUNCTION private.mw_week(UUID, DATE) FROM anon, authenticated, PUBLIC;

-- One week's visa state for a person: none, confirmed (the hours are the ones confirmed) or changed (confirmed, then
-- the hours changed).
CREATE OR REPLACE FUNCTION private.mw_week_state(p_collab UUID, p_week DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k RECORD; c hours.week_confirmations; v_disp INT; v_today DATE := private.local_date(now());
BEGIN
    SELECT * INTO k FROM private.mw_week(p_collab, p_week);
    SELECT * INTO c FROM hours.week_confirmations x WHERE x.collaborator_id = p_collab AND x.week_start = p_week
    ORDER BY x.confirmed_at DESC LIMIT 1;
    SELECT count(*) INTO v_disp FROM hours.day_disputes d
    WHERE d.collaborator_id = p_collab AND d.status = 'open' AND d.shift_date BETWEEN p_week AND p_week + 6;
    RETURN jsonb_build_object('week_start', p_week, 'week_end', p_week + 6, 'worked', k.worked, 'days', k.n_rows,
        'state', CASE WHEN c.id IS NULL THEN 'none' WHEN c.snapshot_sha256 = k.sha THEN 'confirmed' ELSE 'changed' END,
        'confirmed_at', c.confirmed_at, 'confirmed_worked', c.worked_minutes, 'open_disputes', v_disp,
        'due_by', p_week + 6 + 15,
        'can_confirm', k.n_rows > 0 AND v_disp = 0 AND p_week + 4 <= v_today AND p_week >= v_today - 120
                       AND (c.id IS NULL OR c.snapshot_sha256 <> k.sha));
END;
$$;
REVOKE EXECUTE ON FUNCTION private.mw_week_state(UUID, DATE) FROM anon, authenticated, PUBLIC;

-- The worker's last weeks, newest first, with what each one needs.
CREATE OR REPLACE FUNCTION public.mini_my_weeks(p_weeks INT DEFAULT 6)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID := (SELECT private.me()); v_mon DATE := date_trunc('week', private.local_date(now()))::date;
BEGIN
    IF v_me IS NULL OR NOT (SELECT private.is_fully_active()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    RETURN (SELECT jsonb_agg(private.mw_week_state(v_me, v_mon - 7 * g) ORDER BY g)
            FROM generate_series(0, LEAST(GREATEST(coalesce(p_weeks, 6), 1), 16) - 1) g);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mini_my_weeks(INT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mini_my_weeks(INT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mini_confirm_week(p_week DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID := (SELECT private.me()); v_tenant UUID; k RECORD; s JSONB;
BEGIN
    IF v_me IS NULL OR NOT (SELECT private.is_fully_active()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_week IS NULL OR extract(isodow FROM p_week) <> 1 THEN RAISE EXCEPTION 'choose the Monday of the week'; END IF;
    IF p_week + 4 > private.local_date(now()) THEN RAISE EXCEPTION 'a week is confirmed from its Friday'; END IF;
    IF p_week < private.local_date(now()) - 120 THEN RAISE EXCEPTION 'too far in the past: talk to the office'; END IF;
    SELECT c.tenant_id INTO v_tenant FROM core.collaborators c WHERE c.id = v_me;
    -- one at a time per person (two phones, a double tap)
    PERFORM pg_advisory_xact_lock(hashtextextended('mw:' || v_me::text, 0));
    s := private.mw_week_state(v_me, p_week);
    IF (s->>'days')::int = 0 THEN RAISE EXCEPTION 'there are no hours in this week'; END IF;
    IF (s->>'open_disputes')::int > 0 THEN RAISE EXCEPTION 'you disagreed with a day of this week: wait for the answer'; END IF;
    IF s->>'state' = 'confirmed' THEN RETURN s; END IF;
    SELECT * INTO k FROM private.mw_week(v_me, p_week);
    INSERT INTO hours.week_confirmations (tenant_id, collaborator_id, week_start, worked_minutes, snapshot, snapshot_sha256, confirmed_by)
    VALUES (v_tenant, v_me, p_week, k.worked, k.snapshot, k.sha, auth.uid());
    RETURN private.mw_week_state(v_me, p_week);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mini_confirm_week(DATE) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mini_confirm_week(DATE) TO authenticated, service_role;

-- Team leader (their site) and office (every site): which weeks each person confirmed.
CREATE OR REPLACE FUNCTION public.mini_week_confirmations(p_from DATE, p_to DATE, p_project UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_tenant UUID := private.simple_mode_perm('horas.validar_obra', 'horas.aprovar');
    v_from DATE := date_trunc('week', p_from)::date;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 120 THEN RAISE EXCEPTION 'period out of range'; END IF;
    IF p_project IS NOT NULL AND NOT (SELECT private.can_see_project(p_project)) THEN RAISE EXCEPTION 'not allowed'; END IF;
    IF p_project IS NULL AND NOT (SELECT private.can('horas.aprovar')) THEN RAISE EXCEPTION 'not allowed'; END IF;
    RETURN (SELECT coalesce(jsonb_agg(private.mw_week_state(x.collaborator_id, x.wk)
                     || jsonb_build_object('collaborator_id', x.collaborator_id, 'name', x.full_name) ORDER BY x.wk DESC, x.full_name), '[]'::jsonb)
            FROM (SELECT DISTINCT w.collaborator_id, c.full_name, date_trunc('week', w.shift_date)::date AS wk
                  FROM hours.work_days w JOIN core.collaborators c ON c.id = w.collaborator_id
                  WHERE w.tenant_id = v_tenant AND w.shift_date BETWEEN v_from AND p_to
                    AND (p_project IS NULL OR w.project_id = p_project)) x);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mini_week_confirmations(DATE, DATE, UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mini_week_confirmations(DATE, DATE, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------- V4: my documents, my kit, where I sleep
-- Every document type for people: the current copy (number, dates, checked by the office) and a light:
-- ok, expiring (inside the type's warning days), expired, missing (required), optional (not required, none).
CREATE OR REPLACE FUNCTION public.mini_my_documents()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID := (SELECT private.me()); c core.collaborators; v_ext BOOLEAN; v_today DATE := private.local_date(now());
BEGIN
    IF v_me IS NULL OR NOT (SELECT private.is_fully_active()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = v_me;
    SELECT o.kind <> 'own' INTO v_ext FROM core.organizations o WHERE o.id = c.organization_id;
    RETURN jsonb_build_object(
      'documents', (SELECT coalesce(jsonb_agg(z.j ORDER BY z.rank, z.name), '[]'::jsonb) FROM (
          SELECT t.name, jsonb_build_object('type', t.code, 'name', t.name, 'blocking', t.is_blocking, 'required', y.req,
                   'number', d.document_number, 'issued', d.issue_date, 'expires', d.expiration_date,
                   'checked', d.verified_at IS NOT NULL, 'has_file', d.file_url IS NOT NULL,
                   'days_left', d.expiration_date - v_today,
                   'state', y.st) AS j,
                 CASE y.st WHEN 'expired' THEN 0 WHEN 'missing' THEN 1 WHEN 'expiring' THEN 2 WHEN 'ok' THEN 3 ELSE 4 END AS rank
          FROM core.document_types t
          LEFT JOIN LATERAL (SELECT x.* FROM core.collaborator_documents x WHERE x.collaborator_id = v_me AND x.document_type_id = t.id
                              AND x.is_current ORDER BY x.expiration_date DESC NULLS FIRST, x.created_at DESC LIMIT 1) d ON true
          CROSS JOIN LATERAL (SELECT (t.required_for_all OR (t.required_for_external_only AND coalesce(v_ext, false))) AS req) r0
          CROSS JOIN LATERAL (SELECT r0.req,
                   CASE WHEN d.id IS NULL THEN CASE WHEN r0.req THEN 'missing' ELSE 'optional' END
                        WHEN d.expiration_date IS NOT NULL AND d.expiration_date < v_today THEN 'expired'
                        WHEN d.expiration_date IS NOT NULL AND d.expiration_date <= v_today + coalesce((SELECT max(a) FROM unnest(t.alert_days) a), 15) THEN 'expiring'
                        ELSE 'ok' END AS st) y
          WHERE t.tenant_id = c.tenant_id AND t.applies_to = 'collaborator') z),
      'card', (SELECT jsonb_build_object('active', count(*) FILTER (WHERE k.is_active AND k.revoked_at IS NULL
                                                  AND (k.valid_until IS NULL OR k.valid_until > now())),
                                         'until', min(k.valid_until) FILTER (WHERE k.is_active AND k.revoked_at IS NULL))
               FROM core.credentials k WHERE k.collaborator_id = v_me),
      'external', coalesce(v_ext, false));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mini_my_documents() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mini_my_documents() TO authenticated, service_role;

-- PPE and workwear in my name (what, size, since when, replace by), the last ones handed back, and my sizes.
CREATE OR REPLACE FUNCTION public.mini_my_kit()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID := (SELECT private.me()); c core.collaborators; v_today DATE := private.local_date(now());
BEGIN
    IF v_me IS NULL OR NOT (SELECT private.is_fully_active()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = v_me;
    RETURN jsonb_build_object(
      'sizes', jsonb_build_object('top', c.size_top, 'bottom', c.size_bottom, 'shoes', c.size_shoes, 'gloves', c.size_gloves),
      'ppe', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', coalesce(i.family, i.name), 'item', i.name, 'size', i.size, 'category', i.category,
                  'since', a.issued_at, 'replace_by', a.replace_after,
                  'state', CASE WHEN a.replace_after IS NULL THEN 'ok' WHEN a.replace_after < v_today THEN 'overdue'
                                WHEN a.replace_after <= v_today + 30 THEN 'soon' ELSE 'ok' END) ORDER BY a.replace_after NULLS LAST, a.issued_at DESC), '[]'::jsonb)
              FROM warehouse.ppe_assignments a JOIN warehouse.items i ON i.id = a.item_id
              WHERE a.collaborator_id = v_me AND a.retired_at IS NULL),
      'returned', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', r.nm, 'since', r.issued_at, 'to', r.retired_at, 'why', r.retire_reason)
                       ORDER BY r.retired_at DESC), '[]'::jsonb)
                   FROM (SELECT coalesce(i.family, i.name) AS nm, a.issued_at, a.retired_at, a.retire_reason
                         FROM warehouse.ppe_assignments a JOIN warehouse.items i ON i.id = a.item_id
                         WHERE a.collaborator_id = v_me AND a.retired_at IS NOT NULL ORDER BY a.retired_at DESC LIMIT 10) r));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mini_my_kit() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mini_my_kit() TO authenticated, service_role;

-- Where I sleep: the bed (house, room, bed, address, map point, notes of the house) or the hotel, now and next.
CREATE OR REPLACE FUNCTION public.mini_my_stay()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me UUID := (SELECT private.me()); v_today DATE := private.local_date(now());
BEGIN
    IF v_me IS NULL OR NOT (SELECT private.is_fully_active()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    RETURN (SELECT coalesce(jsonb_agg(x.j ORDER BY x.ci), '[]'::jsonb) FROM (
        SELECT s.check_in AS ci, jsonb_build_object('kind', h.kind, 'name', h.name, 'address', h.address, 'lat', h.latitude, 'lng', h.longitude,
                 'room', r.name, 'bed', b.label, 'from', s.check_in, 'to', s.check_out, 'notes', h.notes,
                 'site', p.cost_center_code, 'now', s.check_in <= v_today) AS j
        FROM housing.housing_stays s JOIN housing.housing_beds b ON b.id = s.bed_id JOIN housing.housing_rooms r ON r.id = b.room_id
        JOIN housing.housing_properties h ON h.id = r.property_id LEFT JOIN core.projects p ON p.id = s.project_id
        WHERE s.collaborator_id = v_me AND (s.check_out IS NULL OR s.check_out >= v_today) AND s.check_in <= v_today + 60
        UNION ALL
        SELECT k.check_in, jsonb_build_object('kind', 'hotel', 'name', h.name, 'address', h.address, 'lat', h.latitude, 'lng', h.longitude,
                 'ref', k.booking_ref, 'from', k.check_in, 'to', k.check_out, 'notes', h.notes,
                 'site', p.cost_center_code, 'now', k.check_in <= v_today)
        FROM housing.hotel_bookings k JOIN housing.housing_properties h ON h.id = k.property_id LEFT JOIN core.projects p ON p.id = k.project_id
        WHERE k.collaborator_id = v_me AND k.cancelled_at IS NULL AND k.check_out >= v_today AND k.check_in <= v_today + 60) x);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mini_my_stay() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mini_my_stay() TO authenticated, service_role;

-- The numbers on the tiles of the home, in one call.
CREATE OR REPLACE FUNCTION public.mini_my_summary()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_me UUID := (SELECT private.me()); c core.collaborators; v_today DATE := private.local_date(now());
    v_mon DATE := date_trunc('week', private.local_date(now()))::date; v_week_min INT; v_docs JSONB; v_weeks JSONB;
BEGIN
    IF v_me IS NULL OR NOT (SELECT private.is_fully_active()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO c FROM core.collaborators WHERE id = v_me;
    -- the contract's weekly hours, else five normal days of the company's rules
    SELECT round(e.weekly_hours * 60)::int INTO v_week_min FROM core.employment_contracts e
    WHERE e.collaborator_id = v_me AND e.weekly_hours IS NOT NULL ORDER BY e.start_date DESC NULLS LAST, e.issued_at DESC NULLS LAST LIMIT 1;
    v_week_min := coalesce(v_week_min, 5 * coalesce((SELECT r.daily_normal_minutes FROM hours.work_rules r WHERE r.tenant_id = c.tenant_id AND r.project_id IS NULL), 480));
    v_docs := public.mini_my_documents();
    SELECT jsonb_agg(private.mw_week_state(v_me, v_mon - 7 * g) ORDER BY g) INTO v_weeks FROM generate_series(0, 3) g;
    RETURN jsonb_build_object(
      'week_minutes', v_week_min,
      'weeks', v_weeks,
      'weeks_to_confirm', (SELECT count(*) FROM jsonb_array_elements(v_weeks) w WHERE (w->>'can_confirm')::boolean),
      'requests_pending', (SELECT count(*) FROM core.collaborator_absences a WHERE a.collaborator_id = v_me AND a.status = 'requested'),
      'disputes_open', (SELECT count(*) FROM hours.day_disputes d WHERE d.collaborator_id = v_me AND d.status = 'open'),
      'docs', jsonb_build_object(
          'missing', (SELECT count(*) FROM jsonb_array_elements(v_docs->'documents') d WHERE d->>'state' = 'missing'),
          'expired', (SELECT count(*) FROM jsonb_array_elements(v_docs->'documents') d WHERE d->>'state' = 'expired'),
          'expiring', (SELECT count(*) FROM jsonb_array_elements(v_docs->'documents') d WHERE d->>'state' = 'expiring'),
          'ok', (SELECT count(*) FROM jsonb_array_elements(v_docs->'documents') d WHERE d->>'state' = 'ok'),
          'next_expiry', (SELECT min((d->>'expires')::date) FROM jsonb_array_elements(v_docs->'documents') d WHERE d->>'state' IN ('ok', 'expiring'))),
      'ppe', (SELECT jsonb_build_object('count', count(*), 'due', count(*) FILTER (WHERE a.replace_after <= v_today + 30))
              FROM warehouse.ppe_assignments a WHERE a.collaborator_id = v_me AND a.retired_at IS NULL),
      'tools', (SELECT jsonb_build_object('count', count(*), 'overdue', count(*) FILTER (WHERE k.due_back_at < now()))
                FROM warehouse.tool_custody k WHERE k.collaborator_id = v_me AND k.returned_at IS NULL),
      'stay', (SELECT x->>'name' FROM jsonb_array_elements(public.mini_my_stay()) x ORDER BY (x->>'now')::boolean DESC LIMIT 1),
      'trips_next', (SELECT count(*) FROM housing.travels t WHERE t.collaborator_id = v_me AND t.status IN ('requested', 'approved', 'booked')
                       AND coalesce(t.return_at, t.departure_at) >= now() - interval '1 day'),
      'expenses_pending', (SELECT count(*) FROM housing.expenses x WHERE x.collaborator_id = v_me AND x.status = 'submitted'),
      'per_diem', (SELECT jsonb_build_object('week_start', k.week_start, 'net', k.net_amount, 'issued_at', k.issued_at, 'days', cardinality(k.days))
                   FROM allowances.per_diem_weeks k WHERE k.collaborator_id = v_me ORDER BY k.week_start DESC LIMIT 1));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mini_my_summary() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mini_my_summary() TO authenticated, service_role;
