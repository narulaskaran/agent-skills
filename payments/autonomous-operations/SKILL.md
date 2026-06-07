---
name: autonomous-operations
description: End-to-end workflows for autonomous agent actions involving external systems, payments, and communication.
---

# Autonomous Operations ⚙️

This umbrella skill governs workflows where the agent acts autonomously in the real world, focusing on high-stakes operations like financial transactions and programmatic communication.

## 💰 Autonomous Spending & Payments

### Spend-Request Workflow
Strict verification protocol for spending money on the user's behalf via Link CLI.
1. **Research**: Identify exact item, price, and merchant. Factor in taxes (~8.875% NYC) and shipping.
2. **Queue**: Create a task in the queue with a verifiable validation string.
3. **Request**: Use `link-cli-wrapper.py spend-request create` and present the `approval_url`.\n   - **Limit Alert**: Link CLI has a limit of 5 active spend requests. If you hit a 409 error, you must identify and resolve stale requests before creating a new one.\n4. **Execute**: Use `agent-browser` for checkout. Snapshot page first to get correct refs.
5. **Verify**: Confirm transaction in Link app, then run `verify_task_complete.py`.

### Guardrails
- **Budgeting**: Target base prices 15-25% below hard caps to account for extras.
- **Merchant Verification**: Double-check URLs; avoid generic companies for boutique requests.
- **The \"Promise\" Trap**: Execute the tool call immediately; never end a turn with a promise of future action.
- **Reliability > Speed**: For any non-trivial operation (multi-step, external impact, or background trigger), prioritize mechanical verification over a fast reply. Do not just trigger a background process (like a cron job) and promise a result; queue a verification task to ensure the operation actually succeeded and the state was updated.

### Stripe Elements Checkout (PCI Iframe Technique)

**For Shopify stores, prefer the dedicated `shopify-stripe-checkout` skill** — it has the full Autobrowse-synthesized workflow. This section covers the core CDP technique for non-Shopify Stripe checkout.

**The local browser has CDP on port 9222.** For standard e-commerce sites (Shopify, WooCommerce, indie stores), the entire checkout can be done locally at zero cost:

1. `browser_navigate` to checkout page
2. `browser_click`/`browser_type` for address, contact info, shipping selections
3. For card fields, use `browser_cdp` to interact with Stripe Elements PCI iframes:
   - `browser_cdp` `Target.getTargets` to find Stripe iframe target IDs
   - `browser_cdp` `Runtime.evaluate` with `target_id` to focus input inside iframe
   - `browser_cdp` `Input.insertText` to type card details (real keystroke simulation)
4. `browser_click` to submit payment
5. Verify order confirmation page loads

**Critical:** NEVER use `.value =` or `dispatchEvent` for Stripe Elements fields. Stripe ignores DOM value changes and checks `event.isTrusted`. Only `Input.insertText` (real keystrokes) works.

**Browserbase is only needed for:** Steam, PayPal, Amazon, Apple Store (anti-bot protection).

See `scripts/checkout_flow.sh` for a quick reference, and `references/stripe-elements-cdp-technique.md` for the full technical breakdown.

## 🔄 State-Change Monitoring → Triggered Purchase

### Pattern
When the user wants to buy something that's not yet available (site overloaded, pre-order closed, item out of stock), set up **cron-based site monitoring** that triggers the spend-request flow on state change:

1. **Identify the state signal** — What DOM text indicates "not ready" vs "ready"?
   - Paused: "PLEDGES PAUSED", "temporarily disabled", "out of stock", "sold out"
   - Open: active button, pledge form, "add to cart", "buy now"
2. **Create a cron job** with `browser` + `web` toolsets (needed for dynamic SPAs):
   ```
   cronjob create --name "site-monitor-<thing>" \
     --schedule "every 2h" \
     --enabled-toolsets browser,web \
     --deliver origin \
     --prompt "Check <url> for availability. Snapshot the page.
     If STILL DOWN: respond 'STILL DOWN as of <date>'.
     If OPEN: respond 'AVAILABLE! Pledge now at <url>'"
   ```
