# Playbox Station Firmware

Firmware for the ESP32 inside each Playbox rental station. Phase 0 is a
breadboard smoke test that proves end-to-end BLE between the Playbox app and
the ESP32 using a single fake gate.

## Hardware (Phase 0 breadboard)

| Component | Connection |
|---|---|
| ESP32 WROOM-32 (USB powered for now) | board: `ESP32 Dev Module` in Arduino IDE |
| MG996R servo — signal | GPIO 13 |
| MG996R servo — VCC (red) | LM2596 5V output (NOT ESP32's 5V pin — servo can pull >500mA) |
| MG996R servo — GND (brown/black) | shared with ESP32 GND |
| LM2596 input | TTEC 12V battery (set output to 5.0–6.0V with the trim pot, measure with the DT839) |
| BOOT button (already on the board) | GPIO 0 — used as the fake "reed switch" / gate closed sensor |
| Onboard LED (already on the board) | GPIO 2 — heartbeat blink |

> **Important:** before you connect the servo, use the multimeter to confirm the
> LM2596 output is between 5.0V and 6.0V. The MG996R is rated 4.8–7.2V, but
> anything over ~7V can damage the servo gears under load.

## Arduino IDE setup

1. **Install the ESP32 board package** — Arduino IDE → Settings → Additional
   Boards Manager URLs, paste:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   then Tools → Board → Boards Manager → search "esp32" → Install.

2. **Install three libraries** — Sketch → Include Library → Manage Libraries:
   - `NimBLE-Arduino` by h2zero (latest 2.x)
   - `ArduinoJson` by Benoit Blanchon (latest 7.x)
   - `ESP32Servo` by Kevin Harrington

3. **Select the board:** Tools → Board → ESP32 Arduino → **ESP32 Dev Module**.
   Port: whichever `/dev/cu.usbserial-*` or `/dev/cu.wchusbserial*` appears
   when you plug in the ESP32.

4. **Upload speed:** start at `115200`. If uploads succeed, bump to `921600`
   for faster iteration.

5. Open `PlayboxStation/PlayboxStation.ino` and click ▶ Upload.

## Verifying it works (without the phone yet)

Open Tools → Serial Monitor, set baud to `115200`. Reset the ESP32. You should see:

```
=== Playbox Phase 0 firmware (v0.1.0-phase0) ===
[INIT] servo at 0deg (LOCKED)
[BLE] advertising as 'Playbox-DEV-001'
[READY] waiting for app to connect
[BLE] notify: {"event":"boot","ts":0}
```

The onboard LED should blink ~once per second. The servo should snap to 0°.

## Verifying the BLE end-to-end

Once the Playbox app's debug screen ([app/dev/ble.tsx](../app/dev/ble.tsx)) is
running on a phone, the full handshake is:

| Action in app | Expected on ESP32 |
|---|---|
| Tap **Connect** | Serial: `[BLE] phone connected` |
| Tap **Fake unlock** | Serial: `[STATE] LOCKED -> UNLOCKED`, servo rotates to 90° |
| Press the BOOT button on the ESP32 | Serial: `[BTN] gate closed after pickup — UNLOCKED -> IN_USE`, servo back to 0° |
| Tap **Fake return-unlock** | Serial: `[STATE] IN_USE -> RETURN_UNLOCKED`, servo to 90° |
| Press the BOOT button again | Serial: `[BTN] gate closed after return ... session ends`, servo to 0°, app shows `gate_closed` event |

## Troubleshooting

- **Servo jitters or doesn't move:** power issue. The servo MUST be on a separate
  5–6V supply (LM2596), sharing GND with the ESP32. Powering from the ESP32's
  3V3 or 5V pin will cause brownouts.
- **Upload fails with `Failed to connect to ESP32`:** hold the BOOT button
  while clicking ▶ Upload. Release after "Connecting..." starts.
- **App can't see `Playbox-DEV-001`:** check the Serial Monitor first — is the
  ESP32 advertising? On iOS, also check Settings → Bluetooth is on (the OS
  filters BLE devices by service UUID, but Bluetooth itself must be enabled).
- **Compile error `'Servo' was not declared`:** the `ESP32Servo` library isn't
  installed. Install it via Library Manager.

## Wire format (must match `lib/ble/protocol.ts`)

| BLE characteristic | Direction | Example payload |
|---|---|---|
| `UNLOCK_CHAR` (...def1) | phone → ESP32 (write, SIGNED) | `{"cmd":"unlock","gate":1,"session_id":"sess-abc","duration_min":60,"ts":1717600000,"sig":"<64hex>"}` |
| `UNLOCK_CHAR` (...def1) | phone → ESP32 (write, SIGNED) | `{"cmd":"return_unlock","gate":1,"session_id":"sess-abc","ts":1717600100,"sig":"<64hex>"}` |
| `UNLOCK_CHAR` (...def1) | phone → ESP32 (write, UNSIGNED) | `{"cmd":"set_time","now":1717600000}` · `{"cmd":"ack","seq":42}` |
| `EVENTS_CHAR` (...def2) | ESP32 → phone (notify, SIGNED) | `{"event":"gate_closed","gate":1,"session_id":"sess-abc","seq":42,"ts":1717600200,"sig":"<64hex>"}` |
| `EVENTS_CHAR` (...def2) | ESP32 → phone (notify, SIGNED) | `{"event":"battery_low","seq":7,"ts":...,"sig":"<64hex>","mv":11900}` |
| `INFO_CHAR` (...def3) | phone → ESP32 (read) | `{"station_id":"DEV-001","fw":"0.5.0-3gate","battery_pct":100,"battery_mv":12700,"gates":[{"gate":1,"state":"LOCKED","session_id":""},...]}` |
| `BUFFER_CHAR` (...def4) | phone → ESP32 (read) | JSON array of pending (unacked, `seq>acked_seq`) signed events; app reads, stores, then writes back `{"cmd":"ack","seq":<max>}` |

## v2 signing & event contract

Every outbound event is signed + sequenced by the host-tested signing core
(`crypto/playbox_sign.*`), byte-for-byte identical to the server signer:

- **Canonical event:** `${event}|${gate}|${session_id}|${seq}|${ts}|${extra}`
  where `extra` = integer millivolts ONLY for `battery_low`/`battery_critical`
  (gated on event NAME), `""` otherwise.
- **Canonical command:** `${cmd}|${gate}|${session_id}|${duration_min_or_0}|${ts}`.
- **Key:** the 32 RAW BYTES decoded from the 64-hex `STATION_SECRET_HEX`.
- Events: `boot`, `gate_opened`(+session), `gate_closed`(+session),
  `unlock_timeout`/`return_timeout`/`ball_overdue`(+session),
  `battery_low`/`battery_critical`(+mv).
- `unlock`/`return_unlock` are verified (sig) + replay-guarded (`ts>lastTs`);
  `set_time`/`ack` are unsigned control commands.

### Building the signing core into the sketch (REQUIRED)

The Arduino IDE compiles only sources inside the sketch folder. The core lives
in `firmware/crypto/`. Before flashing, copy the whole `crypto/` subdir into
`PlayboxStation_3gate/` (so `crypto/playbox_sign.c`, `crypto/playbox_sign.h`,
`crypto/sha256.c`, `crypto/sha256.h` sit next to the `.ino`). The sketch
includes `crypto/playbox_sign.h` and the two `.c` files compile as plain C99.
The same core is validated on-host by `firmware/test/run.sh` (17/17 vectors) and
on-device by a boot self-test that signs a golden vector and blinks an error
pattern + prints `SIGN SELF-TEST FAILED` on mismatch.

> Per-station: replace `STATION_SECRET_HEX` with the unit's provisioned 64-hex
> secret and mirror it in the server station row.

The full design (3-gate stations, sneakernet event queue, Supabase wiring) lives in
[../docs/plans/2026-04-15-station-hardware-design.md](../docs/plans/2026-04-15-station-hardware-design.md).
