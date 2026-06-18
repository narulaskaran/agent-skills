# Kalshi Sunset — Real Execution Log (May 2026)

## Trigger
User said: "let's sunset kalshi. there's no payoff. then let's give it a week and see how token burn goes."

## Execution Steps

### 1. List crons to find Kalshi-related jobs
```bash
cronjob list
```
Found:
- `kalshi-research` (every 720m) — researched markets
- `kalshi-watchdog` (every 30m) — checked balance/positions
- `proactive-engine` prompt mentioned "any pending Kalshi proposals"
- `weekly-synthesis` prompt mentioned "Kalshi performance"

### 2. Remove primary Kalshi crons
```bash
cronjob remove --job-id 23faaa247b01  # kalshi-research
cronjob remove --job-id 05d326bff02b  # kalshi-watchdog
```

### 3. Update crons that referenced Kalshi
```bash
cronjob update --job-id 0fce5342d568  # proactive-engine — removed "pending Kalshi proposals"
cronjob update --job-id a5518847061f  # weekly-synthesis — removed "Kalshi performance"
```

### 4. Delete all Kalshi state files
Found ~45 files in `memory/`:
```bash
rm memory/kalshi-*.json memory/kalshi-*.jsonl memory/kalshi-*.md
rm memory/kalshi-proposals.json
rm -rf memory/kalshi-approval-snapshots memory/kalshi-decision-snapshots memory/kalshi-reconstructions
```

### 5. Update user-facing docs
- `MEMORY.md` — Replaced "Kalshi approval preference: avoid sending trade proposals..." with "Kalshi completely sunset as of 2026-05-01. All crons removed, all state files cleaned."
- `USER.md` — Removed "building a self-improving Kalshi trading pipeline" from strategic context

### 6. Update memory tool
```bash
memory --action replace --target memory --old-text "Preferences: Kalshi approval preference: avoid sending trade proposals" --content "Kalshi: Completely sunset as of 2026-05-01 (user decision). All crons, state files, and docs references cleaned up."
```

## Key Lessons
1. **Cron prompts hide references** — Always read every cron's full prompt, not just its name
2. **Memory tool replace needs exact prefix** — Read the memory dump first to see the exact text
3. **~45 data files accumulated** — Regular cleanup could prevent this buildup
4. **Verify with grep** — After cleanup, `grep -ri kalshi` the workspace to catch any stragglers
5. **Reasoning effort reduction** — User also lowered `reasoning_effort` from high to medium on DeepSeek V4 Flash to further cut costs alongside the sunset
