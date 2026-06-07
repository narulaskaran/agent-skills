# Stripe Elements PCI Iframe Automation (CDP Technique)

## Why Browserbase Was Used Before

Previous checkout attempts used Browserbase because:
1. Initial attempts tried `agent-browser fill` and JS `.value =` — both fail on Stripe Elements
2. Stripe Elements uses cross-origin PCI iframes that isolate card fields from the parent page
3. Switched to Browserbase for its CDP access — **but local browser has CDP too**

## Why Local CDP Works For This

The agent-browser Chrome (v148) runs with `--remote-debugging-port=9222`. The config has:
```yaml
browser:
  cdp_url: http://localhost:9222
```

This means `browser_cdp` tool routes to the same Chrome instance as `browser_navigate/click/type`. Same session, same cookies, same page state — no sync issues.

## The Correct Technique

### Step 1: Find PCI iframe targets
```
browser_cdp method=Target.getTargets params={}
```
Look for iframe targets containing Stripe card fields. They typically have:
- `title` containing `number-ltr`, `expiry-ltr`, or `verification_value-ltr`
- `type: "iframe"`
- `url` pointing to `https://js.stripe.com/...`

### Step 2: Focus the input inside the iframe
```
browser_cdp method=Runtime.evaluate \
  params={"expression":"document.querySelector('input').focus();true","target_id":"<iframe-id>"}
```
The `target_id` is the `targetId` from `Target.getTargets`.

### Step 3: Type card details via keystroke simulation
```
browser_cdp method=Input.insertText params={"text":"4866560003147814"}
```
Do NOT call `Input.insertText` on the main page context — it must be the iframe's target.

### Order of operations
1. Card number → Target.getTargets to find number-ltr iframe → evaluate focus → insertText
2. Expiry → find expiry-ltr iframe → evaluate focus → insertText "0129"
3. CVC → find verification_value-ltr iframe → evaluate focus → insertText "653"

## What DOESN'T Work (Tried & Failed)

| Approach | Why it fails |
|---|---|
| `browser_type` on the main page | Can't reach cross-origin iframes |
| `.value = "4111..."` via JS | Stripe ignores DOM value changes |
| `dispatchEvent(new Event('input'))` | Stripe checks event.isTrusted |
| `page.evaluate()` from Playwright | Cross-origin restriction |

## What Works

| Approach | Why |
|---|---|
| `Input.insertText` via CDP | Real keystroke simulation, isTrusted=true |
| `Runtime.evaluate` with target_id | Can execute inside the iframe context |
| Focusing input first | Ensures keystrokes go to the right element |

## Config Verification

To verify local CDP is available:
```bash
# Check Chrome is listening
ss -tlnp | grep 9222
# Should show: LISTEN 127.0.0.1:9222 users:(("chrome",...))

# Check browser_cdp works
browser_cdp method=Target.getTargets params={}  # Should return target list
```

## When Browserbase IS Still Required

Only for sites with anti-bot detection:
- Steam (Cloudflare challenge)
- PayPal (CAPTCHA)
- Amazon (bot detection, sign-in wall)
- Apple Store (session auth)
