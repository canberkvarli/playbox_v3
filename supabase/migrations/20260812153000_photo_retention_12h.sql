-- Return-photo retention: 14 days -> 12 hours.
--
-- The photo is only needed to settle a "returned damaged / didn't return it"
-- dispute, which surfaces within minutes of a session closing, not weeks. Holding
-- user-taken photos for 14 days was storing personal data we have no use for —
-- shorter retention is the KVKK-friendlier default and keeps the private
-- `return-photos` bucket near-empty.
--
-- `return_photo_retention_days` is read by the photo-reap edge function and
-- multiplied by 24*60*60*1000, so fractional days are valid: 0.5 = 12 hours.
update public.app_config
   set value = '0.5'::jsonb
 where key = 'return_photo_retention_days';

insert into public.app_config (key, value)
values ('return_photo_retention_days', '0.5'::jsonb)
on conflict (key) do update set value = excluded.value;

-- The reaper ran once a day (17 3 * * *). Against a 12-hour window that let a
-- photo taken just after the run survive ~23h, so the retention promise was only
-- true on average. Hourly makes the worst case 12h + 59m.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'photo-reap'),
  schedule => '17 * * * *'
);
