# Playbox Station Firmware

Firmware for the ESP32 inside each Playbox rental station.

## Overview

There are two sketches. They share one wire contract, one signing core, and the
same v2 behavior — they differ only in gate count and dev conveniences.

| Sketch | Role | Gates | Notes |
|---|---|---|---|
| [`PlayboxStation/PlayboxStation.ino`](PlayboxStation/PlayboxStation.ino) | **single-gate DEV** | 1 | Phase-0 breadboard/dev variant. BOOT button (GPIO 0) acts as a fake reed switch so you can drive the full state machine with no reed/magnet wired. Chatty Serial. |
| [`PlayboxStation_3gate/PlayboxStation_3gate.ino`](PlayboxStation_3gate/PlayboxStation_3gate.ino) | **3-gate PRODUCTION** | 3 | Plug-and-play production sketch. Real reed switches, ADC battery sense. Host-test validated. |

**v2** (both sketches) added, over the original v1 hand-rolled HMAC build:

- **Signed + sequenced events** — every outbound event is signed with HMAC-SHA256
  and carries a monotonic `seq`, via the host-tested signing core
  ([`crypto/playbox_sign.*`](crypto/)). Byte-for-byte identical to the server
  signer (`supabase/functions/_shared`). Firmware NEVER hand-rolls a canonical
  string or HMAC.
- **Courier model** — emitted events are persisted to an NVS ring buffer (K=64)
  so a reboot never loses an unacked event. The app drains them over
  `BUFFER_CHAR` and writes back an `ack`, which drops them. Works fully offline.
- **`set_time`** anchors a wall clock so every event carries a real `ts`; **`ack`**
  drops buffered events. Both are unsigned control commands.
- **Battery** SLA curve over an ADC divider, `battery_low`/`battery_critical`
  events, refuse-new-unlock at critical (always honor `return_unlock`).
- **Boot self-test** signs a golden vector and errors loudly on a broken flash.

The full system design (sneakernet event queue, Supabase wiring) lives in
[../docs/plans/2026-04-15-station-hardware-design.md](../docs/plans/2026-04-15-station-hardware-design.md).
3-gate wiring detail: [`PlayboxStation_3gate/WIRING.md`](PlayboxStation_3gate/WIRING.md).

## Build

Either Arduino IDE or `arduino-cli` works.

### Required libraries

| Library | Version | Source |
|---|---|---|
| `NimBLE-Arduino` (h2zero) | latest 2.x | Library Manager |
| `ArduinoJson` (Benoit Blanchon) | **v7.x** | Library Manager |
| `Preferences` | bundled with ESP32 core | — |

Board package: **esp32** by Espressif (Boards Manager URL
`https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`).
Board: **ESP32 Dev Module** / NodeMCU-32S.

### Signing core (already in the sketch folder)

The Arduino toolchain compiles every source in the **sketch root** (next to the
`.ino`), so the four signing-core files are kept **flat** in each sketch folder
and committed alongside the `.ino` — no copy step needed before flashing:

```
PlayboxStation/                  (and PlayboxStation_3gate/)
├── PlayboxStation.ino
├── playbox_sign.c   playbox_sign.h
└── sha256.c         sha256.h
```

They are copies of the canonical, host-tested core in `firmware/crypto/`
(validated by `firmware/test/run.sh`). Don't edit the sketch copies — change
`firmware/crypto/` and re-copy (`cp firmware/crypto/*.{h,c} <sketch>/`) if the
contract ever moves.

The sketch includes the header **inside an `extern "C"` block** (the core is
plain C99, the sketch is C++):

```cpp
extern "C" {
  #include "playbox_sign.h"
}
```

