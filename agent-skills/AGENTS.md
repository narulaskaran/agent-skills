# AGENTS.md — Rules for AI agents working in this repo

## CRITICAL: Zero PII Policy

This is a PUBLIC repository. Never commit personal information. This includes:

### Banned patterns — block commit immediately
- Real names (first + last)
- Email addresses (any domain)
- Physical addresses (street, city, zip combinations)
- Phone numbers (any format)
- Payment method IDs (Stripe `csmrpd_*`, `pm_*`, `card_*`)
- SPT tokens (`spt_*` longer than placeholder length)
- API keys, credentials, secrets (any format)
- Non-localhost IP addresses
- Filesystem paths with usernames (`/home/<realuser>/`)
- URLs containing real names or usernames
- Last 4 digits of real payment cards

### Allowed (use these instead)
- Placeholder names: `Jane Doe`, `John Smith`, `Alice Example`
- Placeholder emails: `user@example.com`, `agent@example.com`
- Placeholder addresses: `123 Main St, Anytown, ST 12345`
- Placeholder IDs: `pm_visa_xxxxxxxxxxxx`, `spt_example123456789`
- Localhost IPs only: `127.0.0.1`
- Generic paths: `/home/user/`, `~/`

### Code examples in skills
When including curl commands, API payloads, or code samples:
- Replace real data with `<>` placeholders: `<UUID>`, `<lsrq_id>`, `<spt_token>`
- Replace real addresses with fake ones
- Replace real payment method IDs with fictional ones
- Never include real credentials even in "examples"

### Before committing
Run the pre-commit hook check:
```bash
.git/hooks/pre-commit
```

### If you accidentally commit PII
1. Do NOT push
2. Amend the commit immediately
3. If already pushed, scrub history with `git filter-branch` + force push

### Pre-commit hook
This repo has a pre-commit hook at `.githooks/pre-commit`. Install with:
```bash
git config core.hooksPath .githooks
```
