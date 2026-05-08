# MPPx Credential Serialization

When `link-cli mpp pay` can't handle the payload (e.g., base64 PDF exceeds ARG_MAX ~2MB
shell limit), serialize the MPP credential manually using `mppx` and send via curl.

## Prerequisites

```bash
cd /tmp && npm install mppx --silent
```

## Full Flow

### 1. Capture the 402 Response

From the MPP order creation, save the `www-authenticate` headers (the `method="stripe"` one):

```
Payment id="RD1OJPaVrXN8xl3so6sCk-4bMelahTGuF3hoxtchQVA",
  realm="postalform.com", method="stripe", intent="charge",
  request="eyJhbW91bnQiOiIyNTAi..."
```

### 2. Serialize Credential with SPT Token

```javascript
const { Challenge, Credential } = require('/tmp/node_modules/mppx');

// Build a mock response with the 402 WWW-Authenticate headers
const mockResponse = {
  status: 402,
  headers: new Map([
    ['WWW-Authenticate', 'Payment id="RD1OJ...", realm="postalform.com", method="stripe"...']
  ])
};

const challenges = Challenge.fromResponseList(mockResponse);
const stripeChallenge = challenges.find(c => c.method === 'stripe');

const credential = Credential.from({
  challenge: stripeChallenge,
  payload: { spt: 'spt_1TUZ8...' }
});

const authorization = Credential.serialize(credential);
// → "Payment eyJjaGFsbGVuZ2UiOnsiZGVzY3JpcHRpb24iOi..."
```

### 3. Send via curl

```bash
curl -s "https://postalform.com/api/machine/mpp/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Payment eyJjaGFsbGVuZ2UiOnsiZ..." \
  -d @/tmp/payload.json
```

Key: curl's `-d @file` avoids the ARG_MAX issue that `link-cli mpp pay --data` hits.

### 4. Verify Payment

```bash
curl -s "https://postalform.com/api/machine/mpp/orders/<order_id>" | python3 -m json.tool
```

Look for `is_paid: true` and `payment_status: paid`.

## Pitfalls

- **Don't send bare SPT token.** PostalForm rejects `Authorization: Payment spt_...` — must be full serialized MPP credential.
- **Must reuse exact challenge.** The challenge from the 402 response must be included in the credential. A different challenge breaks verification.
- **SPT is scoped to the challenge.** The SPT token must match the challenge's `amount`, `currency`, and `networkId`. A token minted for a different order won't work.
- **Challenge expires.** The `expires` field on the WWW-Authenticate header sets the window. If the challenge expires before retry, you need a fresh 402.
