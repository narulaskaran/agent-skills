1|---
2|name: autonomous-operations
3|description: End-to-end workflows for autonomous agent actions involving external systems, payments, and communication.
4|---
5|
6|# Autonomous Operations ⚙️
7|
8|This umbrella skill governs workflows where the agent acts autonomously in the real world, focusing on high-stakes operations like financial transactions and programmatic communication.
9|
10|## 💰 Autonomous Spending & Payments
11|
12|### Spend-Request Workflow
13|Strict verification protocol for spending money on the user's behalf via Link CLI.
14|1. **Research**: Identify exact item, price, and merchant. Factor in taxes (~8.875% NYC) and shipping.
15|2. **Queue**: Create a task in the queue with a verifiable validation string.
16|3. **Request**: Use `link-cli-wrapper.py spend-request create` and present the `approval_url`.\n   - **Limit Alert**: Link CLI has a limit of 5 active spend requests. If you hit a 409 error, you must identify and resolve stale requests before creating a new one.\n4. **Execute**: Use `agent-browser` for checkout. Snapshot page first to get correct refs.
17|5. **Verify**: Confirm transaction in Link app, then run `verify_task_complete.py`.
18|
19|### Guardrails
20|- **Budgeting**: Target base prices 15-25% below hard caps to account for extras.
21|- **Merchant Verification**: Double-check URLs; avoid generic companies for boutique requests.
22|- **The \"Promise\" Trap**: Execute the tool call immediately; never end a turn with a promise of future action.
23|- **Reliability > Speed**: For any non-trivial operation (multi-step, external impact, or background trigger), prioritize mechanical verification over a fast reply. Do not just trigger a background process (like a cron job) and promise a result; queue a verification task to ensure the operation actually succeeded and the state was updated.
24|
25|### Stripe Elements Checkout (PCI Iframe Technique)
26|
27|**For Shopify stores, prefer the dedicated `shopify-stripe-checkout` skill** — it has the full Autobrowse-synthesized workflow. This section covers the core CDP technique for non-Shopify Stripe checkout.
28|
29|**The local browser has CDP on port 9222.** For standard e-commerce sites (Shopify, WooCommerce, indie stores), the entire checkout can be done locally at zero cost:
30|
31|1. `browser_navigate` to checkout page
32|2. `browser_click`/`browser_type` for address, contact info, shipping selections
33|3. For card fields, use `browser_cdp` to interact with Stripe Elements PCI iframes:
34|   - `browser_cdp` `Target.getTargets` to find Stripe iframe target IDs
35|   - `browser_cdp` `Runtime.evaluate` with `target_id` to focus input inside iframe
36|   - `browser_cdp` `Input.insertText` to type card details (real keystroke simulation)
37|4. `browser_click` to submit payment
38|5. Verify order confirmation page loads
39|
40|**Critical:** NEVER use `.value =` or `dispatchEvent` for Stripe Elements fields. Stripe ignores DOM value changes and checks `event.isTrusted`. Only `Input.insertText` (real keystrokes) works.
41|
42|**Browserbase is only needed for:** Steam, PayPal, Amazon, Apple Store (anti-bot protection).
43|
44|See `scripts/checkout_flow.sh` for a quick reference, and `references/stripe-elements-cdp-technique.md` for the full technical breakdown.
45|
46|## 🔄 State-Change Monitoring → Triggered Purchase
47|
48|### Pattern
49|When the user wants to buy something that's not yet available (site overloaded, pre-order closed, item out of stock), set up **cron-based site monitoring** that triggers the spend-request flow on state change:
50|
51|1. **Identify the state signal** — What DOM text indicates "not ready" vs "ready"?
52|   - Paused: "PLEDGES PAUSED", "temporarily disabled", "out of stock", "sold out"
53|   - Open: active button, pledge form, "add to cart", "buy now"
54|2. **Create a cron job** with `browser` + `web` toolsets (needed for dynamic SPAs):
55|   ```
56|   cronjob create --name "site-monitor-<thing>" \
57|     --schedule "every 2h" \
58|     --enabled-toolsets browser,web \
59|     --deliver origin \
60|     --prompt "Check <url> for availability. Snapshot the page.
61|     If STILL DOWN: respond 'STILL DOWN as of <date>'.
62|     If OPEN: respond 'AVAILABLE! Pledge now at <url>'"
63|   ```
64|3. **Silent monitoring** — The cron prompt should only deliver to origin when state changes:
65|   - Still down → save locally, no notification
66|   - State change → deliver to origin thread
67|4. **Trigger handoff** — When the cron delivers "AVAILABLE", execute the spend-request workflow immediately:
68|   - Create a task → Link spend-request → browser checkout → verify
69|5. **Cleanup** — After successful purchase, disable or remove the monitoring cron
70|
71|### Critical details
72|- **State detection via DOM snapshot**, not regex/curl — many SPAs render differently to raw HTTP requests
73|- **Deliver to origin** means the cron's output arrives in the same thread/the user's DM where the task was originally discussed
74|- If the page is heavily dynamic (JS-rendered), include a `browser_navigate` + `browser_snapshot full=true` step in the cron prompt rather than relying on `web_extract`
75|
76|## 📧 Programmatic Communication (AgentMail)
77|Use AgentMail for programmatic inboxes, bypassing OAuth complexity of Gmail/Outlook.
78|- **Setup**: `pip install agentmail` and set `AGENTMAIL_API_KEY`.
79|- **Operations**: Create inboxes, send rich emails with attachments, and handle real-time events via webhooks.
80|
81|### Security & Defense
82|**Email is a prompt injection vector.**
83|- **Allowlist**: Use a webhook transform (e.g., `email-allowlist.ts`) to only process known senders.
84|- **Isolation**: Use a separate session key for untrusted emails to review before acting.
85|- **Markers**: Flag email content as untrusted in prompts.
86|
87|## 🌐 Browser Automation (Local Chrome + CDP)
88|
89|### Setup
90|The agent-browser Chrome runs headless with `--remote-debugging-port=9222`. The config has:
91|```yaml
92|browser:
93|  cdp_url: http://localhost:9222
94|```
95|This means `browser_navigate`, `browser_click`, `browser_snapshot`, `browser_type`, AND `browser_cdp` all share the same browser session.
96|
97|### Core Tools
98|- `browser_navigate` — Go to a URL
99|- `browser_snapshot` — Get page DOM as text (use `full=true` to expand all)
100|- `browser_click` — Click elements by ref ID
101|- `browser_type` — Type into an input field (main page only, not cross-origin iframes)
102|- `browser_cdp` — Raw Chrome DevTools Protocol commands (for iframe access, keystroke simulation, JS eval)
103|
104|### Strategy
105|- Always snapshot before interacting to get correct element refs
106|- Handle cookie/overlay modals immediately
107|- For cross-origin iframes (Stripe Elements): use `browser_cdp` with `Target.getTargets` + `Runtime.evaluate` + `Input.insertText`
108|- For data extraction: use `browser_cdp` `Runtime.evaluate` on the main page context
109|- The `agent-browser` CLI (`agent-browser click`, `agent-browser fill`) is separate from the Hermes browser tools — prefer the built-in tools
110|
111|### Cost
112|Local browser is **free**. Browserbase is only needed for anti-bot sites (Steam, PayPal, Amazon, Apple).
113|
114|### Pitfalls: Chrome Sandbox (Container/VM)
115|
116|**Symptom**: `browser_navigate` fails with `FATAL: No usable sandbox!` and `Hint: try --args "--no-sandbox"`.
117|
118|**Root cause**: Ubuntu 23.10+ restricts unprivileged user namespaces via AppArmor. Chrome's sandbox can't initialize.
119|
120|**Fix**:
121|1. Add sandbox args in `~/.hermes/config.yaml` under `browser:`:
122|   ```yaml
123|   chrome_extra_args:
124|     - "--no-sandbox"
125|     - "--disable-setuid-sandbox"
126|   ```
127|   ⚠️ `hermes config set browser.chrome_extra_args '["--no-sandbox"]'` writes JSON-encoded string — wrong format. Must be YAML list. Patch config.yaml manually.
128|
129|2. **Gateway restart required** — config changes to `chrome_extra_args` don't take effect until the gateway restarts. But never run `hermes gateway restart` mid-session (it kills your own session).
130|
131|3. If restart isn't possible (mid-session), fall back to:
132|   - Static analysis + session trace synthesis (for skill authoring)
133|   - Browserbase (if configured)
134|   - `web_extract` + `curl` for page content
135|
136|**Autobrowse synthesis (browser-down fallback)**: When the local browser is broken and you need to create a skill via Autobrowse methodology, you can synthesize from prior session traces + static page analysis. Use `session_search` to find detailed traces of the target site, combine with `curl`/`web_extract` for current page structure, and document patterns. This is faster than live browsing and produces the same quality for well-trodden sites. Caveat: JS-rendered SPAs won't yield variant/selector data via curl — rely on session traces for interactive element discovery.
137|
138|### Related Skills
139|- `shopify-stripe-checkout` — comprehensive Shopify+Stripe checkout (Autobrowse-synthesized). Supersedes inline Stripe Elements guidance above for ecommerce checkouts.
140|- `postalform-checkout` — browser-based PostalForm website checkout (Path C fallback).
141|
142|### 🔁 Self-Improvement (Autobrowse Loop)
143|
144|**Browser tasks self-improve automatically.** Every time you use browser tools and something goes wrong or is inefficient, you trigger the autobrowse improvement loop. Do NOT wait for the user to ask.
145|
146|**Trigger conditions** (any of):
147|- Browser task uses >10 snapshots (target: ≤5)
148|- Same site pattern fails repeatedly across sessions
149|- Discover faster path (API, direct URL, HTML parsing) not yet documented
150|- Hit new site type that will be visited again
151|
152|**Response**: Load `autobrowse-workflow` skill and run the loop:
153|1. Study trace/delegate_task summary — identify exact failure turn
154|2. Form one hypothesis — what single heuristic would have prevented it?
155|3. Update `~/.hermes/autobrowse/tasks/<site>/strategy.md`
156|4. Re-run with updated strategy via `delegate_task`
157|5. Judge: pass/progress → keep; regression → revert, try different hypothesis
158|6. Repeat until 2+ clean passes then graduate: `skill_manage create` → push to `narulaskaran/agent-skills`
159|
160|**Default behavior, not opt-in.** Browser inefficiency → autobrowse. The user should never have to say "improve this." Just do it.
161|
162|## 📦 Skill Publishing (Agent Skills Repo)
163|
164|When a new skill is created or updated, publish it to the public `narulaskaran/agent-skills` repo for sharing, community contributions, and durable version history. See `references/agent-skills-repo.md` for the full clone → copy → push workflow.
165|
166|## 🧳 Travel Trip Monitoring & Prep
167|
168|### Trip Detection (Multi-Source Cross-Reference)
169|When checking for upcoming trips (e.g., via wanderlog-monitor cron or proactively):
170|1. **Scan Google Calendar** — look for flights (LGA→CHS style format), multi-day events, birthday/anniversary events
171|2. **Wanderlog direct access** — `browser_navigate` to wanderlog.com requires OAuth login (Google/Apple/Facebook). No stored credentials exist; skip if unauthenticated.
172|3. **Search AgentMail inbox** for travel signals — Wanderlog invites come from their notification address with subject "XYZ invited you to view..." containing the trip name in quotes. Also search for hotel confirmations, flight receipts.
173|4. **Cross-reference** calendar events with email confirmations to build the trip picture (dates, destinations, purpose)
174|5. **If within 2-week window**, surface prep tasks and queue them
175|
176|### Trip Prep Task Queue
177|When a trip is confirmed within 2 weeks, queue `travel_prep` type tasks:
178|- **Accommodation**: Verify hotel/Airbnb booking exists (check inbox for confirmation emails)
179|- **Gifts**: Identify events (birthdays, anniversaries) and note gift sourcing needed
180|- **Packing list**: Create at `notes/areas/travel-packing.md`
181|- **Calendar blocks**: Add "Pack for [destination]" and "Depart to [airport]" reminders before departure
182|- **Return blocks**: Add departure reminder for return flight
183|
184|### Tool-Specific Notes
185|- **gcal.py** only supports `events` and `list` subcommands — **no `create`**. Calendar blocks for travel prep must be created via Google Calendar API directly (or a script that extends the API). Attempting `gcal.py create` returns "Unknown command: create".
186|- **ICS invite pattern**: When GCal write access is unavailable (or the user prefers email-based invites), generate `.ics` files and email them as attachments. See `references/ics-calendar-invites.md` for the template and AgentMail workflow.
187|- **AgentMail SDK**: Fetching individual messages uses `am.inboxes.messages(inbox_id)` (not `.message()`). The `.inboxes` attribute (not `.inbox`). Use `dir(am)` on the AgentMail client object to discover the correct API surface.
188|- **Wanderlog access**: No credentials or cookies stored. The trip name and details come through invite emails to the AgentMail inbox.
189|
190|## 🔑 API Service Signup & Key Retrieval
191|
192|### Pattern: Fresh Signup
193|When the task is to sign up for an external API service (DeepSeek, new LLM provider, any service requiring browser registration + email verification):
194|
195|1. **Browser signup flow**:
196|   - Navigate to the service's signup page (often a `/sign_in` URL with a "Sign up" link)
197|   - Fill in the agent's own email (AgentMail inbox, e.g. `{{PII_AGENTMAIL_ADDRESS}}`)
198|   - Generate a secure password and store it for reference
199|   - Click "Send code" or the verification trigger
200|   - **Verify the button changed state** (e.g. "Send code" → "Resend after 52s") to confirm the email was actually sent — the page may show no visual confirmation otherwise
201|
202|2. **Read verification code from AgentMail inbox**:
203|   - First list messages: `export AGENTMAIL_API_KEY=$(cred get AGENTMAIL_API_KEY) && python3 scripts/check_inbox.py --inbox {{PII_AGENTMAIL_ADDRESS}}`
204|   - Find the verification email (it's usually the newest message from the service)
205|   - Extract the message ID (the first field of each entry, in angle brackets)
206|   - Read the email content using the Python SDK (not shell-quoted inline python — write a temp script file instead, see the reference file)
207|   - Search for a 6-digit code in the email body using regex `\b(\d{6})\b`
208|   - **Pitfall**: The SDK's `get()` method requires the exact `inbox_id` plus `message_id` including angle brackets. `AgentMail(api_key=...)` requires keyword argument.
209|
210|3. **Submit code and complete registration**:
211|   - `browser_type` the verification code into the "Code" field
212|   - If the "Sign up" button is disabled, wait for the countdown/resend to finish first
213|   - Click "Sign up" / submit
214|
215|4. **Retrieve API key**:
216|   - After login, navigate to the API keys section (usually `/api_keys` or `/account/api-keys`)
217|   - Create a new API key. **Browser pitfall**: if the button is a `
218|
219|### When to Sunset
220|When the user says to kill an integration (e.g., "sunset Kalshi", "turn off X", "stop doing Y"), execute a **complete teardown** — not just disabling the main feature. Half-measures leave dangling crons, stale files, and memory references that burn tokens and confuse future sessions.
221|
222|### Sunset Checklist
223|
224|1. **Kill primary crons (Hermes)** — Use `cronjob list` to identify and `cronjob remove` on any cron dedicated to the integration:
225|   - Market monitors, watchdog loops, periodic research jobs
226|   - Search cron prompts for the integration name
227|
228|2. **Check system crontab too** — Not all crons run via Hermes. Run `crontab -l` and grep for the integration name. Remove stale entries with `crontab -l | grep -v <pattern> | crontab -`. This is a common blind spot — Hermes-managed crons and system crontab are independent. Sunsetting only Hermes crons leaves dangling system crons that silently waste resources.
229|
230|3. **Purge references from remaining Hermes crons** — Scan ALL active cron prompts for mentions of the integration:
231|   - Proactive engines, weekly syntheses, orchestrators
232|   - Update each cron's prompt via `cronjob update` to remove references
233|
234|4. **Delete state files** — The integration likely accumulated data files:
235|   - `ls memory/<integration>-*` to find them
236|   - `rm` all state files (JSON, JSONL, MD, snapshots, reconstructions)
237|
238|4. **Update user-facing docs**:
239|   - `MEMORY.md` — Replace preference/config entries with a sunset note (date + reason)
240|   - `USER.md` — Update the strategic context section to remove the integration
241|
242|5. **Update internal memory** — Find and replace the memory tool entry referencing the integration
243|
244|6. **Remove proposals/configs** — Check `memory/proposals.json` or similar files
245|
246|### Verification
247|After teardown:
248|- `cronjob list` — confirm no crons reference the integration
249|- `crontab -l | grep <integration>` — confirm no system crontab entries survive (common blind spot)
250|- `ls memory/<integration>-*` — confirm no state files remain
251|- `grep -r <integration> MEMORY.md USER.md` — confirm docs are clean
252|
253|### Pitfalls
254|- **Dangling references in cron prompts** are the most common failure — the cron doesn't error, it just wastes tokens scanning for something that doesn't exist
255|- **Memory tool entries** use exact string matching for replace — read the dump first to get the right prefix
256|- **Don't just pause crons** — remove them. Paused crons still register in the list and will waste a scan on every list operation
257|- **OpenRouter daily key limits** — even with valid API keys, OpenRouter can throttle with `"Key limit exceeded (daily limit)"`. Vision calls (which are heavier) are the first to get throttled. If vision_analyze returns 403, check the OpenRouter dashboard at https://openrouter.ai/settings/keys before debugging code.
258|- **Vision model silent-failure footgun**: When the configured vision model fails (400, 403, etc.), Hermes falls back to **"auto" vision backends** — which can route to any available provider, including models you explicitly wanted to avoid. A misconfigured vision model doesn't just fail; it silently burns credits on the fallback path. This is how Gemini charges appeared after switching to Gemma 4: Gemma 4 rejects OpenAI-format `image_url` messages, Hermes falls back to auto, auto picks Gemini. **Always verify the vision model actually works for your image format before considering the migration done.** See `references/vision-model-compatibility.md` for the known-working models and pricing.
259|
260|See `references/kalshi-sunset-example.md` for a full transcript of a real sunset operation (Kalshi, May 2026).
261|
262|## ✅ Task Finalization & Exit Gate
263|
264|When closing out any non-trivial task, the exit-gate loop is mandatory. See `references/task-finalization-pattern.md` for the exact sequence, common pitfalls (validation status vs. queue status, security scanner false positives), and workarounds.
265|
266|## 🔧 Cron Job Reliability — Push-Based Failure Handling
267|
268|### Principle
269|**System-level reliability, not memory-dependent.** Don't rely on session-start checks, watchdogs, or "remembering to look." Cron failures should auto-trigger investigation immediately.
270|
271|### Pattern: `hermes -z` Auto-Investigation on Failure
272|
273|Every `no_agent=true` script cron should use a `.sh` wrapper that spawns investigation on failure:
274|
275|```bash
276|#!/bin/bash
277|# Wrapper: on failure, spawns investigation agent via hermes -z.
278|# Exits 0 to suppress cron failure notification — investigation agent handles comms.
279|
280|ERRFILE="/tmp/<job_name>_error.log"
281|
282|if <actual_command> 2>"$ERRFILE"; then
283|    exit 0
284|fi
285|
286|ERROR_SUMMARY=$(tail -5 "$ERRFILE" | tr '\n' ' | ' | sed 's/[^[:print:]]//g' | cut -c1-400)
287|hermes -z "Cron '<job_name>' (job <job_id>) failed: $ERROR_SUMMARY. Investigate root cause, fix if you can. Only notify user if unfixable." \
288|    --accept-hooks 2>/dev/null &
289|exit 0
290|```
291|
292|**Why this works**: `hermes -z` is one-shot mode — full agent with tools, prints final response to stdout, approvals auto-bypassed. Spawning it in background from the failing script creates an immediate push-based investigation. No polling, no watchdog, no waiting for next session.
293|
294|**Key details**:
295|- Exit 0 from wrapper suppresses cron system's failure notification — investigation agent decides whether to notify
296|- Error summary passed in prompt so investigation agent has context
297|- `--accept-hooks` needed for headless/CI environments
298|
299|### Pitfall: Cron Runner Interpreter
300|
301|The `no_agent=true` cron runner executes `.sh`/`.bash` extensions via bash, **everything else via Python**. This means `.js` scripts fail with `SyntaxError: invalid syntax` — Python tries to parse JavaScript.
302|
303|**Fix**: Always use a `.sh` wrapper for non-bash scripts. Bash wrapper delegates to the real interpreter (`node`, `python3`, etc.).
304|
305|**Symptom**: Cron failure shows Python syntax error on JavaScript code. Not a script bug — wrong interpreter.
306|
307|### Anti-Pattern: Waiting for User to Flag Cron Failures
308|
309|**When you receive a cron failure notification (like the Telegram delivery of a failed run), act immediately.** Diagnose the root cause, fix if you can, verify with a manual run. Do NOT wait for the user to say "did you fix?" or "what happened?" — by the time they ask, the fix window is already late. The failure notification IS the trigger to act.
310|
311|**Pattern**: Failure delivered → investigate immediately (check script, run manually, verify state files, check logs) → fix or report. Only escalate to user if unfixable (creds, API keys, subscription, external dependency).
312|
313|### Anti-Pattern: Watchdog Polling
314|
315|Do NOT create a separate cron that periodically scans for failures. It burns tokens checking healthy jobs, adds latency (up to polling interval), and creates its own failure surface. Push-based (`hermes -z` from wrapper) is strictly better: zero added cost on success, instant on failure.
316|
317|### Cron Job Output Quality — Delivery Anti-Patterns
318|
319|**The "Done. Saved." anti-pattern**: When a cron job has `deliver: telegram`, the agent's final reply IS what the user sees. If the prompt says "save to file" + "done", The user sees "Done. Saved to file." — not the actual content. The file is invisible to him.
320|
321|**Fix**: The prompt must explicitly say: "YOUR FINAL REPLY IS THE BRIEFING. The user sees ONLY your final reply. Do NOT say 'done' or 'saved to file.'"
322|
323|**The preamble leakage anti-pattern**: Agent adds internal status notes ("Thread not found", "Ready to assemble briefing", "No new messages — here you go") BEFORE the actual briefing. These leak into the delivered Telegram message as noise. The user doesn't need to know the agent checked AgentMail and found nothing — they just need the briefing.
324|
325|**Fix**: Prompt must say: "CRITICAL: No preamble. No status notes like 'Thread not found' or 'Ready to assemble.' No 'AgentMail: quiet' as a separate section header. Your final reply IS the briefing — start directly with the date header. If AgentMail has results, fold them into the briefing body. If nothing, don't mention it at all."
326|
327|**Telegram delivery truncation (intermittent)**: Cron→Telegram delivery can truncate messages mid-word at ~460 bytes despite being well under Telegram's 4096-char limit. The output file is always complete — this is a delivery pipeline bug, not a generation issue. No special characters or format triggers identified; appears intermittent across runs.
328|
329|**Workaround**: Keep cron-delivered briefings under 800 chars. Drop internal notes, status lines, and file-write confirmations from the final response — they waste bytes and trigger the anti-patterns above. Verify completeness in the output file (`~/.hermes/cron/output/<job_id>/`) if truncation is suspected.
330|
331|**File writes are internal plumbing**: Only write intermediate files if they're consumed by a subsequent step (e.g., next day's scan reading prior scans). If nothing reads the file, skip it — deliver directly. The user shouldn't have to ask "what's in the file?" — the content should already be in their Telegram.
332|
333|**Missing `enabled_toolsets`**: Cron jobs with no `enabled_toolsets` have NO tools — not even `memory`. This causes silent failures where the agent falls back to file writes and delivers a hollow "Done" message. Always set `enabled_toolsets` explicitly to include everything the job needs (terminal, file, web, search, skills, session_search, memory, kanban).
334|
335|**Content filtering — memory tool DOES NOT WORK in cron**: The `memory` tool is systematically unavailable in cron environments. Root cause: `cron/scheduler.py` line 1452 hardcodes `skip_memory=True` for ALL cron jobs (`# Cron system prompts would corrupt user representations`). Memory content is never injected into the system prompt AND the memory tool itself refuses to operate.
336|
337|**DO NOT use hardcoded suppression lists in cron prompts.** That's brittle, doesn't scale, and requires editing the prompt every time the user corrects something. The user will rightfully call this a hack.
338|
339|**Instead, read memory files directly via `read_file`.** Memory is stored as plain markdown at:
340|- `~/.hermes/memories/MEMORY.md` — agent's notes (cancellations, preferences, conventions)
341|- `~/.hermes/memories/USER.md` — user profile
342|
343|These are plain files — `read_file` always works in cron. Add this as STEP 0 in any context-aware cron prompt:
344|```
345|STEP 0 — READ MEMORY FIRST. Use read_file to load ~/.hermes/memories/MEMORY.md and
346|~/.hermes/memories/USER.md. These are canonical. Cross-reference every item you find
347|against them. If memory says cancelled/NOT happening — omit entirely, no matter what
348|prior scans or session_search surface.
349|```
350|
351|This is self-healing: when the user tells you "X is cancelled" → you save to memory → next cron run reads the updated file → suppression happens automatically. No prompt edits needed.
352|
353|See `references/cron-memory-workaround.md` for the full root cause (scheduler.py line 1452), file paths, and verification steps.
354|
355|**Anti-pattern**: Saving a cancellation to memory and assuming cron jobs will pick it up (they won't — `skip_memory=True`). Also anti-pattern: hardcoding the suppression into the cron prompt (brittle, doesn't scale across multiple crons).
356|
357|## 🔄 Session Startup — Proactive Work Detection
358|
359|When starting a new session (whether user-initiated or cron), immediately check for pending work before waiting to be asked:
360|
361|1. **Check Kanban board**: `hermes kanban list` — any tasks in `ready` or age >5 min? These are tasks the dispatcher may have missed. Process them directly.
362|2. **Check AgentMail inbox directly** — don't rely on Kanban board alone. Load `email-monitor` skill for the correct access pattern: extract API key from system crontab (`crontab -l | grep -oP 'AGENTMAIL_API_KEY="\K[^"]+'`) then curl the API directly (`curl -s -H "Authorization: Bearer $KEY" "https://api.agentmail.to/v0/inboxes/{{PII_AGENTMAIL_ADDRESS}}/threads?limit=20&unread=true"`). The `agentmail` skill's Python SDK reference has a hardcoded key that may be stale — prefer curl. Search for unread threads from `{{PII_KARAN_EMAIL}}` specifically.
363|3. **Check Kanban for unprocessed email tasks**: `hermes kanban list` and grep for "Email:" prefix. These are high-value because the user likely expects auto-processing.
364|4. **Act immediately**: If pending tasks exist or unread emails found, process them without waiting. Don't report "found X pending tasks" — just do the work and report results.
365|
366|### Why This Matters
367|The email-to-Kanban pipeline (email_monitor.py → Kanban task → dispatcher → worker) can break silently between task creation and worker execution. Additionally, the monitor's state file may already have fingerprints for threads that the user later replied to — making them appear as "unread" in AgentMail but invisible to the monitor (fingerprint unchanged because the monitor processed the original, not the reply). Direct inbox checking catches both failure modes. When the user says "why didn't the system auto-ingest this?", the root cause is almost always a dispatcher gap or a state-fingerprint blind spot.
368|
369|## 🧠 Token Budget & Cost Management
370|
371|For the full token optimization methodology — context audit, input trimming, output compression (caveman mode), cost monitoring, and cron bomb detection — load the `token-efficiency` skill. This section covers only the operational checklist for autonomous-ops scenarios.
372|
373|### When the User Caps Daily Spend
374|
375|When the user imposes a daily token/spend budget, execute a **systematic cost-reduction pass**.
376|
377|### Quick Cost-Reduction Checklist
378|
379|1. **Audit all LLM-powered crons** — classify: high-value/user-facing (keep or reduce frequency) vs low-value/internal-only (pause immediately).
380|2. **Trim context loaded every turn** — merge redundant memory entries, prune stale integrations, compact opinion files.
381|3. **Default to cheaper model paths** — route simple lookups to cheapest available model.
382|4. **Replace LLM crons with zero-LLM scripts** — email monitor already does this.
383|5. **Log what was paused/trimmed** — update memory so next session knows the state.
384|
385|### Cron-Specific Pitfalls
386|- **Don't wrap deterministic scripts in Hermes crons** — a Hermes cron launches a full LLM agent session per invocation even with `terminal`-only toolsets. Use system crontab for deterministic scripts.
387|- **Don't create a Hermes cron to manually process Kanban tasks** — the built-in dispatcher sweeps every 60 seconds and spawns isolated workers.
388|- **"No models provided" error**: stale workdir from migration. Delete and recreate cron without workdir.
389|- **Canonical maintenance cron trio**: Memory Consolidation (every 2d, `local`), Harness Maintenance (every 6h, `local`), Weekly Synthesis (every 7d, `telegram`). The Harness Maintenance cron follows the full procedure in `references/system-health-check.md` — gateway health, disk usage, cron audit, stale task cleanup, and error log scan.
390|- **Cron bombs**: >100 sessions in <5 days is a red flag. Pause immediately, then investigate. See the `token-efficiency` skill for the full cost audit methodology and cron-bomb detection script.
391|