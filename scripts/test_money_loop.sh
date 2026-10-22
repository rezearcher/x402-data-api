#!/usr/bin/env bash
# test_money_loop.sh — regression harness for the money-loop crew substrate.
# Proves the Scout/Economist/Skeptic/Distribution/Builder/Judge pipeline's data layer
# and the send gate behave, so a wipe or a careless edit is caught. Exit 0 = all pass.
#
# Tests use TEMP fixtures (never live state or wall-clock dates) except section 5, which
# asserts the real warm-lead ledger is valid JSON — the one failure mode that silently
# disabled the send gate in production (the loop appended a lead without a comma).
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
GOAL="$HOME/.claude/goal-loop-active/makemoney.goal"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0; pass=0
ok()  { echo "  PASS: $*"; pass=$((pass+1)); }
bad() { echo "  FAIL: $*" >&2; fail=$((fail+1)); }

echo "== 1. substrate selftests =="
for s in winner_registry customer_need_registry money_research_queue crew_stage; do
  if python3 -I "scripts/$s.py" selftest >/dev/null 2>&1; then ok "$s selftest"; else bad "$s selftest (exit $?)"; fi
done

echo "== 1b. stage machine: loop-in-place (HOLD until judge passes, then ADVANCE) =="
export CREW_PIPELINE_STORE="$TMP/pipeline.jsonl"
python3 -I scripts/crew_stage.py new '{"id":"t","name":"t","source":"s","resells":"r","audience_hypothesis":"a"}' >/dev/null 2>&1
python3 -I scripts/crew_stage.py advance t >/dev/null 2>&1
[ $? -eq 0 ] && ok "scout judge passes with required fields (ADVANCED)" || bad "scout stage should ADVANCE (exit 0)"
python3 -I scripts/crew_stage.py advance t >/dev/null 2>&1
[ $? -eq 1 ] && ok "economist HOLDs when econ fields missing (loop in place)" || bad "economist should HOLD (exit 1) with no econ"
python3 -I scripts/crew_stage.py set t '{"econ":{"spread_usd":0.5,"computed_note":"x"}}' >/dev/null 2>&1
python3 -I scripts/crew_stage.py advance t >/dev/null 2>&1
[ $? -eq 0 ] && ok "economist ADVANCEs once econ computed" || bad "economist should ADVANCE (exit 0) once econ set"
unset CREW_PIPELINE_STORE

echo "== 1c. security gate: never skipped, blocks until cleared + lockout-checked =="
export CREW_PIPELINE_STORE="$TMP/sec.jsonl"
# drive a candidate straight to the builder->security boundary
python3 -I scripts/crew_stage.py new '{"id":"s","name":"s","source":"x","resells":"r","audience_hypothesis":"a"}' >/dev/null 2>&1
python3 -I scripts/crew_stage.py advance s >/dev/null 2>&1   # scout->economist
python3 -I scripts/crew_stage.py set s '{"econ":{"spread_usd":1,"computed_note":"n"}}' >/dev/null 2>&1
python3 -I scripts/crew_stage.py advance s >/dev/null 2>&1   # economist->skeptic
python3 -I scripts/crew_stage.py set s '{"skeptic":{"verdict":"survive","assumption":"a"}}' >/dev/null 2>&1
python3 -I scripts/crew_stage.py advance s >/dev/null 2>&1   # skeptic->distribution
python3 -I scripts/crew_stage.py set s '{"distribution":{"channel":"c","reach_evidence":"e"}}' >/dev/null 2>&1
python3 -I scripts/crew_stage.py advance s >/dev/null 2>&1   # distribution->builder
python3 -I scripts/crew_stage.py set s '{"builder":{"artifacts":["x"]}}' >/dev/null 2>&1
python3 -I scripts/crew_stage.py advance s >/dev/null 2>&1   # builder->security
stage="$(python3 -I -c "import sys;sys.path.insert(0,'scripts');import crew_stage as c;r=c.find(c.load(),'s');print(c.stage_of(r) if r else 'none')" 2>/dev/null)"
[ "$stage" = "security" ] && ok "builder advances INTO security (gate exists before judge)" || bad "expected security stage after builder, got '$stage'"
python3 -I scripts/crew_stage.py advance s >/dev/null 2>&1
[ $? -eq 1 ] && ok "security HOLDs with no clearance (cannot be skipped)" || bad "security should HOLD (1) without a clearance"
python3 -I scripts/crew_stage.py set s '{"security":{"verdict":"cleared","review":"ok"}}' >/dev/null 2>&1
python3 -I scripts/crew_stage.py advance s >/dev/null 2>&1
[ $? -eq 1 ] && ok "security still HOLDs until lockout is checked (no self-lockout)" || bad "security should HOLD (1) until lockout_checked"
python3 -I scripts/crew_stage.py set s '{"security":{"lockout_checked":true}}' >/dev/null 2>&1
python3 -I scripts/crew_stage.py advance s >/dev/null 2>&1
[ $? -eq 0 ] && ok "security ADVANCEs once cleared AND lockout-checked" || bad "security should ADVANCE (0) when cleared + lockout checked"
# unfixable verdict parks the candidate (escape hatch, not a silent skip)
python3 -I scripts/crew_stage.py new '{"id":"u","name":"u","source":"x","resells":"r","audience_hypothesis":"a"}' >/dev/null 2>&1
for step in 'advance u' 'set u {"econ":{"spread_usd":1,"computed_note":"n"}}' 'advance u' 'set u {"skeptic":{"verdict":"survive","assumption":"a"}}' 'advance u' 'set u {"distribution":{"channel":"c","reach_evidence":"e"}}' 'advance u' 'set u {"builder":{"artifacts":["x"]}}' 'advance u'; do
  python3 -I scripts/crew_stage.py $step >/dev/null 2>&1
