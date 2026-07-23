---
name: postalform-mailing
description: Design and mail physical cards or postcards through PostalForm with exact bleed dimensions, PDF validation, payment safety, and order tracking.
---

# PostalForm mailing

Load `postalform-lessons` and `mpp-payments` before execution. This skill describes workflow only; keep recipient data, sender data, tokens, payment IDs, and private artwork local.

## Safety gates

- Treat names, addresses, emails, photos, order IDs, upload tokens, and payment credentials as sensitive. Use placeholders in drafts and substitute only at execution time.
- Review rendered artwork and text before submission. Do not send until recipient, sender, size, quantity, and message are confirmed.
- Payment is external and irreversible: validate payload first, inspect the 402 challenge, obtain required approval, then submit once. Never retry blindly after a timeout.
- Save the order ID and payment key/header needed for later tracking; verify with a status GET.

## Workflow

1. Choose postcard/card size and calculate bleed from current PostalForm specs. Do not rely on old dimensions.
2. Create HTML with safe-zone margins, readable contrast, and no unsupported Unicode glyphs. Keep artwork and PII separate where possible.
3. Render required page count to PDF. Verify page dimensions, page count, file size, and that all fonts/images are embedded or available.
4. Validate request without charge. Inspect returned schema errors and correct payload before payment.
5. Use the documented MPP flow. Prefer the current supported base64 or upload path; do not mix stale upload-token and payment flows.
6. Submit with one approved payment credential. Capture HTTP status, order ID, and any tracking key from response headers.
7. Poll status with bounded backoff. Report confirmed state only; distinguish accepted, processing, mailed, failed, and unknown.

## Verification commands

```bash
pdfinfo card.pdf
# inspect dimensions and page count before upload
curl -fsS -X POST "$VALIDATE_URL" -H 'Content-Type: application/json' --data-binary @payload.json
```

Use current endpoint and authentication details from `references/payment-flows.md`; never paste live secrets into shell history or reports.

## Pitfalls

- Wrong bleed or orientation causes rejection or cropping.
- Large PNGs can exceed payload limits; compress artwork to JPEG when quality permits.
- A successful upload is not an order. Validate, pay, and query status separately.
- Payment challenge amount/network/request ID must match the order. A fresh SPT may be required after expiry or consumption.
- Space multiple paid orders according to current service rate limits.

## References

- `references/payment-flows.md`: supported payment and tracking paths.
- `references/base64-jpeg-workaround.md`: payload-size workaround.
