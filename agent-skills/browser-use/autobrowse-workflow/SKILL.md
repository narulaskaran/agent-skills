---
name: autobrowse-workflow
description: Hermes-native autobrowse methodology — build browser skills through iterative trace-driven improvement. The meta-skill for creating new site-specific browser automation skills. Use when "automate <site> checkout", "build browser skill for <site>", or hitting new sites repeatedly.
version: 1.0.0
---

# Autobrowse Workflow — Hermes-Native Meta-Skill

Build reliable, token-efficient browser automation skills through iterative experimentation. Inner agent browses the site (via `delegate_task`). You — the outer agent — read what happened and improve the strategy file. Repeat until it passes consistently. Graduate to a permanent skill and push to the agent-skills repo.

## Skills Built With This Methodology

| Skill | Category | Key Innovation |
|-------|----------|----------------|
| `shopify-stripe-checkout` | ecommerce | Cart API avoids browser for discovery; CDP `Input.insertText` for Stripe iframes |
| `postalform-checkout` | ecommerce | Parse Inertia.js `data-page` for templates; 5-snapshot budget |
| `postalform-mailing` | ecommerce | Skip browser entirely — MPP API + Link CLI |

## When to Load This Skill

- User says "automate checkout on <site>", "build browser skill for <site>"
- User drops a URL and wants it automated
- Existing browser skill keeps failing and needs systematic improvement
- Hitting a new site type that will be visited repeatedly

## Workspace Setup

Training artifacts live under `~/.hermes/autobrowse/`:

```bash
mkdir -p ~/.hermes/autobrowse/tasks ~/.hermes/autobrowse/traces ~/.hermes/autobrowse/reports
```

### Task Definition

Create `~/.hermes/autobrowse/tasks/<task-name>/task.md`:
```markdown
# <Task Name>
**URL:** <target URL>
**Goal:** <what the automation should accomplish>
**Expected Output:** <JSON schema or description of expected result>
**Budget:** max snapshots: 5 | max iterations: 10 | max cost: $5
```

### Strategy File

`~/.hermes/autobrowse/tasks/<task-name>/strategy.md` — starts empty, grows with each iteration. **Only edit strategy.md, never task.md.**

---

## The Loop

### Step 1 — Baseline (Iteration 1)

Run inner agent with no strategy. Prompt:

> "Navigate to <URL> and accomplish <goal>. Use browser_navigate, browser_snapshot, browser_click, browser_type, browser_cdp as needed. Document every interaction. Record what worked and what failed. Return: (1) whether goal was accomplished, (2) complete step-by-step trace of all actions, (3) every element ref ID clicked/typed into, (4) every error or stall encountered, (5) total snapshots used, (6) what you would do differently next time."

Use `delegate_task` with `toolsets: ['browser', 'terminal', 'file']`.

### Step 2 — Read the Trace

The `delegate_task` summary IS the trace. Look for:

- **Stalls**: Where did agent loop or get stuck?
- **Wrong refs**: Clicked wrong element?
- **Timing issues**: Tried to interact before page loaded?
- **Selector failures**: Searched for selectors that don't exist?
- **Snapshot waste**: Re-snapshot for data already in HTML?

### Step 3 — Form One Hypothesis

Find the exact turn where things went wrong. What single heuristic would have prevented it?

Examples:
- "Navigate directly to `/checkout` — skip landing page entirely"
- "Parse product list from `data-page` attribute instead of snapshot loop"
- "Wait 2s after clicking dropdown — options animate in before they're clickable"
- "Use `browser_cdp` `Input.insertText` for Stripe fields — `.value` assignment is ignored"
- "Batch all address fields in one pass — 1 snapshot, N `browser_type` calls"

### Step 4 — Update strategy.md

Edit `~/.hermes/autobrowse/tasks/<task-name>/strategy.md`. Keep everything that worked. Fix the specific failure. Add one concrete heuristic.

Good strategies have:
- **Fast path**: Direct URLs or API calls to skip exploration
- **Step-by-step workflow**: Exact sequence with timing notes and element refs
- **Site-specific knowledge**: Selector IDs, form field names, success indicators
- **Snapshot budget**: Target ≤5 snapshots for entire flow
- **Failure recovery**: What to do when X goes wrong

### Step 5 — Evaluate Again

Run another `delegate_task` with strategy in context:

> "Strategy from previous attempt: <paste strategy.md>. Follow this strategy. Deviate only if blocked. Document any new discoveries."

### Step 6 — Judge

- **Pass or progress** → keep, next iteration
- **No progress or regression** → revert strategy.md, try different hypothesis

### Stop Conditions

Strategy passes on 2+ of last 3 iterations AND:
- Snapshot budget ≤5 with reliable output
- All edge cases documented
- Max iterations (10) reached — graduate with known issues noted

---

## Graduation

### Create Hermes Skill

Use `skill_manage(action='create')` to graduate. Frontmatter:
```yaml
name: <task-name>
description: <1-2 sentences with trigger keywords>
version: 1.0.0
autobrowse_version: <iteration count>
```

