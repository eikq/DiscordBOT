#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$BUNDLE_ROOT"

if ! command -v python3.12 >/dev/null 2>&1; then
  echo "Python 3.12 is required. Choose a Vast.ai PyTorch/Ubuntu 24.04 template with Python 3.12."
  exit 1
fi

if [ ! -d .vast-venv ]; then
  python3.12 -m venv .vast-venv
fi

source .vast-venv/bin/activate
export RVC_ROOT="${RVC_ROOT:-$BUNDLE_ROOT/.runtime/Retrieval-based-Voice-Conversion-WebUI}"
python scripts/bootstrap_training.py
python scripts/run_training.py
