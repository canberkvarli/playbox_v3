-- Free mode: a server-side kill switch for the whole money path.
--
-- false => no card gate, no ₺150 preauth hold, no capture on return, and no ₺
--          figures in the session UI. Reserve / unlock / play / return are
--          untouched; the rental simply costs nothing.
-- true  => the existing iyzico flow, exactly as before.
--
-- WHY THIS EXISTS. Taking money in Türkiye needs a legal entity: iyzico will not
-- issue production credentials without a vergi levhası, so until the şirket is
-- open the app literally cannot charge anyone. Shipping a card wall in that
-- state means a user standing at a locker is asked for a card the backend cannot
-- charge. Gating on a config row instead of a constant means payments switch on
-- from the dashboard the day the credentials land — no rebuild, no App Review.
--
-- Defaults FALSE, and the client also defaults FALSE when the read fails. Being
-- wrongly free costs one rental; being wrongly paywalled costs a user, at the
-- locker, in public.
insert into public.app_config (key, value)
values ('payments_enabled', 'false'::jsonb)
on conflict (key) do nothing;
