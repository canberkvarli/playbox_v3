#!/bin/sh
# Build + run the Playbox signing-core host test.
# Tries cc, then clang, then gcc. Exits non-zero on compile or test failure.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${TMPDIR:-/tmp}/playbox_sign_test"

CC=""
for c in cc clang gcc; do
  if command -v "$c" >/dev/null 2>&1; then
    CC="$c"
    break
  fi
done

if [ -z "$CC" ]; then
  echo "ERROR: no C compiler found (tried cc, clang, gcc)" >&2
  exit 127
fi

echo "Using compiler: $CC"
"$CC" -std=c99 -Wall -Wextra -O2 -o "$OUT" \
  "$DIR/test_sign.c" \
  "$DIR/../crypto/playbox_sign.c" \
  "$DIR/../crypto/sha256.c"

echo "Built: $OUT"
echo "Running..."
"$OUT"
