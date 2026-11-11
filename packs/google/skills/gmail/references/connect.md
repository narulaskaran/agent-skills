# Connecting Google (Gmail and Calendar)

One connection serves both. Do it over chat, a step at a time; the owner may be on a phone.

## 0. Check first
`google auth status`
- `token: shared, read-only (GOOGLE_TOKEN_FILE=...)`: this deployment uses a token owned by another program. Do not run `auth start`. If a permission is missing, tell the owner that program has to grant it.
- A token with the access you need: nothing to do.
- `client:` present but no token: go to step 3.

## 1. The owner creates an OAuth client (once, about 5 minutes)
Send these steps. A computer is easier, but a phone works.
1. Open console.cloud.google.com, sign in with the Google account to connect, and create a project (any name, e.g. "Nano").
2. APIs & Services → Library: enable **Gmail API**, then **Google Calendar API**.
3. Google Auth Platform (also called "OAuth consent screen") → Get started. App name "Nano", support email your own, Audience **External**, contact email your own, agree, Create.
4. Audience → **Publish app** → confirm "In production". Without this Google signs Nano out every 7 days. The app stays private and unverified, which is fine for personal use.
5. Clients → Create client → Application type **Desktop app** → name "Nano" → Create. Download the JSON, or copy the Client ID and Client secret.
6. Send me the JSON file here, or paste the ID and secret.

## 2. Save the client
- File received (the message shows its path): `google auth client <path>`, then delete that copy with `rm <path>`.
- Pasted values: `google auth client --id '<client id>' --secret '<client secret>'`.
Do not repeat the secret back in chat.

## 3. Sign in
`google auth start` prints a link. Send the link with these instructions:
- Open it, pick the account, and on "Google hasn't verified this app" tap Advanced, then "Go to Nano (unsafe)". It is their own app.
- Allow everything listed, then Continue.
- The last page fails to load (it points at localhost). Copy the whole address from the address bar and send it back within about 10 minutes.

If the owner wants Nano to only read, with no drafts, no label changes and no calendar edits, use `google auth start --read-only` instead.

## 4. Finish
`google auth finish '<the pasted address>'`. Always use single quotes, because the address contains `&`. Tell the owner the result in plain words, for example "Connected to user@example.com. I can read and tidy mail, write drafts and manage your calendar. I'll never send anything without asking."

## 5. Keep it alive
Google drops connections that go unused for months. Schedule a weekly check right away:
`schedule_add` with name "Google connection check", kind `script`, cron `17 9 * * 1`, body `google auth check --quiet`, then `send`.
It prints nothing while the connection is healthy. If something breaks it sends one line, and you come back to this file. Check `schedule_list` first so you do not add it twice.

## Problems
- `redirect_uri_mismatch` or "invalid request" on Google's page: the client is not a Desktop app. Create a Desktop client (step 1.5) and save it again.
- "Access blocked" or "app not available": the app is still in Testing. Publish it (step 1.4), or add the owner as a test user under Audience.
- `invalid_grant` on finish: the code expired or was already used. Run `google auth start` again and use the new link.
- "older sign-in attempt": they pasted an address from an earlier link. Use the newest one.
- "no refresh token": remove Nano at myaccount.google.com/permissions, then sign in again.
- "API not enabled": step 1.2 was skipped for that API.
