# Connecting Nano to T3 Code

Walk the owner through this over chat when `t3code-connect status` says Nano is not connected, the connection expired, or T3 Code rejects the token. It takes the owner about a minute and needs access to the machine T3 Code runs on (a terminal there, or T3 Code's settings).

## 1. Explain and ask for the access level
In two or three short messages: Nano needs a one-time pairing code from T3 Code. With it, Nano can list projects, start threads, send them messages and read their results, for 30 days. Then ask how much the threads Nano starts may do without asking. The levels are T3 Code's runtime modes and act as a ceiling:
- `approval-required` (default): the thread asks the owner in T3 Code before acting.
- `auto-accept-edits`: file edits go ahead without asking.
- `auto`: T3 Code's auto mode.
- `full-access`: no approval limits, and the token also gets settings and source-control rights. Do not suggest it.
- `read-only`: Nano can only look at threads, not start them.

## 2. The owner creates a pairing code
On the T3 Code machine, in a terminal:

    t3 pair --scope orchestration:read --scope orchestration:operate --label Nano

(Only for `full-access`, add `--scope settings:write --scope source-control:write`.) T3 Code's Connections settings can create one too. A code works once and expires after five minutes.

## 3. The owner hands the code to Nano
Ask them to text it in exactly this form, optionally followed by the access level:

    T3 pairing code: <code> auto

Nano removes the code from the message before you see it and redeems it. You receive a note saying whether it worked. Never ask for the code in any other form. If a bare code reaches you anyway, do not use or repeat it; ask for a fresh code in the form above.

Alternative when the owner is at the host: `docker exec -it nano /app/packs/t3code/bin/t3code-connect pair --access <level>`, then paste the code at the prompt.

## 4. Confirm
Run `t3code-connect status`. Tell the owner in one line that Nano is connected, with which access level, and until when. T3 Code's tools become available with their next message.

Schedule a reminder (`schedule_add`, kind `message`) two days before the expiry date: "Nano's T3 Code access ends on <date>. When convenient, run t3 pair --scope orchestration:read --scope orchestration:operate --label Nano on the T3 Code machine and text me 'T3 pairing code: <code>'."

## When it fails
- "unknown, expired, or already used": the code timed out or was used. Ask for a new one.
- "cannot grant this access": the code was created with too few scopes for the level asked for. Ask for a new code with the scopes above, or a lower level.
- Connection refused or timed out: T3 Code is not reachable at `NANO_T3CODE_URL` (default `http://127.0.0.1:4096`). Ask the owner whether T3 Code is running and where.

## Disconnecting
`t3code-connect disconnect` forgets the token on Nano's side. To revoke it in T3 Code as well, the owner removes the "Nano" connection in T3 Code's Connections settings, or runs `t3 auth session list` and `t3 auth session revoke <id>` on the T3 Code machine.
