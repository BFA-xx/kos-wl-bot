#!/usr/bin/env bash
#
# One-command deploy: sync local code to the EC2 bot, rebuild, re-register
# slash commands, and restart it. Run from your Mac:
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
  pnpm install >/dev/null 2>&1 || true
  pnpm --filter @kos/db build
  pnpm --filter @kos/bot build
  pnpm deploy:commands
  pm2 restart kos-bot --update-env
  sleep 4
  curl -s --max-time 5 http://127.0.0.1:4000/internal/health; echo
'
echo "✅ Deploy complete."
