# Hardware integration runbook

This is the punch-list for taking Playbox from "everything mocks the gate"
to "tap a station and a real lock pops."

## TL;DR

The app talks to gates through one shim — `lib/hardware/index.ts`. Every
screen calls `getDriver()`; the resolver picks **mock** in dev (default) and
**real BLE** otherwise. Flip on real BLE in a dev build by toggling
`useDevStore.bleHardware = true` (no rebuild needed).

```
┌──────────────────────┐    ┌──────────────────────┐   ┌────────────────┐
│ session-prep         │    │ lib/hardware/        │   │ Supabase Edge  │
│   onOyna()           │───▶│   getDriver()        │──▶│   gate-unlock  │──▶ MQTT bridge ──▶ 🔓
│ useStationInRange    │    │   ble | mock         │   └────────────────┘
└──────────────────────┘    └──────────────────────┘
```

## What you have to fill in

### 1. BLE service UUID — `lib/hardware/ble.ts`
```ts
const PLAYBOX_BLE_SERVICE_UUID = '00000000-0000-1000-8000-00805f9b34fb';
```
Replace with the real service UUID your firmware advertises.

### 2. Advertising-name format — `lib/hardware/ble.ts`
```ts
function nameFromStationId(stationId: string): string {
  return `pbox-${stationId}`;
}
```
Update if your firmware uses a different naming convention (e.g. MAC suffix,
sequential serial).

### 3. RSSI threshold — `lib/hardware/ble.ts`
```ts
const IN_RANGE_RSSI = -85;
```
This is conservative. After your first field test, retune so a user holding
the phone at the gate reads as in-range and someone 5+ meters away does not.

### 4. Hardware bridge URL — Edge Function env
The `gate-unlock` function POSTs to a per-deploy bridge URL with bearer
token. Set in Supabase dashboard → Edge Functions → Settings:
```
GATE_DISPATCH_URL=https://gates.playbox.app/dispatch
GATE_DISPATCH_TOKEN=...
```
Without these set, `gate-unlock` returns a soft success (good for dev).

### 5. Database tables for unlock — migrations
The Edge Function reads/writes these tables. Add migrations if missing:

```sql
-- payment_holds: every iyzico preauth, captured_at NULL means active
create table if not exists payment_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  station_id text not null,
  iyzico_payment_id text not null,
  amount_try numeric not null,
  created_at timestamptz default now(),
  captured_at timestamptz,
  released_at timestamptz
);
create index on payment_holds (user_id, station_id) where captured_at is null and released_at is null;

-- gate_unlock_log: audit trail + idempotency
create table if not exists gate_unlock_log (
  id uuid primary key default gen_random_uuid(),
  correlation_id text unique not null,
  user_id uuid references auth.users(id) on delete cascade,
  station_id text not null,
  gate_id text not null,
  status text not null check (status in ('success','failed')),
  detail text,
  created_at timestamptz default now()
);
```

## How to test before hardware arrives

The mock driver simulates everything — proximity, unlock, errors. Open
`lib/hardware/mock.ts`:

```ts
const SIMULATE_OUT_OF_RANGE = false;       // flip true to test "yaklaş" copy
const SIMULATE_UNLOCK_FAIL = null;         // 'timeout', 'gate_busy', etc.
const PROXIMITY_DELAY_MS = 500;
const UNLOCK_DELAY_MS = 700;
```

Each `UnlockError` in `lib/hardware/types.ts` maps to a Turkish copy in
`app/session-prep/[stationId]/[sport].tsx` — verify each one feels right.

## How to test with one real gate

1. Power on the gate. Confirm it advertises with a tool like `nRF Connect`.
2. Note the service UUID and local name.
3. Update `PLAYBOX_BLE_SERVICE_UUID` and `nameFromStationId` in `lib/hardware/ble.ts`.
4. In a dev build, open settings → toggle "BLE hardware" on (you'll need
   to surface the toggle — see `useDevStore.bleHardware`).
5. Open a station detail screen. The bottom should say "menzilde" if your
   phone reads RSSI ≥ -85.
6. Walk through OYNA. If `gate-unlock` is deployed and `GATE_DISPATCH_URL`
   points at your bridge, the gate should pop.

## Failure modes the app already handles

| Driver returns        | User sees                                                   |
|-----------------------|-------------------------------------------------------------|
| `not_in_range`        | "kapıya yaklaş ve tekrar dene"                              |
| `permission_denied`   | "bluetooth izni gerekiyor — ayarlardan aç"                  |
| `bluetooth_off`       | "bluetooth'u açıp tekrar dene"                              |
| `connection_failed`   | "kapı yanıt vermedi. tekrar dene"                           |
| `auth_rejected`       | "oturum doğrulanamadı, baştan başla"                        |
| `gate_busy`           | "kapı şu an meşgul. bir an sonra tekrar dene"               |
| `timeout`             | "kapı yanıtı gelmedi. tekrar dene"                          |
| `network`             | "internet bağlantın yok gibi"                               |
| `unsupported`         | "bu cihaz kapı açmayı desteklemiyor"                        |
| `unknown`             | "bir sorun çıktı, tekrar dene"                              |

If any of these need different copy or an additional action button (e.g.
"open Settings" deep-link for permission_denied), edit the `reasonMap` in
`session-prep/[stationId]/[sport].tsx`.

## Rollout sequence we recommend

1. Deploy `gate-unlock` Edge Function with `GATE_DISPATCH_URL` unset →
   server-side audit log starts populating, dispatch is a no-op.
2. Set up the MQTT/HTTP bridge in front of one test gate, point
   `GATE_DISPATCH_URL` at it.
3. Update `PLAYBOX_BLE_SERVICE_UUID` and `nameFromStationId` in client.
4. Internal smoke test on a single station before rolling out to others.
