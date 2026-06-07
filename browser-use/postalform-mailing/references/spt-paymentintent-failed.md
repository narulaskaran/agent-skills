# SPT PaymentIntent Failed — Error Transcript

## Context

2026-05-11 cron job: Abhinav postcard using pre-approved SPT `spt_example123456789`.
Base64 payload (291KB JPEG-compressed PDF), 4x6 postcard, $2.00.

## Flow

1. POST payload to MPP → **402 with Stripe challenge** `uQ8TzGGlJTWb5x3KXTlJ8ckqBq4XxQqlBGUjjTLxdvQ`
2. Serialized credential with `mppx_gen.js` — produced valid `Authorization: Payment eyJ...` header (1206 chars)
3. Retried with auth header → **402: "Payment verification failed: Stripe PaymentIntent failed."**

```json
{
  "type": "https://paymentauth.org/problems/verification-failed",
  "title": "Verification Failed",
  "status": 402,
  "detail": "Payment verification failed: Stripe PaymentIntent failed.",
  "challengeId": "rkS2OOJEO6--6cIbg41dIGOk0riaMtbV5Ex5r4SAmvY",
  "order_id": "e3996d0f-879e-4a54-8c96-56124eeb8595"
}
```

## Root Cause

The SPT token was structurally valid (passed challenge verification — the challengeId on the error response changed to a new value, meaning the old challenge was verified but the Stripe PaymentIntent creation step failed). The SPT itself was rejected by Stripe — likely expired, already consumed, or the underlying payment method was unusable.

## Recovery

1. Created fresh spend-request `lsrq_1TVxY2BlKzBtMJGOPY51FxO0` ($2.00)
2. Approval URL: `https://app.link.com/activity/approve/lsrq_1TVxY2BlKzBtMJGOPY51FxO0`
3. After approval: replay same body → fresh 402 → serialize new SPT → retry

## Why replay works with base64

Unlike upload_token orders (where the token is consumed by the 402), base64 data URL payloads don't consume any server-side resource. The same `request_id` + body can be replayed indefinitely to get fresh challenges until a valid SPT is provided.

## Key artifacts

- Payload: `/tmp/abhinav_payload.json` (291,673 bytes)
- Order ID: `e3996d0f-879e-4a54-8c96-56124eeb8595`
- Original challenge: saved to `/tmp/stripe_challenge.txt`
- Spend-request: `lsrq_1TVxY2BlKzBtMJGOPY51FxO0`