**Verify it compiles** (catches toolchain/version drift before you flash):

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/PlayboxStation_3gate
# libs: NimBLE-Arduino, ArduinoJson (v7)  (Preferences is built-in; gates use a relay, no servo lib)
```

Both `.c` files (`playbox_sign.c`, `sha256.c`) compile as part of the sketch
build — they are plain C99 and already pass the host test suite. Keep the copied
`crypto/` in sync with `firmware/crypto/` if the core ever changes (the copies
are build artifacts; the source of truth is `firmware/crypto/`).

### Arduino IDE

1. Install the esp32 board package + the libraries above.
2. Tools → Board → ESP32 Arduino → **ESP32 Dev Module**; pick the
   `/dev/cu.usbserial-*` (or `wchusbserial`) port.
3. Open the sketch, ▶ Upload. Upload speed `115200` first; bump to `921600` once
   stable. If upload fails with `Failed to connect`, hold BOOT during "Connecting…".

### arduino-cli

```sh
arduino-cli core install esp32:esp32
arduino-cli lib install "NimBLE-Arduino" "ArduinoJson"
# after copying crypto/ into the sketch folder (see above):
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/PlayboxStation
arduino-cli upload  --fqbn esp32:esp32:esp32 -p /dev/cu.usbserial-XXXX firmware/PlayboxStation
```

## Per-station secret

Each station authenticates with a unique **`STATION_SECRET_HEX`** — 64 hex chars
= 32 raw bytes. The HMAC key is the **decoded 32 raw bytes**, not the utf8 string.

- The firmware's `STATION_SECRET_HEX` **must match** the server's
  `PLAYBOX_STATION_SECRET_<ID>` env var / Vault entry (e.g.
  `PLAYBOX_STATION_SECRET_DEV_001`) exactly, lowercase hex.
- Generate a fresh secret per station:

  ```sh
  openssl rand -hex 32
  ```

- Set it in the sketch (`#define STATION_SECRET_HEX "…"`) **and** mirror it in the
  server station row before the unit will be accepted by `ingest-events`.
- **NEVER commit a real secret.** The value checked in is the shared DEV-001 dev
  secret (== the host test-vector secret) on purpose, so the bench self-test and
  the device sign identically. Production units must override it.

> The self-test uses a SEPARATE pinned secret (`SELFTEST_SECRET_HEX`) so it keeps
> proving the signing core even on a unit provisioned with a real, different
> `STATION_SECRET_HEX`.

## The signing contract

- **Source of truth:** [`firmware/crypto/`](crypto/) — `playbox_sign.{h,c}` build
  the canonical strings and HMAC; `sha256.{h,c}` is the hash. Plain C99, shared
  verbatim by firmware and (logically) the server.
- **Canonical event:** `${event}|${gate}|${session_id}|${seq}|${ts}|${extra}`
  where `gate`/`session_id` are `""` when absent, and `extra` = integer
  millivolts ONLY for `battery_low`/`battery_critical` (gated on event name),
  `""` otherwise.
- **Canonical command:** `${cmd}|${gate}|${session_id}|${duration_min_or_0}|${ts}`.
- **Signatures** are 64 lowercase hex chars, no `0x`.
- **Proof of server parity:** the host test compiles the real core against the
  golden vectors and node-computed command sigs:

  ```sh
  cd firmware/test && sh run.sh      # → "--- 17/17 checks passed --- / RESULT: ALL PASS"
  ```

  These 17 vectors are the contract: if they pass, the firmware's canonical
  string + HMAC match the server. The **on-device boot self-test** signs the
  `gate_closed` golden vector and compares to a pinned sig — it catches a flash
  where signing is subtly broken (compiler/lib/struct drift) by blinking the LED
  fast 10x and printing `SIGN SELF-TEST FAILED`.

## Wire contract summary

BLE UUIDs (must match `lib/ble/protocol.ts`):

| Characteristic | UUID suffix | Props |
|---|---|---|
| Service | `…def0` | — |
| `UNLOCK_CHAR` | `…def1` | WRITE |
| `EVENTS_CHAR` | `…def2` | NOTIFY |
| `INFO_CHAR` | `…def3` | READ |
| `BUFFER_CHAR` | `…def4` | READ |

