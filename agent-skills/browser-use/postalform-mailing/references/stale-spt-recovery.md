# Stale SPT Recovery Pattern

When an approved spend-request (SPT) exists but can't complete payment because the original order's upload token was consumed and the server won't reissue the same challenge.

## Root Cause Chain

1. Order created with `request_id` X → 402 with challenge A
2. SPT approved for challenge A (externalId = X)
3. Upload token consumed by the 402 (pitfall #24)
4. Rate limit (429) or session ends before payment

**Later recovery attempt fails because:**
- Same request_id X with fresh upload token → 422 "Upload token was already used. Order: X" (pitfall #24)
- New request_id with fresh token → 402 with challenge B ≠ A → SPT won't match (pitfall #28)
- Base64 PDF with same request_id → 413 "request entity too large" (pitfall #30)
- `link-cli mpp pay` probes URL → gets new challenge → SPT mismatch (pitfall #31)

## Verified Recovery Path (User Must Be Present)

1. **Fresh PDF upload via MCP** → `pfu_...`
2. **New MPP order** with fresh `request_id` → 402 with new challenge
3. **Decode challenge** with `link-cli mpp decode`
4. **New spend-request** with `link-cli spend-request create` (needs Link app approval)
5. **User approves** in Link mobile app
6. **Pay** with `link-cli mpp pay --method POST --data '<payload with upload_token>'`

## Error Transcripts (May 11, 2026)

### 422: Upload token already used for order
```
POST with request_id="d94ac01f-..." + fresh upload_token
→ 422: "Upload token was already used. Order: d94ac01f-9c8c-4013-a2a6-4d1dfd4e2009."
```

### 413: Base64 PDF too large
```
POST with request_id="d94ac01f-..." + base64 PDF data URL (2.5MB)
→ 413: "request entity too large"
```

### SPT challenge mismatch (via link-cli mpp pay)
```
link-cli mpp pay with fresh request_id
→ Probe gets 402 with new challenge FgD_UMQb...
→ SPT was for challenge 3qlDvEArj...
→ "UNKNOWN: Payment submission failed with status 422"
```

### 429: Rate limit blocks everything
```
POST to /api/machine/mpp/orders
→ 429: "Too many unpaid order attempts. Complete a payment or wait an hour and try again."
```
Blocks both order creation AND payment attempts. 1-hour cooldown required.

## State File Template

```json
{
  "task": "PostalForm postcard to <recipient>",
  "status": "awaiting_approval",
  "pdf_path": "/tmp/postcards/.../card.pdf",
  "upload_token": "pfu_...",
  "upload_token_consumed": true,
  "request_id": "<original-uuid>",
  "challenge_id": "<challenge-id>",
  "network_id": "profile_...",
  "amount_cents": 200,
  "spend_request_id": "lsrq_...",
  "approval_url": "https://app.link.com/activity/approve/lsrq_...",
  "recovery_notes": "Upload token consumed. On recovery: 1) Re-upload PDF for fresh token. 2) Generate new request_id. 3) Create new spend-request (old one is challenge-scoped and can't be reused). 4) Approve and pay."
}
```
