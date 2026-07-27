#!/usr/bin/env bash
# auto-merge — kanban_task_completed hook for x402-data-api.
# Auto-merge wt/<task_id> worktree branches into main when the task completes.
# Runs in the worker process after kanban_complete — inherits HERMES_KANBAN_TASK
# from the worker environment AND receives the full hook payload on stdin
# (JSON with task_id in the 'extra' field).
# Fail-OPEN: always exits 0 so it can NEVER block a legitimate completion.
REPO="/home/rez/projects/x402-data-api"

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
[ -z "$task_id" ] && exit 0

branch="wt/$task_id"

# --- Navigate to repo ---------------------------------------------------------
cd "$REPO" 2>/dev/null || exit 0

# --- Check branch exists locally ----------------------------------------------
git rev-parse --verify "$branch" >/dev/null 2>&1 || exit 0

# --- Fetch latest -------------------------------------------------------------
git fetch origin main 2>/dev/null || true

# --- Record what we're about to work on (for diagnostics) ---------------------
current_sha=$(git rev-parse --short "$branch" 2>/dev/null || echo "unknown")

# --- Switch to main, pull latest ---------------------------------------------
git checkout main 2>/dev/null || exit 0
git pull origin main 2>/dev/null || true

# --- Check if already merged --------------------------------------------------
if git merge-base --is-ancestor "$branch" main 2>/dev/null; then
    # Already an ancestor — branch is up-to-date or was previously merged.
    # Clean up local branch reference.
    git branch -d "$branch" 2>/dev/null || true
    exit 0
fi

# --- Attempt merge (fail-OPEN: any failure = log + silent abort) ---------------
merge_output=$(git merge --no-ff -m "auto-merge: $branch (task $task_id, sha $current_sha)" "$branch" 2>&1) || {
    merge_exit=$?
    fail_dir="$HOME/.hermes/data/x402-data-api-health/auto_merge_failures"
    mkdir -p "$fail_dir"
    {
        echo "task_id: $task_id"
        echo "branch: $branch"
        echo "sha: $current_sha"
        echo "exit_code: $merge_exit"
        echo "--- merge_output ---"
        echo "$merge_output"
        if echo "$merge_output" | grep -qi "untracked working tree files would be overwritten"; then
            echo "--- CONFLICT TYPE: untracked files ---"
            echo "conflicting_paths:"
            echo "$merge_output" | grep -E "^\t" | sed 's/^\t//'
        fi
    } > "$fail_dir/$task_id.log"
    git merge --abort 2>/dev/null
    exit 0
}

# --- Merge succeeded: push, clean up -------------------------------------------
git push origin main 2>/dev/null || true
# Remove remote branch if it exists
git push origin --delete "$branch" 2>/dev/null || true
# Clean up local branch (safe — won't work if we're still checked out here)
git branch -d "$branch" 2>/dev/null || true

exit 0
