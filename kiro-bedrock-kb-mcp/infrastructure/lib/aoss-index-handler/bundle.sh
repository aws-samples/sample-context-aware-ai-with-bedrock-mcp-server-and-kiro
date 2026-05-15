#!/usr/bin/env bash
set -euo pipefail

# Bundle the Lambda handler with its dependencies.
# Run this before `cdk deploy`. No Docker required.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_DIR="${SCRIPT_DIR}/bundle"

rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

echo "Installing dependencies into bundle/..."
pip3 install \
  -r "${SCRIPT_DIR}/requirements.txt" \
  -t "$BUNDLE_DIR" \
  --platform manylinux2014_x86_64 \
  --only-binary=:all: \
  --python-version 3.12 \
  --quiet 2>/dev/null || \
pip3 install \
  -r "${SCRIPT_DIR}/requirements.txt" \
  -t "$BUNDLE_DIR" \
  --quiet

echo "Copying handler..."
cp "${SCRIPT_DIR}/index.py" "$BUNDLE_DIR/"

echo "Bundle ready at: $BUNDLE_DIR"
