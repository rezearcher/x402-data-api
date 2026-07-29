#!/usr/bin/env bash
# scripts/deploy.sh — Deploy x402-data-api using CF_WORKERS_TOKEN
#
# Uses CF_WORKERS_TOKEN (not CF_API_TOKEN) because the former has
# Workers:Write scope. This is the correct credential.
#
# Usage:
#   CLOUDFLARE_API_TOKEN="$(grep '^CF_WORKERS_TOKEN=' ~/.hermes/.env | cut -d= -f2-)" bash scripts/deploy.sh
#
# Or set CF_WORKERS_TOKEN in the environment and run:
#   bash scripts/deploy.sh
#
# Pre-deploy gate:
#   If we're inside a kanban worktree whose task body contains review-required
#   guardrails, or whose most recent task_events.blocked payload says
#   "review-required", this script refuses to deploy unless the task is already
#   in "blocked" status (meaning the worker called kanban_block BEFORE deploy,
#   which is the correct ordering).  If the task has review guardrails but is
#   NOT yet blocked, the worker must call kanban_block(reason="review-required: ...")
#   first — deploy is refused until the card is in the correct state.

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# ---------------------------------------------------------------------------
# Pre-deploy gate: kanban review-required ordering check
# ---------------------------------------------------------------------------
_board="${KANBAN_BOARD:-x402-data-api}"
_kanban_db="$HOME/.hermes/kanban/boards/$_board/kanban.db"

# Detect kanban task id from the git worktree path, if any.
_task_id=""
_git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
if echo "$_git_dir" | grep -qP '/\.git/worktrees/t_[a-f0-9]+'; then
  # git rev-parse --git-dir inside a linked worktree returns
  # <repo>/.git/worktrees/t_<id> — the task id is the basename of that
  # path itself, NOT of its dirname (which would resolve to "worktrees").
  # The regex must match "/.git/worktrees/" — the dot precedes "git".
  _task_id="$(basename "$_git_dir")"
elif [ -n "${HERMES_KANBAN_TASK:-}" ]; then
  _task_id="$HERMES_KANBAN_TASK"
fi

if [ -n "$_task_id" ] && [ -f "$_kanban_db" ]; then
  _status="$(sqlite3 "$_kanban_db" "SELECT status FROM tasks WHERE id='$_task_id';" 2>/dev/null || true)"

  # Check TWO sources for review-required signal:
  # 1. The task body (guardrails written at card creation)
  # 2. The most recent 'blocked' event payload (set by kanban_block tool)
  _body="$(sqlite3 "$_kanban_db" "SELECT body FROM tasks WHERE id='$_task_id';" 2>/dev/null || true)"
  _latest_blocked="$(sqlite3 "$_kanban_db" "SELECT payload FROM task_events WHERE task_id='$_task_id' AND kind='blocked' ORDER BY id DESC LIMIT 1;" 2>/dev/null || true)"
  _has_review_gate=false

  if echo "$_body" | grep -qiE "(review.required|review.*sign.off|GUARDRAILS.*review|GUARDRAILS.*block)"; then
    _has_review_gate=true
  fi
  if echo "$_latest_blocked" | grep -qiE '"reason".*"review-required'; then
    _has_review_gate=true
  fi

  if [ "$_has_review_gate" = true ]; then
    case "$_status" in
      blocked)
        echo "ERROR: Task $_task_id is BLOCKED (review-required). Unblock it first, then deploy." >&2
        echo "  →  hermes kanban unblock $_task_id  (after the review is done)" >&2
        exit 1
        ;;
      ready|running)
        echo "ERROR: Task $_task_id has review-required guardrails but is not yet blocked." >&2
        echo "  You MUST call kanban_block(reason=\"review-required: ...\") BEFORE deploying." >&2
        echo "  This ensures the review gate fires before the externally-visible action," >&2
        echo "  not after (see t_5a25e44e for context)." >&2
        exit 1
        ;;
      *)
        # done / triage / todo — allow deploy (review already passed or not applicable)
        ;;
    esac
  fi
fi

# --- Resolve token -----------------------------------------------------------
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  if [ -n "${CF_WORKERS_TOKEN:-}" ]; then
    CLOUDFLARE_API_TOKEN="$CF_WORKERS_TOKEN"
  elif [ -f ~/.hermes/.env ]; then
    CLOUDFLARE_API_TOKEN="$(grep '^CF_WORKERS_TOKEN=' ~/.hermes/.env | cut -d= -f2-)"
  fi
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "FATAL: No CF_WORKERS_TOKEN found. Set CLOUDFLARE_API_TOKEN or CF_WORKERS_TOKEN." >&2
  exit 1
fi

export CLOUDFLARE_API_TOKEN

echo "=== Deploying x402-data-api ==="
echo "Token prefix: ${CLOUDFLARE_API_TOKEN:0:8}..."

npx wrangler deploy 2>&1

echo "=== Deploy complete ==="