done
python3 -I scripts/crew_stage.py set u '{"security":{"verdict":"unfixable","review":"cannot secure without lockout"}}' >/dev/null 2>&1
python3 -I scripts/crew_stage.py advance u >/dev/null 2>&1
[ $? -eq 3 ] && ok "security 'unfixable' KILLs (escape hatch exists)" || bad "security unfixable should KILL (3)"
unset CREW_PIPELINE_STORE

echo "== 2. send-gate decision table (fixture ledger, date-independent) =="
LED="$TMP/leads.json"
cat > "$LED" <<'JSON'
{"leads":[
 {"lead":"InWindow Co","emails":["block@fixture.test"],"thread_id":"x/y#1","status":"ball-in-court","do_not_send_until":"2099-01-01"},
 {"lead":"PastWindow Co","emails":["allow@fixture.test"],"thread_id":"x/y#2","status":"ball-in-court","do_not_send_until":"2000-01-01"}
]}
JSON
python3 -I scripts/send_guard.py --ledger "$LED" --to block@fixture.test >/dev/null 2>&1
[ $? -eq 10 ] && ok "BLOCKs a lead inside its quiet window" || bad "should BLOCK (10) an in-window lead"
python3 -I scripts/send_guard.py --ledger "$LED" --to block@fixture.test --reply >/dev/null 2>&1
[ $? -eq 0 ] && ok "ALLOWs a --reply to an in-window lead" || bad "should ALLOW (0) a --reply"
python3 -I scripts/send_guard.py --ledger "$LED" --to allow@fixture.test >/dev/null 2>&1
[ $? -eq 0 ] && ok "ALLOWs a lead past its window" || bad "should ALLOW (0) a past-window lead"
python3 -I scripts/send_guard.py --ledger "$LED" --to nobody@fixture.test >/dev/null 2>&1
[ $? -eq 0 ] && ok "ALLOWs an unknown recipient (degrade-open)" || bad "should ALLOW (0) unknown recipient"
# corrupt ledger -> loud WARN on stderr, still ALLOW (never blocks all outreach)
echo '{bad json' > "$TMP/corrupt.json"
out="$(python3 -I scripts/send_guard.py --ledger "$TMP/corrupt.json" --to x@y.test 2>&1 >/dev/null)"; rc=$?
{ [ $rc -eq 0 ] && echo "$out" | grep -q "WARN"; } && ok "corrupt ledger -> loud WARN + degrade-open" || bad "corrupt ledger should WARN loudly and ALLOW (got rc=$rc)"

