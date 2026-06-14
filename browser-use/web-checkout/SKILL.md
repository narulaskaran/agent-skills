---
name: web-checkout
description: Patterns for autonomous web checkout flows — when browser automation fails, when to use API instead, handling rate limits, CAPTCHAs, and payment iframes. Use when automating any web checkout/purchase flow.
version: 1.0.0
---

# Web Checkout — Autonomous Patterns

## Decision Tree: API vs Browser

```
Can the merchant be interacted with via HTTP API?
├── YES → Use API (curl). Faster, cheaper, more reliable.
│   └── Rate limited? → Space requests, use cron, respect cooldowns.
└── NO → Try browser automation.
    ├── Chrome sandbox working? → Use browser_navigate + browser_snapshot
    │   └── CAPTCHA? → May need manual solve or Browserbase proxy
    └── Chrome sandbox broken? → Try Puppeteer/Playwright via terminal
        └── Still blocked? → Manual checkout only (tell user)
```

**Always prefer API over browser.** Browser automation burns ~1000+ tokens per snapshot, is fragile, and fails on CAPTCHAs, iframes, and SPA navigation. API calls are deterministic and token-cheap.

## Rate Limiting Patterns

### Recognizing Rate Limits
- HTTP 429 "Too Many Requests" — most common
- "Too many unpaid order attempts" — payment-specific
- Silent failures or stale error responses — sometimes disguised rate limiting

### Rate Limit Recovery
1. **Stop immediately.** More attempts make it worse.
2. Read the error message for cooldown duration (often "wait an hour")
3. Space future attempts with generous margins (≥1 hour between)
4. Completed/successful payments often clear the counter
5. Different endpoints may have independent rate limits (API vs website)

### Batch Operations
- Determine rate limit early: start with 1, observe, then scale
- Never fire N requests in parallel without knowing the limit
- Use cron jobs with `schedule: "105m"` for sequential spacing
- Exponential backoff doesn't help if the limit is strict count-based

## Single-Use Resources

Many APIs use resources that are consumed on first use:
- **Upload tokens**: consumed on order creation, can't retry
- **Payment tokens (SPTs)**: consumed on successful payment
- **Idempotency keys**: first use creates, subsequent uses return same result

**Pattern:** Before retrying, identify which resources are single-use. Get fresh ones for each attempt. Prefer reusable alternatives (base64 data URLs over upload tokens).

### Base64 Data URLs
When an API accepts `data:application/pdf;base64,...` payloads:
- Reusable across retries
- No single-use problem
- BUT: size limits apply (Cloudflare 413 at ~2MB, ARG_MAX at ~2MB)
- **Always compress before encoding**: JPEG instead of PNG for images, lower DPI for PDFs

## Browser Automation (When Unavoidable)

### Chrome Sandbox
In containers/VMs, Chrome fails with "No usable sandbox!" 
- The `browser_navigate` tool doesn't support `--no-sandbox` flag
- Background Chrome with `--no-sandbox` doesn't help (tool launches its own instance)
- **Fallback:** Puppeteer/Playwright via terminal with `args: ['--no-sandbox']`

### Token Budget
Browser automation is expensive. Target ≤5 snapshots per flow:
1. Page load (1)
2. Form refs (1)
3. Payment refs (1)
4. Confirmation (1)
5. Reserve (1)

Each snapshot = ~1000+ tokens. A 20-snapshot flow = 20K tokens wasted.

### Stripe/Payment Iframes
- Stripe PCI fields are in cross-origin iframes
- `.value` assignment is ignored — must use real keystroke simulation
- `browser_cdp Input.insertText` for iframe input
- Stripe Link (`{{PII_KARAN_EMAIL}}`) may pre-fill payment details

### CAPTCHA / Turnstile
- May require Browserbase proxy (residential IP)
- Or manual solve by user
- If CAPTCHA appears, abort browser path and tell user

## Payload Size Limits

Multiple layers of size limits exist:
1. **Shell ARG_MAX** (~2MB): can't pass large strings as CLI arguments
2. **Cloudflare/CDN** (varies, often ~100MB but can be lower for specific endpoints)
3. **Application-level** (PostalForm 413 at ~2.5MB base64)

**File-based transfer avoids ARG_MAX:**
```bash
curl -s -d @payload.json <endpoint>  # ✅ file reference, not inline
```

## Payment Flow Checklist

Before starting any autonomous payment:
- [ ] Is there an API? Use it first.
- [ ] Are there single-use tokens? Get fresh ones per attempt.
- [ ] Is payload under size limits? Compress if needed.
- [ ] Are rate limits known? Space accordingly.
- [ ] Is user available to approve spend-requests?
- [ ] Have I verified the amount, recipient, and card before charging?

## Anti-Patterns

1. ❌ Browser-first when API exists
2. ❌ Retrying without understanding the failure mode
3. ❌ Ignoring rate limit signals
4. ❌ Reusing single-use resources
5. ❌ Inline large payloads in CLI arguments
6. ❌ Batch-submitting without knowing rate limits
7. ❌ Not compressing payloads before base64 encoding
8. ❌ Fighting CAPTCHAs instead of finding API alternative
