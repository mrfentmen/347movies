#!/usr/bin/env bash
# 347movies — scheduled health battery (weekly cron-style regression).
#
# Runs the full verification suite and appends an HONEST dated result entry to
# changelog.md: pass/fail per step, never a claim. Meant to be run on a schedule
# (cron / launchd / CI) so the site's health is verifiable without a human in the
# loop — see LAUNCH-RUNBOOK.md "Scheduled health battery" for the wiring.
#
# What it covers and why (all self-contained; no dev server assumed — the browser
# battery starts its own):
#   typecheck + unit tests + audit  → local code health
#   browser battery (E2E/keyboard/mobile/axe) → real-browser behavior on a local server
#   canonical smoke                 → the LIVE production site (status matrix + guards)
#
# Exit code: 0 when every step passed; 1 when any step failed (the changelog entry
# records the failure either way — a failed run must still be auditable).
set -u
cd "$(dirname "$0")/.."

RUN_TS="$(date -u '+%Y-%m-%d %H:%M UTC')"
RUN_DATE="$(date -u '+%Y-%m-%d')"
LOG="$(mktemp)"

steps_pass=()
steps_fail=()

# A step is a name + a command. Output goes to a temp file so a failing step's tail
# can be quoted in the changelog entry.
run_step() {
  local name="$1"
  shift
  echo "=== $name ==="
  if "$@" >"$LOG" 2>&1; then
    echo "PASS $name"
    steps_pass+=("$name")
  else
    echo "FAIL $name"
    steps_fail+=("$name")
  fi
}

run_step "typecheck" npm run typecheck
run_step "unit tests" npm test
run_step "dependency audit" npm audit --omit=dev
# Security re-review gate: fails when the last dated "Security review" ledger entry is
# older than the cadence (default 90 days), so the scheduled battery flags a stale
# review and stays red until a fresh one is committed. The review itself is the
# security-review skill pass; recording its dated changelog entry is what satisfies
# this gate (scripts/security-review-due.sh).
run_step "security re-review current" ./scripts/security-review-due.sh
run_step "browser battery" npm run test:browser
run_step "canonical smoke (production)" npm run smoke

total=$(( ${#steps_pass[@]} + ${#steps_fail[@]} ))
if [ ${#steps_fail[@]} -eq 0 ]; then
  status="ALL PASSED ($total/$total)"
  exit_code=0
else
  status="FAILED — ${#steps_fail[@]} of $total steps failed"
  exit_code=1
fi

{
  echo ""
  echo "## $RUN_DATE — Scheduled health battery ($status)"
  echo ""
  echo "- Run: $RUN_TS (automated; no human in the loop). Each row below is raw command"
  echo "  output, not a claim."
  echo ""
  echo "| Step | Result |"
  echo "|------|--------|"
  # Guarded expansions: with `set -u`, a bare "${arr[@]}" on an empty array is an
  # unbound-variable error on macOS bash 3.2 (the +"${arr[@]}" form expands to nothing
  # when the array is empty — verified 2026-08-16 via a stubbed run).
  for s in ${steps_pass[@]+"${steps_pass[@]}"}; do echo "| $s | ✅ |"; done
  for s in ${steps_fail[@]+"${steps_fail[@]}"}; do echo "| $s | ❌ |"; done
  echo ""
  if [ ${#steps_fail[@]} -gt 0 ]; then
    echo "- Failing step output (tail):"
    echo '```'
    tail -15 "$LOG"
    echo '```'
    echo ""
    echo "- A failed battery does not mean the site is down — investigate the failing"
    echo "  step per LAUNCH-RUNBOOK.md before acting."
  fi
  echo "- Battery command: \`npm run health\` (script: scripts/health-battery.sh)"
  echo "---"
} > "$LOG.entry"

# The changelog is reverse-chronological (newest at top, after the header + separator
# at lines 1-5). Insert the entry after the first `---` instead of appending at the
# bottom, so a health entry never lands out of order after "What's next".
ENTRY="$LOG.entry"
OUT="$LOG.out"
{
  sed -n '1,/^---$/p' changelog.md
  cat "$ENTRY"
  sed -n '/^---$/,$p' changelog.md | tail -n +2
} > "$OUT"
mv "$OUT" changelog.md
rm -f "$ENTRY" "$LOG"
exit "$exit_code"
