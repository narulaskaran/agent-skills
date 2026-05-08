# Agent Skills

Reusable browser agent skills — community-maintained collection for Hermes Agent and other AI browser frameworks. Built via [Autobrowse](https://www.browserbase.com/blog/autobrowse) methodology.

## What are skills?

Skills are durable markdown files that encode how to complete specific web tasks. Instead of re-learning every site from scratch, agents load a skill and execute. Skills capture:

- Site architecture and gotchas
- Step-by-step workflow
- Selector patterns and API endpoints
- Pitfalls and edge cases
- Token burn reduction strategies

## Skills

### Ecommerce

| Skill | Description | Status |
|-------|-------------|--------|
| [shopify-stripe-checkout](ecommerce/shopify-stripe-checkout/SKILL.md) | Complete checkout on any Shopify store with Stripe payment. Handles cart API, PCI iframe card entry via CDP, discount codes. | Autobrowsed (3 BirchCoffee sessions) |
| [postalform-mailing](ecommerce/postalform-mailing/SKILL.md) | End-to-end card design + mailing via PostalForm. Covers image generation, HTML card design, PDF export, MPP machine API payment via Link CLI. | Production-validated |
| [postalform-checkout](ecommerce/postalform-checkout/SKILL.md) | Browser-based PostalForm website checkout (Path C fallback). Used when machine API is rate-limited. | Autobrowsed (static analysis) |

## Format

Each skill is a directory containing:
- `SKILL.md` — YAML frontmatter + markdown body with workflow, pitfalls, references
- `references/` — supporting docs (API specs, payment flows, credential guides)
- `templates/` — HTML/CSS templates where applicable
- `scripts/` — helper scripts where applicable

## Contributing

Skills improve through iteration. To contribute:

1. Run a task using an existing skill
2. Note what broke, what wasted tokens, what could be faster
3. Submit a PR with improvements
4. Include session traces or evidence of improvement

See [Autobrowse methodology](https://www.browserbase.com/blog/autobrowse) for the full iteration workflow.

## License

MIT
