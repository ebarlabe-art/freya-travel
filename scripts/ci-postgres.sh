#!/usr/bin/env bash
set -euo pipefail

action="${1:-start}"
container="${2:-freya_alb02_ci}"
image="${FREYA_CI_POSTGRES_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.165}"
password="${FREYA_CI_POSTGRES_PASSWORD:-local-alb02-test-only}"

diagnose() {
  echo "== Docker state: $container =="
  docker inspect "$container" --format 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}' 2>&1 || true
  echo "== PostgreSQL logs: $container =="
  docker logs --tail 200 "$container" 2>&1 || true
}

wait_ready() {
  # The Supabase image starts a temporary Unix-socket-only PostgreSQL during
  # initialization and then stops it. TCP readiness signals the final server.
  local ready=0
  for attempt in $(seq 1 60); do
    if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
      ready=1
      break
    fi
    state="$(docker inspect "$container" --format '{{.State.Status}}' 2>/dev/null || true)"
    if [ "$state" = "exited" ] || [ "$state" = "dead" ]; then
      echo "PostgreSQL stopped during startup (attempt $attempt)."
      diagnose
      docker start "$container" >/dev/null 2>&1 || true
    fi
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    echo "PostgreSQL did not become ready."
    diagnose
    return 1
  fi
}

case "$action" in
  start)
    docker rm -f "$container" >/dev/null 2>&1 || true

    pulled=0
    for attempt in 1 2 3 4; do
      if docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"; then
        pulled=1
        break
      fi
      if [ "$attempt" -lt 4 ]; then
        delay=$((attempt * 15))
        echo "Image pull failed (attempt $attempt/4). Retrying in ${delay}s..."
        sleep "$delay"
      fi
    done
    if [ "$pulled" -ne 1 ]; then
      echo "Could not obtain PostgreSQL image after retries."
      exit 1
    fi

    docker run -d       --name "$container"       --restart on-failure:3       --shm-size=256m       -e POSTGRES_PASSWORD="$password"       "$image" >/dev/null

    wait_ready

    docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
SQL
    echo "PostgreSQL ready in $container."
    ;;
  check)
    if ! docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
      echo "PostgreSQL is not ready."
      diagnose
      exit 1
    fi
    ;;
  diagnose)
    diagnose
    ;;
  stop)
    docker rm -f "$container" >/dev/null 2>&1 || true
    ;;
  *)
    echo "Usage: $0 {start|check|diagnose|stop} [container]" >&2
    exit 2
    ;;
esac
