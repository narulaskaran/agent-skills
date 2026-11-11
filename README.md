# Nano

A small personal agent you text over iMessage. It runs as one Docker container, built on the [Pi](https://pi.dev) agent SDK, and reaches iMessage through [Photon](https://photon.codes). No Mac, no public URL, no other chat platforms.

What it does today:

- **Chat over iMessage** with text and images in, text and files out, typing indicators and read receipts. Only allow-listed numbers are answered.
- **Reminders and scheduled jobs** the agent creates itself: one-time messages, conditional reminders, recurring tasks, and script monitors that only speak when something changed.
- **Memory on disk**: a short owner profile, a Markdown knowledge base with index files, and a daily conversation log the agent can search.
- **No session management for you**: after a few hours of silence the next text starts a fresh context window that carries over the last few messages. Long active stretches are compacted automatically.
- **Background tasks**: heavy work (research, browsing, checkout flows) is handed to separate sessions, so Nano keeps answering while it runs and reports back when each one is done. Slow scheduled jobs can run the same way.
- **Optional local model** for private or light work: emails and documents can be sorted and summarised on your own machine without reaching the cloud model.
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
| `NANO_MAX_TASKS` | no | Background tasks running at once, default 3; more wait in a queue |
| `NANO_TASK_TIMEOUT_MINUTES` | no | A background task still running after this is stopped and reported, default 30 |
| `NANO_LOCAL_MODEL`, `NANO_LOCAL_BASE_URL` | no | A local model id and its OpenAI-compatible `/v1` endpoint (llama.cpp, Ollama, ...) |
| `NANO_LOCAL_API_KEY`, `NANO_LOCAL_CONTEXT` | no | Its key if it needs one, and its context window in tokens (default 32768) |

### Background tasks and the local model

The agent hands heavy work to a background task with the `delegate` tool: a separate Pi session with the same tools and skills, minus delegation and messaging the owner. When it ends, only its final answer (not its transcript) is passed back to the main conversation, which tells you about it. Task sessions are kept in `data/sessions/tasks/`, their state in `data/tasks.json`; tasks cut off by a restart are reported once on startup, and results that finished but were not yet relayed are relayed then. Scheduled `task` jobs take `background: true` to run the same way.

Work can ask for the local model in two strengths:

- `model: "local"` prefers the local model and falls back to the main model, with a note, when none is configured.
- `private: true` runs only on the local model and is refused when none is configured. It never falls back to the cloud.

A private task's content stays on the local model, but its final answer goes to the main (cloud) model so Nano can tell you about it. Private instructions should ask for only what you need, such as "amount and due date", not "summarise the email". `ask_local` (a tool) and `nano-local` (a command for scripts, e.g. `nano-local "Is this a bill?" --choices yes,no < mail.txt`) make one-shot classification or extraction calls whose input never enters a conversation.

## Layout

```
src/            the runtime (TypeScript, no build step)
  index.ts      wiring and shutdown
  channel.ts    Photon iMessage channel, plus a stdin channel for local testing
  agent.ts      one conversation: Pi session, idle rollover, message bursts, turn queue
  session.ts    Pi session setup shared by conversations and workers
  tasks.ts      background tasks: queue, limits, persistence, hand-back
  worker.ts     runs a background task in its own Pi session
  models.ts     model runtime, local model provider, main/local/private choice
  local.ts      one-shot local model calls (ask_local, nano-local)
  scheduler.ts  reminders, cron jobs, script monitors, outbox
  packs.ts      pack loading
  tools.ts      tools added on top of Pi's built-ins
  task-tools.ts delegate and task management tools
  prompt.ts     system prompt assembly
bin/            commands on PATH (nano-local)
prompts/        the standing prompt
packs/<name>/   capabilities shipped with Nano
templates/kb/   starter knowledge base for new installs
data/           everything personal: sessions, logs, profile, knowledge base, private packs (git-ignored)
```

All personal state lives in `data/`. Nothing in it belongs in this repository.

## Packs

A pack is a folder that adds one capability. `NANO_PACKS` lists the ones to load.

```
<pack>/skills/<skill>/SKILL.md   Agent Skills, advertised to the model and read on demand
<pack>/extension.ts              optional: tools and hooks (default export `(ctx) => ExtensionFactory`)
<pack>/bin/                      optional: commands put on PATH for the agent's shell
<pack>/install.sh                optional: system dependencies, run when the image is built
<pack>/env.example               optional: settings the pack reads
```

Packs in `packs/` ship with Nano and should be useful to anyone. Your own workflows go in `data/packs/<name>/` with the same layout; they are loaded the same way and never leave your machine.

| Pack | What it adds |
|---|---|
| `core` | Scheduling patterns for reminders, monitors and heartbeats. |
| `purchases` | A headless `browser` command and Stripe Link (`link-cli`) for buying things: virtual cards, Link Pay Tokens, shared payment tokens, HTTP 402 payments. Link's own app approval is the gate. See [packs/purchases](packs/purchases/README.md). |
| `google` | Gmail and Google Calendar through a `google` command, connected over chat. See [packs/google](packs/google/README.md). |
| `mcp` | Any MCP server, listed in `data/pi/mcp.json`, with tools loaded on demand. See [packs/mcp](packs/mcp/README.md). |
| `t3code` | Hands coding work to a T3 Code server and reports back. Needs `mcp`. See [packs/t3code](packs/t3code/README.md). |

Each pack documents its own settings in `packs/<name>/env.example`.

## Sending through Nano from other programs

Anything on the machine can have Nano text the owner by dropping a file into `data/outbox/`: a `.txt` file is sent as is; a `.json` file is `{"text": "...", "kind": "message" | "task"}`, where `task` hands the text to the agent as instructions. Write to a temporary name and rename, so a half-written file is never picked up.

## Development

```bash
npm install --ignore-scripts
npm run typecheck && npm test
NANO_CHANNEL=stdin NANO_DATA_DIR=/tmp/nano-dev DEEPSEEK_API_KEY=... npm start   # type messages on stdin
```
