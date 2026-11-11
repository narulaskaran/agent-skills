---
name: shopify-stripe-checkout
description: Reusable skill for ANY Shopify+Stripe checkout. Product discovery, cart API, checkout initiation, form filling, payment via Shopify Hosted Fields (Stripe backend). Avoids browser overhead where possible.
version: 1.0.0
---

# Shopify + Stripe Checkout — Universal Skill

**Works on any Shopify store with Shopify Payments (Stripe backend).** Tested on BirchCoffee (coffeebirch.myshopify.com, Impulse theme 5.5.3, cart drawer, one-page checkout). Patterns are Shopify-platform-wide, not store-specific.

---

## 1. Store Detection

Shopify store confirmed if ANY of:
- Meta: `<meta name="shopify-checkout-api-token" content="...">`
- Meta: `<meta id="shopify-digital-wallet" content="/.../digital_wallets/dialog">`
- JS: `Shopify.shop = "...myshopify.com"`
- Headers: `powered-by: Shopify`
- Cart API works: `GET /cart.js` returns JSON with `token`, `items`

Extract shop domain from HTML:
```bash
grep -oP 'Shopify\.shop\s*=\s*"([^"]+)"' page.html
# → coffeebirch.myshopify.com → shop ID in URL paths
```

Also check for `shop_id` in meta or JS for API calls.

---

## 2. Product Discovery (NO BROWSER NEEDED)

### 2.1 From home/collection pages
```bash
curl -sL "https://STORE.com/collections/all" | grep -oP '"/products/[^"]+"' | sort -u
```

### 2.2 Product detail + variants
```bash
curl -sL "https://STORE.com/products/PRODUCT-HANDLE" -o product.html
```

Extract variant IDs from `var meta = {"product":{...}}` or from inline JSON. Key fields:
- `product.id` (numeric, e.g. 7719181713469)
- `variants[].id` (numeric, e.g. 42641042243645)
- `variants[].price` (cents, e.g. 2300 = $23.00)
- `variants[].name` (display name)
- `variants[].option1`, `option2` (size, grind, etc.)
- `variants[].available` (boolean)

Parse with Python:
```python
import re, json
html = open('product.html').read()
m = re.search(r'var meta = ({.+?});', html)
if m:
    data = json.loads(m.group(1))
    product = data['product']
    for v in product['variants']:
        print(f"variant_id={v['id']} price=${v['price']/100:.2f} '{v['name']}'")
```

---

## 3. Cart API (NO BROWSER NEEDED)

All endpoints return JSON. No auth required (cart cookie handles session).

### 3.1 Add to cart
```bash
curl -s -X POST "https://STORE.com/cart/add.js" \
  -H "Content-Type: application/json" \
  -d '{"id":VARIANT_ID,"quantity":1}'
```
Returns cart item. Sets `cart` cookie automatically.

Key response fields: `id`, `variant_id`, `key`, `price`, `product_title`, `variant_title`, `quantity`, `url`

### 3.2 Get cart state
```bash
curl -s "https://STORE.com/cart.js" -b "cart=TOKEN"
```
Returns: `token`, `items[]`, `total_price`, `item_count`, `currency`

### 3.3 Update quantity
```bash
curl -s -X POST "https://STORE.com/cart/change.js" \
  -H "Content-Type: application/json" \
  -d '{"id":LINE_ITEM_KEY,"quantity":2}'
```

### 3.4 Remove from cart
```bash
curl -s -X POST "https://STORE.com/cart/change.js" \
  -H "Content-Type: application/json" \
  -d '{"id":LINE_ITEM_KEY,"quantity":0}'
```

---

## 4. Checkout Flow

### 4.1 Initiate checkout (TWO-STEP COOKIE DANCE)

**Step A: POST to /cart to get checkout redirect + session cookie**
```bash
curl -s -c cookies.txt -o /dev/null -w "%{redirect_url}" \
  -X POST "https://STORE.com/cart" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -b "cart=CART_TOKEN" \
  -d "checkout=Checkout"
```

Response: 302 redirect to Shop Pay with `ur_back_url` parameter containing the actual checkout URL.

The `cookies.txt` now contains `_shopify_essential` — this is CRITICAL for accessing the checkout page.

**Step B: GET checkout page with session cookie**
```bash
curl -sL -b cookies.txt -o checkout.html \
  "https://STORE.com/checkouts/cn/CART_TOKEN/LOCALE?_r=SESSION_TOKEN&auto_redirect=false&edge_redirect=true&skip_shop_pay=true"
```

