#!/usr/bin/env python3
"""
BLE test client — signs unlock commands with the DEV-001 dev secret and
writes them directly to the Playbox station, no Supabase needed.

Usage:
    python3 tools/ble-test.py unlock              # send signed unlock
    python3 tools/ble-test.py return              # send signed return_unlock
    python3 tools/ble-test.py both                # unlock, wait, return
    python3 tools/ble-test.py garbage             # send unsigned junk (should be rejected)

Dependency: bleak (`pip install bleak --break-system-packages`).

NOTE: macOS will prompt for Bluetooth permission the first time. Grant it.
"""

import asyncio
import hashlib
import hmac
import json
import sys
import time

from bleak import BleakClient, BleakScanner

SERVICE_UUID     = "12345678-1234-5678-1234-56789abcdef0"
UNLOCK_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1"
EVENTS_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef2"
INFO_CHAR_UUID   = "12345678-1234-5678-1234-56789abcdef3"

# DEV-001 secret — must match the array in firmware/PlayboxStation/PlayboxStation.ino
DEV_001_SECRET = bytes.fromhex(
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
)


def sign(secret: bytes, payload: str) -> str:
    return hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()


def build_unlock(gate: int, session_id: str, duration_min: int) -> dict:
    ts = int(time.time())
    sig = sign(DEV_001_SECRET, f"unlock|{gate}|{session_id}|{duration_min}|{ts}")
    return {
        "cmd": "unlock",
        "gate": gate,
        "session_id": session_id,
        "duration_min": duration_min,
        "ts": ts,
        "sig": sig,
    }


def build_return_unlock(gate: int, session_id: str) -> dict:
    ts = int(time.time())
    sig = sign(DEV_001_SECRET, f"return_unlock|{gate}|{session_id}|0|{ts}")
    return {
        "cmd": "return_unlock",
        "gate": gate,
        "session_id": session_id,
        "ts": ts,
        "sig": sig,
    }


async def find_station() -> str | None:
    print("Scanning for Playbox station (10s)...")

    def filter_fn(device, adv):
        # Match by name OR by service UUID — name is unreliable on iOS-style scans
        if device.name and "Playbox" in device.name:
            return True
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        return SERVICE_UUID.lower() in uuids

    device = await BleakScanner.find_device_by_filter(filter_fn, timeout=10)
    if device is None:
        print("ERROR: Playbox station not found. Confirm:")
        print("  - red LED is on")
        print("  - blue LED is blinking once per second")
        print("  - macOS has granted Bluetooth permission to Terminal/Python")
        return None
    print(f"Found {device.name or '(unnamed)'} @ {device.address}")
    return device


async def write_payload(client: BleakClient, payload: dict | bytes, label: str):
    if isinstance(payload, dict):
        body = json.dumps(payload, separators=(",", ":")).encode()
    else:
        body = payload
    print(f"\n>>> {label}")
    print(f"    {body.decode('utf-8', errors='replace')}")
    await client.write_gatt_char(UNLOCK_CHAR_UUID, body, response=True)
    print(f"    (BLE write acked)")


async def run(action: str):
    device = await find_station()
    if device is None:
        return

    async with BleakClient(device) as client:
        print(f"Connected. Subscribing to events...")

        def on_event(_, data):
            try:
                print(f"    [event] {data.decode('utf-8')}")
            except Exception:
                print(f"    [event] (binary {len(data)} bytes)")

        await client.start_notify(EVENTS_CHAR_UUID, on_event)

        # Read INFO once
        info = await client.read_gatt_char(INFO_CHAR_UUID)
        print(f"Station info: {info.decode('utf-8')}\n")

        if action == "unlock":
            await write_payload(client, build_unlock(1, "test-session-1", 30), "SIGNED unlock")
        elif action == "return":
            await write_payload(client, build_return_unlock(1, "test-session-1"), "SIGNED return_unlock")
        elif action == "both":
            await write_payload(client, build_unlock(1, "test-session-1", 30), "SIGNED unlock")
            print("Servo should now be at 90 degrees (UNLOCKED).")
            print("Press the BOOT button on ESP32 to advance to IN_USE state...")
            await asyncio.sleep(8)
            await write_payload(
                client, build_return_unlock(1, "test-session-1"), "SIGNED return_unlock"
            )
            print("Servo should now be at 90 degrees (RETURN_UNLOCKED).")
            print("Press the BOOT button again to close — servo back to 0deg, gate_closed event fires.")
            await asyncio.sleep(8)
        elif action == "garbage":
            payload = b'{"cmd":"unlock","gate":1,"session_id":"x"}'
            await write_payload(client, payload, "UNSIGNED garbage (should be rejected)")
        else:
            print(f"Unknown action: {action}. Use unlock | return | both | garbage")
            return

        # Listen briefly for any events
        await asyncio.sleep(2)
        print("\nDone.")


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "unlock"
    asyncio.run(run(action))


if __name__ == "__main__":
    main()
