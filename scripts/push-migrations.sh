#!/usr/bin/env bash
# Applies supabase/migrations/*.sql in filename order against $DATABASE_URL.
# Reads DATABASE_URL from .env.local so the credential never appears on the
# command line (where it would land in shell history and process listings).
set -uo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "FATAL: .env.local not found" >&2; exit 1
fi

DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '\r' | sed 's/^"//; s/"$//')
if [ -z "${DATABASE_URL:-}" ]; then
  echo "FATAL: DATABASE_URL is not set in .env.local" >&2; exit 1
fi

# Optional first arg: only apply migrations at or after this numeric prefix.
START="${1:-000}"

applied=0
skipped=0
for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  if [ "${name%%_*}" \< "$START" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  printf '%-46s' "$name"

  # A file carrying its own BEGIN/COMMIT (041) must not be wrapped again:
  # under --single-transaction the file's COMMIT would close psql's outer
  # transaction early, leaving anything after it running unprotected.
  if grep -qiE '^[[:space:]]*(BEGIN|COMMIT)[[:space:]]*;' "$f"; then
    tx=""
  else
    tx="--single-transaction"
  fi

  if out=$(psql "$DATABASE_URL" --set ON_ERROR_STOP=on $tx --quiet --no-psqlrc -f "$f" 2>&1); then
    echo "OK"
    applied=$((applied + 1))
  else
    echo "FAILED"
    {
      echo "----- $name -----"
      echo "$out" | grep -E '^(psql:|ERROR|DETAIL|HINT|CONTEXT)' | head -20
      echo "-----------------"
      echo "Stopped after $applied successful migration(s); later migrations depend on this one."
    } >&2
    exit 1
  fi
done

echo
echo "Applied $applied migration(s); skipped $skipped already-applied."
