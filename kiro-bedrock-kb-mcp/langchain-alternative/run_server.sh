#!/usr/bin/env bash
# Wrapper script to launch the LangChain MCP server with the correct venv Python.
# This resolves the absolute path dynamically so mcp.json can use a stable reference.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_PYTHON="$SCRIPT_DIR/.venv/bin/python"

if [ ! -f "$VENV_PYTHON" ]; then
  echo "ERROR: Python venv not found at $VENV_PYTHON" >&2
  echo "Run these commands first:" >&2
  echo "  cd $SCRIPT_DIR" >&2
  echo "  python3 -m venv .venv" >&2
  echo "  source .venv/bin/activate" >&2
  echo "  pip install -r requirements.txt" >&2
  exit 1
fi

exec "$VENV_PYTHON" "$SCRIPT_DIR/mcp_server.py" "$@"
