# Paying at a web checkout

The `browser` skill covers driving the page; this is the purchase flow around it.

## Before the spend request
1. Open the product page, choose the exact variant and quantity, add to cart, go to checkout.
2. Use guest checkout. Contact email: the owner's Link email is fine unless they gave another (`link-cli user-info retrieve`). Shipping: the default Link address, typed field by field.
3. Pick the shipping method the owner wants (cheapest standard if they did not say).
4. On the payment step, inspect every offered payment method (separate Visa/Mastercard or Card options, wallets, a PayPal button), then choose the route using the list below. A wallet-branded guest checkout and an embedded card-fields option can be separate flows; do not conclude a wallet is required from its logo alone.
5. Rehearse the card form (below) when it is a form you have not used before.
6. Read the final total from the checkout's order summary (items, shipping, tax). Text the owner (skill rule 1), then create the spend request with exactly that total and `--merchant-url` set to the checkout page.

Do not leave the checkout page open for long while waiting; some carts expire. If the page reloads or the total changes after approval, compare it with the approved amount before paying.

## Choosing the payment route
Best first. Take the highest route the checkout offers. If the best one is a PayPal route, tell the owner before creating a spend request.

1. **Link Pay Token** (`browser lpt detect` usable): no card typed at all.
2. **WebMCP purchase tool** (`browser webmcp list`): the merchant's own tool, with the card placeholders.
3. **The merchant's own card form** that uses Stripe, Adyen, Shopify, Braintree or Square card fields, in the page or in iframes: a one-time virtual card typed in.
4. **Another card form that is not PayPal**, such as a bank or custom gateway: virtual card, one attempt, watch the result closely.
5. **PayPal-hosted card fields or PayPal's "Debit or Credit Card" guest form**: last resort. On 2026-11-13 PayPal refused a Link virtual card for DeepSeek with HTTP 422 `PAYER_CANNOT_PAY` through this route. Try it once, only after a rehearsal, and only with the owner's go-ahead.
6. **Wallet or account only** (PayPal login, Google Pay, Apple Pay, bank, crypto): not supported. Hand off to the owner (below).

Also ask whether the seller has another way to buy that uses a higher route, such as another storefront or reseller for the same product, and tell the owner if one exists.

Before using a route, read the knowledge base note `finance/merchant-notes.md` for this merchant: what worked and what failed last time.

## Rehearse the form
Do this before involving the owner, so the form is understood before a real card exists. It spends nothing and creates no order.
1. Get to the payment step and open the card option.
2. Type the well-known test values with the digit check on: `browser type <ref> "4242424242424242" --verify-digits`, then expiry `12 / 34` and CVC `123`, and the name.
3. Snapshot and read each field back. Note which fields exist (postal code? billing address?), which ones mask their value, and which processor's frames they are.
4. Never click Pay or submit anything. Reload the page to clear the test values.
5. If a field will not hold the digits, find out why with `browser network` and fix your approach now. Do not create a spend request until the rehearsal is clean.

Report the rehearsal result to the owner only if something blocks the purchase.

## When a payment is refused
- One submission per merchant per purchase. After any refusal (an HTTP 4xx from the payment call, a decline message, an order that goes to failed), stop. Do not create another request or order for the same purchase without the owner's go-ahead.
- Right after the refusal: `browser network` for the payment call's status and body, a screenshot of the page, then cancel the spend request.
- Note in the merchant's knowledge base note which route was used, the exact status and reason, and the date.
- Then hand off to the owner (below).

## Handing off to the owner
When a route is unsupported or refused, text the owner once, in plain words: what you tried, why it stopped (quote the reason), and the exact thing that would finish it, such as "top up $10 on platform.deepseek.com/top_up with PayPal or Apple Pay; it takes about a minute". Offer the cheapest alternative you know of. Do not keep retrying in the background.

## Virtual card
After approval:
```
browser snapshot -i
browser type f1e3 "{{card.number}}" --spend-request lsrq_...
browser type f1e5 "{{card.exp}}" --spend-request lsrq_...
browser type f1e7 "{{card.cvc}}" --spend-request lsrq_...
```
- Billing address fields: use `{{card.line1}}`, `{{card.postal_code}}` and so on, or tick "same as shipping" when the card's billing address matches.
- Name on card: `{{card.name}}`.
- Snapshot again, check every required field and the total one last time, then click Pay once. Keep full snapshots and form text for diagnosis: do not pipe checkout results through `tail` or filters that discard validation errors.
- 3-D Secure popups or an OTP the owner receives: ask the owner for the code; if it cannot be completed, report `3ds_challenge` and cancel.
- If the page stays on the form, read the entire form and inspect all frames for validation errors, processing indicators or authentication challenges. Correct a clear local validation error only when the page establishes that no payment was submitted. Do not label it a decline without a decline message or provider status.
- After a confirmed decline, cancel the spend request and report the exact reason. Never resubmit a single-use card after a charge or an uncertain final submission.

With a WebMCP purchase tool, pass the placeholders in its JSON instead (see the browser skill's payments reference) and use the tool's response as the result.

## Link Pay Token
Stripe-hosted or embedded Stripe Checkout pages can take a token tied to the owner's saved Link card.

1. `browser lpt detect` gives the merchant account id `acct_…`.
2. Create the request without merchant name, URL, `--network-id` or `--test`:
   ```
   link-cli spend-request create --format json --credential-type link_pay_token \
     --merchant-account-id acct_... --amount 2500 --currency usd \
     --line-item "name:Concert ticket,unit_amount:2500,quantity:1" \
     --total "type:total,display_text:Total,amount:2500" \
     --context "One general admission ticket for Friday's show, bought on the venue's Stripe checkout page as the owner asked today."
   ```
   Link shows the owner the real merchant name before they approve.
3. After approval, right before paying: `browser lpt fill lsrq_...`.
4. `browser snapshot`: the card form should turn into one saved Link card with the owner's email. Click Pay.
5. If nothing changes, run `lpt fill` once more. Still nothing: cancel the request, then use a card spend request. Never use the token anywhere else.

If `lpt detect` finds nothing but the page shows a Link wallet already signed in, the browser profile has a Link session: use the card flow instead of signing out.

## After paying
Wait for the confirmation page (`browser wait --url …` or `browser wait "Thank you"`). Take the order number from the page or confirmation email. If the page remains unchanged or errors after Pay, preserve the checkout tab and inspect the full page. Check merchant billing in a separate tab and reconcile Link transaction status and the configured receipt inbox before paying again. Navigating away can itself cancel a checkout. A timeout means the outcome is uncertain until reconciled; a balance alone is not proof of success or failure.