**Key params:**
- `auto_redirect=false` — prevents auto-redirect to Shop Pay
- `edge_redirect=true` — required
- `skip_shop_pay=true` — skip Shop Pay, go directly to checkout
- `_r=SESSION_TOKEN` — unique per session, extracted from ur_back_url

**URL pattern:** `/checkouts/cn/<cart_token>/<locale>`
- Cart token: from `/cart.js` response `token` field
- Locale: e.g. `en-de`, `en-us`

### 4.2 Checkout page structure

Layout: `one-page` (in meta `serialized-checkoutLayout`). All sections on same page.

**Meta tags of interest:**
- `serialized-sessionToken` — required for GraphQL mutations
- `serialized-checkoutSessionIdentifier` — checkout session UUID
- `serialized-sourceToken` — cart token
- `serialized-apiClientId` — API client ID (usually 580111)
- `serialized-graphql` — full checkout state as GraphQL payload (shop config, available payments, pricing)

---

## 5. Checkout Form Fields (name attributes)

### Contact Information
| Field | `name` | Required | Autocomplete | Notes |
|-------|--------|----------|-------------|-------|
| Email | `email` | YES | `email` | Also has `id="email"` |

### Shipping Address
| Field | `name` | Required | Autocomplete |
|-------|--------|----------|-------------|
| First name | `firstName` | YES | `shipping given-name` |
| Last name | `lastName` | YES | `shipping family-name` |
| Company | `company` | no | `shipping organization` |
| Address | `address1` | YES | `shipping address-line1` |
| Apt/Suite | `address2` | no | `shipping address-line2` |
| City | `city` | YES | `shipping address-level2` |
| Postal code | `postalCode` | YES | `shipping postal-code` |
| Phone | `phone` | no | `shipping tel-national` |

Country/Region is auto-detected from geolocation (defaults to DE/Germany from our server). Change via country selector (JS-rendered).

### SMS Opt-in
```html
<input type="checkbox" id="sms_marketing_opt_in" name="sms_marketing_opt_in">
```

### Hidden autofill fields (for browser autofill)
```html
<input id="autofill_firstName" name="firstName" aria-hidden="true">
<!-- ... one for each field ... -->
```

---

## 6. Payment: Shopify Hosted Fields (Stripe Backend)

**No direct iframe selectors!** Shopify uses PCI-compliant hosted fields loaded dynamically via:

```
https://checkout.pci.shopifyinc.com/build/<version>/card_fields.js
```

The card fields (number, expiry, CVC) are rendered inside a secure iframe managed by Shopify. You CANNOT directly select or fill these fields — they're in a cross-origin iframe.

**Payment methods available** (from GraphQL state):
1. `shopify_payments` — credit/debit card (Stripe backend, hosted fields)
2. `SHOP_PAY` — Shop Pay wallet
3. `APPLE_PAY` — Apple Pay
4. `GOOGLE_PAY` — Google Pay
5. Shop Cash — store credit
6. Stripe Shared Token — alternative card payment

**Supported card brands:** VISA, MASTERCARD, AMEX, DISCOVER, DINERS_CLUB, ELO, JCB, UNIONPAY

### Browser approach for payment step

When using browser automation:
1. Fill shipping/contact via direct DOM manipulation or form input
2. Click "Continue to shipping" → shipping methods load
3. Select shipping method
4. Click "Continue to payment" → hosted fields iframe loads
5. Card fields are in cross-origin iframe — use `browser_type` targeting iframe input fields:
   - Card number: `#number` or `[data-card-field="number"]` inside iframe
   - Expiry: `#expiry` or `[data-card-field="expiry"]`
   - CVC: `#cvc` or `[data-card-field="cvc"]`
   - Name on card: `name="name"` (may be outside iframe)

**Note:** The exact selectors inside the hosted fields iframe may vary by Shopify version. Always check the DOM after the payment step loads.

---

## 7. Optimization Strategy

### When to use API vs Browser

| Step | Method | Why |
|------|--------|-----|
| Product discovery | **API/curl** | Fast, no JS needed |
| Add to cart | **API** (`/cart/add.js`) | Single POST, returns JSON |
| Cart state | **API** (`/cart.js`) | Single GET |
| Initiate checkout | **API** (POST /cart + cookie capture) | Avoids browser redirect dance |
| Fill contact/shipping | **Browser** OR **GraphQL mutations** | Forms are JS-rendered; can't fill via static HTML POST |
| Select shipping method | **Browser** | JS-rendered options |
| Payment (card entry) | **Browser** | Hosted fields in iframe — must use real browser |
| Complete order | **Browser** | Final "Pay now" button click |

