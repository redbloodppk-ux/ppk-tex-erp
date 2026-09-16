-- ============================================================================
-- 302: One small, deliberately dull payload for the iPhone widget.
--
-- PPK, 2026-09-16, asked for a home-screen widget, then - having weighed the
-- risk of a key living on a phone - "yes go head without cash".
--
-- WHAT IS AND IS NOT IN HERE
-- Looms running, the last logged day's metres, and which reminders are due.
-- No cash, no balances, no party names, no invoice numbers, no amounts of
-- any kind. That is the point: this function is the only thing the widget
-- key can reach, so the worst an outsider holding it can learn is how many
-- looms ran and that the bore motor needs doing.
--
-- Everything is aggregate except the reminder titles, which PPK writes
-- himself and are things like "BORE MOTOR" - operationally useful to him,
-- worth nothing to anyone else.
--
-- METRES ARE FOR THE LAST DAY THAT HAS LOGS, not for today. A shift is
-- logged after it is worked, so "today" reads zero all morning and would
-- make the mill look stopped. The date comes back with the figure so the
-- widget can say which day it is showing rather than implying it is now.
--
-- SECURITY: this is exposed through a token-protected API route, so it must
-- never grow a column that matters. If a future version needs cash, that is
-- a new decision with a new conversation, not a quiet edit here.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_widget_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'as_of', to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI'),
    'looms', jsonb_build_object(
      'running', (SELECT count(*) FROM public.loom WHERE status = 'running'),
      'total',   (SELECT count(*) FROM public.loom)
    ),
    'production', (
      -- The most recent day that actually carries shift-log metres, and
      -- what that day totalled.
      SELECT COALESCE(
        (SELECT jsonb_build_object(
                  'date',   to_char(d.log_date, 'YYYY-MM-DD'),
                  'metres', ROUND(d.metres, 1))
           FROM (
             SELECT sl.log_date, SUM(w.metres_woven) AS metres
               FROM public.production_shift_log sl
               JOIN public.production_shift_log_weaver w ON w.shift_log_id = sl.id
              WHERE w.metres_woven > 0
              GROUP BY sl.log_date
              ORDER BY sl.log_date DESC
              LIMIT 1
           ) d),
        jsonb_build_object('date', NULL, 'metres', 0))
    ),
    'reminders', (
      SELECT jsonb_build_object(
        'due_now', (SELECT count(*) FROM public.reminder
                     WHERE status = 'active'
                       AND due_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date),
        'items', COALESCE((
          SELECT jsonb_agg(x ORDER BY x->>'due')
            FROM (
              SELECT jsonb_build_object(
                       'title',   r.title,
                       'due',     to_char(r.due_date, 'YYYY-MM-DD'),
                       'overdue', r.due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
                     ) AS x
                FROM public.reminder r
               WHERE r.status = 'active'
               ORDER BY r.due_date
               LIMIT 4
            ) s
        ), '[]'::jsonb)
      )
    )
  );
$$;

COMMENT ON FUNCTION public.fn_widget_status() IS
  'Read-only summary for the phone widget: looms running, last logged day''s metres, reminders due. Deliberately carries NO money figures - it sits behind a token on a phone. See migration 302.';

-- Verify:
--   select jsonb_pretty(fn_widget_status());
