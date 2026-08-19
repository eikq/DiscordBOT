#!/usr/bin/env bash
# Install Node.js + Playwright + dedicated Chromium INSIDE Whonix Workstation only.
set -euo pipefail

if [[ ! -e /usr/share/whonix && ! -e /usr/share/anon-ws-base-files ]]; then
  echo "Refusing: this is not a Whonix guest."
  exit 1
fi
if [[ -e /usr/share/anon-gw-base-files ]]; then
  echo "Refusing: run this on Whonix Workstation, not Gateway."
  exit 1
fi

echo "Installing Node.js/npm via Workstation apt (Tor) ..."
sudo apt-get update
sudo apt-get install --no-install-recommends -y nodejs npm ca-certificates

WORKDIR="${HOME}/jarvis-whonix-research-worker"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

cat > package.json <<'EOF'
{
  "name": "jarvis-whonix-research-worker",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "Playwright + dedicated Chromium inside Whonix Workstation only.",
  "scripts": {
    "install-browsers": "playwright install chromium"
  },
  "dependencies": {
    "playwright": "^1.55.0"
  }
}
EOF

npm install
npx playwright install chromium

echo "Guest worker ready. Do not use channel=chrome or channel=msedge."
echo "Do not copy a host Chrome/Edge profile into this VM."