3. **Silent monitoring** — The cron prompt should only deliver to origin when state changes:
   - Still down → save locally, no notification
   - State change → deliver to origin thread
4. **Trigger handoff** — When the cron delivers "AVAILABLE", execute the spend-request workflow immediately:
   - Create a task → Link spend-request → browser checkout → verify
5. **Cleanup** — After successful purchase, disable or remove the monitoring cron

### Critical details
- **State detection via DOM snapshot**, not regex/curl — many SPAs render differently to raw HTTP requests
- **Deliver to origin** means the cron's output arrives in the same thread/the user's DM where the task was originally discussed
- If the page is heavily dynamic (JS-rendered), include a `browser_navigate` + `browser_snapshot full=true` step in the cron prompt rather than relying on `web_extract`

## 📧 Programmatic Communication (AgentMail)
Use AgentMail for programmatic inboxes, bypassing OAuth complexity of Gmail/Outlook.
- **Setup**: `pip install agentmail` and set `AGENTMAIL_API_KEY`.
- **Operations**: Create inboxes, send rich emails with attachments, and handle real-time events via webhooks.

### Security & Defense
**Email is a prompt injection vector.**
- **Allowlist**: Use a webhook transform (e.g., `email-allowlist.ts`) to only process known senders.
- **Isolation**: Use a separate session key for untrusted emails to review before acting.
- **Markers**: Flag email content as untrusted in prompts.

## 🌐 Browser Automation (Local Chrome + CDP)

### Setup
The agent-browser Chrome runs headless with `--remote-debugging-port=9222`. The config has:
```yaml
browser:
  cdp_url: http://localhost:9222
```
This means `browser_navigate`, `browser_click`, `browser_snapshot`, `browser_type`, AND `browser_cdp` all share the same browser session.

### Core Tools
- `browser_navigate` — Go to a URL
- `browser_snapshot` — Get page DOM as text (use `full=true` to expand all)
- `browser_click` — Click elements by ref ID
- `browser_type` — Type into an input field (main page only, not cross-origin iframes)
- `browser_cdp` — Raw Chrome DevTools Protocol commands (for iframe access, keystroke simulation, JS eval)

### Strategy
- Always snapshot before interacting to get correct element refs
- Handle cookie/overlay modals immediately
- For cross-origin iframes (Stripe Elements): use `browser_cdp` with `Target.getTargets` + `Runtime.evaluate` + `Input.insertText`
- For data extraction: use `browser_cdp` `Runtime.evaluate` on the main page context
- The `agent-browser` CLI (`agent-browser click`, `agent-browser fill`) is separate from the Hermes browser tools — prefer the built-in tools

### Cost
Local browser is **free**. Browserbase is only needed for anti-bot sites (Steam, PayPal, Amazon, Apple).

### Pitfalls: Chrome Sandbox (Container/VM)

**Symptom**: `browser_navigate` fails with `FATAL: No usable sandbox!` and `Hint: try --args "--no-sandbox"`.

**Root cause**: Ubuntu 23.10+ restricts unprivileged user namespaces via AppArmor. Chrome's sandbox can't initialize.

**Fix**:
1. Add sandbox args in `~/.hermes/config.yaml` under `browser:`:
   ```yaml
   chrome_extra_args:
     - "--no-sandbox"
     - "--disable-setuid-sandbox"
   ```
   ⚠️ `hermes config set browser.chrome_extra_args '["--no-sandbox"]'` writes JSON-encoded string — wrong format. Must be YAML list. Patch config.yaml manually.

2. **Gateway restart required** — config changes to `chrome_extra_args` don't take effect until the gateway restarts. But never run `hermes gateway restart` mid-session (it kills your own session).

