# Validating Nano with `@stripe/link-validate`

Stripe's validator starts a local test seller and prints one task per payment channel. Each task is a sentence such as "Buy the trail water bottle from http://127.0.0.1:PORT/card-browser-purchase and ship it to my default address. Use test-mode payment credentials only (Link CLI: --test)." It then watches the seller and Link until each purchase is paid and confirmed.

| Validation | Channel | What the agent must do |
|---|---|---|
| `spt-api-purchase` | api | read the seller's API docs, pay with a shared payment token, confirm the order |
| `spt-mpp-purchase` | mpp | pay an HTTP 402 challenge with `link-cli mpp pay` |
| `spt-api-cancel` | api | attempt a purchase the seller refuses (out of stock), then cancel the spend request |
| `card-browser-purchase` | browser | fill a card checkout form in a browser with a test virtual card |
| `card-webmcp-purchase` | webmcp | submit the same checkout through the page's WebMCP `purchase` tool |

## What it needs
- A Stripe sandbox secret key (`sk_test_…` or `rk_test_…`) as `STRIPE_SECRET_KEY`. The SPT channels use it to verify payments; the card channels never call Stripe.
- A Link account (US or Canada) with a card and one default shipping address, logged in to `link-cli`. Shipping is checked against that default address; without one the shipping check is skipped.
- The validator auto-approves test spend requests for its own seller (link-cli 0.30 or later; the image pins 1.4.1), so nobody has to approve in the Link app.

## Why it runs inside the Nano container
The seller listens on `127.0.0.1` only and rejects any other `Host`, so the agent's browser and `curl` must share its network namespace. The validator also reads Link through `link-cli` on its PATH, so it must use the same login as the agent. Running it inside the Nano container covers both. Each task needs its own conversation; `test/validate.sh` gives each one a separate Nano process on the stdin channel with a fresh data directory, all sharing one Link login.

## Procedure
Use a throwaway container, never the one serving the owner. `<env-file>` holds the model key.

```sh
docker build -t nano:dev .
docker run -d --name nano-validate --env-file <env-file> -e NANO_PACKS=core,purchases \
  -v nano-validate:/data nano:dev sleep infinity

# 1. Link login, once (approve the link it prints in the Link app):
docker exec -it -u node -e HOME=/data/home nano-validate \
  link-cli auth login --client-name "Nano validation"
docker exec -u node -e HOME=/data/home nano-validate link-cli auth status

# 2. Install the validator:
docker exec -u node -e HOME=/data/home -w /data nano-validate \
  git clone --depth 1 https://github.com/stripe/link-cli link-cli-src
docker exec -u node -e HOME=/data/home -w /data/link-cli-src nano-validate \
  npx -y pnpm@10 install --prod --filter @stripe/link-validate

# 3. Run it (all channels, or e.g. --channel browser,webmcp):
docker exec -u node -e HOME=/data/home -e STRIPE_SECRET_KEY=<sk_test_key> nano-validate \
  bash /app/packs/purchases/test/validate.sh /data/link-cli-src --timeout 1800
```

`validate.sh` prints one line per validation and exits with the validator's code: 0 passed, 1 setup error, 2 failed, 3 timed out. Each task's conversation is in `/data/validate/<run>/<validation>/transcript.txt`, with Nano's log in `nano.log` and the full session under `sessions/`. The validator's JSON events are in `events.jsonl`.

To feed tasks by hand instead, run `node packages/validate/src/index.ts` in `/data/link-cli-src` and paste each task into a separate Nano process:

```sh
docker exec -it -u node -e HOME=/data/home nano-validate bash -c \
  'd=/data/manual/$RANDOM; mkdir -p $d/profile && echo "Test owner." > $d/profile/USER.md &&
   NANO_DATA_DIR=$d LINK_AUTH_FILE=/data/link/auth.json NANO_CHANNEL=stdin node /app/src/index.ts'
```

The profile file skips first-run onboarding. Nano exits when its stdin closes, so leave it open until the validator reports the task.

## Cleanup
Spend requests from an abandoned run stay pending until they expire. Cancel them:

```sh
docker exec -u node -e HOME=/data/home nano-validate link-cli spend-request list --format json
docker exec -u node -e HOME=/data/home nano-validate link-cli spend-request cancel <lsrq_id>
docker rm -f nano-validate && docker volume rm nano-validate
```

## Results so far
No sandbox key or Link login was available while building this pack, so no validation has passed yet. What did run, in the image built from this pack:

- The validator installs in the container (`pnpm install --prod --filter @stripe/link-validate`, about 4 s) and its `--help` runs. Without a key it exits 1 with its setup message.
- `validate.sh --channel browser,webmcp` with a placeholder `sk_test` key and no Link login (the card channels never call Stripe): both tasks reached the seller (`api_viewed`). The agent read the skills, opened the checkout, found the WebMCP `purchase` tool on the WebMCP task, checked `link-cli auth status`, started `link-cli auth login` and asked the owner to approve it. Both timed out at that point (exit 3), as expected without a login.
- Not exercised: the SPT channels (they need the sandbox key), spend request creation and approval, `{{card.*}}` filling from a real spend request, `mpp pay`, and the cancel flow.

Running the procedure above with a sandbox key and a Link login is the remaining step.
