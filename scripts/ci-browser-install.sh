#!/usr/bin/env bash
# Isolated, fail-closed Playwright installation; one engine per runner.
set -Eeuo pipefail
stage=${1:-}
engine=${2:-}
case "$engine" in chromium|webkit) ;; *) echo 'Expected chromium or webkit' >&2; exit 2;; esac
case "$stage" in tooling|dependencies|browser) ;; *) echo 'Expected tooling, dependencies or browser' >&2; exit 2;; esac
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
tooling="$RUNNER_TEMP/travel-book-browser"
logs=${CI_BROWSER_LOG_DIR:-"$RUNNER_TEMP/browser-install-logs"}
mkdir -p "$logs"
exec > >(tee "$logs/$engine-$stage.log") 2>&1
finish() {
  result=$?
  trap - EXIT
  printf '\nFinished %s/%s at %s (exit %s)\n' "$engine" "$stage" "$(date -u +%FT%TZ)" "$result"
  if (( result != 0 )); then
    echo "::error::Browser installation failed: $engine/$stage (exit $result; 124 means timeout). See browser-install-$engine artifact."
    df -h "$RUNNER_TEMP"
    ps -eo pid,ppid,stat,comm
    if [[ -d "$tooling/.npm-logs" ]]; then
      cp -r "$tooling/.npm-logs" "$logs/npm-logs"
    fi
    for log in /var/log/apt/term.log /var/log/apt/history.log; do
      if [[ -r "$log" ]]; then tail -100 "$log"; fi
    done
  fi
  exit "$result"
}
trap finish EXIT
printf 'Starting %s/%s at %s\n' "$engine" "$stage" "$(date -u +%FT%TZ)"
node --version
npm --version
cli="$tooling/node_modules/playwright-core/cli.js"
case "$stage" in
  tooling)
    timeout --signal=TERM --kill-after=10s 180s npm install --prefix "$tooling" --no-package-lock --ignore-scripts --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000 --loglevel=verbose --logs-dir="$tooling/.npm-logs" playwright-core@1.63.0
    node "$cli" --version
    ;;
  dependencies)
    # The original run stalled on the Azure Ubuntu mirror. Use Ubuntu's
    # official HTTPS archive on this disposable hosted runner, preserving pockets.
    for sources in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources /etc/apt/apt-mirrors.txt; do
      if [[ -f "$sources" ]]; then
        sudo sed -i -E 's#https?://azure.archive.ubuntu.com/ubuntu#https://archive.ubuntu.com/ubuntu#g' "$sources"
      fi
    done
    # Bound apt mirror/lock stalls as well as the complete install-deps process.
    printf 'Acquire::Retries "2";\nAcquire::http::Timeout "20";\nAcquire::https::Timeout "20";\nDPkg::Lock::Timeout "60";\n' | sudo tee /etc/apt/apt.conf.d/99freya-ci-timeouts >/dev/null
    timeout --signal=TERM --kill-after=15s 360s sudo env DEBIAN_FRONTEND=noninteractive node "$cli" install-deps "$engine"
    ;;
  browser)
    export PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=${PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:-30000}
    timeout --signal=TERM --kill-after=10s 240s node "$cli" install "$engine"
    # Installation alone does not prove that shared libraries and launch work.
    timeout --signal=TERM --kill-after=5s 30s node --input-type=module - "$tooling" "$engine" <<'JS'
import {pathToFileURL} from 'node:url';
const pw=await import(pathToFileURL(process.argv[2]+'/node_modules/playwright-core/index.mjs'));
const browser=await pw[process.argv[3]].launch({headless:true});
try {const page=await browser.newPage();await page.setContent('<title>Freya CI</title>');if(await page.title()!=='Freya CI')throw Error('Browser smoke test failed');console.log('PASS installed browser launch: '+process.argv[3]);} finally {await browser.close();}
JS
    ;;
esac
