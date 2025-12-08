#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:-https://localhost:3443}"
WAF_CONTAINER="${WAF_CONTAINER:-waf}"   # nom du service docker compose, utilisé pour récupérer modsec log si possible
TIMEOUT="${TIMEOUT:-5}"

echo "🔒 Testing WAF on ${TARGET} (path-as-is used for LFI tests)"

# helper
do_curl() {
  local method="$1"; shift
  local url="$1"; shift
  local data="${1:-}"; shift || true
  local extra_headers=("$@")
  local tmphead tmpbody
  tmphead="$(mktemp)"
  tmpbody="$(mktemp)"
  local curl_args=(-k -s -S -D "$tmphead" -o "$tmpbody" --max-time "$TIMEOUT")
  # path-as-is only if url contains ../ to avoid accidental normalization
  [[ "$url" == *".."* ]] && curl_args+=(--path-as-is)
  [[ "$method" != "GET" ]] && curl_args+=(-X "$method")
  [[ -n "$data" ]] && curl_args+=(-d "$data")
  for h in "${extra_headers[@]}"; do curl_args+=(-H "$h"); done
  curl "${curl_args[@]}" "$url" || true
  local code
  code="$(awk 'NR==1{print $2}' "$tmphead" 2>/dev/null || echo "000")"
  local server
  server="$(awk 'BEGIN{IGNORECASE=1} /Server:/{print substr($0,index($0,$2))}' "$tmphead" | tr -d '\r' || true)"
  # read body head excerpt
  local body_excerpt
  body_excerpt="$(head -c 1024 "$tmpbody" | sed -n '1,40p')"
  printf "%s\t%s\t%s\n" "$code" "${server:-unknown}" "$body_excerpt"
  echo "$tmphead" "$tmpbody"
}

assert_eq() {
  local name="$1"; local got="$2"; local want="$3"; local tmphead="$4"; local tmpbody="$5"
  if [[ "$got" == "$want" ]]; then
    printf "🔍 %-28s -> %s\n" "$name" "$got"
  else
    printf "🔍 %-28s -> %s (EXPECTED %s)\n" "$name" "$got" "$want"
    echo "---- response headers ----"
    sed -n '1,120p' "$tmphead"
    echo "---- response body (first 1k) ----"
    sed -n '1,200p' "$tmpbody"
    # try to show last modsec audit entries if possible
    if docker compose ps --status running | grep -q "$WAF_CONTAINER"; then
      echo "---- tail /tmp/modsec_audit.log from $WAF_CONTAINER (if exists) ----"
      docker compose exec "$WAF_CONTAINER" sh -lc 'test -f /tmp/modsec_audit.log && tail -n 80 /tmp/modsec_audit.log || echo "no /tmp/modsec_audit.log found"'
    else
      echo "Note: WAF container ($WAF_CONTAINER) not running or docker-compose unavailable"
    fi
    exit 1
  fi
}

# Tests
# GET tests (encoded payloads)
read head body < <(do_curl GET "${TARGET}/?id=1%27%20OR%20%271%27=%271")
code=$(echo "$head" | awk '{print $1}')
assert_eq "SQLi in query" "$code" "403" "$head" "$body"

read head body < <(do_curl GET "${TARGET}/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E")
code=$(echo "$head" | awk '{print $1}')
assert_eq "Reflected XSS" "$code" "403" "$head" "$body"

read head body < <(do_curl GET "${TARGET}/?page=..%2F..%2F..%2F..%2Fetc%2Fpasswd")
code=$(echo "$head" | awk '{print $1}')
assert_eq "LFI path traversal" "$code" "403" "$head" "$body"

# POST Content-Type enforcement test (415 expectation)
read head body < <(do_curl POST "${TARGET}/api/auth/login" '{"x":1}' "Content-Type: text/plain")
code=$(echo "$head" | awk '{print $1}')
assert_eq "POST bad CT -> 415" "$code" "415" "$head" "$body"

# TRACE test
read head body < <(do_curl TRACE "${TARGET}/api/auth/login")
code=$(echo "$head" | awk '{print $1}')
if [[ "$code" == "403" || "$code" == "405" ]]; then
  printf "🔍 %-28s -> %s\n" "TRACE blocked/disabled" "$code"
else
  echo "🔍 TRACE check -> $code (expected 403/405)"; exit 1
fi

echo -e "\n✅ Test suite finished successfully."
