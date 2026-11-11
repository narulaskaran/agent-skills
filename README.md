# Nano

A small personal agent you text over iMessage. It runs as one Docker container, built on the [Pi](https://pi.dev) agent SDK, and reaches iMessage through [Photon](https://photon.codes). No Mac, no public URL, no other chat platforms.

What it does today:

- **Chat over iMessage** with text and images in, text and files out, typing indicators and read receipts. Only allow-listed numbers are answered.
- **Reminders and scheduled jobs** the agent creates itself: one-time messages, conditional reminders, recurring tasks, and script monitors that only speak when something changed.
- **Memory on disk**: a short owner profile, a Markdown knowledge base with index files, and a daily conversation log the agent can search.
- **No session management for you**: after a few hours of silence the next text starts a fresh context window that carries over the last few messages. Long active stretches are compacted automatically.
- **Web lookups**, a shell and file tools inside the container.
- **Guided first run**: the first conversation asks your name, timezone and what you want help with, then saves them.

## Quick start

You need Docker, a Photon project, and one model API key.

```bash
git clone <this repo> nano && cd nano
cp .env.example .env      # fill in the four required values
docker compose up -d --build
docker compose logs -f nano
```

Then text your Photon number from the phone number you allow-listed. To verify the configuration without connecting, run `docker compose run --rm nano node /app/src/index.ts --check`.

If you hand this repo to a coding agent, point it at [AGENTS.md](AGENTS.md); it has the full setup procedure.

## Configuration

Everything is in `.env` (see [.env.example](.env.example)).

| Variable | Required | Meaning |
|---|---|---|
| `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET` | yes | From your Photon project settings |
| `NANO_ALLOWED_USERS` | yes | Your phone number(s) in E.164 form, comma separated |
| A model key, e.g. `DEEPSEEK_API_KEY` | yes | The key for the provider named in `NANO_MODEL` |
| `NANO_MODEL` | no | `provider/model-id`, default `deepseek/deepseek-flash` |
| `BRAVE_SEARCH_API_KEY` | no | Enables the `web_search` tool |
| `TZ` | no | Fallback timezone until Nano learns yours |
| `NANO_IDLE_HOURS` | no | Silence before a fresh context window, default 4 |
| `NANO_PACKS` | no | Skill packs to load, default `core` |

## Layout

```
src/            the whole runtime (about 1,150 lines of TypeScript, no build step)
  index.ts      wiring and shutdown
  channel.ts    Photon iMessage channel, plus a stdin channel for local testing
  agent.ts      one conversation: Pi session, idle rollover, message bursts
  scheduler.ts  reminders, cron jobs, script monitors
  tools.ts      tools added on top of Pi's built-ins
  prompt.ts     system prompt assembly
prompts/        the standing prompt
skills/<pack>/  Agent Skills, grouped into packs
templates/kb/   starter knowledge base for new installs
data/           everything personal: sessions, logs, profile, knowledge base (git-ignored)
```

All personal state lives in `data/`. Nothing in it belongs in this repository.

## Skill packs

| Pack | Status |
|---|---|
| `core` | Working. Scheduling patterns. |
| `food` | Working. Food diary (calories, protein, fiber) in a SQLite file, through a `food` command. Add `food` to `NANO_PACKS`. |
| `purchases` | Carried over (web checkout, Stripe Link, MPP, postcards); not yet adapted. |

## Development

```bash
npm install --ignore-scripts
npm run typecheck && npm test
NANO_CHANNEL=stdin NANO_DATA_DIR=/tmp/nano-dev DEEPSEEK_API_KEY=... npm start   # type messages on stdin
```
