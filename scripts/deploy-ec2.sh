#!/usr/bin/env bash
#
# One-command deploy: sync local code to the EC2 bot, test, rebuild, register
# global slash commands, restart, and verify scheduler health. Run from your Mac:
#
#   ./scripts/deploy-ec2.sh
#
# Override host/key/path if they change:
#   KEY=~/Downloads/kosraf.pem HOST=ubuntu@1.2.3.4 ./scripts/deploy-ec2.sh
#
set -euo pipefail

KEY="${KEY:-$HOME/Downloads/kosraf.pem}"
HOST="${HOST:-ubuntu@34.207.252.118}"
REMOTE_DIR="${REMOTE_DIR:-~/kos-wl-bot/}"
LOCAL_DIR="${LOCAL_DIR:-$(cd "$(dirname "$0")/.." && pwd)/}"

echo "▶ Syncing code to $HOST ..."
rsync -az \
  --exclude node_modules --exclude .next --exclude dist --exclude .git \
  --exclude '.env' --exclude '.env.*' --exclude generated --exclude '.DS_Store' \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "$LOCAL_DIR" "$HOST:$REMOTE_DIR"

echo "▶ Building & restarting on the server ..."
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$HOST" '
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  cd ~/kos-wl-bot
  pnpm install --frozen-lockfile
  pnpm --filter @kos/db build
  pnpm --filter @kos/bot test
  pnpm --filter @kos/bot build
  pnpm --filter @kos/bot deploy:commands -- --global
  pm2 restart kos-bot --update-env
  for attempt in $(seq 1 20); do
    if health=$(curl -fsS --max-time 5 http://127.0.0.1:4000/internal/health 2>/dev/null); then
      if node -e "const health = JSON.parse(process.argv[1]); if (!health.ok || !health.ready || !health.scheduler?.lastTickAt || health.scheduler.lastTickOk !== true) process.exit(1)" "$health"; then
        echo "$health"
        exit 0
      fi
    fi
    sleep 2
  done
  echo "Bot did not become scheduler-ready within 40 seconds" >&2
  pm2 logs kos-bot --lines 50 --nostream >&2
  exit 1
'
echo "✅ Deploy complete."
