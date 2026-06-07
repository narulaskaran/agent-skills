# PostalForm API Interaction Reference

Raw API call transcripts from the Mother's Day card session (May 7, 2026).

## Validate Order

```bash
curl -s "https://postalform.com/api/machine/orders/validate" \
  -H "Content-Type: application/json" \
  -d '{"request_id":"<UUID>","buyer_name":"Jane Doe","buyer_email":"user@example.com","mailpiece_type":"postcard","postcard_size":"6x9","pdf":"data:application/pdf;base64,...","sender_name":"Jane Doe","sender_address_type":"Manual","sender_address_manual":{"line1":"123 Main St","line2":"Apt 1A","city":"Anytown","state":"ST","zip":"12345"},"recipient_name":"Jane Smith","recipient_address_type":"Manual","recipient_address_manual":{"line1":"456 Oak Ave","city":"Springfield","state":"ST","zip":"67890"}}'
```

Success response:
```json
{
  "request_id": "bab25dc3-ea83-45ab-9d1a-0e1e2c842d28",
  "status": "validated_new_order",
  "quote": {
    "price_usd": 2.5,
    "page_count": 2,
    "billable_page_count": 2,
    "double_sided": true,
    "color": true,
    "mail_class": "standard",
    "mailpiece_type": "postcard",
    "postcard_size": "6x9",
    "provider": "lob"
  }
}
```

## MPP Order Creation (402)

```bash
curl -s -i "https://postalform.com/api/machine/mpp/orders" \
  -H "Content-Type: application/json" \
  -d @order.json
```

402 response headers include:
```
x-payment-protocol: mpp
www-authenticate: Payment id="...", realm="postalform.com", method="tempo", ...
www-authenticate: Payment id="...", realm="postalform.com", method="stripe", intent="charge", request="<base64>", ...
```

The Stripe challenge (base64-decoded):
```json
{
  "amount": "250",
  "currency": "usd",
  "externalId": "<order_id>",
  "methodDetails": {
    "metadata": {
      "buyer_email": "user@example.com",
      "buyer_name": "Jane Doe",
      "machine_method": "stripe_spt",
      "machine_protocol": "mpp",
      "mailpiece_type": "postcard",
      "orderId": "<order_id>",
      "payment_channel": "mpp_machine",
      "postcard_size": "6x9"
    },
    "networkId": "profile_61TtEFzJLc3ern1bCA6TtEFz2WSQelapp2aMumCymWBE",
    "paymentMethodTypes": ["card", "link"]
  }
}
```

402 body:
```json
{
  "type": "https://paymentauth.org/problems/payment-required",
  "title": "Payment Required",
  "status": 402,
  "order_id": "<order_id>",
  "message": "Payment challenge issued. Do not create a new order.",
  "retry_requirements": {
    "reuse_request_id": true,
    "reuse_request_body": true,
    "do_not_create_new_order": true
  },
  "supported_methods": ["tempo", "stripe_spt"]
}
```

## Order Status Poll

```bash
curl -s "https://postalform.com/api/machine/mpp/orders/<order_id>"
```

Awaiting payment:
```json
{
  "order_id": "...",
  "status": "awaiting_payment",
  "payment_status": "awaiting_payment",
  "is_paid": false,
  "payment_intent_id": "pi_3TUYktAZ1uAl2Z270WgwP4Qz",
  "payment_channel": "mpp_machine",
  "price_usd": "2.50",
  "currency": "usd",
  "mailpiece_type": "postcard",
  "postcard_size": "6x9"
}
```

## MCP PDF Upload

```bash
# 1. Initialize session (SSE)
curl -s -i "https://postalform.com/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hermes","version":"1.0"}}}'

# Response includes: mcp-session-id: <session_uuid>

# 2. Create upload slot
curl -s -N "https://postalform.com/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: <session_id>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"postalform.create_pdf_upload","arguments":{"file_name":"card.pdf"}}}'

# Response includes: upload_url, upload_token, expires_at

# 3. Upload the PDF
curl -s -X POST "<upload_url>" -F "file=@card.pdf"
# Returns: {"upload_token":"pfu_...","status":"uploaded",...}
```

## Common Validation Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `request_id: Invalid UUID` | Not UUID format | Use `str(uuid.uuid4())` |
| `pdf: must be { upload_token } or ...` | pdf field as object with "data" key | Use string data URL or `{"upload_token":"..."}` |
| `sender_name: expected string, received undefined` | Missing field | Add `sender_name` and `recipient_name` |
| `Upload token is invalid or expired` | Token consumed or expired | Create fresh token per order |
| `pdf: Provide exactly one of pdf or form` | Missing pdf field on retry | Must include pdf even on payment retry |
| `Too many unpaid order attempts` | Rate limited | Wait 1 hour or complete existing payment |