Skill body structure:
```markdown
# <Task Title> — Browser Skill

## Purpose
<1-2 sentences: what this automates and why>

## When to Use
<Trigger conditions>

## Prerequisites
<What must exist before using this skill>

## Site Architecture
<Key DOM structure, APIs, frameworks, captchas>

## Workflow
### Step 1 — <name>
<exact commands, element refs, timing>

### Step 2 — <name>
...

## Snapshot Budget
| Step | Snapshots | Notes |
|------|-----------|-------|
| ... | ... | ... |
| **Total** | N | |

## Pitfalls
<Bullet list of hard-won heuristics from iterations>

## Failure Recovery
<What to do when navigation fails, session is contaminated, or extraction returns garbage>

## Verification
<How to confirm the skill still works>
```

### Push to Agent Skills Repo

```bash
# Clone shallow
git clone --depth 1 https://github.com/narulaskaran/agent-skills.git /tmp/agent-skills

# Copy skill
cp -r ~/.hermes/skills/<category>/<skill-name> /tmp/agent-skills/<category>/

# Push
cd /tmp/agent-skills
git config user.email "user@example.com"
git config user.name "Hermes Agent"
gh auth setup-git
git add -A
git commit -m "feat: add <skill-name> — <one-line description>"
git push
```

Repo structure (`narulaskaran/agent-skills`):
```
agent-skills/
├── README.md
├── ecommerce/
│   ├── shopify-stripe-checkout/
│   ├── postalform-mailing/
│   └── postalform-checkout/
└── (future categories)/
```

---

## Core Principles

### 1. Parse, Don't Browse
When data is in HTML (`data-page` attributes, meta tags, JSON blobs), extract it directly. Every `browser_snapshot` avoided saves ~1000+ tokens.

### 2. Navigate Directly
When you know the next step's URL, use `browser_navigate(url)` instead of clicking through. Avoids timing issues and wrong-ref errors.

### 3. Batch Form Fills
After one snapshot to get element refs, fill ALL known fields with `browser_type` before snapshotting again.

### 4. Use API Where Possible
Check for: Cart API (Shopify `/cart.js`), GraphQL endpoints, REST APIs. One curl = 5 tokens. One snapshot = 1000+ tokens.

### 5. Snapshot Budget
Target ≤5 snapshots: Page Load, Form Refs, Payment Refs, Confirmation. +1 for edge cases. Justify each additional one.

### 6. CDP for Iframes
Stripe PCI fields, PayPal buttons, cross-origin iframes:
- `browser_cdp Target.getTargets` — find iframe target IDs
- `browser_cdp Runtime.evaluate` with `targetId` — access iframe context
- `browser_cdp Input.insertText` — real keystrokes (Stripe checks `event.isTrusted`)

### 7. One Hypothesis Per Iteration
Fix one thing at a time. Change 3 things → don't know which mattered.

### 8. Trust the Trace
Inner agent shows exactly what it saw and did. Don't rationalize failures — trace is truth.

---

## Pitfalls

1. **Chrome sandbox**: In containers/VMs, `browser_navigate` fails with "No usable sandbox". Add `--no-sandbox` to browser config. Fallback: static analysis + session traces.
2. **SPA navigation**: Inertia.js, React Router — wait for XHR before next action. Check `browser_console` for errors.
3. **CAPTCHA/Turnstile**: May require Browserbase proxy. Document in strategy.
4. **Session contamination**: Previous `delegate_task` leaves cookies/state. Start fresh sessions.
5. **Selector volatility**: CSS classes change between loads. Prefer `name`, `data-*`, `aria-label`.
6. **Never edit task.md**: Task definition is the success criteria — it stays fixed.
7. **Don't skip graduation**: Ungraduated strategy.md is lost knowledge. Graduate even if imperfect — note remaining issues.
8. **Browserbase only for anti-bot sites**: Local Chrome + CDP is free and sufficient for most sites. Use Browserbase only for Steam, PayPal, Amazon, Apple Store.

---

## Example: PostalForm Checkout Evolution

| Iter | What Changed | Result |
|------|-------------|--------|
| 1 (baseline) | Full browser exploration | 20+ snapshots, 3 stalls, ❌ |
| 2 | Parse templates from `data-page` instead of snapshot loop | 5 snapshots, discovered template IDs |
| 3 | Batch address fields, direct navigate to checkout | 4 snapshots, ❌ payment timeout |
| 4 | Add CDP `Input.insertText` for Stripe | 5 snapshots, ✅ pass |
| 5 | Consolidate: merge learnings into SKILL.md | Graduated |

---

## Session Startup

When starting a session and this skill is relevant:
1. Check `~/.hermes/autobrowse/tasks/` for existing task definitions
2. Check if any `strategy.md` has unverified selectors
3. Priority: fix verified-skill issues → then new site requests

## Related Skills

- `shopify-stripe-checkout` — Reference implementation (example of graduated skill)
- `postalform-checkout` — Reference implementation (example of graduated skill)
- `autonomous-operations` — Browser automation infrastructure, CDP technique, spending workflow
- `token-efficiency` — Token budget and cost management for browser-heavy workflows
