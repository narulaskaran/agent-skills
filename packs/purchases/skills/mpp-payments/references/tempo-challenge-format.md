# Tempo Challenge Format — Full Decoded Example

From MPP Demo site (Vercel, 2026-05-26).

## Raw 402 Response Headers

```
HTTP/2 402
www-authenticate: Payment id="6RGj9SElToCMqkTUtPWjSIB3sEiWc3FLwoG3-09KNUM",
  realm="mpp-demo-47swnhgfe-user-projects.vercel.app",
  method="tempo",
  intent="charge",
  request="eyJhbW91bnQiOiIxMDAwMCIsImN1cnJlbmN5IjoiMHgyMGMwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwIiwibWV0aG9kRGV0YWlscyI6eyJjaGFpbklkIjo0MjQzMX0sInJlY2lwaWVudCI6IjB4ZDY5NjkxZWFkNzczMmYxMTBhYWE5ZjZkMGQzMDAzMDM3MGU1NGZmMjcifQ==",
  expires="2026-05-26T18:49:50.769Z"
content-type: application/problem+json
```

Response body:
```json
{
  "type": "https://paymentauth.org/problems/payment-required",
  "title": "Payment Required",
  "status": 402,
  "detail": "Payment is required.",
  "challengeId": "6RGj9SElToCMqkTUtPWjSIB3sEiWc3FLwoG3-09KNUM"
}
```

## Decoded `request` Field

Decode: `echo "<request>" | base64 -d | python3 -m json.tool`

```json
{
    "amount": "10000",
    "currency": "0x20c0000000000000000000000000000000000000",
    "methodDetails": {
        "chainId": 42431
    },
    "recipient": "0xd69691ead7732f110aaa9f6d0d30030370e54ff27"
}
```

## Field Meanings

| Field | Value | Meaning |
|-------|-------|---------|
| `amount` | `"10000"` | Micro-units of the token. 10000 = 0.01 USDC (6 decimals) |
| `currency` | `0x20c0...0000` | On-chain token address for USDC (probably wrapped/ERC-20) |
| `methodDetails.chainId` | `42431` | EVM-compatible chain ID |
| `recipient` | `0xd696...` | Merchant's wallet address to receive payment |
| `expires` | ISO 8601 | Challenge window (~5 min from 402 response) |

## Payment with mppx

```bash
# One-shot (requires funded wallet + keychain):
npx mppx https://<endpoint>/api/content

# Manual sign (if you have keys):
npx mppx sign <challenge-header> --account <name>
```

## Pitfalls

- **mppx needs `libsecret-tools` on Linux** — provides `secret-tool` binary for keychain. Library-only install (`libsecret-1-0`) is not enough.
- **Chain 42431** is a testnet — you need testnet USDC from a faucet, not mainnet funds.
- Challenge **expires in ~5 minutes** — decode and act quickly.
