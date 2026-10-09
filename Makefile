.PHONY: install test etl demo quickstart clean
install:
	python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r etl/requirements.txt
test:
	pytest tests/ -q
etl:
	python3 etl/fetch.py
demo:
	cd web && python3 -m http.server 8000
quickstart:
	bash scripts/quickstart.sh
clean:
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; rm -rf .venv .pytest_cache; true