3. If restart isn't possible (mid-session), fall back to:
   - Static analysis + session trace synthesis (for skill authoring)
   - Browserbase (if configured)
   - `web_extract` + `curl` for page content

**Autobrowse synthesis (browser-down fallback)**: When the local browser is broken and you need to create a skill via Autobrowse methodology, you can synthesize from prior session traces + static page analysis. Use `session_search` to find detailed traces of the target site, combine with `curl`/`web_extract` for current page structure, and document patterns. This is faster than live browsing and produces the same quality for well-trodden sites. Caveat: JS-rendered SPAs won't yield variant/selector data via curl — rely on session traces for interactive element discovery.

### Related Skills
- `shopify-stripe-checkout` — comprehensive Shopify+Stripe checkout (Autobrowse-synthesized). Supersedes inline Stripe Elements guidance above for ecommerce checkouts.
- `postalform-checkout` — browser-based PostalForm website checkout (Path C fallback).

### 🔁 Self-Improvement (Autobrowse Loop)

**Browser tasks self-improve automatically.** Every time you use browser tools and something goes wrong or is inefficient, you trigger the autobrowse improvement loop. Do NOT wait for the user to ask.

**Trigger conditions** (any of):
- Browser task uses >10 snapshots (target: ≤5)
- Same site pattern fails repeatedly across sessions
- Discover faster path (API, direct URL, HTML parsing) not yet documented
- Hit new site type that will be visited again

**Response**: Load `autobrowse-workflow` skill and run the loop:
1. Study trace/delegate_task summary — identify exact failure turn
2. Form one hypothesis — what single heuristic would have prevented it?
3. Update `~/.hermes/autobrowse/tasks/<site>/strategy.md`
4. Re-run with updated strategy via `delegate_task`
5. Judge: pass/progress → keep; regression → revert, try different hypothesis
6. Repeat until 2+ clean passes then graduate: `skill_manage create` → push to `narulaskaran/agent-skills`

**Default behavior, not opt-in.** Browser inefficiency → autobrowse. the user should never have to say "improve this." Just do it.

## 📦 Skill Publishing (Agent Skills Repo)

When a new skill is created or updated, publish it to the public `narulaskaran/agent-skills` repo for sharing, community contributions, and durable version history. See `references/agent-skills-repo.md` for the full clone → copy → push workflow.

## 🧳 Travel Trip Monitoring & Prep

### Trip Detection (Multi-Source Cross-Reference)
When checking for upcoming trips (e.g., via wanderlog-monitor cron or proactively):
1. **Scan Google Calendar** — look for flights (LGA→CHS style format), multi-day events, birthday/anniversary events
2. **Wanderlog direct access** — `browser_navigate` to wanderlog.com requires OAuth login (Google/Apple/Facebook). No stored credentials exist; skip if unauthenticated.
3. **Search AgentMail inbox** for travel signals — Wanderlog invites come from `no-reply@wanderlog.com` with subject "XYZ invited you to view..." containing the trip name in quotes. Also search for hotel confirmations, flight receipts.
4. **Cross-reference** calendar events with email confirmations to build the trip picture (dates, destinations, purpose)
5. **If within 2-week window**, surface prep tasks and queue them

### Trip Prep Task Queue
When a trip is confirmed within 2 weeks, queue `travel_prep` type tasks:
- **Accommodation**: Verify hotel/Airbnb booking exists (check inbox for confirmation emails)
- **Gifts**: Identify events (birthdays, anniversaries) and note gift sourcing needed
- **Packing list**: Create at `notes/areas/travel-packing.md`
- **Calendar blocks**: Add "Pack for [destination]" and "Depart to [airport]" reminders before departure
- **Return blocks**: Add departure reminder for return flight

