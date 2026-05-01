#!/usr/bin/env bash
# setup-venv.sh - Auto-create and install all 3 venvs from their requirements.txt
# Run from repo root: bash scripts/setup-venv.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "[setup] Repo root: $REPO_ROOT"

create_venv() {
    local DIR="$1"
    local REQ_FILE="$2"
    local LABEL="$3"

    echo ""
    echo "=== Setting up $LABEL venv in $DIR ==="

    if [[ ! -f "$REQ_FILE" ]]; then
        echo "[WARN] requirements.txt not found at $REQ_FILE - skipping"
        return 1
    fi

    if [[ ! -d "$DIR/venv" ]]; then
        echo "[setup] Creating venv at $DIR/venv..."
        python3 -m venv "$DIR/venv"
    else
        echo "[setup] venv already exists at $DIR/venv"
    fi

    local PIP="$DIR/venv/bin/pip"
    if [[ ! -x "$PIP" ]]; then
        PIP="$DIR/venv/Scripts/pip.exe"  # Windows fallback
    fi

    echo "[setup] Installing requirements..."
    "$PIP" install -r "$REQ_FILE"
    echo "[setup] Done: $LABEL"
}

# 1. dapp
create_venv "$REPO_ROOT/dapp" "$REPO_ROOT/dapp/requirements.txt" "dapp"

# 2. pipeline
create_venv "$REPO_ROOT/pipeline" "$REPO_ROOT/pipeline/requirements.txt" "pipeline"

# 3. veridex
create_venv "$REPO_ROOT/veridex" "$REPO_ROOT/veridex/requirements.txt" "veridex"

echo ""
echo "[setup] All venvs ready."
echo "[setup] Activate: source <dir>/venv/bin/activate  (or Scripts\activate on Windows)"
