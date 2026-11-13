# AgentMail event handoff

This pack adapts an existing, authenticated AgentMail inbox reconciler to Nano. It does not register another public webhook or store an API key. `lib/handoff.py` replaces only the reconciler's delivery function, retaining its signature-verified webhook ingress, API pagination, state, process lock and recovery poll. The existing producer remains responsible for signature verification and inbox filtering.

Call `install(reconciler, inbox_id=<inbox>, queue_dir=<queue>)` before running the existing monitor. The adapter expects `thread_fingerprint(thread)` and `create_kanban_task(thread, reason)` on that monitor. Each changed thread produces an atomic JSON task containing an inbox/thread pointer. Subjects, message content, verification codes and credentials are not placed in this spool. The owner-specific wrapper and inbox configuration belong outside the public repository.

Create the queue with the Nano user's ownership and mode 0700, and mount that directory into Nano. Set `NANO_EVENT_OUTBOX_DIRS` to its container path. Comma-separated paths permit other trusted local event sources. Existing `<data>/outbox` producers continue unchanged.

Nano polls its configured event spools with its scheduler. Successful delivery renames a task to `.done`; failed delivery leaves it queued. The adapter recognizes pending tasks and receipts, so a producer retry does not republish a completed event. Delivery is at least once across a crash between action completion and acknowledgement; consumers must reconcile external side effects. Malformed files are quarantined as `.bad`. Queues must contain trusted application-generated tasks, not raw webhook bodies or email instructions.

Use the vault's `agentmail` credential and the owner's inbox skill to read messages. API keys remain outside the Nano environment. Keep Link-app spending approval enabled. No email sending or spending is authorized by an inbox notification itself.

A local classification layer must not discard verification emails needed by an active login. In a legacy monitor with a suppressing canary mode, use its observation-only/shadow mode while handing events to Nano.
