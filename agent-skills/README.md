# Agent Skills
Opinionated, skills for AI agents which I've developed over time from my own Hermes agent.

## Skills

### Browser Use

| Skill | What it does | 
|-------|-------------|
| [shopify-stripe-checkout](browser-use/shopify-stripe-checkout/SKILL.md) | Checkout at online Shopify stores. Handles Stripe PCI iframes (CDP keystroke injection), cart API, discount codes. Generalized from Birch Coffee. | 
| [postalform-mailing](browser-use/postalform-mailing/SKILL.md) | Design and mail physical postcards via PostalForm. Covers image generation, HTML card design to bleed specs, PDF export, base64 JPEG workaround, batch orders, SPT recovery, MPP machine API payment via Stripe Link CLI. | 
| [postalform-checkout](browser-use/postalform-checkout/SKILL.md) | Browser-based PostalForm website checkout — fallback for when the MPP API is rate-limited. |
| [postalform-lessons](browser-use/postalform-lessons/SKILL.md) | Patterns from PostalForm + MPP flows. Prevents hours of debugging. Key: compress PDFs to JPEG, base64 data URLs, mppx serialization, one SPT per payment, space orders 1h apart. |
| [autobrowse-workflow](browser-use/autobrowse-workflow/SKILL.md) | Meta-skill for building reliable browser automation skills. Iterative trace-driven improvement via delegate_task inner agents. The methodology behind all checkout skills in this repo. |
| [web-checkout](browser-use/web-checkout/SKILL.md) | Decision patterns for autonomous web checkout: API vs browser, CAPTCHAs, payment iframes, rate limits. When to fall back, when to push through. |

### Payments

| Skill | What it does |
|-------|-------------|
| [mpp-payments](payments/mpp-payments/SKILL.md) | Machine Payment Protocol patterns. Reusable Stripe Link CLI → mppx serialization flow, credential lifecycle, 402 challenge-response authentication. | 
| [autonomous-operations](payments/autonomous-operations/SKILL.md) | End-to-end autonomous operations: spending protocols with verification gates, email-driven task intake (AgentMail → Kanban), system health checks, calendar invite workflows, and cron bomb detection. |

### Software Development

| Skill | What it does |
|-------|-------------|
| [systematic-debugging](software-development/systematic-debugging/SKILL.md) | 4-phase root cause debugging. Understand an issue before fixing. |
| [requesting-code-review](software-development/requesting-code-review/SKILL.md) | Pre-commit verification pipeline: security scan, baseline-aware quality gates, independent reviewer subagent, auto-fix loop. |
| [subagent-driven-development](software-development/subagent-driven-development/SKILL.md) | Execute implementation plans via delegate_task subagents with two-stage review (spec then quality). |
| [writing-plans](software-development/writing-plans/SKILL.md) | Write implementation plans for zero-context implementers: exact files, complete code, testing commands, verification steps. |
| [consistency-check](software-development/consistency-check/SKILL.md) | Verify multi-part outputs before marking done. Every requirement → satisfied, every deliverable → written and verified. |

### Health

| Skill | What it does |
|-------|-------------|
| [food-tracking](health/food-tracking/SKILL.md) | Track daily food intake with calories, protein, and fiber. Supports photo-based and text-based entries, restaurant menu research, and health troubleshooting. |

## How skills are made

These come from real sessions where either an agent tried to do something, failed, iterated, and eventually identified a reliable path, or where I requested and fine tuned a workflow for my own usage.

## Contributing

PRs welcome. If you use a skill and find a better way, send the improvement back. Good PRs include:

- What broke or was slow
- What you changed
- Why it's better (fewer turns, lower cost, higher success rate)
