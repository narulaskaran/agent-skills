---
name: vault
description: Use saved website logins and API keys without reading them. When a site needs a sign-in, list vault entries and run browser login, or text the owner the portal address. When an API needs a key, use vault fetch. Never ask the owner to send a password, one-time-code seed, or API key in chat.
---

# vault

Passwords, one-time-code seeds and API keys are stored where you can use them and cannot read them. You will not see the secret in command output, in a file you can open, or in the portal. Do not try to. Do not ask the owner to paste one into the chat. If they do, tell them to change it and to enter the new one in the portal instead.

Spending rules are unchanged. A login does not authorize a purchase. The purchases pack's confirmation rules still apply after you are signed in.

## Signing in to a site

1. `vault list`. Entries are metadata only: name, site, username, whether a one-time code is saved.
2. If an entry exists for the site, open the site with `browser` and run `browser login <name>`. Optional `--user`, `--password` and `--otp` refs are hints from the latest snapshot. The login only runs when the page's host is the saved site, or a subdomain of it.
3. Read the result. It says whether the form was submitted, the URL and title, whether a password field is still on the page (the login probably failed), and whether the site asked for a one-time code you do not have.
4. If there is no entry, or the login fails, run `vault url` (or `vault url --add <site>` to pre-fill the site) and text that address to the owner. Tell them to open it from an allowed local-network or Tailscale device; this machine is deliberately blocked. Then wait. Do not invent a password, and do not type one into the page yourself.

`browser eval` does not run on a site that has a saved login. Use the snapshot.

## Calling an API

`vault fetch <name> <url>` performs the request and prints the status and body. The key is attached by the daemon as the one header stored with it. You do not get the key, and you cannot place it somewhere else.

```
vault fetch deepseek https://api.example/v1/user
vault fetch deepseek -X POST -H "Content-Type: application/json" -d '{"limit":1}' https://api.example/v1/user
```

The URL has to be `https`, and the host has to be one saved with that key (or a subdomain, when the saved host starts with `*.`). A redirect to any other host is refused. A header you pass with the same name as the key's header is refused.

`vault list` shows the key's hosts and the last four characters of the key, not the key.


## Model and speech providers

The same portal has `/providers` for connections and `/models` for per-job selections. The owner controls those settings; the agent socket cannot change them. Run `vault url` and append `providers` or `models` to its trailing slash when the owner needs to configure a connection, model, voice or fallback. Keys belong in the provider form, never in chat or command arguments.

With the speech pack enabled, use `nano-speech stt <audio-file>` and `nano-speech tts "text" [output.m4a]`. Requests use the owner's saved choices. Report failures instead of choosing another service yourself. Private work and its fallback must stay on local connections.
