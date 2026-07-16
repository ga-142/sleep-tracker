#!/usr/bin/env sh
set -eu

if [ -x .venv/bin/python ]; then
  PYTHON=.venv/bin/python
else
  PYTHON=python3
fi

"$PYTHON" -m unittest discover -s tests -v
"$PYTHON" -m compileall -q backend tests

for file in frontend/js/*.js; do
  node --check "$file"
done

docker compose config --quiet
echo "All checks passed."
