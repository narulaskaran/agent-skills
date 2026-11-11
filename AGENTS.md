# AGENTS.md

Instructions for coding agents working in this repository.

## Setting Nano up for someone

Goal: a running `nano` container that answers the owner's iMessages.

1. Check prerequisites: `docker --version` and `docker compose version` both work.
2. `cp .env.example .env`, then collect the four required values from the person. Do not invent any of them.
   - `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET`: they sign up at https://app.photon.codes, create a project, enable iMessage, register their phone number, and copy the two values from project settings.
   - `NANO_ALLOWED_USERS`: their own phone number in E.164 form (for example `+15551234567`).
   - One model key. Default is `DEEPSEEK_API_KEY`. For another provider, set its key and change `NANO_MODEL` to `provider/model-id`.
3. Write the values into `.env` yourself. Never print secret values back, and never commit `.env`.
4. `docker compose build`, then `docker compose run --rm nano node /app/src/index.ts --check`. It must end with `nano: check ok`. If it reports a problem, fix exactly what it names.
5. `docker compose up -d`, then `docker compose logs --tail 30 nano`. Expect `Spectrum started` and `nano: listening on photon`.
6. Ask the person to text their Photon number. A reply within a minute means setup is done. The first conversation is an onboarding chat; nothing else needs configuring by hand.

If there is no reply: check the logs for `ignoring message from non-allowed sender` (the allow-listed number does not match the sending number) or a model error (bad or missing key).

## Working on the code

- Node 24, TypeScript run directly with no build step. Use erasable syntax only (no enums, no parameter properties).
- `npm run typecheck && npm test` must pass before you call a change done.
- Test conversation behaviour locally with `NANO_CHANNEL=stdin` and a throwaway `NANO_DATA_DIR`.
- Keep the runtime small. Prefer a skill (Markdown in `skills/<pack>/`) over new runtime code when instructions are enough.
- `@spectrum-ts/*` and `@earendil-works/pi-*` are pinned to exact versions; both ship breaking changes. Read their type definitions in `node_modules` before changing calls into them.

## Zero personal data

This is a public repository. Never commit personal information:

- real names, email addresses, phone numbers, physical addresses
- API keys, tokens, secrets, payment method or token IDs, card digits
- non-localhost IP addresses, filesystem paths containing a username
- anything from `data/` (sessions, logs, profile, knowledge base)

Use placeholders instead: `Jane Doe`, `user@example.com`, `+15551234567`, `123 Main St, Anytown, ST 12345`, `pm_visa_xxxxxxxxxxxx`, `/home/user/`, and `<angle-bracket>` placeholders in command examples.

A pre-commit hook scans staged files. Install it with `git config core.hooksPath .githooks`. If you commit personal data by accident, do not push; amend the commit first.
