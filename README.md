# Agent Skills

Opinionated, battle-tested skills for AI agents — the stuff we built while automating real tasks and thought others might want.

Like [gstack](https://github.com/garrytan/gstack) but for browser automation, ecommerce, and creative workflows. Each skill is a markdown file your agent loads and executes — no re-learning, no rediscovering gotchas, no burning tokens on problems already solved.

## What's a skill?

A markdown file with YAML frontmatter that teaches an agent how to do one thing well:

- **Workflow** — step-by-step, with exact commands and selectors
- **Gotchas** — the stuff that broke the first 3 times
- **Strategy** — where to spend tokens, where to be cheap
- **References** — API docs, payment flows, dimension specs

Agents load skills at runtime. The skill becomes part of their context. They execute.

## Skills

### Browser Use

| Skill | What it does | Status |
|-------|-------------|--------|
| [shopify-stripe-checkout](browser-use/shopify-stripe-checkout/SKILL.md) | Checkout on any Shopify store. Handles Stripe PCI iframes (CDP keystroke injection), cart API, discount codes. Generalized from Birch Coffee. | Production-validated |
| [postalform-mailing](browser-use/postalform-mailing/SKILL.md) | Design and mail physical postcards via PostalForm. Covers image generation, HTML card design to bleed specs, PDF export, MPP machine API payment via Stripe Link CLI. | Production-validated |
| [postalform-checkout](browser-use/postalform-checkout/SKILL.md) | Browser-based PostalForm website checkout — fallback for when the MPP API is rate-limited. | Needs browser verification |

## How skills are made

These come from real sessions where an agent tried to do something, failed, iterated, and eventually converged on a reliable path. The skill captures that path so the next agent (or person, or teammate) doesn't pay the discovery tax again.

We use [Autobrowse](https://www.browserbase.com/blog/autobrowse) for browser tasks — run the task, study the trace, iterate the strategy, graduate the winning approach. For non-browser skills, it's the same loop without the browser: try, fail, document, converge.

## Using skills

Copy the skill directory into your agent's skills folder. Load it. Run it.

For Hermes Agent:
```bash
cp -r browser-use/shopify-stripe-checkout ~/.hermes/skills/
# Agent loads it automatically when relevant to your task
```

For other frameworks: the SKILL.md format is portable markdown. Point your agent at the file, or paste it into your system prompt.

## Contributing

PRs welcome. If you use a skill and find a better way, send the improvement back. Good PRs include:

- What broke or was slow
- What you changed
- Evidence it's better (fewer turns, lower cost, higher success rate)

## Why this exists

Agents are amnesiacs. Every session they rediscover the same sites, hit the same gotchas, burn the same tokens. Skills fix that — they're memory in a form humans and agents can both read and trust.

Gary Tan put out gstack with skills he liked for Claude Code. This is the same idea, applied to browser automation, shopping, mailing, and whatever else we end up automating.

## License

MIT — use it, fork it, make it better.
