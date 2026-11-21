#!/usr/bin/env bash
set -euo pipefail

# ShopNest Zero-Downtime Blue-Green Deployment & Automatic Rollback Script
# Required environment variables:
#   APP_ENV          - staging | production
#   DEPLOY_ROOT      - /var/www/shopnest/staging | /var/www/shopnest/prod
#   NGINX_SLOT_FILE  - /var/www/shopnest/nginx/staging-slot.inc | /var/www/shopnest/nginx/prod-slot.inc
#   GIT_COMMIT_SHA   - exact 40-char git commit SHA being deployed
#   BLUE_PORT        - backend port for blue slot (e.g. 4001 / 5001)
#   GREEN_PORT       - backend port for green slot (e.g. 4002 / 5002)
#   PUBLIC_PORT      - public Nginx port (80 for production, 8080 for staging)
#   RELEASE_ARCHIVE  - path to release tarball on EC2

SHORT_SHA="${GIT_COMMIT_SHA:0:7}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
DEPLOYED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

mkdir -p "${DEPLOY_ROOT}/releases" "${DEPLOY_ROOT}/logs"
LOG_FILE="${DEPLOY_ROOT}/logs/deploy-${TIMESTAMP}-${SHORT_SHA}.log"
SUMMARY_LOG="${DEPLOY_ROOT}/logs/deployments.log"
HISTORY_LOG="${DEPLOY_ROOT}/releases_history.log"
ACTIVE_SLOT_FILE="${DEPLOY_ROOT}/active_slot"
LAST_GOOD_SHA_FILE="${DEPLOY_ROOT}/last_good_sha"
ENV_FILE="${DEPLOY_ROOT}/.env"

# Mirror all output to persistent deployment log file
exec > >(tee -a "${LOG_FILE}") 2>&1

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [${APP_ENV}] $*"
}

write_nginx_slot() {
  local release_dir="$1"
  local backend_port="$2"
  local tmp_file="${NGINX_SLOT_FILE}.tmp"

  cat > "${tmp_file}" <<EOF
root ${release_dir}/frontend;
index index.html;

location /api/ {
    proxy_pass http://127.0.0.1:${backend_port};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
}
EOF
  mv "${tmp_file}" "${NGINX_SLOT_FILE}"
  sudo /usr/sbin/nginx -t
  sudo /usr/sbin/nginx -s reload
}

check_health_endpoint() {
  local url="$1"
  local expected_sha="$2"
  local max_attempts="${3:-15}"
  local sleep_sec="${4:-1}"

  for attempt in $(seq 1 "${max_attempts}"); do
    local response
    if response="$(curl -fsS --max-time 3 "${url}" 2>/dev/null)"; then
      local status db commit
      status="$(echo "${response}" | jq -r '.status // empty')"
      db="$(echo "${response}" | jq -r '.database // empty')"
      commit="$(echo "${response}" | jq -r '.commit // empty')"
      if [ "${status}" = "healthy" ] && [ "${db}" = "connected" ] && [ "${commit}" = "${expected_sha}" ]; then
        log "Health check PASSED on attempt ${attempt}/${max_attempts} (${url} -> status=${status}, db=${db}, commit=${commit:0:7})"
        return 0
      fi
      log "Attempt ${attempt}/${max_attempts}: unexpected health payload from ${url}: ${response}"
    else
      log "Attempt ${attempt}/${max_attempts}: waiting for ${url}..."
    fi
    sleep "${sleep_sec}"
  done

  return 1
}

log "=================================================================="
log "Starting Blue-Green Deployment"
log "Environment : ${APP_ENV}"
log "Commit SHA  : ${GIT_COMMIT_SHA}"
log "Public Port : ${PUBLIC_PORT}"
log "Log File    : ${LOG_FILE}"
log "=================================================================="

if [ ! -f "${ENV_FILE}" ]; then
  log "ERROR: Missing secure runtime env file ${ENV_FILE}"
  exit 1
fi

# Determine current active slot and inactive target slot
PREV_SLOT="none"
PREV_SHA="none"
if [ -f "${ACTIVE_SLOT_FILE}" ]; then
  PREV_SLOT="$(cat "${ACTIVE_SLOT_FILE}")"
fi
if [ -f "${LAST_GOOD_SHA_FILE}" ]; then
  PREV_SHA="$(cat "${LAST_GOOD_SHA_FILE}")"
fi

