#!/usr/bin/env bash
# 4-chain.sh — runs steps 2–7 of the match chain via curl against prod edge
# functions. Steps 0, 1, 3, 5 are SQL (run via Supabase MCP separately).
#
# Required env vars (see README.md):
#   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
#   HOST_JWT, CAND_JWT, HOST_UID, CAND_UID
#   INST_ID
#
# Captures (printed at end for the executor to capture into env):
#   OFFER_ID, LOCK_ID

set -euo pipefail

req() {
  local jwt="$1" path="$2" body="$3"
  curl -sS -X POST "${SUPABASE_URL}/functions/v1/${path}" \
    -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
    -H "Authorization: Bearer ${jwt}" \
    -H 'Content-Type: application/json' \
    -d "${body}" \
    -w '\n[http=%{http_code}]\n'
}

rest() {
  local jwt="$1" path="$2"
  curl -sS "${SUPABASE_URL}/rest/v1/${path}" \
    -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
    -H "Authorization: Bearer ${jwt}" \
    -w '\n[http=%{http_code}]\n'
}

echo '=== STEP 2: host discovery probe (queue_entries via PostgREST) ==='
rest "$HOST_JWT" "queue_entries?date_instance_id=eq.${INST_ID}&status=eq.interested&select=*"

echo '=== STEP 3: host match-shortlist ==='
req "$HOST_JWT" 'match-shortlist' \
  "{\"instance\":\"${INST_ID}\",\"candidate\":\"${CAND_UID}\",\"rank\":1}"

echo '=== STEP 4: host match-make-offer (capture offer_id) ==='
OFFER_RESP=$(req "$HOST_JWT" 'match-make-offer' \
  "{\"instance\":\"${INST_ID}\",\"candidate\":\"${CAND_UID}\"}" \
  | sed '/^\[http=/d')
echo "$OFFER_RESP"
OFFER_ID=$(echo "$OFFER_RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["offer_id"])')
echo "OFFER_ID=$OFFER_ID"

echo '=== STEP 5: candidate match-accept-offer (capture lock_id) ==='
LOCK_RESP=$(req "$CAND_JWT" 'match-accept-offer' \
  "{\"offer\":\"${OFFER_ID}\"}" \
  | sed '/^\[http=/d')
echo "$LOCK_RESP"
LOCK_ID=$(echo "$LOCK_RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["lock_id"])')
echo "LOCK_ID=$LOCK_ID"

echo '=== STEP 6: both read profiles_select_revealed ==='
echo '--- HOST reads CANDIDATE ---'
rest "$HOST_JWT" "profiles_select_revealed?id=eq.${CAND_UID}&select=id,first_name,clear_photo_url"
echo '--- CANDIDATE reads HOST ---'
rest "$CAND_JWT" "profiles_select_revealed?id=eq.${HOST_UID}&select=id,first_name,clear_photo_url"

echo '=== STEP 7: both insert match_ratings ==='
RATING_BODY_HOST="{\"lock_id\":\"${LOCK_ID}\",\"rater_id\":\"${HOST_UID}\",\"ratee_id\":\"${CAND_UID}\",\"showed_up\":true,\"on_time\":true,\"cancelled_with_notice\":false,\"unsafe_or_disrespectful\":false}"
RATING_BODY_CAND="{\"lock_id\":\"${LOCK_ID}\",\"rater_id\":\"${CAND_UID}\",\"ratee_id\":\"${HOST_UID}\",\"showed_up\":true,\"on_time\":true,\"cancelled_with_notice\":false,\"unsafe_or_disrespectful\":false}"

echo '--- HOST rates CAND ---'
curl -sS -X POST "${SUPABASE_URL}/rest/v1/match_ratings" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${HOST_JWT}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d "$RATING_BODY_HOST" \
  -w '\n[http=%{http_code}]\n'

echo '--- CAND rates HOST ---'
curl -sS -X POST "${SUPABASE_URL}/rest/v1/match_ratings" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${CAND_JWT}" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d "$RATING_BODY_CAND" \
  -w '\n[http=%{http_code}]\n'

echo
echo "=== CAPTURED ==="
echo "OFFER_ID=$OFFER_ID"
echo "LOCK_ID=$LOCK_ID"
echo "Paste these into your env before running 5-verify.sql."
