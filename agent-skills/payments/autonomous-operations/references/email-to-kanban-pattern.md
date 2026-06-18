# Email → Kanban Integration Pattern

## Architecture

```
Hermes cron "Email Monitor (AgentMail Poller)" (every 5m, terminal-only toolsets)
  └─ email_monitor.py (zero-LLM, deterministic)
       └─ hermes kanban create "Email: [subject]" --body "..." --assignee default
            └─ Kanban dispatcher (every 60s) spawns worker
                 └─ Worker fetches full content via AgentMail API
```

## email_monitor.py Design

- **No LLM cost** — pure Python comparison against state.json
- **State tracking**: `state.json` maps thread_id → last_message_id fingerprint
- **Detection**: new threads AND updated threads (changed fingerprint) both trigger task creation
- **Kanban creation** via `subprocess.run(["hermes", "kanban", "create", ...])`
- **Latency**: 5 min cron interval + ≤60s dispatcher sweep

## Key Implementation

```python
def create_kanban_task(thread, reason: str):
    subject = getattr(thread, "subject", "(no subject)") or "(no subject)"
    participants = getattr(thread, "participants", [])
    sender = participants[0] if participants else "unknown"
    thread_id = getattr(thread, "thread_id", "unknown")

    title = f"Email: {subject[:80]}"
    body = (
        f"From: {sender}\n"
        f"Subject: {subject}\n"
        f"Thread ID: {thread_id}\n"
        f"Reason: {reason}\n\n"
        f"Use AgentMail API to fetch full content for thread {thread_id}."
    )

    subprocess.run(
        ["hermes", "kanban", "create", title, "--body", body, "--assignee", "default"],
        capture_output=True, text=True, timeout=10
    )
```

## Pitfalls

- **Cron job not created yet**: The script may exist and be well-written, but if no Hermes cron job wraps it, it will never run. This is the most common cause of "email not being processed." Verify with `cronjob list | grep -i "email monitor"`. The script and the cron are separate — both must exist.
- **Dispatcher/Worker gap (silent failure)**: The most insidious failure mode. The monitor creates Kanban tasks successfully, but the gateway dispatcher may fail to spawn workers. Tasks sit in `ready` state indefinitely. This produces the exact user complaint "why didn't you auto-ingest this?" — from the monitor's perspective, everything worked. From the user's perspective, nothing happened.
  - Verify with: `hermes kanban list` — any `ready` tasks older than 5 min?
  - Mitigation: session-start check of Kanban board; process orphaned tasks directly.
- State file must be saved AFTER Kanban tasks are created (order matters — if state is saved first and the subprocess fails, email is lost)
- `hermes kanban create` is the CLI, not a tool. Regular sessions don't have Kanban tools in their schema (gated by HERMES_KANBAN_TASK env var)
- Tasks land in `ready` state — dispatcher picks them up on next sweep (≤60s)
- Subprocess failures are non-fatal — state is still saved to prevent re-processing on next poll
