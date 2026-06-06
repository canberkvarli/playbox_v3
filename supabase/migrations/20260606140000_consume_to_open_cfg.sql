-- Seeds the `consume_to_open_min` app_config tunable.
--
-- Closes the STRANDED-HOLD edge surfaced by the money-model integration:
-- a reservation that was CONSUMED (QR scanned, deposit hold consumed at unlock)
-- but whose gate was NEVER physically opened (opened_at null) is caught by
-- NEITHER gate_closed (no return) NOR session-sweep's abandoned pass (which
-- REQUIRES opened_at != null). Its live deposit hold would dangle forever.
--
-- session-sweep Pass 1c reads this tunable: a consumed-but-never-opened row whose
-- consume timestamp (reservations.terminal_at) is older than consume_to_open_min
-- is flagged release_eligible_at (RELEASE — the user took no equipment, so NO
-- penalty). Phase 2 settlement then releases the hold.
--
-- 15 min: generous time to scan -> walk to the gate -> open. Past that, the user
-- bailed and their deposit is correctly returned. Matches the index.ts default
-- (DEFAULT_CONSUME_TO_OPEN_MIN). jsonb value to match the existing app_config
-- seed convention in 20260426120000_reservations.sql.

insert into public.app_config (key, value) values
  ('consume_to_open_min', '15'::jsonb)
on conflict (key) do nothing;
