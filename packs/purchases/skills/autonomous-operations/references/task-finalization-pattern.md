# Task Finalization — Exit Gate Pattern

## The Exit Gate Loop

After completing checklist items, `verify_task_complete.py --id <id>` acts as the exit gate. It checks three things beyond checklist completion:

1. **Checklist: 6/6 done** — all items marked with `--check`
2. **Validation status on scratchpad** — must be `validated`, not `unset`
3. **Validation notes on scratchpad** — must be non-empty
4. **Completion summary** — `task_completion_summary.py` must have been run

## The Exact Sequence

```bash
# 1. Mark all checklist items done
python3 scripts/task_scratchpad.py --id <id> --check "pattern"

# 2. Set validation status AND add validation note (BOTH required)
python3 scripts/task_scratchpad.py --id <id> \
  --validation-status validated \
  --validation-note "All deliverables verified: <evidence>"

# 3. Write completion summary
python3 scripts/task_completion_summary.py --id <id> --summary "..."

# 4. Run exit gate — loop until exit 0
python3 scripts/verify_task_complete.py --id <id>

# 5. Finalize
python3 scripts/task_queue.py complete --id <id> --result "..." --validation-passed
```

## Common Pitfalls

### Durable summary artifact — verify gate requires a file
The exit gate checks for a "durable summary artifact" — a file referenced in the scratchpad's `files` array that exists on disk. If you set validation notes and status but the gate still fails with "missing durable summary artifact", you need to:
1. Write a summary `.md` file to the scratchpad directory
2. Register it: `python3 scripts/task_scratchpad.py --id <id> --file memory/task-scratchpads/<id>-summary.md`

**Path gotcha**: scratchpad files live under `.hermes/workspace/memory/task-scratchpads/`, NOT `workspace/memory/task-scratchpads/`. The `--file` argument takes a relative path resolved from the workspace root. Check `task_scratchpad.py` output for the actual `json` and `md` paths to confirm the correct base directory.

### `auto_finalize_task.py` has a path bug — use `task_queue.py complete` directly
`auto_finalize_task.py` hardcodes `scripts/task_queue.py` relative to `~/.hermes/workspace/`, which doesn't exist after the 2026-05-01 migration. It will fail with `No such file or directory`. **Workaround**: finalize directly with `task_queue.py complete --id <id> --result "..." --validation-passed`. Note that `complete` requires `--validation-passed` flag and a concrete evidence string, not vague claims.

### `task_queue.py validate` ≠ scratchpad validation_status
`task_queue.py validate --id <id> --evidence "..."` sets the queue task status to `validating`. It does NOT set the scratchpad's `validation_status` field. The exit gate looks at the scratchpad field, not the queue status. You must call `task_scratchpad.py --validation-status validated` separately.

### Security scanner (tirith) false positives
The built-in security scanner flags patterns in command text, not just actual commands. Common false positives:
- **URL + punctuation**: `api.deepseek.com.` or `api.deepseek.com)` — the scanner sees punctuation after a hostname as "trailing dot/whitespace in hostname"
- **Pipe to interpreter**: `python3 ... | python3 -c "..."` — flags as HIGH

**Workaround**: Avoid URLs at the end of sentences where punctuation follows. Use abbreviated forms like `api.deepseek.com` mid-sentence, or rephrase. For validation notes/completion summaries, keep URLs out or put them mid-sentence without trailing punctuation.

### Validation notes format
Validation notes go to scratchpad via `--validation-note` (appendable, repeatable). They show as `validation_notes` array in the JSON. The exit gate checks this array is non-empty.
