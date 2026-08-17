#!/usr/bin/env bash
# 347movies — security re-review staleness gate (scheduled cadence).
#
# Part of the health battery (scripts/health-battery.sh): fails when the most recent
# dated "Security review" entry in changelog.md is older than the cadence, so a
# scheduled run flags "security re-review due" and the battery stays red until a fresh
# review is committed to the ledger. The ledger entry — not this script — is the record
# of a review, so satisfying the gate is the same act as documenting the review.
#
# Cadence: SECURITY_REVIEW_MAX_AGE_DAYS (default 90 — a quarterly re-review is the
# industry norm for a low-churn surface; tighten to 30 for a strict monthly gate).
# The health battery runs weekly; the gate trips ~quarterly and forces a re-review.
#
# Exit: 0 when a review is current, 1 when stale/missing (the reason goes to stdout so
# the battery's failing-step output quotes it). Testable: run with
# SECURITY_REVIEW_MAX_AGE_DAYS=0 to force a trip, or point changelog.md at a fixture.
set -u
cd "$(dirname "$0")/.."

MAX_AGE_DAYS="${SECURITY_REVIEW_MAX_AGE_DAYS:-90}"

LAST_DATE="$(
  grep -E '^## [0-9]{4}-[0-9]{2}-[0-9]{2} — Security review' changelog.md 2>/dev/null \
    | head -1 \
    | sed -E 's/^## ([0-9]{4}-[0-9]{2}-[0-9]{2}).*/\1/'
)"
if [ -z "$LAST_DATE" ]; then
  echo "no dated Security review entry in changelog.md — run the security-review pass and record it in the ledger."
  exit 1
fi

# Portable epoch conversion: macOS `date -j -f`, GNU `date -d`.
if date -j -f "%Y-%m-%d" "$LAST_DATE" "+%s" >/dev/null 2>&1; then
  LAST_EPOCH="$(date -j -f "%Y-%m-%d" "$LAST_DATE" "+%s")"
else
  LAST_EPOCH="$(date -d "$LAST_DATE" "+%s")"
fi
NOW_EPOCH="$(date '+%s')"
AGE_DAYS=$(( (NOW_EPOCH - LAST_EPOCH) / 86400 ))

if [ "$AGE_DAYS" -gt "$MAX_AGE_DAYS" ]; then
  echo "last security review was $AGE_DAYS days ago ($LAST_DATE) — exceeds the $MAX_AGE_DAYS-day cadence; run the security-review pass and record a dated entry in changelog.md."
  exit 1
fi

echo "security re-review current — last review $LAST_DATE ($AGE_DAYS days ago, cadence $MAX_AGE_DAYS days)"
exit 0
