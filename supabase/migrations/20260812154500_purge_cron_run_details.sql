-- Keep cron.job_run_details from eating the database.
--
-- pg_cron logs EVERY run forever and never prunes. With four sweeps on
-- `* * * * *` that is 5,760 rows/day (~180 MB/month). On 2026-08-12 this table
-- had grown to 309,816 rows / 316 MB and pushed the project to 151% of the
-- 0.5 GB Free-plan database quota, starting a grace period. It is pure job log:
-- nothing in the app reads it, it is only useful for debugging a failed sweep.
--
-- Seven days is enough history to investigate a sweep that misbehaved while
-- keeping the table around 40k rows / ~40 MB.
--
-- NOTE: this DELETE alone does not shrink the file on disk — dead tuples are
-- only returned to the OS by VACUUM FULL (done manually once at cleanup time).
-- Steady-state that is fine: autovacuum reuses the freed space for new rows, so
-- the table plateaus instead of growing without bound.
select cron.schedule(
  'cron-log-purge',
  '7 4 * * *',
  $$delete from cron.job_run_details where start_time < now() - interval '7 days'$$
);
