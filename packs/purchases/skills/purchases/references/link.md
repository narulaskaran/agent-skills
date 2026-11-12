# Link CLI

`link-cli` keeps its login in `$LINK_AUTH_FILE` (default `<data>/link/auth.json`). Add `--format json` whenever you parse output. `link-cli <command> --schema` shows every option of a command. The version is pinned by the image: never try to update or reinstall it.

## Connecting
Check first: `link-cli auth status --format json` (`authenticated: true` means done).

If not connected:
1. `link-cli auth login --client-name "Nano" --format json` returns `verification_url` and `phrase`.
2. Your next reply must contain both the message to the owner and the wait command. Text written next to a tool call is sent before the command starts; a wait command with no text beside it leaves the owner without the link until the wait is over.
   - Message: open the link, sign in to Link, check the phrase matches (quote it), approve. Link is for US and Canadian accounts; the Link app (https://link.com/download) is where they will approve purchases later.
   - Command: `link-cli auth status --interval 5 --max-attempts 120 --format json` (waits up to 10 minutes).
3. When `authenticated` is true, confirm in one line and carry on with the task. If it times out, say you are still waiting; the pending login stays valid for a while, and a later `auth status` completes it once they approve.

If they do not want to share spending history, add `--no-financial-insights` to the login.

## Wallet
- `link-cli payment-methods list --format json`: cards and banks usable by agents. The default is used unless the owner names another card; pass its id as `--payment-method-id`.
- `link-cli shipping-address list --format json`: saved addresses. Use the one with `is_default: true`. Fields: `name`, `line_1`, `line_2`, `locality` (city), `administrative_area` (state), `postal_code`, `country_code`.
- `link-cli user-info retrieve --format json`: spend limits and any verification the owner still has to finish (`agent_wallet_verification_requirement.action_url`; send them that link).
- `link-cli spend-request list --format json` (`--include-history` for old ones).

## Creating a spend request
Card (normal checkout):
```
link-cli spend-request create --format json \
  --merchant-name "Example Shop" --merchant-url "https://shop.example.com/checkout" \
  --amount 4599 --currency usd \
  --line-item "name:Trail mug,unit_amount:1999,quantity:2" \
  --total "type:shipping,display_text:Shipping,amount:601" \
  --total "type:total,display_text:Total,amount:4599" \
  --context "Two trail mugs from Example Shop, shipped standard to the owner's default address. The owner asked for this purchase in chat today."
```
- Amounts are integers in the currency's minor unit (cents). Pass the checkout's currency explicitly.
- `--context` must be at least 100 characters. The owner reads it when approving, so write it for them.
- `--merchant-url` is the page where you will pay.
- Shared payment token: `--credential-type shared_payment_token --network-id <profile_…>`, without merchant name and URL.
- Link Pay Token: `--credential-type link_pay_token --merchant-account-id <acct_…>`, without merchant name, URL, `--network-id` or `--test`.
- Subscriptions: add `--recurring-interval month` (or day, week, year). The amount is the limit per period. Cancelling the spend request stops payments but not the merchant subscription.
- Preorders or charges after delivery: `--expires-at <ISO time>Z`, explained in the context.
- `--test` for test credentials (not for Link Pay Tokens).

Approval is requested automatically. The output has the request `id` and `approval_url`.

## Approval
Reply with the message and the wait command together (text next to a tool call is sent before it runs). The message has the details (rule 1 in the skill) and the `approval_url`, and says they can also approve in the Link app. The command:
```
link-cli spend-request retrieve <id> --interval 3 --timeout 300 --format json
```
- `approved`: pay now. Card credentials are valid until `card.valid_until`.
- `denied`, `expired`, `canceled`: stop and tell the owner. Do not recreate it unless they ask.
- `requires_action` (or `failed` with an action): run `link-cli spend-request retrieve <id> --next-action --format json`, send the owner its `display_message` and exact `action_url`; they complete the check themselves. With `resolution: auto_resume`, retrieve the same request again after they finish (another action may follow). Otherwise create a new request after they finish.
- `POLLING_TIMEOUT` (still pending after 5 minutes): tell the owner it is waiting for their approval and end the turn. When they say they approved, retrieve again. The approval window is 30 minutes.

## Cancelling
`link-cli spend-request cancel <id>` revokes the credential. Do it when the owner changes their mind, the merchant refuses the order, the total changed, or a purchase attempt failed before the credential was used.

## Reporting
After an attempt, success or failure, you may tell Stripe how it went. It helps the next agent and costs nothing:
```
link-cli report --domain shop.example.com --outcome success --spend-request-id <id> \
  --attempt-trace "1. /products/mug: clicked Add to cart
2. /checkout: entered [email] and [address], chose Standard
3. /checkout: card in Stripe iframe, clicked Pay, order confirmed"
```
Outcomes: `success`, `blocked`, `abandoned`. Tags (`--tag`, repeatable): `stripe_checkout`, `captcha`, `anti_bot_script`, `cdn_block`, `waf_block`, `dns_block`, `rate_limited`, `login_required`, `3ds_challenge`, `page_inaccessible`, `timeout`, `site_error`, `payment_declined`, `other` (explain with `--freeform-context`). Never put the owner's email, name, address or card in a report.

## Limits
$500 per spend request and per day, $20,000 per 30 days, 30 minutes to approve, at most 10 approved requests open at once, 50 created per hour. US and Canadian Link accounts only.

## Errors
| Error | Fix |
|---|---|
| `Not authenticated` | Connect first (above). If it worked before, the login expired: connect again. |
| `context` too short | Rewrite it as a full sentence of 100+ characters. |
| merchant name/URL rejected | Leave them out for shared payment tokens and Link Pay Tokens. |
| `verification-failed` from a seller | The token was already used. Create a new spend request. |
| `NO_PAYMENT_METHOD` | The owner needs to add a card in the Link app. |
