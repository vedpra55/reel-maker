#!/usr/bin/env bash
# One-time setup on a Mac:  ./setup.sh
#   Homebrew packages (node, ffmpeg) → npm install → reel doctor --fix
set -euo pipefail
cd "$(dirname "$0")"

say() { printf "\n\033[1;36m▸\033[0m \033[1m%s\033[0m\n" "$1"; }

if [[ "$(uname)" == "Darwin" ]]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required. Install it first (it asks for your password):"
    echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    echo "Then run ./setup.sh again."
    exit 1
  fi
  missing=()
  if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)'; then
    missing+=(node)
  fi
  command -v ffmpeg >/dev/null 2>&1 || missing+=(ffmpeg)
  if ((${#missing[@]})); then
    say "Missing: ${missing[*]}"
    read -r -p "  Install with Homebrew? [y/N] " ok
    if [[ "$ok" =~ ^[Yy] ]]; then brew install "${missing[@]}"; else echo "  Skipped – reel doctor will list them again."; fi
  fi
else
  echo "Not macOS – install node ≥ 20 and ffmpeg with your package manager."
fi

say "Installing project packages"
npm install --no-audit --no-fund

say "Checking everything (reel doctor --fix)"
./reel doctor --fix
