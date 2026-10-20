# ATOM (one-time root): make the quality gates tamper-PROOF
The anti-gaming gates (judge + governors + oracle) are isolated + integrity-checked, but under the single
`rez` user tampering can be DETECTED, not PREVENTED. To PREVENT it, run once:

    sudo bash /home/rez/greyridge-gates/setup_isolation.sh

This moves the gate code to root-owned `/opt/greyridge-gates` (rez can read+execute, not write) and leaves
`/home/rez/greyridge-gates` as a symlink so everything keeps working. Why it unlocks: an autonomous loop
running as `rez` can no longer edit its own judge/governors to lower its bar — the core anti-gaming guarantee.

---
# ATOM 2 (one-time root): turn thinking ON for the 4.8 judge
5.x is AUP-blocked on this account (verified: even "reply OK" is flagged), so the judge stays on Opus 4.8.
On 4.8, a claude call with NO --effort runs with thinking OFF = weakest mode = the fabricated-citation
failure we hit. Fix (re-baselines the protected judge automatically):

    sudo bash /home/rez/update_judge_48mitigations.sh

---
# ATOM 3 (one-time root) — SUPERSEDES ATOM 2: install validated judge upgrades
Tool-grounded judge (Read/Grep/Glob + effort high; validated — grepped real lines, caught real bugs, no
fabrication) + goal_gate bug fixes. Includes the --effort change from ATOM 2, so run THIS instead:

    sudo bash /home/rez/install_judge_upgrades.sh
