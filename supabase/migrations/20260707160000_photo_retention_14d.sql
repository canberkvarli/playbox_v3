-- Reduce return-photo retention 30 -> 14 days.
--
-- 14 days matches the distance-contract (mesafeli satış) withdrawal window — the
-- one legally-meaningful retention period — while halving storage + KVKK exposure
-- vs the original 30-day default. This is a runtime tunable; changing it here (or
-- with a plain UPDATE) takes effect on the next nightly photo-reap run, no
-- redeploy needed.

insert into public.app_config (key, value) values
  ('return_photo_retention_days', '14'::jsonb)
on conflict (key) do update set value = excluded.value;
