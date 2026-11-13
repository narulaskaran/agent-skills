# Browser troubleshooting

- **Element not found or timeout**: the ref is stale. Snapshot again. If the element is below the fold or in a collapsed section, `browser scroll <ref>` or click the section open first.
- **Click does nothing**: an overlay (cookie banner, newsletter popup) is in the way. Close it, or `browser click <ref> --force`. Check `browser tabs` in case it opened a new tab.
- **Snapshot too long**: use `-i`, snapshot a part (`browser snapshot e40`), or `--max 4000`.
- **Page looks empty**: `browser wait 3000` then snapshot again; single-page apps render late. `browser screenshot` shows what is really there.
- **Dialogs** (`alert`, `confirm`) are accepted automatically and reported in the command output.
- **Downloads** are saved under the browser directory; the command output gives the path.
- **Verification challenges**: for an owner-authorized account, use the normal UI and an accessibility challenge when offered. Finish the complete set, then wait for its result; do not keep clicking while it is processing. After two complete sets that reset or a denial, stop retrying and report the observed state. Do not forge tokens or disable checks. Check browser compatibility and supported integration routes before declaring that human takeover is necessary. For a blocked Link purchase, record `link-cli report --outcome blocked --tag captcha …`.
- **Logged-in sites**: the profile keeps cookies. For an owner-authorized login, use `browser login` with a saved vault entry; never guess passwords. Email verification codes can be retrieved from the configured inbox using its skill. Keep codes out of chat and notes, and use only fresh messages matching the current login. Link-app spend approval and any bank verification still require the owner's participation.
- **Stuck browser**: `browser close`, then start again. The profile is kept.
- **Location**: the browser runs where the container runs, so stores may guess the wrong country or currency. Check the currency and ship-to country before paying.

## Shopify stores
Most small shops run on Shopify. Recognise them by `cdn.shopify.com` assets or `/products/<handle>` URLs. Product data is public JSON, so skip the browser for discovery:

- `curl -s https://<shop>/products/<handle>.js` gives variants with ids, prices in cents and availability.
- `curl -s https://<shop>/products.json?limit=50` lists products.

Use the browser for the cart and checkout: add the variant (`https://<shop>/cart/<variant_id>:<qty>` opens checkout with that cart), fill contact and shipping, pick shipping, then the card fields, which are cross-origin iframes. Shopify may offer Shop Pay first; choose the plain card option.
