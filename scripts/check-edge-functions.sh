#!/usr/bin/env bash
# Typecheck the Supabase edge functions.
#
# tsconfig.app.json is include: ["src"], so `tsc -b` never sees this directory —
# these files shipped unchecked. A call missing its `method` argument reached
# production that way: the bot token landed in the HTTP method slot and every
# request threw. The edge runtime doesn't typecheck either, so nothing caught it.
#
# noImplicitAny is off on purpose: the supabase client is imported from a URL
# tsc can't resolve, so its values degrade to `any` and would otherwise bury the
# real diagnostics. Argument counts and types — the class of bug above — are
# still fully checked.
set -uo pipefail
cd "$(dirname "$0")/.."

raw=$(npx tsc --noEmit --strict --noImplicitAny false --skipLibCheck \
  --allowImportingTsExtensions --target es2022 --module esnext \
  --moduleResolution bundler \
  supabase/functions/deno.d.ts supabase/functions/*/index.ts 2>&1 || true)

# The remote import is the one thing that legitimately cannot resolve here.
real=$(printf '%s\n' "$raw" | grep -v "Cannot find module 'https" | grep -v '^[[:space:]]*$')

if [ -n "$real" ]; then
  printf '%s\n' "$real"
  echo
  echo "edge-function typecheck FAILED"
  exit 1
fi
echo "edge functions: typecheck clean"
