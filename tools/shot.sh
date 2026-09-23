#!/usr/bin/env bash
# Screenshot an HTML file with headless Chrome.
# Chrome writes the PNG but never exits on macOS, so we background it and poll.
#
#   ./tools/shot.sh <input.html> <output.png> [width] [height] [fullpage]
#
# fullpage: pass "full" to capture the entire scroll height (uses --window-size
#           with a tall viewport; caller should ensure the doc fits).
set -uo pipefail

IN="$1"; OUT="$2"; W="${3:-1440}"; H="${4:-900}"; MODE="${5:-viewport}"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN_ABS="$(cd "$(dirname "$IN")" && pwd)/$(basename "$IN")"
OUT_ABS="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd || { mkdir -p "$(dirname "$OUT")"; cd "$(dirname "$OUT")" && pwd; })/$(basename "$OUT")"
PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/acshot.XXXXXX")"
rm -f "$OUT_ABS"

FLAGS=(
  --headless --disable-gpu --no-sandbox --no-first-run --no-default-browser-check
  --disable-extensions --disable-background-networking --disable-sync
  --disable-features=Translate,BackForwardCache
  --force-device-scale-factor=2
  --hide-scrollbars
  --user-data-dir="$PROFILE"
  --virtual-time-budget=6000
  --window-size="${W},${H}"
  --screenshot="$OUT_ABS"
)

"$CHROME" "${FLAGS[@]}" "file://${IN_ABS}" >/dev/null 2>&1 &
CPID=$!

# poll for the file to appear and stop growing
for _ in $(seq 1 60); do
  if [ -s "$OUT_ABS" ]; then
    S1=$(stat -f%z "$OUT_ABS" 2>/dev/null || echo 0)
    sleep 0.4
    S2=$(stat -f%z "$OUT_ABS" 2>/dev/null || echo 0)
    [ "$S1" = "$S2" ] && [ "$S1" -gt 0 ] && break
  fi
  sleep 0.4
done

kill "$CPID" 2>/dev/null
pkill -f "user-data-dir=$PROFILE" 2>/dev/null
rm -rf "$PROFILE" 2>/dev/null

if [ -s "$OUT_ABS" ]; then
  echo "OK $(basename "$OUT_ABS") $(stat -f%z "$OUT_ABS") bytes"
else
  echo "FAIL no screenshot produced for $IN" >&2; exit 1
fi
