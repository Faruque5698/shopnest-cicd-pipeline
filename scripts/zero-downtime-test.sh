#!/usr/bin/env bash
set -euo pipefail

# ShopNest Zero-Downtime Verification Script (Part F)
# Usage: bash scripts/zero-downtime-test.sh <BASE_URL> [DURATION_SECONDS]
# Example: bash scripts/zero-downtime-test.sh http://<LIVE_URL> 90

BASE_URL="${1:?Usage: $0 <BASE_URL> [DURATION_SECONDS]}"
DURATION="${2:-90}"
INTERVAL="0.35"

TOTAL=0
SUCCESS=0
FAILED=0
LAST_STATE=""
START_EPOCH="$(date +%s)"
END_EPOCH=$((START_EPOCH + DURATION))

echo "=================================================================="
echo "ShopNest Continuous Zero-Downtime Verification"
echo "Target URL : ${BASE_URL}"
echo "Duration   : ${DURATION}s (polling every ${INTERVAL}s)"
echo "Started At : $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=================================================================="

while [ "$(date +%s)" -lt "${END_EPOCH}" ]; do
  TOTAL=$((TOTAL + 1))
  TS="$(date -u +"%H:%M:%S")"

  HTTP_CODE="$(curl -sS -o /tmp/shopnest_zd_health.json -w "%{http_code}" --max-time 3 "${BASE_URL}/api/health" 2>/dev/null || echo "000")"
  FRONT_CODE="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 "${BASE_URL}/" 2>/dev/null || echo "000")"

  if [ "${HTTP_CODE}" = "200" ] && [ "${FRONT_CODE}" = "200" ]; then
    SUCCESS=$((SUCCESS + 1))
    COMMIT="$(jq -r '.shortCommit // "unknown"' /tmp/shopnest_zd_health.json 2>/dev/null || echo "unknown")"
    SLOT="$(jq -r '.slot // "unknown"' /tmp/shopnest_zd_health.json 2>/dev/null || echo "unknown")"
    STATE="${SLOT}@${COMMIT}"

    if [ "${STATE}" != "${LAST_STATE}" ]; then
      echo "[${TS}] #${TOTAL}  HTTP ${HTTP_CODE} (API) / ${FRONT_CODE} (UI)  --> LIVE VERSION TRANSITION: ${LAST_STATE:-initial} -> ${STATE}"
      LAST_STATE="${STATE}"
    elif [ $((TOTAL % 15)) -eq 0 ]; then
      echo "[${TS}] #${TOTAL}  HTTP ${HTTP_CODE} (API) / ${FRONT_CODE} (UI)  | Active: ${STATE} | Failed: ${FAILED}"
    fi
  else
    FAILED=$((FAILED + 1))
    echo "[${TS}] #${TOTAL}  FAILURE! API=${HTTP_CODE}, UI=${FRONT_CODE}"
  fi

  sleep "${INTERVAL}"
done

AVAILABILITY="$(awk "BEGIN { printf \"%.2f\", (${SUCCESS} / (${TOTAL} > 0 ? ${TOTAL} : 1)) * 100 }")"

echo "=================================================================="
echo "Zero-Downtime Verification Summary"
echo "Total Requests : ${TOTAL}"
echo "Succeeded (200): ${SUCCESS}"
echo "Failed         : ${FAILED}"
echo "Availability   : ${AVAILABILITY}%"
echo "Final Active   : ${LAST_STATE}"
echo "=================================================================="

if [ "${FAILED}" -gt 0 ]; then
  exit 1
fi
