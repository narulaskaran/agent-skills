# google pack

Gmail and Google Calendar for the owner, through one command, `google`. It uses Node's built-in `fetch` against the Gmail and Calendar REST APIs, with no new npm dependencies and no system packages. Enable it with `NANO_PACKS=core,google`.

```
bin/google                  shell wrapper -> node lib/main.ts
lib/                        CLI (auth, HTTP client, gmail, calendar)
skills/gmail/SKILL.md       email workflows and rules
skills/gmail/references/connect.md   first-time connection, walked through over chat
skills/calendar/SKILL.md    calendar workflows and rules
test/                       unit tests, HTTP mocked (run by `npm test`)
```

`google help` lists every command. Output is compact plain text by default. Text from other people (email bodies, headers, snippets, event titles and descriptions) is wrapped in `<<<EMAIL CONTENT ...>>>` / `<<<CALENDAR CONTENT ...>>>` markers, and the content cannot fake the closing marker. Searches return 10 results by default (50 at most, then `--page`), and bodies are cut at 8000 characters. With several ids the cut is 4000 per message. A thread shares about 12000 characters, at least 800 per message, and shows 20 messages at most.

Safety in the CLI itself:
- `gmail send` previews and exits 2 unless `--confirm-send` is given.
- `calendar delete` needs `--confirm`.
- Calendar writes default to `--send-updates none`.
- One-click unsubscribe never sends the Google token to the sender.
- No command deletes mail.

## Connecting (owner's own token)

The agent walks the owner through [skills/gmail/references/connect.md](skills/gmail/references/connect.md) in chat. In short:

1. In console.cloud.google.com: create a project and enable the Gmail API and Google Calendar API.
2. On the Google Auth Platform / OAuth consent screen, choose External and then **Publish app** ("In production"). An app left in Testing gets refresh tokens that expire after 7 days. Unverified is fine for personal use (fewer than 100 users); the owner clicks through a warning once.
3. Create a client of type **Desktop app** and download its JSON.
4. Run `google auth client <file>` (or `--id/--secret`), then `google auth start`. The owner opens the URL on a phone and approves. The final `http://localhost/?code=...` page fails to load; they paste that address back, and the agent runs `google auth finish '<address>'`.

PKCE (S256) and a `state` check protect the code exchange.

Scopes requested:

| Scope | Why |
|---|---|
| `gmail.modify` | read, search, labels, archive and mark read, drafts, send. It cannot permanently delete. |
| `calendar.events` | read, create, update and delete events |
| `calendar.readonly` | list calendars and query free/busy |

`google auth start --read-only` asks for `gmail.readonly` and `calendar.readonly` only. Commands that need more fail before calling Google, with a message that names what is missing.

### Files

Everything lives in `$NANO_DATA_DIR/google/` (directory 0700, files 0600):

| File | Content |
|---|---|
| `client_secret.json` | the owner's OAuth client, in Google's client-secret format (`{"installed": {...}}`) |
| `token.json` | refresh token, in google-auth's "authorized user" format |
| `cache.json` | the current access token, keyed by a hash of the refresh token |
| `pending.json` | PKCE verifier and state while a sign-in is in progress |

Attachments download to `$NANO_DATA_DIR/workspace/attachments/` unless `--out` says otherwise.

## Using an existing token (shared with another program)

Set either or both variables (see [env.example](env.example)):

- `GOOGLE_TOKEN_FILE`: an authorized-user JSON, as written by google-auth (Python `Credentials.to_json()`, `gcloud`, many agents):
  `{"type": "authorized_user", "client_id", "client_secret", "refresh_token", "token", "expiry", "token_uri", "scopes": [...]}`. Only `refresh_token` is required. `client_id`/`client_secret` may come from the client file instead, and `token` + `expiry` are used as they are while still valid.
- `GOOGLE_CLIENT_SECRET_FILE`: a Google client-secret JSON (`{"installed": {...}}` or `{"web": {...}}`).

These files are **read-only** to Nano. It never rewrites, chmods or deletes them, and `auth start`, `auth finish` and `auth logout` refuse to run while `GOOGLE_TOKEN_FILE` is set. Access tokens Nano refreshes go to its own `$NANO_DATA_DIR/google/cache.json`. If the other program refreshes the shared file, Nano picks up its fresh access token automatically.

The capabilities follow the token's scopes. A token with only `gmail.readonly` + `calendar.readonly` can search, read, list and run freebusy. Drafts, label changes and calendar edits fail with a clear message until someone re-consents with the scopes above in the program that owns the token.

In Docker, mount the file read-only, for example `-v /path/to/google_token.json:/secrets/google_token.json:ro` with `GOOGLE_TOKEN_FILE=/secrets/google_token.json`. Make sure the container user (`NANO_UID`) can read it.

## Keepalive

A refresh token that goes unused for about six months stops working. The skill has the agent schedule a weekly `script` job running `google auth check --quiet`. That command always uses the refresh token and makes one cheap call (the Gmail profile, or the calendar list). It prints nothing on success, and one line on failure. It exits 0 either way, because the scheduler only delivers output from commands that succeed.

## Scripts and a local model (design note)

The runtime is getting a local-model role so bulk inbox triage can stay off cloud models. This pack does not do triage, but its output is meant to be piped:

- `google gmail search '<query>' --format ids --max 500` prints one id per line on stdout. The next-page hint goes to stderr.
- `google gmail read - --format json` reads ids from stdin (at most 50 per call; use `xargs -n 50` for more) and prints one JSON object per message: `id, threadId, flags, from, to, cc, date, subject, attachments, unsubscribe, body`. Bodies are capped by `--max-chars`.
- `google gmail modify - --archive --read` takes ids from stdin as well.
- The exit codes are 0 for success, 1 for errors and 2 for usage problems or a missing confirmation. Nothing is interactive, and errors go to stderr.

A triage job can then stay entirely inside one `script`:
`google gmail search 'in:inbox newer_than:1d' --format ids | google gmail read - --format json --max-chars 2000 | <local model> | ...`
Only the job's final summary reaches the conversation, so message bodies never enter a cloud model's context.

## Tests

`npm test` from the repository root, or `node --test packs/google/test/*.test.ts`. The tests run the CLI in-process with a fake `fetch` and a temporary data dir, so they need no network. Typecheck with `npx tsc --noEmit -p packs/google`.