| Characteristic | Direction | Example payload |
|---|---|---|
| `UNLOCK_CHAR` | phone → ESP32 (write, **SIGNED**) | `{"cmd":"unlock","gate":1,"session_id":"sess-abc","duration_min":60,"ts":1717600000,"sig":"<64hex>"}` |
| `UNLOCK_CHAR` | phone → ESP32 (write, **SIGNED**) | `{"cmd":"return_unlock","gate":1,"session_id":"sess-abc","ts":1717600100,"sig":"<64hex>"}` |
| `UNLOCK_CHAR` | phone → ESP32 (write, **UNSIGNED**) | `{"cmd":"set_time","now":1717600000}` · `{"cmd":"ack","seq":42}` |
| `EVENTS_CHAR` | ESP32 → phone (notify, **SIGNED**) | `{"event":"gate_opened","gate":1,"session_id":"sess-abc","seq":41,"ts":...,"sig":"<64hex>"}` |
| `EVENTS_CHAR` | ESP32 → phone (notify, **SIGNED**) | `{"event":"battery_low","seq":7,"ts":...,"sig":"<64hex>","mv":11900}` |
| `BUFFER_CHAR` | phone ← ESP32 (read) | JSON array of pending (`seq>acked_seq`) signed events; app reads, stores, then writes `{"cmd":"ack","seq":<max>}` |
| `INFO_CHAR` | phone ← ESP32 (read) | canonical superset (below) |

**Events:** `boot`, `gate_opened`(+session), `gate_closed`(+session),
`unlock_timeout`/`return_timeout`/`ball_overdue`(+session),
`battery_low`/`battery_critical`(+mv). `gate_opened` carries the `session_id`.

**Commands:** `unlock` / `return_unlock` are signed + replay-guarded (`ts>lastTs`,
persisted). `set_time` / `ack` are unsigned control commands.

**Courier model:** every emitted event is persisted to an NVS ring (K=64) and
exposed (unacked only) via `BUFFER_CHAR`. The app drains it and writes back
`ack{seq}`, which drops those entries. Survives reboots and offline periods.

### Canonical INFO superset (do not let it drift)

Two app parsers read INFO with different shapes, so the firmware emits a superset
that satisfies both. `gates` is ALWAYS a **number** (count), never an array.

| Field | Type | Read by |
|---|---|---|
| `station_id` | string | general |
| `fw` | string | `app/station/[id].tsx` (`info.fw`) |
| `gates` | **number** (count: 1 or 3) | `app/station/[id].tsx` (`info.gates`) |
| `battery_pct` / `battery_mv` | number | general / dashboards |
| `gate_states` | string[] per-gate state | `lib/hardware/infoGate.ts` `extractGate()` |
| `gate_sessions` | string[] per-gate session | `lib/hardware/infoGate.ts` `extractGate()` |
| `states` | object[] `{gate,state,session_id}` | `app/station/[id].tsx` iterates `info.states` |
| `sessions` | string[] per-gate session | alias of `gate_sessions` |

For the single-gate dev sketch every array has length 1; for the 3-gate sketch,
length 3. State strings are exactly `LOCKED | UNLOCKED | IN_USE | RETURN_UNLOCKED`.

## Hardware

### Single-gate dev (breadboard)

| Component | Connection |
|---|---|
| ESP32 WROOM-32 | USB powered; board `ESP32 Dev Module` |
| Relay board IN1 (ACTIVE-LOW) | GPIO 13 — open = ~400ms LOW pulse, idle HIGH |
| Solenoid (via relay NO contact) | separate supply (NOT the ESP32 pin), GND shared |
| BOOT button (onboard) | GPIO 0 — **fake reed** (press = gate closed) |
| Onboard LED | GPIO 2 — heartbeat / self-test error blink |
| Battery ADC | GPIO 34, OPTIONAL — `BATTERY_ADC_WIRED 0` by default reports full battery (signing path unchanged) |

> The relay board is active-LOW: pulling IN1 to GND fires the relay. The firmware
> idles IN1 HIGH and pulses it LOW for `RELAY_PULSE_MS` (400ms) to throw the latch.
> Power the solenoid from its own supply through the relay's NO contact — never off
> the ESP32 rail.

### 3-gate production

| Function | Pins |
|---|---|
| Relay board IN1/IN2/IN3 (ACTIVE-LOW), gates 1/2/3 | GPIO **13 / 12 / 14** — open = ~400ms LOW pulse. ⚠️ GPIO 12 (gate 2) is a boot strapping pin: move to GPIO 27 or add a pulldown before wiring that channel |
| Reed switches (door-closed), gates 1/2/3 | GPIO **18 / 19 / 21**, INPUT_PULLUP, GPIO↔GND, LOW = closed |
| Onboard LED | GPIO 2 |
| Battery ADC | GPIO **34** (ADC1, input-only — safe with BLE) |

