# BLOCKER: goal_gate.py reads GROSS paid → mis-routes to cold outreach every cycle

**Owner:** Rez (`/opt/greyridge-gates/goal_gate.py` is `root:root 0644`; I cannot edit it)
**Found:** 2026-10-21 · **Severity:** MEDIUM — wastes ~every cycle by naming the wrong lane.
**Unblocked on my side:** the field the fix needs is now LIVE on `/metrics` (commit ecdd5e3).

## What's wrong (proven in code, not guessed)

`goal_gate.py:30` reads the GROSS counter:
```python
f["paid"]={"value":int(m.get("total_paid_calls",0)),"exact":True,"src":"worker/metrics"}
```
`total_paid_calls` counts **our own self/test settlements + unknown-payer bot dust** alongside any
real buyer. Today it is **6377**. With `contacted=78, replied=42`, the gate's `find_leak` computes:

| paid source | replied→paid rate | leak named | recommended action |
|---|---|---|---|
| GROSS `total_paid_calls`=6377 | 151.8 (nonsense, >1) | `contacted->replied` | "find better prospects" → **cold outreach** (forbidden, 140+ pulls, $0) |
| NET `net_external_paid_calls`=8 | 0.19 | `replied->paid` | "convert a waiting reply" → **correct lane** |

So the gross number makes the gate name the one lane the mission doc explicitly says is played out,
every cycle. That is the recurring "mandate says cold-outreach, override it" friction.

## The fix (one line — the field already exists live)

`/metrics` now returns (verified live 2026-10-21, commit ecdd5e3):
```json
{ "total_paid_calls": 6377,
  "net_external_paid_calls": 8,
  "net_external": { "window_seconds": 2592000, "external_calls": 8, "self_calls": 0,
                    "unknown_calls": 0, "distinct_external_payers": 2,
                    "external_payers": ["0xa19f6215...","0xec2abd3e..."] } }
```
`net_external_paid_calls` is computed in the worker (`TrafficLog.getNetExternalPaid`) from PAID rows
with the **same `SELF_PAYERS` exclusion** the referral reconciler already uses — payer-aware, so it
excludes our own wallets and unknown bot dust. It is a trailing 30-day count (the DO prunes old
rows), which is the only honest replied→paid measure: >0 ever = real external demand exists.

**Swap `goal_gate.py:30` to:**
```python
f["paid"]={"value":int(m.get("net_external_paid_calls") or 0),"exact":True,"src":"worker/metrics:net_external"}
```
(`or 0` not `,0` — the field is `null` when the TrafficLog read fails; null→0 is the safe default:
if we can't prove external demand, treat paid as 0 → gate routes to replied→paid conversion.)

After the swap, the mandate will correctly name `replied->paid` and tell the loop to convert the
waiting replies (adexto PR#5, DopamineDesk, LiquidLogicX, Surplus) instead of cold-pitching.

## Note — this is a SEPARATE atom from the oracle

The oracle (`verify_goal.py`, routescan-dead) is a different root-owned gate; its fix is in
`outreach/blockers/oracle-routescan-dead.md`. This doc only concerns the funnel/mandate gate.
Both are one-line/one-block edits; neither blocks conversion work.
