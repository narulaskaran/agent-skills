# ICS Calendar Invite Pattern

When Google Calendar write access is unavailable (the `gcal.py` script is read-only, and the user prefers .ics email invites over direct API write access), use this pattern to create calendar events.

## Generating .ics Files

Use Python to create RFC 5545-compliant `.ics` files:

```python
ics_template = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Hermes//Calendar//EN
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VEVENT
DTSTART;TZID=America/New_York:{dtstart}
DTEND;TZID=America/New_York:{dtend}
RRULE:FREQ=WEEKLY;COUNT={count};BYDAY={byday}
SUMMARY:{summary}
DESCRIPTION:{description}
LOCATION:{location}
STATUS:CONFIRMED
BEGIN:VALARM
TRIGGER:-PT30M
ACTION:DISPLAY
DESCRIPTION:Starting in 30 min
END:VALARM
END:VEVENT
END:VCALENDAR"""
```

### Key Fields
- `DTSTART`/`DTEND`: format `YYYYMMDDTHHMMSS`, with `TZID=America/New_York`
- `RRULE`: `FREQ=WEEKLY;COUNT=N;BYDAY=MO,TU,WE,TH,FR,SA,SU`
- `VALARM`: `TRIGGER:-PT30M` for 30-minute reminder
- Output to `~/workspace/memory/<name>/` directory

## Emailing .ics Files

Use AgentMail with `--attach`:

```bash
python3 ~/workspace/skills/agentmail/scripts/send_email.py \
  --inbox agent@example.com \
  --to user@example.com \
  --subject "Calendar Invites: <description>" \
  --text "<explanation of what was created>" \
  --attach /home/user/workspace/memory/<path>/<file>.ics
```

### Pitfalls
- **Time zone**: Always use `America/New_York` for the user (Eastern time). UTC conversion errors are common.
- **Schedule conflicts**: Check `gcal.py events user@example.com` for existing commitments before setting times.
- **Recurring vs individual**: Use `RRULE` for recurring (lifts, routines). Use single events (`DTSTART`/`DTEND` without `RRULE`) for one-offs.
- **the user imports these himself** — the .ics arrives as an attachment; he clicks to add to his calendar. Don't expect automatic sync.
- **Agent's inbox is the sender**: `agent@example.com`, not the user's email.