- **Battery divider:** ~5:1 (R1=39k top / R2=10k bottom → ratio 4.9) maps the
  10.5–13V SLA rail into the 0–3.3V ADC range. **`BATTERY_DIVIDER` MUST be
  calibrated** per board with a DMM (measure rail + pin voltage, trim the
  constant; the ESP32 ADC is non-linear near the rails). Read at rest only —
  never during a relay pulse (solenoid inrush sags the rail and false-trips low/critical).
- **Battery thresholds (SLA 12V):** `battery_low` at **11.9V** (~40% SoC),
  `battery_critical` at **11.5V** (~20% SoC), 150mV hysteresis (one event per
  crossing). At **critical the firmware REFUSES new unlocks** (don't strand the
  next user on a dying battery) but **ALWAYS honors `return_unlock`** so nobody
  is trapped with an item.
- **Power:** SLA **12V / 7Ah** battery. Solenoids draw from their **own supply
  through the relay NO contacts**, GND shared with the ESP32 — NEVER drive a
  solenoid off the ESP32 rail (inrush causes brownout / reboots).
- **Boot safety:** the firmware sets each relay pin OUTPUT and drives it OFF
  (HIGH) the instant setup runs, so an active-low relay never clicks a solenoid
  on during reset. Exception: GPIO 12 (gate 2) is itself a boot strapping pin
  that must read LOW at boot — relocate that channel or add a pulldown.

## Flashing + validation checklist

This is the plug-and-play replacement step: flash a unit, validate, swap it in.

1. **Copy the core** into the sketch folder (`cp -R firmware/crypto <sketch>/crypto`).
2. **Set the secret** — `STATION_SECRET_HEX` matches the server's
   `PLAYBOX_STATION_SECRET_<ID>`.
3. **Flash** the sketch.
4. **Watch Serial @ 115200** for the self-test pass:
   ```
   === Playbox single-gate DEV firmware (0.5.0-dev1) ===   (or "3-gate firmware (0.5.0-3gate)")
   [SELFTEST] signing core OK
   [BLE] advertising as 'Playbox-DEV-001'
   [EVT] {"event":"boot","seq":N,"ts":...,"sig":"<64hex>"}
   ```
   LED blinks ~1/s. (A fast 10x blink + `SIGN SELF-TEST FAILED` = broken flash.)
5. **Connect** via the app's dev BLE screen ([app/dev/ble.tsx](../app/dev/ble.tsx)).
6. **`set_time`** → Serial `[TIME] set_time … -> bootEpoch=…` (events now carry real ts).
7. **`unlock`** → `[STATE] gate 1: LOCKED -> UNLOCKED`, relay pulses open
   (`[RELAY] gate 1 -> PULSE OPEN`), and a signed `gate_opened` event (with
   `seq` + `session_id`) is notified.
8. **Close the gate** — press BOOT (dev) or close the door onto the reed (3-gate)
   → `UNLOCKED -> IN_USE`.
9. **`return_unlock`** → `IN_USE -> RETURN_UNLOCKED`, relay pulses open.
10. **Close again** → signed **`gate_closed`** event, `-> LOCKED`.
11. **Confirm the server `ingest-events`** accepts the signed events (sig + seq
    verify on the backend). Then `ack{seq}` from the app drains `BUFFER_CHAR`.

## Troubleshooting

- **Solenoid won't fire / weak kick:** power. Separate supply through the relay
  NO contact, GND shared with the ESP32. Confirm the relay clicks on a `unlock`.
- **Relay clicks on at boot:** the board is active-low and the pin floated before
  setup — the firmware drives it HIGH immediately, but check you're on GPIO 13
  (gate 0), not a strapping pin like GPIO 12.
- **Upload `Failed to connect to ESP32`:** hold BOOT during "Connecting…".
- **App can't see `Playbox-DEV-001`:** check Serial — is it advertising? Ensure
  phone Bluetooth is on.
- **Compile `playbox_sign.h: No such file`:** you didn't copy `crypto/` into the
  sketch folder (see Build → CRITICAL).
- **Server rejects events:** secret mismatch — `STATION_SECRET_HEX` ≠ the server's
  `PLAYBOX_STATION_SECRET_<ID>`. Regenerate/sync. Confirm host test is 17/17.
