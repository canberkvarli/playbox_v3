# Photo-on-Return + Lost-Gear — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Let a user attach a **proof-of-return photo** of the gear (dispute evidence + condition record), and **report a problem** (lost / damaged / wrong-item / other) — both keyed to the session so ops + the dispute timeline can use them.

**Architecture:** A private Supabase **storage bucket** for return photos + a **`gear_reports`** table (owner-RLS). The client captures/uploads a photo (path keyed by `user_id` + `bleSessionId`) and/or files a report. **Pure helpers** (photo path, report payload, validation) are Jest-tested; the camera/upload UI is thin RN wiring verified in the app. `bleSessionId` is the attach key (the server already links `reservations.ble_session_id = session_id`, so ops can map a report/photo back to the reservation).

**Tech stack:** Expo (`expo-camera` already installed; add `expo-image-picker` for gallery/capture choice), Supabase Storage + a migration, Zustand `sessionStore`, i18n (`tr.json`, Turkish-locked), Jest for the pure helpers.

---

## Grounding facts (verified)
- Return flow: `app/(tabs)/play.tsx` `finalizeReturn` → `endSession()` → routes to `/session-review`. `app/session-review.tsx` shows summary + emoji rating + `BadFeedbackModal`. **No photo stub — greenfield.**
- `expo-camera` v17 installed (`app/scan.tsx` uses `CameraView`). `expo-image-picker` NOT installed.
- No `supabase.storage` usage anywhere — greenfield. `lib/supabase.ts` standard client; auth = JWT `sub` = user_id.
- `lib/feedback.ts` `submitFeedback()` inserts to `feedback` (user_id, kind, session_id, rating, reasons, message) — the insert + RLS pattern to mirror.
- `stores/sessionStore.ts` `EndedSession`/`ActiveSession`: has `bleSessionId`, `stationId`, `gate`; **no `reservation_id` client-side**. Attach key = `bleSessionId`.
- i18n: `useT()`/react-i18next, strings in `i18n/locales/tr.json`.

---

## Task 1: Migration — `gear_reports` table + `return-photos` storage bucket
**Files:** `supabase/migrations/20260607120000_gear_reports.sql` (write-only; do NOT apply).
- `gear_reports`: `id uuid default gen_random_uuid() pk`, `user_id text not null`, `ble_session_id text`, `station_id text`, `gate int`, `kind text not null check (kind in ('lost','damaged','wrong_item','other'))`, `message text`, `photo_path text`, `status text not null default 'open' check (status in ('open','reviewing','resolved'))`, `created_at timestamptz default now()`. Index on `(status, created_at)` for an ops queue + on `ble_session_id`.
- RLS: enable; owner-insert policy (`user_id = auth.jwt()->>'sub'`); owner-select own; service_role full (ops). Mirror the `feedback` table's RLS exactly (read it).
- **Storage bucket** `return-photos`: create via SQL (`insert into storage.buckets (id, name, public) values ('return-photos','return-photos', false) on conflict do nothing;`) + storage RLS policies: a user may `insert`/`select` objects under their own `user_id/` prefix (`(storage.foldername(name))[1] = auth.jwt()->>'sub'`), service_role full. Document the path convention `return-photos/<user_id>/<ble_session_id>.jpg`.
- Read the real `feedback` migration + any storage policy precedent first; match style. Commit.

## Task 2: pure helpers + deps
**Files:** `lib/gear/report.ts` (pure) + `lib/gear/report.test.ts`; add `expo-image-picker` to package.json (`npx expo install expo-image-picker` — or add the dep + note).
- `returnPhotoPath(userId, bleSessionId)` → `` `${userId}/${bleSessionId}.jpg` `` (the storage object path; bucket is separate). Reject empty userId/sessionId (return null) so we never upload to a malformed path.
- `GEAR_REPORT_KINDS = ['lost','damaged','wrong_item','other'] as const`; `isValidReportKind(k)`.
- `buildGearReportRow({ userId, bleSessionId, stationId, gate, kind, message, photoPath })` → the insert row (snake_case), omitting null/empty optionals; validates kind (throws/returns error on invalid), trims message, caps message length (e.g. 1000). Pure + total.
- Jest tests: path builder (valid + rejects empty); kind validation; row builder (valid row, invalid kind rejected, optional fields omitted when absent, message trimmed/capped). Run red→green. Commit.

