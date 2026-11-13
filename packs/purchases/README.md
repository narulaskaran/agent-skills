# purchases

Lets Nano buy things online for its owner with their [Stripe Link](https://link.com) wallet. Every payment is a Link spend request that the owner approves in the Link app; that approval is the only sign-off.

Enable it with `NANO_PACKS=core,purchases` and rebuild the image.

## What it adds
- `browser`: a headless Chromium the agent drives from the shell. Pages are read as accessibility snapshots with refs (`e12`, or `f1e3` inside an iframe), so it can fill card fields in cross-origin payment frames such as Stripe Elements. It also calls a page's WebMCP tools and fills Stripe's Link Pay Token field. One background browser per data directory keeps a persistent profile under `$NANO_DATA_DIR/browser` and stops after 15 idle minutes by default (`NANO_BROWSER_IDLE_MINUTES=0` disables that timeout). `browser help` lists the commands.
- `link-cli`: the Stripe Link CLI, pinned, with its login stored in `$NANO_DATA_DIR/link/auth.json` (or `$LINK_AUTH_FILE`).
- Skills: `purchases` (rules, choosing a payment path, Link commands, checkout, machine payments) and `browser`.

Payment paths the agent knows:

| Seller | Credential | How |
|---|---|---|
| Ordinary web checkout | one-time virtual card | typed into the form by `browser` from `{{card.*}}` placeholders |
| Page exposing a WebMCP purchase tool | virtual card | `browser webmcp call` with the same placeholders |
| Stripe Checkout with the agent payment block | Link Pay Token | `browser lpt detect`, then `browser lpt fill` |
| HTTP 402 with a Stripe challenge (MPP) | shared payment token | `link-cli mpp pay` |
| Seller API that accepts a shared payment token | shared payment token | `link-cli spend-request create --credential-type shared_payment_token`, then `curl` |

The browser fetches card details from the approved spend request itself. Card numbers never reach the model, its session log or the disk: they are replaced in every command output by `[card •••• 4242]`, and screenshots mask the fields they were typed into.

## One-time setup
1. Rebuild: `docker compose build`.
2. Text Nano "connect my Link account". It sends a link and a phrase; approve in the Link app. Or from a shell: `docker compose exec -u node nano link-cli auth login --client-name Nano`. Link is available to US and Canadian accounts.
3. In the Link app, add a card and a default shipping address.

To reuse the login of another link-cli install, copy its `config.json` (from `~/.config/link-cli-nodejs/` on that machine) into the data directory and set `LINK_AUTH_FILE` to it. Refresh tokens rotate, so two installs using one login can sign each other out; a separate login is safer.

## WebMCP
The browser launches full Chromium in its current headless mode with `--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport` and `--site-per-process` and talks to the Chrome DevTools `WebMCP` domain, so it lists and calls both declarative tools (`<form toolname>`) and imperative ones (`document.modelContext.registerTool`), including tools registered inside cross-origin iframes. Tested against the local fixture in `test/`: a declarative `purchase` form tool and an imperative tool inside a cross-origin card iframe.

On Stripe's checkout pages the tools (`get_link_pay_token_merchant`, `set_link_pay_token`, `select_payment_method`, `apply_promo_code`) are registered by Stripe.js only when Stripe enables them for the checkout session. On Stripe's public test-mode demo they were not enabled, while the Link Pay Token block they wrap was present and detected, so `browser lpt` covers the same flow without them. Iframe tools need `allow="tools"` on the iframe. The browser uses `--site-per-process` and the required WebMCP feature flags, and iframe discovery/invocation is covered by the local fixture.

## Browser installation
`install.sh` installs the full Chromium build pinned by `playwright-core`, rather than the separate headless shell. Launch uses `channel: "chromium"` so headless operation uses that full browser. This increases the image size in exchange for compatibility with normal web applications. It does not guarantee that every website will accept an automated login. See [BROWSER-NOTES.md](BROWSER-NOTES.md) for the live verification result and its limits.

## Validation
[VALIDATION.md](VALIDATION.md) describes running Stripe's validator (`@stripe/link-validate`) against Nano.

## Tests
`node --test packs/purchases/test/*.test.mjs` covers redaction and placeholder handling. `test/fixture-server.mjs` serves an offline checkout (cart, select, card iframe, WebMCP tools, Link Pay Token block) for manual or agent runs:

```
docker exec -u node <container> node /app/packs/purchases/test/fixture-server.mjs
# then: browser open http://127.0.0.1:8471/
```
