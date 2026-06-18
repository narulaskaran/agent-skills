---
name: postalform-checkout
description: Browser-based PostalForm checkout via website (Path C fallback). Covers template selection, customization, address entry, and Stripe payment through browser automation. Use when machine API/MPP paths are rate-limited or blocked.
version: 1.0.0
autobrowse_version: 1
---

# PostalForm Website Checkout (Browser Path)

Alternative checkout path when PostalForm's machine API (`/api/machine/mpp/orders`) is rate-limited. Uses browser automation to complete checkout at [postalform.com/postcards](https://postalform.com/postcards).

⚠️ **PII:** Names, emails, and addresses use `{{PII_*}}` placeholders. Load `~/.hermes/memory/pii.json` and replace placeholders before executing.

## When To Use This Path

| Condition | Use |
|-----------|-----|
| Machine API works | Use `postalform-mailing` skill (Path A) |
| "Too many unpaid order attempts" | Use this skill (Path C) |
| MCP broken (ENOENT) | Use this skill (Path C) |
| MPP 402 challenge fails | Use this skill (Path C) |
| User prefers manual payment | Use this skill (Path C) |

## Prerequisites

PDF must already be generated using `postalform-mailing` skill Steps 1-4. This skill handles ONLY the checkout portion.

```bash
# Ensure PDF exists
ls -la card.pdf
```

## Site Architecture

PostalForm uses Inertia.js — a server-side rendering SPA. Key characteristics:
- Initial page load includes JSON props in `data-page` attribute
- Subsequent navigation is JS-driven (no static URLs for customize/checkout steps)
- Turnstile captcha on file uploads (site key: `0x4AAAAAACIzRY27msYNkCF2`)
- Stripe handles payments

### Template Data (from Inertia props)

The `/postcards` index page loads 50 templates. Each has:
```json
{
  "templateId": 1,
  "templateName": "Thank You (Simple)",
  "category": "Personal",
  "recommendedSize": "4x6",
  "sizeKey": "4x6",
  "tone": "neutral",
  "tags": ["thank-you", "personal"],
  "keyFields": ["to_name", "from_name", "message"],
  "thumbnailUrl": "/postcards/1/thumbnail",
  "frontImageUrl": "/postcards/1/front",
  "backImageUrl": "/postcards/1/back"
}
```

Template categories: Events, Local Business, Nonprofit, Personal, Real Estate.

Postcard sizes: 4x6, 6x9 (template-dependent).

## Checkout Flow

### Stage 1: Template Selection

1. Navigate to `https://postalform.com/postcards`
2. Parse template list from `data-page` attribute:
   ```python
   import re, html, json
   m = re.search(r'data-page="([^"]*)"', page_html)
   data = json.loads(html.unescape(m.group(1)))
   templates = data['props']['templates']
   ```
3. Choose template by `templateId`. **If uploading custom PDF, choose any template — it will be replaced.**
4. Click the template card element. In the browser snapshot, look for clickable elements near the template name.

**Strategy optimization**: Parse templates from HTML directly instead of `browser_snapshot` loop. Avoids ~15-20 tool calls scanning through templates.

### Stage 2: Customization

The customization step is an SPA page with:
- Front/back image previews
- Text fields for `keyFields` (to_name, from_name, message, etc.)
- Option to upload custom PDF

**For custom card art (from postalform-mailing)**:
1. Enter placeholder text in the text fields
2. Upload the pre-generated PDF via the file upload button
3. Handle Turnstile captcha if prompted

**Selectors to look for** (verify with real browser session):
- Text inputs: likely `input[type="text"]` with labels matching keyFields
- PDF upload: `input[type="file"]` or a drop zone
- "Continue" or "Next" button to proceed

**Strategy optimization**: For custom PDF uploads, skip template customization entirely. Find the upload button and submit the pre-generated PDF directly.

### Stage 3: Address Entry

Expected form fields:
- **Sender**: Name, Address Line 1, Address Line 2, City, State, ZIP
- **Recipient**: Name, Address Line 1, Address Line 2, City, State, ZIP

Default addresses — load from `~/.hermes/memory/pii.json`:
```
{{PII_KARAN_NAME}} (sender)
{{PII_KARAN_ADDRESS}}

{{PII_MOM_NAME}} (recipient)
{{PII_MOM_ADDRESS}}
```