### Tool-Specific Notes
- **gcal.py** only supports `events` and `list` subcommands — **no `create`**. Calendar blocks for travel prep must be created via Google Calendar API directly (or a script that extends the API). Attempting `gcal.py create` returns "Unknown command: create".
- **ICS invite pattern**: When GCal write access is unavailable (or the user prefers email-based invites), generate `.ics` files and email them as attachments. See `references/ics-calendar-invites.md` for the template and AgentMail workflow.
- **AgentMail SDK**: Fetching individual messages uses `am.inboxes.messages(inbox_id)` (not `.message()`). The `.inboxes` attribute (not `.inbox`). Use `dir(am)` on the AgentMail client object to discover the correct API surface.
- **Wanderlog access**: No credentials or cookies stored. The trip name and details come through invite emails to the AgentMail inbox.

## 🔑 API Service Signup & Key Retrieval

### Pattern: Fresh Signup
When the task is to sign up for an external API service (DeepSeek, new LLM provider, any service requiring browser registration + email verification):

1. **Browser signup flow**:
   - Navigate to the service's signup page (often a `/sign_in` URL with a "Sign up" link)
   - Fill in the agent's own email (AgentMail inbox, e.g. `agent@example.com`)
   - Generate a secure password and store it for reference
   - Click "Send code" or the verification trigger
   - **Verify the button changed state** (e.g. "Send code" → "Resend after 52s") to confirm the email was actually sent — the page may show no visual confirmation otherwise

