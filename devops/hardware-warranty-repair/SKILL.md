---
name: hardware-warranty-repair
description: Managing product warranty claims, RMA processes, vendor repair tickets — tracking portals, authorization steps, shipping selection, cross-platform email verification.
---

# Hardware Warranty & RMA Workflows

Managing product warranty claims, RMA (Return Merchandise Authorization) processes, and vendor repair tickets. Covers tracking portals, authorization steps, shipping selection, and cross-platform email verification.

## Trigger Conditions
- Product failure requires warranty claim or RMA
- User asks about product replacement, repair status, or return process
- Vendor support case is mid-flight and needs status checking
- Authorization received and user action on vendor portal required

## Post-Authorization Portal Checklist (Generic)
After vendor confirms/authorizes an RMA:
1. Log into vendor's customer portal with account credentials
2. Locate RMA case by case number or email link
3. Confirm shipping address (must be physical — no PO Box)
4. Select shipping method (varies by vendor):
   - Free/Standard: return defective first, replacement ships afterward
   - Advanced/Paid: replacement ships first, convenience fee applies
5. Complete any required payment via PayPal or credit card on file
6. Note the deadline for returning defective unit (often 25-30 days)
7. Keep defective unit intact until process completes

## Cross-Platform Email Verification
Vendors may reply to EITHER inbox a user uses:
- Check the support ticket sender's official email address
- Also check the account holder's Gmail if they're logged into that account with the vendor
- AgentMail or similar monitoring often captures one side only; always also verify account holder's primary Gmail

### Handling OAuth Expiration Mid-Tracking
If hismaila/Gmail tool fails with `IMAP AUTHENTICATE XOAUTH2 failed: NO Invalid credentials`:
- The access token has expired — re-run the gmail authorization flow
- Use AgentMail or other accessible inboxes as intermediate verification source
- Don't treat this as a permanent limitation

## Email Monitoring for RMA Cases
When tracking warranty claims across email:
- Filter by case number AND vendor name (two-part filter, not just one)
- Ignore already-processed thread IDs to avoid false positives
- Note authorization emails typically come from multiple sources (support + automated/portal)
- AgentMail captures outbound support replies; Gmail may have direct inbound updates
