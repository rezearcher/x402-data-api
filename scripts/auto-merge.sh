#!/usr/bin/env bash
# auto-merge — kanban_task_completed hook for x402-data-api.
# Auto-merge wt/<task_id> worktree branches into main when the task completes.
# Runs in the worker process after kanban_complete — inherits HERMES_KANBAN_TASK
# from the worker environment AND receives the full hook payload on stdin
# (JSON with task_id in the 'extra' field).
# Fail-OPEN: always exits 0 so it can NEVER block a legitimate completion.
# BUT: every exit path writes a trace to $fail_dir so a silent no-op is never
# actually silent — ok=true from the kernel must be auditable afterwards.
REPO="/home/rez/projects/x402-data-api"
fail_dir="$HOME/.hermes/data/x402-data-api-health/auto_merge_failures"

# --- Trace every terminal path (fail-open but never invisible) -----------------
log_run() { # $1 = reason (writes/overwrites per-task run record)
    mkdir -p "$fail_dir"
    {
        echo "timestamp: $(date -Is 2>/dev/null || date)"
        echo "task_id: ${task_id:-unknown}"
        echo "branch: ${branch:-unknown}"
        echo "sha: ${current_sha:-unknown}"
        echo "reason: $1"
    } > "$fail_dir/${task_id:-unknown}.log"
}

# --- Extract task_id ----------------------------------------------------------
task_id="${HERMES_KANBAN_TASK:-}"
if [ -z "$task_id" ] && [ -t 0 ]; then
    # stdin is a terminal (not piped) — use arg as fallback
    task_id="${1:-}"
elif [ -z "$task_id" ]; then
    # stdin has piped data — try to extract task_id from JSON payload
    stdin_data=$(cat 2>/dev/null || echo "")
    if [ -n "$stdin_data" ]; then
        task_id=$(echo "$stdin_data" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('extra',{}).get('task_id',''))
except Exception:
    print('')
" 2>/dev/null || echo "")
    fi
fi
branch="wt/${task_id:-unknown}"
if [ -z "$task_id" ]; then
    log_run "no task_id resolved (HERMES_KANBAN_TASK unset, no arg, no JSON payload)"
    exit 0
fi

# --- Navigate to repo ---------------------------------------------------------
cd "$REPO" 2>/dev/null || { log_run "cannot cd to $REPO"; exit 0; }

# --- Check branch exists locally ----------------------------------------------
if ! git rev-parse --verify "$branch" >/dev/null 2>&1; then
    log_run "branch $branch not found locally (already cleaned up?)"
    exit 0
fi

# --- Fetch latest -------------------------------------------------------------
git fetch origin main 2>/dev/null || true

# --- Record what we're about to work on (for diagnostics) ---------------------
current_sha=$(git rev-parse --short "$branch" 2>/dev/null || echo "unknown")

# --- Switch to main, pull latest ---------------------------------------------
if ! git checkout main 2>/dev/null; then
    log_run "cannot checkout main (dirty tree? main checked out elsewhere?)"
    exit 0
fi
git pull origin main 2>/dev/null || true

# --- Check if already merged --------------------------------------------------
if git merge-base --is-ancestor "$branch" main 2>/dev/null; then
    # Already in local main. Verify it is ALSO on origin — otherwise the merge
    # was never pushed and deleting the branch would lose it permanently.
    if git merge-base --is-ancestor "$branch" origin/main 2>/dev/null; then
        log_run "already merged AND pushed (no-op)"
        git branch -d "$branch" 2>/dev/null || true
    else
        log_run "already in local main but NOT on origin/main — merge never pushed; branch kept, needs manual push"
    fi
    exit 0
fi

# --- Attempt merge (fail-OPEN: any failure = log + silent abort) ---------------
merge_output=$(git merge --no-ff -m "auto-merge: $branch (task $task_id, sha $current_sha)" "$branch" 2>&1) || {
    merge_exit=$?
    mkdir -p "$fail_dir"
    {
        echo "timestamp: $(date -Is 2>/dev/null || date)"
        echo "task_id: $task_id"
        echo "branch: $branch"
        echo "sha: $current_sha"
        echo "exit_code: $merge_exit"
        echo "--- merge_output ---"
        echo "$merge_output"
        if echo "$merge_output" | grep -qi "untracked working tree files would be overwritten"; then
            echo "--- CONFLICT TYPE: untracked files ---"
            echo "conflicting_paths:"
            echo "$merge_output" | grep -E "^\\t" | sed 's/^\\t//'
        fi
    } > "$fail_dir/$task_id.log"
    git merge --abort 2>/dev/null
    exit 0
}

# --- Merge succeeded: push, VERIFY, then clean up ------------------------------
git push origin main 2>/dev/null || true
# git push updates the local origin/main tracking ref on success; a mismatch
# here means the push failed or did not propagate. NEVER delete the branch in
# that case — a local-only merge that loses its branch is a lost merge.
if [ "$(git rev-parse main 2>/dev/null)" != "$(git rev-parse origin/main 2>/dev/null)" ]; then
    log_run "merge succeeded locally but push to origin failed/did not propagate; branch kept"
    exit 0
fi
# Remove remote branch if it exists
git push origin --delete "$branch" 2>/dev/null || true
# Clean up local branch (safe — won't work if we're still checked out here)
git branch -d "$branch" 2>/dev/null || true

log_run "merged + pushed OK"
exit 0
