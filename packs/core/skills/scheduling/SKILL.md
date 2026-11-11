---
name: scheduling
description: Patterns for reminders, conditional reminders, temporary monitors and project heartbeats using the schedule tools. Read before scheduling anything more involved than a plain one-time reminder.
---

# Scheduling patterns

All times are the owner's local time. Confirm in one short line what you scheduled and when.

## Plain reminder
"Remind me at 6 to call the dentist" → `schedule_add` with kind `message`, `at`, and the exact text to send. No model run happens when it fires, so write the text as the finished message.

## Conditional reminder
"Remind me Monday if I still haven't returned the shoes" → kind `task`. The body must stand alone: what to check (a note in the knowledge base, the conversation log, an order page), what to say if it is still open, and to answer `[silent]` if it is already done.

## Recurring nudge or digest
Use `cron`. Add `until` whenever there is a natural end (a trip date, a deadline) so the job removes itself.

## Temporary monitor that only speaks on change
For "tell me when X changes" (a price, a delivery status, a flight, a reply):
1. Write a small script in the workspace that prints one line when the thing changed since last run and prints nothing otherwise. Keep its last-seen value in a state file next to it.
2. Schedule it with kind `script`, a `cron` interval that fits how fast the thing changes, and `until`.
3. Use `then: "send"` when the script's line is already a good message, `then: "task"` when it needs judgement.
4. Cancel it when the owner says it is resolved.
A script check costs nothing when nothing changed. Prefer it over a recurring `task` whenever the check can be mechanical.

## Project heartbeat
For multi-week things (a trip, an event): keep one note in the knowledge base with open items and dates, and schedule a `task` on a daily or weekly `cron` with `until` set to the event date. The task reads the note, checks what moved, and messages the owner only with something they need to do or decide. Otherwise `[silent]`.

## Housekeeping
- Before adding, call `schedule_list` to avoid duplicates.
- One-time jobs disappear after firing. Recurring jobs run until cancelled or `until` passes.
- Missed while offline: one-time jobs fire on restart; recurring jobs skip the missed runs.
