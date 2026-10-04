#!/usr/bin/env bash
# Deploy the pushed HEAD commit to the live-trans server as a new release.
# Usage: scripts/deploy.sh [--yes]
#   --yes  skip the confirmation (restart ends every session held in RAM)
# Overridable env: DEPLOY_HOST, DEPLOY_ROOT, DEPLOY_NODE_BIN, DEPLOY_URL, DEPLOY_KEEP (releases kept, incl. current)
set -euo pipefail

HOST="${DEPLOY_HOST:-hapo_gateway_stg}"
ROOT="${DEPLOY_ROOT:-/home/ubuntu/live-trans}"
NODE_BIN="${DEPLOY_NODE_BIN:-/home/ubuntu/.nvm/versions/node/v24.15.0/bin}"
URL="${DEPLOY_URL:-https://live.hapo.work}"
KEEP="${DEPLOY_KEEP:-5}"
PATHS=(README.md package.json package-lock.json deploy docs public scripts server test)

cd "$(git rev-parse --show-toplevel)"
fail() { echo "deploy: $*" >&2; exit 1; }

# Only committed, pushed code is deployed, so a release always maps to a commit on GitHub.
git diff --quiet HEAD -- "${PATHS[@]}" || fail "có thay đổi chưa commit trong ${PATHS[*]}"
git fetch -q origin
git branch -r --contains HEAD | grep -q . || fail "HEAD chưa được push lên origin"
SHA="$(git rev-parse --short=7 HEAD)"
RELEASE="$ROOT/releases/$SHA"

CURRENT="$(ssh "$HOST" "readlink $ROOT/current")"
echo "Đang chạy: ${CURRENT##*/}  →  sẽ deploy: $SHA ($(git log -1 --format=%s HEAD))"
[ "${CURRENT##*/}" = "$SHA" ] && fail "$SHA đã là bản đang chạy"
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Restart sẽ kết thúc mọi phiên đang chạy. Tiếp tục? [y/N] " answer
  [ "$answer" = "y" ] || fail "đã huỷ"
fi

echo "1/4 Upload mã của commit $SHA"
ssh "$HOST" "rm -rf $RELEASE && mkdir -p $RELEASE"
git archive --format=tar HEAD -- "${PATHS[@]}" | ssh "$HOST" "tar -x -C $RELEASE"

echo "2/4 Cài thư viện và kiểm tra trên server"
ssh "$HOST" "set -euo pipefail; export PATH=$NODE_BIN:\$PATH; cd $RELEASE
  npm ci --omit=dev --no-audit --no-fund >/dev/null
  npm run check --silent
  npm test --silent >/tmp/live-trans-deploy-test.log 2>&1 || { tail -30 /tmp/live-trans-deploy-test.log; exit 1; }
  grep -E '^(ℹ|#) (pass|fail) ' /tmp/live-trans-deploy-test.log"

echo "3/4 Chuyển sang $SHA và restart"
# On an unhealthy start, point current back at the previous release before failing.
ssh "$HOST" "set -euo pipefail; cd $ROOT
  PORT=\$(sudo -n grep -E '^PORT=' /etc/live-trans/runtime.env | cut -d= -f2 || true)
  ln -sfn $RELEASE current && sudo -n systemctl restart live-trans
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS -o /dev/null http://127.0.0.1:\${PORT:-4317}/api/health 2>/dev/null && exit 0; sleep 1; done
  echo 'Service không khoẻ, rollback về ${CURRENT##*/}' >&2
  ln -sfn $CURRENT current && sudo -n systemctl restart live-trans
  sudo -n journalctl -u live-trans --since '-1 min' --no-pager | tail -15 >&2
  exit 1"

echo "4/4 Kiểm tra qua $URL và dọn release cũ (giữ $KEEP bản)"
curl -fsS "$URL/api/health" >/dev/null || fail "$URL/api/health không phản hồi"
ssh "$HOST" "cd $ROOT/releases && ls -1t | grep -E '^[0-9a-f]{7,40}\$' | grep -vx -e '$SHA' -e '${CURRENT##*/}' | tail -n +$((KEEP - 1)) | xargs -r rm -rf"
echo "Xong: $SHA đang chạy. Rollback: ssh $HOST 'ln -sfn $CURRENT $ROOT/current && sudo -n systemctl restart live-trans'"
