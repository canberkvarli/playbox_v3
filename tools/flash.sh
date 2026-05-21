#!/usr/bin/env bash
# =============================================================================
# Playbox firmware flasher
# =============================================================================
# One command to compile + upload + serial-monitor the Phase 0 firmware.
# Idempotent: installs arduino-cli, ESP32 core, and required libraries on
# first run; on subsequent runs it just compiles/uploads.
#
# Usage:
#   ./tools/flash.sh              # compile + upload + monitor
#   ./tools/flash.sh compile      # compile only
#   ./tools/flash.sh upload       # compile + upload (no monitor)
#   ./tools/flash.sh monitor      # serial monitor only
#   ./tools/flash.sh erase        # nuke NVS + flash (recover from bad state)
#
# Env vars (optional):
#   PORT=/dev/cu.usbserial-XXXX   # override auto-detected serial port
#   FQBN=esp32:esp32:nodemcu-32s  # override board FQBN
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKETCH_DIR="$REPO_ROOT/firmware/PlayboxStation"
FQBN="${FQBN:-esp32:esp32:nodemcu-32s}"
ESP32_INDEX="https://espressif.github.io/arduino-esp32/package_esp32_index.json"
BAUD=115200
# Upload baud rate — 460800 is reliable on most USB cables. Drop to 230400
# or 115200 if you keep getting "Bad data checksum" mid-upload (cable/port
# can't sustain the higher speed). 921600 is faster but less forgiving.
UPLOAD_SPEED="${UPLOAD_SPEED:-460800}"

# ---- helpers ----------------------------------------------------------------
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

die() { red "ERROR: $*" >&2; exit 1; }

detect_port() {
  if [[ -n "${PORT:-}" ]]; then
    [[ -e "$PORT" ]] || die "PORT=$PORT does not exist"
    echo "$PORT"; return
  fi
  local found
  found=$(ls /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART /dev/cu.wchusbserial-* 2>/dev/null | head -n1 || true)
  [[ -n "$found" ]] || die "no ESP32 serial port found. Check USB cable is data-capable and plugged directly into laptop."
  echo "$found"
}

ensure_arduino_cli() {
  if command -v arduino-cli >/dev/null 2>&1; then return; fi
  yellow "arduino-cli not found — installing via Homebrew..."
  command -v brew >/dev/null 2>&1 || die "Homebrew not installed. Install from https://brew.sh first."
  brew install arduino-cli
}

ensure_esp32_core() {
  if arduino-cli core list 2>/dev/null | grep -q '^esp32:esp32'; then return; fi
  yellow "Installing ESP32 board package (this takes a few minutes the first time)..."
  arduino-cli config init --overwrite >/dev/null 2>&1 || true
  arduino-cli core update-index --additional-urls "$ESP32_INDEX"
  arduino-cli core install esp32:esp32 --additional-urls "$ESP32_INDEX"
}

ensure_libs() {
  local libs=("NimBLE-Arduino" "ArduinoJson" "ESP32Servo")
  local installed
  installed=$(arduino-cli lib list 2>/dev/null || true)
  for lib in "${libs[@]}"; do
    if echo "$installed" | grep -qi "^$lib "; then continue; fi
    yellow "Installing library: $lib"
    arduino-cli lib install "$lib"
  done
}

ensure_toolchain() {
  ensure_arduino_cli
  ensure_esp32_core
  ensure_libs
}

cmd_compile() {
  ensure_toolchain
  green "Compiling..."
  arduino-cli compile --fqbn "$FQBN" "$SKETCH_DIR"
  green "Compile OK"
}

cmd_upload() {
  ensure_toolchain
  local port; port=$(detect_port)
  green "Compiling..."
  arduino-cli compile --fqbn "$FQBN" "$SKETCH_DIR"
  green "Uploading to $port @ ${UPLOAD_SPEED} baud..."
  arduino-cli upload --fqbn "$FQBN" -p "$port" \
    --upload-property "upload.speed=${UPLOAD_SPEED}" \
    "$SKETCH_DIR"
  green "Upload OK"
}

cmd_monitor() {
  local port; port=$(detect_port)
  green "Opening serial monitor on $port @ ${BAUD} baud (Ctrl+C to exit)..."
  arduino-cli monitor -p "$port" -c "baudrate=$BAUD"
}

cmd_erase() {
  ensure_toolchain
  local port; port=$(detect_port)

  # Find an esptool: PATH first, then the one bundled with the ESP32 core,
  # then `brew install esptool` as a last resort. Avoids `pip install` which
  # macOS blocks on system Python (PEP 668 externally-managed-environment).
  local esptool_bin=""
  if command -v esptool >/dev/null 2>&1; then
    esptool_bin="esptool"
  elif command -v esptool.py >/dev/null 2>&1; then
    esptool_bin="esptool.py"
  else
    local bundled
    bundled=$(find "$HOME/Library/Arduino15/packages/esp32/tools/esptool_py" \
      -maxdepth 4 -type f \( -name esptool -o -name esptool.py \) 2>/dev/null \
      | head -n1)
    if [[ -n "$bundled" ]]; then
      esptool_bin="$bundled"
    else
      yellow "esptool not found — installing via Homebrew..."
      command -v brew >/dev/null 2>&1 || die "Homebrew not installed; install from https://brew.sh"
      brew install esptool
      esptool_bin="esptool"
    fi
  fi

  yellow "Erasing entire flash (NVS + sketch) on $port using: $esptool_bin"
  "$esptool_bin" --port "$port" erase_flash
  green "Erase OK — flash is blank, run './tools/flash.sh' to re-upload"
}

cmd_all() {
  cmd_upload
  cmd_monitor
}

main() {
  case "${1:-all}" in
    compile)  cmd_compile ;;
    upload)   cmd_upload ;;
    monitor)  cmd_monitor ;;
    erase)    cmd_erase ;;
    all|"")   cmd_all ;;
    *)        die "unknown command: $1 (use: compile|upload|monitor|erase|all)" ;;
  esac
}

main "$@"
