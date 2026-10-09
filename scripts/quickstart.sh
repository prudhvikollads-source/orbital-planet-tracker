#!/bin/bash
# ORBITAL quickstart: venv -> deps -> tests -> ETL dry run -> serve the app.
set -e
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/pip -q install -r requirements.txt -r etl/requirements.txt
.venv/bin/python -m pytest tests/ -q
.venv/bin/python etl/fetch.py --check
echo ""
echo "Quickstart OK. Serve the app from the REPO ROOT:"
echo "  python3 -m http.server 8000   # then open http://localhost:8000/web/"