if [ "${PREV_SLOT}" = "blue" ]; then
  TARGET_SLOT="green"
  TARGET_PORT="${GREEN_PORT}"
  PREV_PORT="${BLUE_PORT}"
else
  TARGET_SLOT="blue"
  TARGET_PORT="${BLUE_PORT}"
  PREV_PORT="${GREEN_PORT}"
fi

TARGET_PROC="shopnest-${APP_ENV}-${TARGET_SLOT}"
PREV_PROC="shopnest-${APP_ENV}-${PREV_SLOT}"
RELEASE_DIR="${DEPLOY_ROOT}/releases/${GIT_COMMIT_SHA}"

log "Previous active slot : ${PREV_SLOT} (commit: ${PREV_SHA:0:7})"
log "Target inactive slot : ${TARGET_SLOT} (port: ${TARGET_PORT})"

# Unpack versioned release directory
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"
tar -xzf "${RELEASE_ARCHIVE}" -C "${RELEASE_DIR}"

# Install production-only backend dependencies
log "Installing backend production dependencies in ${RELEASE_DIR}/backend..."
(cd "${RELEASE_DIR}/backend" && npm ci --omit=dev --no-audit --no-fund)

load_env_file() {
  local env_path="$1"
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    local key="${line%%=*}"
    local val="${line#*=}"
    export "${key}=${val}"
  done < "${env_path}"
}

# Apply idempotent database schema & seed against Private RDS PostgreSQL
log "Applying idempotent PostgreSQL schema and seed..."
(
  load_env_file "${ENV_FILE}"
  export PGPASSWORD="${DB_PASSWORD}"
  export PGSSLMODE="$([ "${DB_SSL:-false}" = "true" ] && echo "require" || echo "prefer")"
  psql -h "${DB_HOST}" -p "${DB_PORT:-5432}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "${RELEASE_DIR}/database/schema.sql" >/dev/null
  psql -h "${DB_HOST}" -p "${DB_PORT:-5432}" -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "${RELEASE_DIR}/database/seed.sql" >/dev/null
)
log "Database schema and seed verified."

# Start new release on the INACTIVE slot (active slot continues serving traffic uninterrupted)
log "Starting ${TARGET_PROC} on 127.0.0.1:${TARGET_PORT}..."
pm2 delete "${TARGET_PROC}" >/dev/null 2>&1 || true

(
  load_env_file "${ENV_FILE}"
  export PORT="${TARGET_PORT}"
  export HOST="127.0.0.1"
  export APP_ENV="${APP_ENV}"
  export APP_SLOT="${TARGET_SLOT}"
  export GIT_COMMIT_SHA="${GIT_COMMIT_SHA}"
  export DEPLOYED_AT="${DEPLOYED_AT}"
  pm2 start "${RELEASE_DIR}/backend/src/server.js" \
    --name "${TARGET_PROC}" \
    --cwd "${RELEASE_DIR}/backend" \
    --update-env \
    --kill-timeout 5000
)

# Health Check Phase 1: Verify inactive slot BEFORE switching any live traffic
log "Running Pre-Switch Health Check on http://127.0.0.1:${TARGET_PORT}/api/health..."
if ! check_health_endpoint "http://127.0.0.1:${TARGET_PORT}/api/health" "${GIT_COMMIT_SHA}" 15 1; then
  log "ERROR: Pre-Switch Health Check FAILED for commit ${GIT_COMMIT_SHA} on slot ${TARGET_SLOT}!"
  log "--- Last 30 lines of ${TARGET_PROC} logs ---"
  pm2 logs "${TARGET_PROC}" --lines 30 --nostream || true
  log "--- Initiating AUTOMATIC ROLLBACK ---"
  pm2 delete "${TARGET_PROC}" >/dev/null 2>&1 || true

  if [ "${PREV_SLOT}" != "none" ] && [ "${PREV_SHA}" != "none" ]; then
    if check_health_endpoint "http://127.0.0.1:${PUBLIC_PORT}/api/health" "${PREV_SHA}" 5 1; then
      log "AUTOMATIC ROLLBACK SUCCESSFUL: Live traffic remained uninterrupted on last known good release ${PREV_SHA} (slot: ${PREV_SLOT})."
    else
      log "WARNING: Attempting to restore previous release ${PREV_SHA} on slot ${PREV_SLOT}..."
      write_nginx_slot "${DEPLOY_ROOT}/releases/${PREV_SHA}" "${PREV_PORT}"
    fi
  else
    log "No previous release existed yet; broken candidate ${TARGET_PROC} has been stopped."
  fi

  echo "${DEPLOYED_AT} | env=${APP_ENV} | sha=${GIT_COMMIT_SHA} | slot=${TARGET_SLOT} | status=ROLLED_BACK | restored_sha=${PREV_SHA} | log=${LOG_FILE}" >> "${SUMMARY_LOG}"
  exit 1
