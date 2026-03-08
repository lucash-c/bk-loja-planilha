#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${BASE_URL:-http://127.0.0.1:4000}}"
RELEASE_ID="${2:-${RELEASE_ID:-}}"
ASSET_PATH="${3:-${ASSET_PATH:-assets/main.js}}"

if [[ -z "$RELEASE_ID" ]]; then
  echo "RELEASE_ID is required (arg2 or env)." >&2
  exit 1
fi

check_redirect_root() {
  local expected_location="/releases/${RELEASE_ID}/"
  local headers
  headers="$(curl -sSI "$BASE_URL/")"
  echo "$headers"

  if ! grep -qiE '^HTTP/.* 30[12]' <<<"$headers"; then
    echo "Root endpoint did not return redirect" >&2
    return 1
  fi

  if ! grep -qi "^location: ${expected_location}$" <<<"$(echo "$headers" | tr -d '\r')"; then
    echo "Root redirect location mismatch. Expected: ${expected_location}" >&2
    return 1
  fi
}

check_ok() {
  local endpoint="$1"
  local headers
  headers="$(curl -sSI "$BASE_URL$endpoint")"
  echo "$headers"

  if ! grep -qiE '^HTTP/.* 200' <<<"$headers"; then
    echo "Endpoint ${endpoint} did not return 200" >&2
    return 1
  fi
}

echo "### curl -I $BASE_URL/"
check_redirect_root

echo "### curl -I $BASE_URL/releases/$RELEASE_ID/index.html"
check_ok "/releases/${RELEASE_ID}/index.html"

echo "### curl -I $BASE_URL/releases/$RELEASE_ID/$ASSET_PATH"
check_ok "/releases/${RELEASE_ID}/${ASSET_PATH}"

echo "Smoke check concluído com sucesso para release ${RELEASE_ID}."