echo "== 3. research-queue ordering (fixture store; pre-phase needs highest-priority-first) =="
export MONEY_RESEARCH_QUEUE_STORE="$TMP/rq.jsonl"
python3 -I scripts/money_research_queue.py add "low urgency task" --from scout --reason r --priority 3 >/dev/null 2>&1
python3 -I scripts/money_research_queue.py add "top urgency task" --from distribution --reason r --priority 1 >/dev/null 2>&1
top="$(python3 -I scripts/money_research_queue.py next 2>/dev/null | head -1)"
echo "$top" | grep -q "pri 1" && ok "queue 'next' surfaces priority-1 first" || bad "queue 'next' did not surface pri 1 first: $top"
unset MONEY_RESEARCH_QUEUE_STORE

echo "== 4. goal-reference integrity =="
if [ -f "$GOAL" ]; then
  miss=0
  for p in $(grep -oE '/home/rez/projects/x402-data-api/(scripts|outreach|docs)/[A-Za-z0-9_./-]+' "$GOAL" \
            | sed -E 's/[.,;:]+$//' | sort -u); do        # strip trailing sentence punctuation
    [ -e "$p" ] || { bad "goal references missing path: $p"; miss=$((miss+1)); }
  done
  [ "$miss" -eq 0 ] && ok "all goal-referenced paths exist"
else
  bad "goal file not found at $GOAL (loop paused/disarmed?)"
fi

echo "== 5. real warm-lead ledger is valid JSON (the prod corruption mode) =="
if python3 -I -c "import json;json.load(open('outreach/warm_leads.json'))" 2>/dev/null; then
  ok "outreach/warm_leads.json parses"
else
  bad "outreach/warm_leads.json is INVALID JSON — send gate is disabled until repaired"
fi

echo "== 6. AI-fingerprint sweep (substrate must be clean) =="
hits="$(grep -rniE 'co-authored-by|generated by (claude|ai)|as an ai|i am an ai|language model' \
  scripts/winner_registry.py scripts/customer_need_registry.py scripts/money_research_queue.py scripts/send_guard.py 2>/dev/null)"
[ -z "$hits" ] && ok "substrate scripts carry no AI-authorship fingerprint" || bad "AI fingerprint in substrate: $hits"

echo "== 7. error-handling edge cases (regressions from the final-state audit) =="
# 7a: send_guard on valid-JSON wrong-shape ledgers must degrade OPEN, never crash
echo '[1,2]' > "$TMP/ws1.json"
python3 -I scripts/send_guard.py --ledger "$TMP/ws1.json" --to x@y.test >/dev/null 2>&1
[ $? -eq 0 ] && ok "send_guard ALLOWs on a list-shaped ledger (no crash)" || bad "send_guard should ALLOW (0) on wrong-shape ledger"
echo '{"leads":[1,"a"]}' > "$TMP/ws2.json"
python3 -I scripts/send_guard.py --ledger "$TMP/ws2.json" --to x@y.test >/dev/null 2>&1
[ $? -eq 0 ] && ok "send_guard ALLOWs on non-dict lead entries (no crash)" || bad "send_guard should ALLOW (0) on bad lead entries"
# 7b: money oracle fails CLOSED when the sensor lacks a fetched_at stamp
echo '{"total_external_usdc":5.0}' > "$TMP/nofa.json"
python3 -I -c "import sys,os;sys.path.insert(0,'scripts');os.environ['X402_REVENUE_DIR']='$TMP/nofa_dir';import crew_stage as c" 2>/dev/null
mkdir -p "$TMP/nofa_dir"; cp "$TMP/nofa.json" "$TMP/nofa_dir/latest.json"
r=$(X402_REVENUE_DIR="$TMP/nofa_dir" python3 -I -c "import sys;sys.path.insert(0,'scripts');import crew_stage as c;print(c._oracle_external_dollar())" 2>/dev/null)
[ "$r" = "False" ] && ok "money oracle fails closed on a sensor with no fetched_at" || bad "oracle should fail closed (False) with no fetched_at, got '$r'"
# 7c: winner_registry survives a non-UTF8 store
printf '\xff\xfe junk\n{"id":"ok","name":"ok"}\n' > "$TMP/nonutf8.jsonl"
python3 -I scripts/winner_registry.py --store "$TMP/nonutf8.jsonl" list >/dev/null 2>&1
[ $? -eq 0 ] && ok "winner_registry survives a non-UTF8 store (no crash)" || bad "winner_registry should not crash on non-UTF8"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && { echo "MONEY-LOOP HARNESS OK"; exit 0; } || { echo "MONEY-LOOP HARNESS FAILED"; exit 1; }
