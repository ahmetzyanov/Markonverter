#!/bin/zsh
# One-shot live check: refresh Arc Ozon cookies + localStorage, then run the probe.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$scripts_dir/../../../.."

python3 "$scripts_dir/export_arc_ozon_cookies.py"
node "$scripts_dir/export_arc_ozon_storage_state.mjs"

set -a; source .env.ozon.local; set +a
npm run qa:ozon:live -- "$@"
