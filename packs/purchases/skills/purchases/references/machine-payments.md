# Machine payments: shared payment tokens

A shared payment token (SPT, `spt_…`) lets a seller charge the owner's Link card once, through Stripe, for up to the approved amount. Sellers take it either through an HTTP 402 challenge (the Machine Payments Protocol, MPP) or through their own API.

## HTTP 402 (MPP)
A request that answers `402 Payment Required` with a `WWW-Authenticate: Payment …` header is asking to be paid.

1. Look at the challenge: `curl -si <url>` (add the method and body you would send), then `link-cli mpp decode --challenge '<WWW-Authenticate value>' --format json`. Only `method="stripe"` is supported; anything else, stop and tell the owner. Note the amount, currency and what it is for.
2. Text the owner the seller, what the request buys and the amount (skill rule 1).
3. Start the payment with the same method, body and headers the seller expects:
   ```
   link-cli mpp pay https://api.example.com/v1/report -X POST -d '{"topic":"weather"}' \
     -H 'Content-Type: application/json' --format json \
     --context "One weather report from api.example.com for the owner's trip planning, paid per request through its machine payment endpoint."
   ```
   The amount comes from the challenge. Add `--test` only for test sellers.
4. The output has `approval_url` and `_next`. Reply with the link to the owner and, in the same reply, run `link-cli ` followed by `_next.poll_command` exactly as given (it waits for approval).
5. Once approved, run `link-cli ` followed by `_next.pay_command` exactly as given. It retries the request with the token and prints the seller's response: that response is the result.

If you already hold an approved SPT request for this seller: `link-cli mpp pay <url> --spend-request-id lsrq_... [-X/-d/-H …]`.

The token is single use. `verification-failed` means it was already spent: check whether the first attempt went through before creating a new request.

## Seller APIs that take an SPT
Some sellers document an API (often at `/api`, `/docs` or in an `llms.txt`) where you send an SPT in a request body.

1. Read their docs. Get the product, the price, the shipping fields and the seller's Stripe network id (`profile_…`).
2. Text the owner (rule 1). Create:
   ```
   link-cli spend-request create --format json --credential-type shared_payment_token \
     --network-id profile_... --amount 1200 --currency usd \
     --line-item "name:Printed map,unit_amount:1200,quantity:1" \
     --context "One printed trail map from the seller's API, shipped to the owner's default Link address. The owner asked for it today."
   ```
   No `--merchant-name` or `--merchant-url` for SPTs.
3. Wait for approval (link.md), then `link-cli spend-request retrieve <id> --include shared_payment_token --format json` and take `shared_payment_token.id` (`spt_…`) from it. This is a one-time token tied to this seller and amount, not a card number; still keep it out of messages to the owner.
4. Send it as their docs say, with `curl` (`-H 'Content-Type: application/json' -d @-` with a here-document keeps the body readable). Shipping comes from the default Link address, field for field in the seller's format.
5. Follow the seller's flow to the end (for example a separate confirm step with a token they return). Paid only counts when they say so.
6. If they refuse (out of stock, region not served, error), cancel the spend request and tell the owner. Never retry with the same token after a refusal that consumed it.

## Shopping a Link catalog (UCP)
`link-cli ucp catalog search --query "<what>" --format json` searches businesses that sell through Link. If the owner wants something found there: `ucp checkout create --business <np_…> --line-item "id:<sku>,quantity:1"`, settle the fulfillment until `ready_for_complete`, create an SPT request with `--network-id <np_…>` for the final total, then `ucp checkout complete <checkout_id> --spend-request-id lsrq_... --business <np_…>`. `link-cli ucp --help` lists the details.
