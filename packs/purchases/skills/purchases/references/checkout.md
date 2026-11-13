# Paying at a web checkout

The `browser` skill covers driving the page; this is the purchase flow around it.

## Before the spend request
1. Open the product page, choose the exact variant and quantity, add to cart, go to checkout.
2. Use guest checkout. Contact email: the owner's Link email is fine unless they gave another (`link-cli user-info retrieve`). Shipping: the default Link address, typed field by field.
3. Pick the shipping method the owner wants (cheapest standard if they did not say).
4. On the payment step, decide the credential:
   - `browser lpt detect` says usable: Link Pay Token (below).
   - `browser webmcp list` shows a purchase or checkout tool: virtual card through that tool.
   - Otherwise: virtual card typed into the form.
   - Inspect the payment-method controls, including separate Visa/Mastercard or Card options. A wallet-branded guest checkout and an embedded card-fields option can be separate flows. Select the direct card option when offered and confirm its actual fields before creating a request. Do not conclude that the wallet is required from its logo alone.
5. Read the final total from the checkout's order summary (items, shipping, tax). Text the owner (skill rule 1), then create the spend request with exactly that total and `--merchant-url` set to the checkout page.

Do not leave the checkout page open for long while waiting; some carts expire. If the page reloads or the total changes after approval, compare it with the approved amount before paying.

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