## Task 3: client wiring — photo capture + report sheet
**Files:** `lib/gear/uploadReturnPhoto.ts` (thin supabase storage upload), a report sheet component (e.g. `components/GearReportSheet.tsx`), wire into `app/session-review.tsx` (+ an entry from `app/(tabs)/play.tsx`), `i18n/locales/tr.json`.
- `uploadReturnPhoto(supabase, userId, bleSessionId, fileUri)` → reads the file (expo-file-system/blob), `supabase.storage.from('return-photos').upload(returnPhotoPath(...), blob, {upsert:true})`, returns the stored path or an error. Best-effort: an upload failure must NOT block the review flow.
- **session-review:** add an optional "kapanış fotoğrafı ekle" (add a return photo) action → expo-camera/image-picker capture → `uploadReturnPhoto` → on success, optionally record a `gear_reports`-free reference (or store path on the session/feedback). Keep it OPTIONAL (skippable) — never gate finishing the session on a photo.
- **report a problem:** a `GearReportSheet` (kind picker: kayıp/hasarlı/yanlış ürün/diğer + message + optional photo) reachable from session-review and from play.tsx during/after a session → inserts a `gear_reports` row (via `buildGearReportRow`) + uploads the photo if attached. Best-effort, with success/failure UX.
- i18n: add Turkish strings (mirror the `feedback.*` key style; new `gear.*` namespace). Turkish-locked.
- Use the safe-import / permission pattern from `app/scan.tsx` for the camera.

## Task 4: submit-flow test + ops-surfacing note
**Files:** `lib/gear/report.test.ts` (extend) — a small flow test with a MOCK supabase (storage.upload + from().insert recorded) proving: a valid report inserts the right row + uploads to the right path; a photo-upload failure still records the report (best-effort); an invalid kind is rejected before any insert. Run green.
- Document (in the plan or a comment) the **ops-surfacing follow-up:** when Phase 4 merges, add an `op_gear_reports()` SECURITY DEFINER function (mirroring `op_attention_queue`) so operators see open reports, and optionally append a `reservation_events` 'gear_report' breadcrumb (mapping `ble_session_id`→reservation) so it shows in `op_dispute_timeline`. (Out of scope here — phase4 lives on another branch.)

## Out of scope
- Ops-side surfacing of reports (phase4 `op_*` — noted follow-up).
- Server-side image moderation / auto-condition-detection.

## Definition of done
- `gear_reports` table + `return-photos` bucket (owner-RLS) migration written.
- Pure helpers (path/kind/row) Jest-tested; `expo-image-picker` added.
- Optional return-photo capture+upload on session-review (skippable, best-effort); a report-a-problem sheet (lost/damaged/wrong-item/other + message + optional photo) inserting `gear_reports`; Turkish i18n.
- Submit-flow test green (mock supabase). Ops-surfacing follow-up documented.

---

## Ops surfacing (follow-up, when Phase 4 merges)

> **Status:** integration point only — Phase 4 (the `op_*` operator console + `op_attention_queue` / `op_dispute_timeline`) lives on a separate branch. None of the SQL below is written/applied in this branch. When Phase 4 merges, add a migration (e.g. `supabase/migrations/<ts>_op_gear_reports.sql`) implementing the three pieces below. Mirror the existing operator-function conventions in `supabase/migrations/20260427120000_operator_functions.sql`: `security definer`, `set search_path = public` (add `auth` only if reading `auth.users`), `revoke all ... from public`, then `grant execute ... to postgres, service_role`.

### 1. `op_gear_reports()` — open-reports queue (mirror `op_attention_queue`)

A `SECURITY DEFINER` function returning open `gear_reports` joined back to the originating reservation. The join key is `gear_reports.ble_session_id = reservations.ble_session_id` (the server already maintains `reservations.ble_session_id = session_id`, so a report maps cleanly to its reservation/user even though `gear_reports.user_id` is the app user id).