**Strategy optimization**: Fill all fields in one pass using `browser_type` for each input. Avoid re-snapshotting between fields.

### Stage 4: Payment

PostalForm uses Stripe for payments. Expected flow:
1. Review order summary
2. Proceed to Stripe checkout (embedded or redirect)
3. Enter card details or use Link
4. Confirm payment

**Strategy optimization**: 
- If Stripe Link is supported, use `{{PII_KARAN_EMAIL}}` — Link remembers saved cards
- If not, use Link CLI virtual card: create spend-request → get virtual card details → type into Stripe fields
- For PCI iframes, use real keystroke simulation (not `.value` assignment)

### Stage 5: Confirmation

After payment:
1. Verify order confirmation page loads
2. Extract order ID if visible
3. Check email for confirmation from PostalForm

## Browser Automation Strategy

### Efficiency Principles (Autobrowse)

1. **Parse, don't browse.** When data is in HTML (`data-page` attribute, API responses), extract it directly. Don't use `browser_snapshot` to "read" what's already in source.

2. **Navigate directly.** When you know the next step's URL, use `browser_navigate(url)` instead of clicking through.

3. **Batch form fills.** After snapshotting once to get element refs, fill all known fields before snapshotting again.

4. **Minimize snapshots.** Each `browser_snapshot` is expensive. Goal: ≤5 snapshots for entire checkout.

### Ideal Snapshot Budget

| Step | Snapshots | Notes |
|------|-----------|-------|
| Page load | 1 | Initial navigation |
| Template select | 0 | Parse from HTML |
| Customize + Upload | 1 | Get refs for file input + text fields |
| Address entry | 1 | Get refs for all address fields |
| Payment | 1 | Stripe form refs |
| Confirmation | 1 | Verify success |
| **Total** | **5 max** | |

### Known Browser Issues

- **Chrome sandbox**: Use `--no-sandbox` in containers/VMs
- **Turnstile**: May require manual solve or Browserbase proxy
- **Stripe PCI iframes**: Require `keyboard.type()` instead of `fill()`
- **SPA navigation**: Wait for Inertia XHR to complete before next action (use `browser_console` to check for errors)

## Integration with postalform-mailing

The two skills work together:

```
postalform-mailing (Steps 1-4)
    ├── Generate illustrated art (OpenRouter image-gen)
    ├── Design HTML card
    ├── Export 2-page PDF
    └── → card.pdf

postalform-checkout (this skill)
    ├── Upload card.pdf to website
    ├── Fill sender/recipient addresses
    ├── Pay via Stripe
    └── → Order confirmed
```

## Verification

After completing checkout:
1. Take screenshot of confirmation page
2. Extract order number if shown
3. Check AgentMail for PostalForm confirmation email
4. Update kanban task with order ID

## Pitfalls

1. **Don't use this path if machine API works.** It's slower and burns more tokens.
2. **Template choice doesn't matter for custom PDF uploads.** Pick any template — the PDF replaces it.
3. **Selectors are not yet verified.** This skill was created from static analysis (HTML + Inertia props). Real browser session needed to confirm exact selectors for interactive elements. See "Verification Needed" below.
4. **Turnstile captcha on upload.** May require Browserbase proxy or manual intervention.
5. **Stripe PCI iframes.** Card number/CVC fields are in cross-origin iframes — use `keyboard.type()` not `element.fill()`.
6. **Rate limiting.** Website checkout may also be rate-limited after multiple failed attempts. Generate fresh Browserbase sessions.
7. **Session persistence.** Inertia.js uses session cookies. Maintain same browser session throughout checkout.

## Verification Needed

This skill was created from static site analysis only (HTML parsing, JS bundle inspection). The following need verification with a real browser session:

- [ ] Exact selectors for template click targets
- [ ] Customize page structure and input selectors
- [ ] PDF upload element and Turnstile behavior
- [ ] Address form field names/selectors
- [ ] Stripe checkout integration (embedded vs redirect)
- [ ] Confirmation page structure

**Next step**: Run a Browserbase session through the full checkout flow, record selectors, and update this skill with verified element refs.

## References

- `postalform-mailing` skill: Card design + PDF generation + machine API flow
- PostalForm machine API: `https://postalform.com/api/machine/`
- PostalForm postcards: `https://postalform.com/postcards`
- Autobrowse methodology: Study trace → iterate strategy → converge → graduate