2. **Read verification code from AgentMail inbox**:
   - First list messages: `export AGENTMAIL_API_KEY=$(cred get AGENTMAIL_API_KEY) && python3 scripts/check_inbox.py --inbox agent@example.com`
   - Find the verification email (it's usually the newest message from the service)
   - Extract the message ID (the first field of each entry, in angle brackets)
   - Read the email content using the Python SDK (not shell-quoted inline python — write a temp script file instead, see the reference file)
   - Search for a 6-digit code in the email body using regex `\b(\d{6})\b`
   - **Pitfall**: The SDK's `get()` method requires the exact `inbox_id` plus `message_id` including angle brackets. `AgentMail(api_key=...)` requires keyword argument.

3. **Submit code and complete registration**:
   - `browser_type` the verification code into the "Code" field
   - If the "Sign up" button is disabled, wait for the countdown/resend to finish first
   - Click "Sign up" / submit

4. **Retrieve API key**:
   - After login, navigate to the API keys section (usually `/api_keys` or `/account/api-keys`)
   - Create a new API key. **Browser pitfall**: if the button is a `

### When to Sunset
When the user says to kill an integration (e.g., "sunset Kalshi", "turn off X", "stop doing Y"), execute a **complete teardown** — not just disabling the main feature. Half-measures leave dangling crons, stale files, and memory references that burn tokens and confuse future sessions.

### Sunset Checklist

1. **Kill primary crons (Hermes)** — Use `cronjob list` to identify and `cronjob remove` on any cron dedicated to the integration:
   - Market monitors, watchdog loops, periodic research jobs
   - Search cron prompts for the integration name

2. **Check system crontab too** — Not all crons run via Hermes. Run `crontab -l` and grep for the integration name. Remove stale entries with `crontab -l | grep -v <pattern> | crontab -`. This is a common blind spot — Hermes-managed crons and system crontab are independent. Sunsetting only Hermes crons leaves dangling system crons that silently waste resources.

3. **Purge references from remaining Hermes crons** — Scan ALL active cron prompts for mentions of the integration:
   - Proactive engines, weekly syntheses, orchestrators
   - Update each cron's prompt via `cronjob update` to remove references

4. **Delete state files** — The integration likely accumulated data files:
   - `ls memory/<integration>-*` to find them
   - `rm` all state files (JSON, JSONL, MD, snapshots, reconstructions)

4. **Update user-facing docs**:
   - `MEMORY.md` — Replace preference/config entries with a sunset note (date + reason)
   - `USER.md` — Update the strategic context section to remove the integration

5. **Update internal memory** — Find and replace the memory tool entry referencing the integration

6. **Remove proposals/configs** — Check `memory/proposals.json` or similar files

### Verification
After teardown:
- `cronjob list` — confirm no crons reference the integration
- `crontab -l | grep <integration>` — confirm no system crontab entries survive (common blind spot)
- `ls memory/<integration>-*` — confirm no state files remain
- `grep -r <integration> MEMORY.md USER.md` — confirm docs are clean

### Pitfalls
- **Dangling references in cron prompts** are the most common failure — the cron doesn't error, it just wastes tokens scanning for something that doesn't exist
- **Memory tool entries** use exact string matching for replace — read the dump first to get the right prefix
- **Don't just pause crons** — remove them. Paused crons still register in the list and will waste a scan on every list operation
- **OpenRouter daily key limits** — even with valid API keys, OpenRouter can throttle with `"Key limit exceeded (daily limit)"`. Vision calls (which are heavier) are the first to get throttled. If vision_analyze returns 403, check the OpenRouter dashboard at https://openrouter.ai/settings/keys before debugging code.
- **Vision model silent-failure footgun**: When the configured vision model fails (400, 403, etc.), Hermes falls back to **"auto" vision backends** — which can route to any available provider, including models you explicitly wanted to avoid. A misconfigured vision model doesn't just fail; it silently burns credits on the fallback path. This is how Gemini charges appeared after switching to Gemma 4: Gemma 4 rejects OpenAI-format `image_url` messages, Hermes falls back to auto, auto picks Gemini. **Always verify the vision model actually works for your image format before considering the migration done.** See `references/vision-model-compatibility.md` for the known-working models and pricing.

See `references/kalshi-sunset-example.md` for a full transcript of a real sunset operation (Kalshi, May 2026).

## ✅ Task Finalization & Exit Gate

When closing out any non-trivial task, the exit-gate loop is mandatory. See `references/task-finalization-pattern.md` for the exact sequence, common pitfalls (validation status vs. queue status, security scanner false positives), and workarounds.

## 🔧 Cron Job Reliability — Push-Based Failure Handling

### Principle
**System-level reliability, not memory-dependent.** Don't rely on session-start checks, watchdogs, or "remembering to look." Cron failures should auto-trigger investigation immediately.

### Pattern: `hermes -z` Auto-Investigation on Failure

Every `no_agent=true` script cron should use a `.sh` wrapper that spawns investigation on failure:

```bash
#!/bin/bash
# Wrapper: on failure, spawns investigation agent via hermes -z.
# Exits 0 to suppress cron failure notification — investigation agent handles comms.

ERRFILE="/tmp/<job_name>_error.log"

if <actual_command> 2>"$ERRFILE"; then
    exit 0
fi

ERROR_SUMMARY=$(tail -5 "$ERRFILE" | tr '\n' ' | ' | sed 's/[^[:print:]]//g' | cut -c1-400)
hermes -z "Cron '<job_name>' (job <job_id>) failed: $ERROR_SUMMARY. Investigate root cause, fix if you can. Only notify the user if unfixable." \
    --accept-hooks 2>/dev/null &
exit 0
```

**Why this works**: `hermes -z` is one-shot mode — full agent with tools, prints final response to stdout, approvals auto-bypassed. Spawning it in background from the failing script creates an immediate push-based investigation. No polling, no watchdog, no waiting for next session.

**Key details**:
- Exit 0 from wrapper suppresses cron system's failure notification — investigation agent decides whether to notify
- Error summary passed in prompt so investigation agent has context
- `--accept-hooks` needed for headless/CI environments

### Pitfall: Cron Runner Interpreter

The `no_agent=true` cron runner executes `.sh`/`.bash` extensions via bash, **everything else via Python**. This means `.js` scripts fail with `SyntaxError: invalid syntax` — Python tries to parse JavaScript.

**Fix**: Always use a `.sh` wrapper for non-bash scripts. Bash wrapper delegates to the real interpreter (`node`, `python3`, etc.).

**Symptom**: Cron failure shows Python syntax error on JavaScript code. Not a script bug — wrong interpreter.

### Anti-Pattern: Watchdog Polling

Do NOT create a separate cron that periodically scans for failures. It burns tokens checking healthy jobs, adds latency (up to polling interval), and creates its own failure surface. Push-based (`hermes -z` from wrapper) is strictly better: zero added cost on success, instant on failure.

### Cron Job Output Quality — Delivery Anti-Patterns

**The "Done. Saved." anti-pattern**: When a cron job has `deliver: telegram`, the agent's final reply IS what the user sees. If the prompt says "save to file" + "done", the user gets "Done. Saved to file." — not the actual content. The file is invisible to him.

**Fix**: The prompt must explicitly say: "YOUR FINAL REPLY IS THE BRIEFING. the user sees ONLY your final reply. Do NOT say 'done' or 'saved to file.'"

**The preamble leakage anti-pattern**: Agent adds internal status notes ("Thread not found", "Ready to assemble briefing", "No new messages — here you go") BEFORE the actual briefing. These leak into the delivered Telegram message as noise. the user doesn't need to know the agent checked AgentMail and found nothing — he just needs the briefing.

**Fix**: Prompt must say: "CRITICAL: No preamble. No status notes like 'Thread not found' or 'Ready to assemble.' No 'AgentMail: quiet' as a separate section header. Your final reply IS the briefing — start directly with the date header. If AgentMail has results, fold them into the briefing body. If nothing, don't mention it at all."

**Telegram delivery truncation (intermittent)**: Cron→Telegram delivery can truncate messages mid-word at ~460 bytes despite being well under Telegram's 4096-char limit. The output file is always complete — this is a delivery pipeline bug, not a generation issue. No special characters or format triggers identified; appears intermittent across runs.

**Workaround**: Keep cron-delivered briefings under 800 chars. Drop internal notes, status lines, and file-write confirmations from the final response — they waste bytes and trigger the anti-patterns above. Verify completeness in the output file (`~/.hermes/cron/output/<job_id>/`) if truncation is suspected.

**File writes are internal plumbing**: Only write intermediate files if they're consumed by a subsequent step (e.g., next day's scan reading prior scans). If nothing reads the file, skip it — deliver directly. the user shouldn't have to ask "what's in the file?" — the content should already be in his Telegram.

**Missing `enabled_toolsets`**: Cron jobs with no `enabled_toolsets` have NO tools — not even `memory`. This causes silent failures where the agent falls back to file writes and delivers a hollow "Done" message. Always set `enabled_toolsets` explicitly to include everything the job needs (terminal, file, web, search, skills, session_search, memory, kanban).

**Content filtering — memory tool DOES NOT WORK in cron**: The `memory` tool is systematically unavailable in cron environments. Root cause: `cron/scheduler.py` line 1452 hardcodes `skip_memory=True` for ALL cron jobs (`# Cron system prompts would corrupt user representations`). Memory content is never injected into the system prompt AND the memory tool itself refuses to operate.

**DO NOT use hardcoded suppression lists in cron prompts.** That's brittle, doesn't scale, and requires editing the prompt every time the user corrects something. the user will rightfully call this a hack.

**Instead, read memory files directly via `read_file`.** Memory is stored as plain markdown at:
- `~/.hermes/memories/MEMORY.md` — agent's notes (cancellations, preferences, conventions)
- `~/.hermes/memories/USER.md` — user profile

These are plain files — `read_file` always works in cron. Add this as STEP 0 in any context-aware cron prompt:
```
STEP 0 — READ MEMORY FIRST. Use read_file to load ~/.hermes/memories/MEMORY.md and
~/.hermes/memories/USER.md. These are canonical. Cross-reference every item you find
against them. If memory says cancelled/NOT happening — omit entirely, no matter what
prior scans or session_search surface.
```

This is self-healing: when the user tells you "X is cancelled" → you save to memory → next cron run reads the updated file → suppression happens automatically. No prompt edits needed.

See `references/cron-memory-workaround.md` for the full root cause (scheduler.py line 1452), file paths, and verification steps.

**Anti-pattern**: Saving a cancellation to memory and assuming cron jobs will pick it up (they won't — `skip_memory=True`). Also anti-pattern: hardcoding the suppression into the cron prompt (brittle, doesn't scale across multiple crons).

## 🔄 Session Startup — Proactive Work Detection

When starting a new session (whether user-initiated or cron), immediately check for pending work before waiting to be asked:

1. **Check Kanban board**: `hermes kanban list` — any tasks in `ready` or age >5 min? These are tasks the dispatcher may have missed. Process them directly.
2. **Check AgentMail inbox directly** — don't rely on Kanban board alone. Load `email-monitor` skill for the correct access pattern: extract API key from system crontab (`crontab -l | grep -oP 'AGENTMAIL_API_KEY="\K[^"]+'`) then curl the API directly (`curl -s -H "Authorization: Bearer $KEY" "https://api.agentmail.to/v0/inboxes/agent@example.com/threads?limit=20&unread=true"`). The `agentmail` skill's Python SDK reference has a hardcoded key that may be stale — prefer curl. Search for unread threads from `user@example.com` specifically.
3. **Check Kanban for unprocessed email tasks**: `hermes kanban list` and grep for "Email:" prefix. These are high-value because the user likely expects auto-processing.
4. **Act immediately**: If pending tasks exist or unread emails found, process them without waiting. Don't report "found X pending tasks" — just do the work and report results.

