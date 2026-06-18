# Cron Bomb Detection & Session Analysis

## What Is a Cron Bomb?

A cron job configured to fire **too frequently** — typically every 1-2 minutes — using an expensive model (`deepseek-v4-pro`). Even when the queue is empty, each invocation burns a full inference round (system prompt + tool calls + response). The most common cause: a `worker-oneshot` cron created for a specific task but misconfigured with a short interval instead of `run once`.

## Detection Technique

### Step 1: Session File Inventory

Count and group cron sessions by hash:

```python
import json, os
from collections import defaultdict

sessions_dir = "/home/user/.hermes/sessions/"
files = [f for f in os.listdir(sessions_dir) if f.endswith('.json') and 'cron' in f]

groups = defaultdict(list)
for f in files:
    parts = f.split('_')
    if 'cron' in parts:
        idx = parts.index('cron')
        cron_hash = parts[idx+1]
        size = os.path.getsize(os.path.join(sessions_dir, f))
        groups[cron_hash].append((f, size))

for key, items in sorted(groups.items(), key=lambda x: -len(x[1])):
    total_mb = sum(s for _, s in items) / 1024 / 1024
    print(f"{key}: {len(items)} sessions, {total_mb:.1f}MB")
```

**Red flag**: Any cron hash with >100 sessions in <5 days.

### Step 2: Check Cron Definitions

Read the source of truth: `/home/user/.hermes/cron/jobs.json`

```bash
python3 -c "
import json
data = json.load(open('/home/user/.hermes/cron/jobs.json'))
for j in data['jobs']:
    if j.get('enabled') and j.get('state') != 'paused':
        sched = j.get('schedule', {})
        print(f\"{j['name']} ({j['id'][:8]}): {sched.get('display','?')} - {j.get('last_status','?')} - runs: {j.get('repeat',{}).get('completed',0)}\")
"
```

**Red flag**: Any cron with `schedule: every 1m` or `every 2m`. Worker-oneshot crons created with `--schedule "every 1m"` instead of `--once`.

### Step 3: Read Session Content

Sample a session to understand what it's doing:

```python
with open(f"/home/user/.hermes/sessions/{sample_file}") as fh:
    data = json.load(fh)

# Check model and first user message
print(f"Model: {data.get('model')}")
for msg in data.get("messages", []):
    if msg.get("role") == "user":
        print(f"User prompt: {str(msg.get('content',''))[:500]}")
        break
```

**Red flag**: Worker prompts reading SOUL.md/USER.md/WORKER.md every invocation — that's ~15KB of system prompt burned per run.

### Step 4: Identify "No Models Provided" Failures

Crons with `last_status: error` and error message containing `"No models provided"` are failing on every run but still hitting the API:

```bash
hermes cron list 2>&1 | grep -B5 "No models provided"
```

This error comes from the DeepSeek API (code 400, user_id prefix `user_3APXY`) and usually means the cron subsystem isn't properly routing the model name. Interactive sessions with the same config work fine — it's cron-specific.

### Step 5: Cost Estimation

| Model | Input $/1M | Output $/1M | Approx blended |
|---|---|---|---|
| deepseek-v4-pro | ~$0.28 | ~$1.10 | ~$0.50/M |
| deepseek-v4-flash | ~$0.07 | ~$0.28 | ~$0.13/M |

Rough estimate: session file size in KB × 3.5 chars-per-token ≈ token count. Multiply by blended rate.

## Immediate Actions

1. **Pause the bomb**: `hermes cron pause <id>`
2. **Pause failing crons**: `hermes cron pause <id>` for any with "No models provided" errors
3. **Don't just pause — plan removal**: Worker-oneshot crons tied to a specific task (`dfb80121` in the prompt) should be removed after pausing, since the task is already complete.

## The worker-oneshot Naming Convention

Worker-oneshot crons are named `worker-oneshot-<timestamp>` and created with a specific task's queue IDs embedded in the prompt. They're intended to run once but can be misconfigured with interval schedules. Key signs:
- Name matches `worker-oneshot-*`
- Prompt contains "Pending task IDs: [...]" with stale task IDs
- Schedule is `every 1m` or similarly short

These should be **removed** after pausing — they serve no ongoing purpose once the referenced task is complete.
