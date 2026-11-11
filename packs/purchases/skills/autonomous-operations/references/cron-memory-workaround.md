# Cron Memory Workaround — Root Cause & Pattern

## Root Cause

`cron/scheduler.py` line 1452:

```python
agent = AIAgent(
    ...
    skip_memory=True,  # Cron system prompts would corrupt user representations
    ...
)
```

This is **hardcoded for ALL cron jobs**. Effects:
- Memory content (MEMORY.md, USER.md) is never injected into the system prompt
- The `memory` tool itself refuses to operate when `skip_memory=True`
- Every cron session log says "Memory tool unavailable"

## Why This Hurts

Daily context scans, proactive digests, workout planners — any cron job that needs persistent user context is blind to corrections. When the user says "X is cancelled" and you save it to memory, the next cron run STILL surfaces X because it can't read memory.

## The Workaround

Memory is stored as **plain markdown files**:
- `~/.hermes/memories/MEMORY.md` — agent's notes
- `~/.hermes/memories/USER.md` — user profile

`read_file` always works in cron (no `skip_memory` gate). Use it as STEP 0:

```
STEP 0 — READ MEMORY FIRST. Use read_file to load ~/.hermes/memories/MEMORY.md and
~/.hermes/memories/USER.md. These are canonical. Cross-reference every item you find
against them. If memory says cancelled/NOT happening — omit entirely.
```

## Pattern: Self-Healing Cron Suppression

1. User corrects agent in live session → agent saves to memory tool
2. Memory tool writes to `~/.hermes/memories/MEMORY.md`
3. Next cron run reads the updated file via `read_file`
4. Sees the correction → suppresses automatically
5. No prompt edits needed. No hardcoded lists.

## Verification

After updating a cron prompt with this pattern, check the next run's output:
```bash
hermes cron run <job_id>  # triggers on next tick
# Wait for delivery, verify suppressed items don't appear
```
