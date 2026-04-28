#!/usr/bin/env bash
# scripts/lint_pipeline_purity.sh

set -e

PIPELINE_DIR="app/pipeline"
FAIL=0

echo "Checking pipeline purity..."

if grep -r "from app.repositories" "$PIPELINE_DIR/" 2>/dev/null | grep -v "__pycache__"; then
    echo "FAIL: pipeline imports app.repositories — DB must stay in services/repos"
    FAIL=1
fi

if grep -r "supabase" "$PIPELINE_DIR/" 2>/dev/null | grep -v "__pycache__"; then
    echo "FAIL: pipeline imports supabase — storage must stay in services"
    FAIL=1
fi

if grep -r "\.insert\|\.update\|\.delete\|\.upsert" "$PIPELINE_DIR/" 2>/dev/null | grep -v "__pycache__"; then
    echo "FAIL: pipeline contains DB write calls"
    FAIL=1
fi

BANNED=("file_url" "image_path" "visual_dna" "clip_vector" "asset_id" "image_id" "match_score" "confidence")
for name in "${BANNED[@]}"; do
    if grep -r "\"$name\"\|'$name'\| $name " app/ 2>/dev/null | grep -v "__pycache__" | grep -v "migrations/" | grep -v "lint_"; then
        echo "WARN: banned field name '$name' found — use canonical name from contracts.py"
    fi
done

if [ $FAIL -eq 1 ]; then
    echo "Pipeline purity check FAILED."
    exit 1
fi

echo "Pipeline purity check PASSED."