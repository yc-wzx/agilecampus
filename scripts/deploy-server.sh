#!/usr/bin/env bash
# Run via SSH with sudo. Accept only our uploaded, checksum-verified Linux package.
set -euo pipefail
test "$(id -u)" -eq 0
upload="$(cd -- "$(dirname -- "$0")" && pwd)"
app=/opt/agilecampus
runtime=/opt/agilecampus-runtime
revision="$(tr -d '\r\n' < "$upload/revision.txt")"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
test ! -L "$app"
test ! -L "$runtime"
(cd "$upload" && sha256sum -c SHA256SUMS)
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git ca-certificates curl xz-utils docker.io docker-compose-v2
systemctl enable --now docker

# Portable Node installation: do not replace a pre-existing system Node version.
node_version=22.23.3
node_archive="node-v$node_version-linux-x64.tar.xz"
install -d -m 755 "$runtime"
if ! test -x "$runtime/node/bin/node"; then
  curl -fL --retry 3 "https://nodejs.org/dist/v$node_version/$node_archive" -o "$upload/$node_archive"
  curl -fL --retry 3 "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "$upload/node-checksums.txt"
  (cd "$upload" && awk -v name="$node_archive" '$2 == name {print}' node-checksums.txt > node-selected-checksum && test -s node-selected-checksum && sha256sum -c node-selected-checksum)
  install -d -m 755 "$runtime/node"
  tar -xJf "$upload/$node_archive" --strip-components=1 -C "$runtime/node"
fi
node="$runtime/node/bin/node"
"$node" -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'

if test -d "$app/.git"; then
  test "$(git -C "$app" remote get-url origin)" = 'https://github.com/yc-wzx/agilecampus.git'
  test -z "$(git -C "$app" status --porcelain --untracked-files=no)"
  git -C "$app" fetch origin
else
  test ! -e "$app"
  git clone https://github.com/yc-wzx/agilecampus.git "$app"
fi
git -C "$app" checkout --detach "$revision"
if test -f "$app/.env"; then
  cp -p "$app/.env" "$app/.env.pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)"
fi
install -m 600 "$upload/production.env" "$app/.env"
docker load -i "$upload/images.tar.gz"
cd "$app"
"$node" scripts/ops.mjs release --prebuilt
"$node" scripts/ops.mjs status
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'
printf 'Release installed: %s\n' "$revision"