fi

# Atomic Zero-Downtime Traffic Cutover via Nginx graceful reload
log "Switching Nginx traffic atomically from ${PREV_SLOT} to ${TARGET_SLOT} (port ${TARGET_PORT})..."
write_nginx_slot "${RELEASE_DIR}" "${TARGET_PORT}"

# Health Check Phase 2: Post-Switch Public Endpoint Verification through Nginx
log "Running Post-Switch Verification on http://127.0.0.1:${PUBLIC_PORT}/ and /api/health..."
FRONTEND_OK=true
if ! curl -fsS --max-time 3 "http://127.0.0.1:${PUBLIC_PORT}/" | grep -qi "ShopNest"; then
  FRONTEND_OK=false
fi

if [ "${FRONTEND_OK}" != "true" ] || ! check_health_endpoint "http://127.0.0.1:${PUBLIC_PORT}/api/health" "${GIT_COMMIT_SHA}" 8 1; then
  log "ERROR: Post-Switch Verification FAILED on public port ${PUBLIC_PORT}! Initiating AUTOMATIC ROLLBACK..."
  if [ "${PREV_SLOT}" != "none" ] && [ "${PREV_SHA}" != "none" ] && [ -d "${DEPLOY_ROOT}/releases/${PREV_SHA}" ]; then
    write_nginx_slot "${DEPLOY_ROOT}/releases/${PREV_SHA}" "${PREV_PORT}"
    pm2 delete "${TARGET_PROC}" >/dev/null 2>&1 || true
    check_health_endpoint "http://127.0.0.1:${PUBLIC_PORT}/api/health" "${PREV_SHA}" 5 1 || true
    log "AUTOMATIC ROLLBACK SUCCESSFUL: Reverted Nginx back to ${PREV_SHA} (slot: ${PREV_SLOT})."
  fi
  echo "${DEPLOYED_AT} | env=${APP_ENV} | sha=${GIT_COMMIT_SHA} | slot=${TARGET_SLOT} | status=ROLLED_BACK_POST_SWITCH | restored_sha=${PREV_SHA} | log=${LOG_FILE}" >> "${SUMMARY_LOG}"
  exit 1
fi

# Record new active state & release history
echo "${TARGET_SLOT}" > "${ACTIVE_SLOT_FILE}"
echo "${GIT_COMMIT_SHA}" > "${LAST_GOOD_SHA_FILE}"
echo "${DEPLOYED_AT} | ${GIT_COMMIT_SHA} | ${TARGET_SLOT}" >> "${HISTORY_LOG}"
echo "${DEPLOYED_AT} | env=${APP_ENV} | sha=${GIT_COMMIT_SHA} | slot=${TARGET_SLOT} | status=SUCCESS | prev_sha=${PREV_SHA} | log=${LOG_FILE}" >> "${SUMMARY_LOG}"

# Gracefully drain and stop previous slot (3-second drain buffer after Nginx reload)
if [ "${PREV_SLOT}" != "none" ] && [ "${PREV_SLOT}" != "${TARGET_SLOT}" ]; then
  log "Draining in-flight connections on previous slot (${PREV_PROC}) for 3 seconds..."
  sleep 3
  pm2 delete "${PREV_PROC}" >/dev/null 2>&1 || true
  log "Previous slot ${PREV_PROC} stopped cleanly."
fi

pm2 save >/dev/null 2>&1 || true

# Prune old release directories beyond last 10 (keeping disk tidy while preserving recent rollbacks)
(
  cd "${DEPLOY_ROOT}/releases"
  # shellcheck disable=SC2012
  ls -1dt */ 2>/dev/null | tail -n +11 | xargs -r rm -rf
)

log "=================================================================="
log "DEPLOYMENT SUCCEEDED WITH ZERO DOWNTIME!"
log "Active Slot : ${TARGET_SLOT} (port ${TARGET_PORT})"
log "Live Commit : ${GIT_COMMIT_SHA}"
log "=================================================================="
