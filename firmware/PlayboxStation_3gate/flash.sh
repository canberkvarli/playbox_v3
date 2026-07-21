#!/usr/bin/env bash
# Flash the Playbox 3-gate firmware via arduino-cli — no Arduino IDE, no crashes.
#
# Usage (run from anywhere):
#   ./flash.sh        compile + upload + open serial monitor
#   ./flash.sh -m     monitor only (skip flashing)
#   ./flash.sh -e     ERASE all flash first (wipes NVS / stuck gate state), then upload
#
# Ctrl-C quits the serial monitor.
set -euo pipefail

SKETCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FQBN="esp32:esp32:esp32"   # = "ESP32 Dev Module"
BAUD=115200

# Auto-detect the ESP32 serial port (CP2102 / CH340 / SLAB).
PORT="$(ls /dev/cu.usbserial-* /dev/cu.wchusbserial-* /dev/cu.SLAB_USBtoUART 2>/dev/null | head -1 || true)"
if [[ -z "${PORT}" ]]; then
  echo "✗ No ESP32 serial port found. Plug the board in (looked for /dev/cu.usbserial-*)."
  exit 1
fi
echo "→ Port: ${PORT}"

# Monitor-only mode.
if [[ "${1:-}" == "-m" ]]; then
  echo "→ Serial monitor @ ${BAUD} (Ctrl-C to quit)"
  exec arduino-cli monitor -p "${PORT}" -c baudrate=${BAUD}
fi

# Optional full erase (wipes NVS → resets gate state to LOCKED/AVAILABLE).
if [[ "${1:-}" == "-e" ]]; then
  echo "→ ERASING all flash (wipes NVS / gate state)…"
  if python3 -m esptool --chip esp32 --port "${PORT}" erase_flash 2>/dev/null; then
    :
  elif command -v esptool.py >/dev/null 2>&1 && esptool.py --chip esp32 --port "${PORT}" erase_flash; then
    :
  else
    echo "  (esptool not found — skipping erase. Run 'pip3 install esptool' if you need it.)"
  fi
fi

echo "→ Compiling…"
arduino-cli compile --fqbn "${FQBN}" "${SKETCH_DIR}"
echo "→ Uploading…"
arduino-cli upload -p "${PORT}" --fqbn "${FQBN}" "${SKETCH_DIR}"
echo "✓ Flashed. Opening serial monitor @ ${BAUD} (Ctrl-C to quit)…"
exec arduino-cli monitor -p "${PORT}" -c baudrate=${BAUD}
