# Recovery State Format

When an MPP payment stalls on `pending_approval` (cron job, SPT expired), save
this state file so recovery can resume without re-uploading or re-designing.

## Template

```json
{
  "order_id": "<from 402 response>",
  "request_id": "<UUID used in payload>",
  "spend_request_id": "lsrq_...",
  "approval_url": "https://app.link.com/activity/approve/lsrq_...",
  "amount_cents": 200,
  "amount_usd": "2.00",
  "currency": "usd",
  "network_id": "profile_...",
  "payment_method_id": "csmrpd_...",
  "recipient": "Name",
  "recipient_address": "Full address",
  "pdf_path": "/tmp/postcards/.../card.pdf",
  "payload_path": "/tmp/..._mpp_payload.json",
  "challenge_path": "/tmp/..._challenge.txt",
  "status": "pending_approval",
  "created_at": "ISO 8601",
  "recovery_instructions": "After approval: extract SPT, mppx serialize, curl retry"
}
```

## Recovery Commands

```bash
# 1. Get SPT after approval
SPT=$(npx -y @stripe/link-cli spend-request retrieve <lsrq_id> --full-output --format json | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data'][-1]['shared_payment_token']['id'])")

# 2. Serialize credential
AUTH=$(node /tmp/mppx_gen.js "$(cat /tmp/<name>_challenge.txt)" "$SPT")

# 3. Pay
curl -s -H 'Content-Type: application/json' \
  -H "Authorization: $AUTH" \
  -d @/tmp/<name>_mpp_payload.json \
  https://postalform.com/api/machine/mpp/orders \
  | python3 -m json.tool
```

## Failure Modes During Recovery

### SPT expired again (Stripe PaymentIntent failed)
The challenge may have expired between initial 402 and recovery. If the
original challenge is stale, replay the same payload (same request_id) to
get a fresh 402 challenge, then create a NEW spend-request, get approval,
and use the new SPT. The base64 payload is idempotent — replaying is safe.

### Challenge already expired when recovery starts
If `>5 min` elapsed since initial 402, the challenge is dead. Replay the
payload: `curl -s -D /tmp/fresh_headers.txt -d @payload.json <endpoint>`.
This gets a fresh 402 with a new challenge. Create a new spend-request
for the new challenge, get approval, pay.

### Spend-request shows "approved" but SPT is empty
The spend-request may have been approved but the SPT was already used
(single-use). Check `--full-output` for the `shared_payment_token` field.
If missing, create a fresh spend-request.
