-- 160: per-user notification clear marker.
--
-- Notifications are DERIVED (no notifications table), so "Clear all"
-- works by remembering WHEN the user cleared: every item whose
-- occurred_at is on or before cleared_at is hidden from the feed.
-- New events (a new bill, a new pending costing) appear again because
-- their occurred_at is newer than the marker.

create table if not exists notification_clear (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  cleared_at timestamptz not null default now()
);

alter table notification_clear enable row level security;

drop policy if exists notification_clear_select on notification_clear;
create policy notification_clear_select on notification_clear
  for select using (auth.uid() = user_id);

drop policy if exists notification_clear_upsert on notification_clear;
create policy notification_clear_upsert on notification_clear
  for insert with check (auth.uid() = user_id);

drop policy if exists notification_clear_update on notification_clear;
create policy notification_clear_update on notification_clear
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
