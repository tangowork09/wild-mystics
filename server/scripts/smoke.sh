#!/usr/bin/env bash
# End-to-end smoke test of the Wild Mystics API over real HTTP (curl).
#
#   npm run dev            # terminal 1: wrangler dev --local on :8787 (after npm run db:migrate:local)
#   npm run smoke          # terminal 2
#   API=https://wild-mystics-api.<subdomain>.workers.dev npm run smoke   # a deployment (creates a throwaway account)
#
# Exits non-zero if any response has an unexpected status.
set -uo pipefail

API="${API:-http://localhost:8787}"
STAMP="$(date +%s)"
NAME="smoke_${STAMP}"
EMAIL="${NAME}@example.com"
PASSWORD="smoke-test-password"
IP="198.51.100.$((STAMP % 200 + 20))"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILURES=0
STATUS=""
BODY=""

# request METHOD PATH [JSON] [TOKEN] [EXTRA CURL ARGS...]  -> sets STATUS, BODY
request() {
  local method=$1 path=$2 data=${3:-} token=${4:-}
  shift 4 2>/dev/null || shift $#
  local args=(-s -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' -X "$method" -H "CF-Connecting-IP: $IP")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' --data-binary "$data")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  STATUS=$(curl "${args[@]}" "$@" "$API$path")
  BODY=$(cat "$TMP/body")
}

# check EXPECTED LABEL
check() {
  local expected=$1 label=$2 shown="$BODY"
  ((${#shown} > 150)) && shown="${shown:0:150}..."
  if [[ "$STATUS" == "$expected" ]]; then
    printf 'ok    %-58s %s %s\n' "$label" "$STATUS" "$shown"
  else
    printf 'FAIL  %-58s %s (expected %s) %s\n' "$label" "$STATUS" "$expected" "$shown"
    FAILURES=$((FAILURES + 1))
  fi
}

field() { node -e 'const v=JSON.parse(process.argv[1]);console.log(process.argv[2].split(".").reduce((o,k)=>o==null?o:o[k],v)??"")' "$BODY" "$1"; }
header() { grep -i "^$1:" "$TMP/headers" | head -1 | cut -d' ' -f2- | tr -d '\r'; }

echo "API: $API   user: $NAME"

request GET /api/health
check 200 "GET  /api/health"

request OPTIONS /api/save "" "" -H 'Origin: capacitor://localhost' -H 'Access-Control-Request-Method: PUT' -H 'Access-Control-Request-Headers: authorization,content-type'
BODY="allow-origin=$(header access-control-allow-origin) methods=$(header access-control-allow-methods) headers=$(header access-control-allow-headers)"
check 204 "OPTIONS /api/save (Origin: capacitor://localhost)"

request POST /api/auth/signup "{\"username\":\"$NAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
check 201 "POST /api/auth/signup"
TOKEN=$(field token)

request POST /api/auth/signup "{\"username\":\"$(echo "$NAME" | tr a-z A-Z)\",\"password\":\"$PASSWORD\"}"
check 409 "POST /api/auth/signup (same username, other case)"

request POST /api/auth/signup "{\"username\":\"${NAME}x\",\"password\":\"short\"}"
check 400 "POST /api/auth/signup (weak password)"

request POST /api/auth/login "{\"login\":\"$(echo "$EMAIL" | tr a-z A-Z)\",\"password\":\"$PASSWORD\"}"
check 200 "POST /api/auth/login (email, other case) = second device"
TOKEN2=$(field token)

request POST /api/auth/login "{\"login\":\"$NAME\",\"password\":\"wrong-password\"}"
check 401 "POST /api/auth/login (wrong password)"

request GET /api/me "" "$TOKEN"
check 200 "GET  /api/me"

request GET /api/me
check 401 "GET  /api/me (no token)"

request GET /api/save "" "$TOKEN"
check 404 "GET  /api/save (nothing saved yet)"

request PUT /api/save '{"data":"{\"team\":[\"emberling\"]}","baseVersion":0}' "$TOKEN"
check 200 "PUT  /api/save baseVersion 0 (device 1)"

request PUT /api/save '{"data":"{\"team\":[\"emberling\",\"gloop\"]}","baseVersion":1}' "$TOKEN2"
check 200 "PUT  /api/save baseVersion 1 (device 2)"

request PUT /api/save '{"data":"{\"team\":[]}","baseVersion":1}' "$TOKEN"
check 409 "PUT  /api/save stale baseVersion 1 (device 1)"

request GET /api/save "" "$TOKEN"
check 200 "GET  /api/save"

node -e 'process.stdout.write(JSON.stringify({data:"a".repeat(2700000),baseVersion:2}))' > "$TMP/big.json"
request PUT /api/save "" "$TOKEN" -H 'Content-Type: application/json' --data-binary "@$TMP/big.json"
check 413 "PUT  /api/save (2.7 MB body)"

request POST /api/auth/logout "" "$TOKEN"
check 200 "POST /api/auth/logout (device 1)"

request GET /api/me "" "$TOKEN"
check 401 "GET  /api/me (device 1 after logout)"

request GET /api/me "" "$TOKEN2"
check 200 "GET  /api/me (device 2 still signed in)"

IP="203.0.113.$((STAMP % 200 + 20))"
for i in $(seq 1 10); do request POST /api/auth/login "{\"login\":\"$NAME\",\"password\":\"bad-$i\"}"; done
check 401 "POST /api/auth/login x10 wrong (fresh IP): 10th"
request POST /api/auth/login "{\"login\":\"$NAME\",\"password\":\"$PASSWORD\"}"
BODY="retry-after=$(header retry-after) $BODY"
check 429 "POST /api/auth/login 11th (right password, throttled)"

echo
if ((FAILURES > 0)); then
  echo "$FAILURES check(s) failed"
  exit 1
fi
echo "All checks passed."