```sql
create or replace function public.op_gear_reports(p_limit int default 50)
returns table (
  report_id      uuid,
  user_id        text,
  ble_session_id text,
  station_id     text,
  gate           int,
  kind           text,
  message        text,
  photo_path     text,        -- in-bucket object path; sign it via #3 to view
  status         text,
  created_at     timestamptz,
  reservation_id uuid         -- null when the report had no (or an unmatched) session
)
language sql
security definer
set search_path = public
as $$
  select g.id, g.user_id, g.ble_session_id, g.station_id, g.gate, g.kind,
         g.message, g.photo_path, g.status, g.created_at, r.id
  from public.gear_reports g
  left join public.reservations r
    on r.ble_session_id is not null
   and r.ble_session_id = g.ble_session_id
  where g.status = 'open'
  order by g.created_at desc
  limit greatest(1, least(p_limit, 200));
$$;
revoke all on function public.op_gear_reports(int) from public;
grant execute on function public.op_gear_reports(int) to postgres, service_role;
```

(The `(status, created_at)` and `ble_session_id` indexes from Task 1 already cover the filter + join.)

### 2. `reservation_events` 'gear_report' breadcrumb (so it shows in `op_dispute_timeline`)

So a filed report appears inline on the dispute timeline (`op_view_audit` / `op_dispute_timeline` read `reservation_events` ordered by `at`), append a breadcrumb when a report is inserted with a matching session. Two options:

- **DB trigger (preferred — also catches non-app inserts):** an `after insert on public.gear_reports` trigger that, when a matching `reservations` row exists, inserts a `reservation_events` row:
  ```sql
  insert into public.reservation_events (reservation_id, kind, payload)
  select r.id, 'gear_report',
         jsonb_build_object('report_id', new.id, 'kind', new.kind,
                            'has_photo', new.photo_path is not null)
  from public.reservations r
  where r.ble_session_id = new.ble_session_id;
  ```
  Keep `payload` free of the raw `message`/`photo_path` (PII / private storage path) — store ids + booleans; ops dereference the photo via #3.
- **App-side (simpler, no schema change beyond `'gear_report'` being a valid free-text `kind`):** after a successful `gear_reports` insert, fire the same `reservation_events` insert. Note this only fires from the app and is skipped when no session id is present.

`op_dispute_timeline` then surfaces the `'gear_report'` kind with no further changes (it already renders arbitrary `reservation_events.kind`s).

### 3. Signed-URL helper for ops to view the private return photo

The `return-photos` bucket is private (owner-only RLS); operators are not the owner. Provide a short-lived signed URL so ops can view a report's photo without making the bucket public:

```sql
-- Option A: server-side (Edge Function / service_role), no SQL function needed —
-- the cleanest path. Ops console calls:
--   supabase.storage.from('return-photos').createSignedUrl(photo_path, 60)
-- using the SERVICE_ROLE client (bypasses owner RLS), 60s TTL, no download flag.

-- Option B: SECURITY DEFINER SQL wrapper if the console only has RPC access:
create or replace function public.op_gear_report_photo_url(p_report_id uuid, p_ttl int default 60)
returns text
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_path text;
  v_url  text;
begin
  select photo_path into v_path from public.gear_reports where id = p_report_id;
  if v_path is null then return null; end if;
  -- storage.create_signed_url signs an in-bucket object path; TTL clamped.
  select (storage.create_signed_url('return-photos', v_path,
                                    greatest(5, least(p_ttl, 600)))).signed_url
    into v_url;
  return v_url;
end;
$$;
revoke all on function public.op_gear_report_photo_url(uuid, int) from public;
grant execute on function public.op_gear_report_photo_url(uuid, int) to postgres, service_role;
```

Prefer **Option A** (service-role `createSignedUrl` from the ops backend) unless the console is RPC-only; it keeps storage signing out of SQL and matches how the rest of the operator surface already calls Supabase with the service role.

> **Pointer to the integration code:** `op_gear_reports` mirrors `public.op_view_audit` (and the broader queue pattern of `op_attention_queue`); the timeline breadcrumb reuses the exact `insert into public.reservation_events (reservation_id, kind, payload)` shape already used by `op_force_release` in `20260427120000_operator_functions.sql`.