### Why This Matters
The email-to-Kanban pipeline (email_monitor.py → Kanban task → dispatcher → worker) can break silently between task creation and worker execution. Additionally, the monitor's state file may already have fingerprints for threads that the user later replied to — making them appear as "unread" in AgentMail but invisible to the monitor (fingerprint unchanged because the monitor processed the original, not the reply). Direct inbox checking catches both failure modes. When the user says "why didn't you auto-ingest this?", the root cause is almost always a dispatcher gap or a state-fingerprint blind spot.

## 🧠 Token Budget & Cost Management

For the full token optimization methodology — context audit, input trimming, output compression (caveman mode), cost monitoring, and cron bomb detection — load the `token-efficiency` skill. This section covers only the operational checklist for autonomous-ops scenarios.

### When the User Caps Daily Spend

When the user imposes a daily token/spend budget, execute a **systematic cost-reduction pass**.

### Quick Cost-Reduction Checklist

1. **Audit all LLM-powered crons** — classify: high-value/user-facing (keep or reduce frequency) vs low-value/internal-only (pause immediately).
2. **Trim context loaded every turn** — merge redundant memory entries, prune stale integrations, compact opinion files.
3. **Default to cheaper model paths** — route simple lookups to cheapest available model.
4. **Replace LLM crons with zero-LLM scripts** — email monitor already does this.
5. **Log what was paused/trimmed** — update memory so next session knows the state.

### Cron-Specific Pitfalls
- **Don't wrap deterministic scripts in Hermes crons** — a Hermes cron launches a full LLM agent session per invocation even with `terminal`-only toolsets. Use system crontab for deterministic scripts.
- **Don't create a Hermes cron to manually process Kanban tasks** — the built-in dispatcher sweeps every 60 seconds and spawns isolated workers.
- **"No models provided" error**: stale workdir from migration. Delete and recreate cron without workdir.
- **Canonical maintenance cron trio**: Memory Consolidation (every 2d, `local`), Harness Maintenance (every 6h, `local`), Weekly Synthesis (every 7d, `telegram`). The Harness Maintenance cron follows the full procedure in `references/system-health-check.md` — gateway health, disk usage, cron audit, stale task cleanup, and error log scan.
- **Cron bombs**: >100 sessions in <5 days is a red flag. Pause immediately, then investigate. See the `token-efficiency` skill for the full cost audit methodology and cron-bomb detection script.
