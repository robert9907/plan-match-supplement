#!/usr/bin/env bash
# Fails if any consumer code reads the raw medsup rate tables instead of the
# _public views. Catches both the JS-client pattern (.from('pm_medsup_rate'))
# and the raw PostgREST fetch pattern (/rest/v1/pm_medsup_rate?...).
#
# Migration 005 (2026-07-30) revokes anon SELECT on the base tables, so a
# base-table read from a client-side or anon-key path will 401 in prod.
# Runs from the repo root: `bash scripts/check-medsup-view.sh`
set -e
cd "$(dirname "$0")/.."

# The [^_] guard prevents matching pm_medsup_rate_public / pm_supp_carrier_rates_public.
# The trailing grep -v is a belt-and-suspenders filter (grep -E anchors the base name,
# but if a future _publicXYZ variant appears we still don't false-positive on it).
HITS=$(grep -rnE "from\(['\"](pm_medsup_rate|pm_supp_carrier_rates)['\"]\)|rest/v1/(pm_medsup_rate|pm_supp_carrier_rates)[^_]" \
  src/ api/ 2>/dev/null | grep -v node_modules | grep -v "_public" || true)

if [ -n "$HITS" ]; then
  echo "FAIL: consumer code reads a raw medsup rate table instead of the _public view."
  echo "$HITS"
  exit 1
fi
echo "PASS: all medsup rate reads go through pm_medsup_rate_public / pm_supp_carrier_rates_public"