### Token savings
- Product discovery via API: ~5 tokens vs ~2000 tokens (browser snapshot)
- Cart add via API: ~5 tokens vs ~500 tokens
- Checkout initiation via API: ~10 tokens vs ~3000 tokens (navigate + snapshot loop)
- **Total saved before payment step: ~3000 tokens → ~20 tokens (~99.3% reduction)**

### Fast-path checkout URL construction

Once you have the cart token, you can construct the checkout URL directly:
```
https://STORE.com/checkouts/cn/<cart_token>/<locale>
```
But you MUST have the `_shopify_essential` cookie (from POST /cart with checkout=Checkout) + valid `_r` session token.

---

## 8. GraphQL Backend

The checkout uses Shopify's Checkout GraphQL API internally. Key mutations (not directly callable without session tokens):

- `checkoutEmailUpdate` — update email
- `checkoutShippingAddressUpdate` — update shipping address
- `checkoutShippingLineUpdate` — select shipping method
- `checkoutCompleteWithCreditCard` — complete with card payment
- `checkoutCompleteWithTokenizedPayment` — complete with tokenized payment

The `serialized-graphql` meta tag contains the full initial checkout state. Session token is in `serialized-sessionToken`.

---

## 9. Complete Flow Summary

```
1. DETECT: grep for shopify-checkout-api-token or Shopify.shop
2. DISCOVER: curl /collections/all → extract product URLs
3. GET PRODUCT: curl /products/HANDLE → parse variants (var meta = {...})
4. ADD TO CART: POST /cart/add.js {"id": VARIANT_ID, "quantity": 1}
5. GET CART: GET /cart.js → get token
6. INITIATE CHECKOUT: POST /cart with checkout=Checkout → capture _shopify_essential cookie
7. LOAD CHECKOUT: GET /checkouts/cn/TOKEN/LOCALE with cookie + params
8. FILL FORM (browser): email, firstName, lastName, address1, city, postalCode
9. SHIPPING (browser): click continue → select method → click continue
10. PAYMENT (browser): fill card in hosted fields iframe → click "Pay now"
```

---

## 10. Pitfalls

1. **Checkout page redirects to home** — missing `_shopify_essential` cookie. Must get it from POST /cart (not from cart/add.js).
2. **Shop Pay redirect** — set `skip_shop_pay=true` and `auto_redirect=false` in checkout URL params. The `_r` session token is unique per checkout initiation.
3. **Cart cookie expires** — cart cookies last ~30 days. If checkout session expires, re-add to cart and re-initiate.
4. **Hosted fields iframe** — cannot fill card fields via DOM without a real browser. Cross-origin iframe prevents direct manipulation.
5. **Country auto-detection** — Shopify detects country from server IP. Our server (Germany) → country defaults to DE. May need to change country in checkout if shipping to US.
6. **Geolocation mismatch** — if shipping country differs from server country, you need to change the country in the checkout form (JS-rendered selector).
7. **POST /cart returns 405 on redirect** — normal. The 302 redirect is to GET the checkout URL. Use `-L` with curl or follow redirect chain manually.
8. **`_shopify_essential` cookie is HttpOnly** — cannot be accessed via JavaScript, only via HTTP response headers.
9. **Chrome sandbox issues in containers** — if browser_navigate fails with "No usable sandbox", fall back to curl/API for all non-payment steps. Only payment entry requires actual browser.

---

## 11. Testing

To test on any Shopify store:
```bash
# 1. Verify Shopify
curl -sI "https://STORE.com" | grep -i shopify

# 2. Find products  
curl -sL "https://STORE.com/collections/all" | grep -oP '"/products/[^"]+"' | sort -u | head -5

# 3. Get variant ID
curl -sL "https://STORE.com/products/PRODUCT" | grep -oP '"variants":\[.*?\]' | head -1

# 4. Add to cart
curl -s -X POST "https://STORE.com/cart/add.js" \
  -H "Content-Type: application/json" \
  -d '{"id":VARIANT_ID,"quantity":1}'

# 5. Initiate checkout (capture cookies)
curl -s -c cookies.txt -o /dev/null -w "%{redirect_url}\n" \
  -X POST "https://STORE.com/cart" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "checkout=Checkout"
```
