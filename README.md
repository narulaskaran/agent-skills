# Agent Skills
Opinionated, skills for AI agents which I've developed over time from my own Hermes agent.

## Skills

### Browser Use

| Skill | What it does | 
|-------|-------------|
| [shopify-stripe-checkout](browser-use/shopify-stripe-checkout/SKILL.md) | Checkout on any Shopify store. Handles Stripe PCI iframes (CDP keystroke injection), cart API, discount codes. Generalized from Birch Coffee. | 
| [postalform-mailing](browser-use/postalform-mailing/SKILL.md) | Design and mail physical postcards via PostalForm. Covers image generation, HTML card design to bleed specs, PDF export, MPP machine API payment via Stripe Link CLI. | 
| [postalform-checkout](browser-use/postalform-checkout/SKILL.md) | Browser-based PostalForm website checkout — fallback for when the MPP API is rate-limited. | 

## How skills are made

These come from real sessions where an agent tried to do something, failed, iterated, and eventually identified a reliable path. The skill captures that path so the next agent (or person, or teammate) doesn't pay the discovery tax again.

## Contributing

PRs welcome. If you use a skill and find a better way, send the improvement back. Good PRs include:

- What broke or was slow
- What you changed
- Why it's better (fewer turns, lower cost, higher success rate)
