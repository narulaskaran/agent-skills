# vault

A credential store Nano can use and cannot read. Website logins (username, password, optional TOTP seed) and API keys live in a directory owned by a second Unix user, `nano-vault`. The model talks to a daemon over a Unix socket. The socket has no operation that returns a password, a seed, a current code, an API key, or a browser cookie.

Enable it with `NANO_PACKS=core,purchases,vault` and rebuild the image. The browser from the purchases pack then runs as `nano-vault` too. There is one browser, not two. With the vault pack left out of `NANO_PACKS`, nothing here starts and the browser behaves as it does without it.

## Trust model

The boundary is the user id. The agent runs as `nano` and can read anything that user can read, including files under `/data` and anything it can talk a tool into printing. `nano-vault` owns the secret directory (mode `0700`), the browser profile, and the daemon. The agent can connect to the daemon's socket. It cannot replace the socket, and the replies are metadata plus redacted page text.

What the model still receives, on purpose:

- Page content after a login. A statement, a balance, or a confirmation email in the page is visible.
- The logged-in session. Once `browser login` succeeds, the model can click around as that user.
- The last four characters of an API key, so it can tell keys apart.

What it does not receive: the password, the TOTP seed, the current or neighbouring TOTP codes, the API key, or browser cookies.

Honest leftovers:

- The store is not encrypted. A key kept beside the file would not add a boundary. The directory mode and the user id are the boundary. Anyone who can read the filesystem as root, or as `nano-vault`, can read the file.
- The portal trusts every device in the configured allowed networks that is not this machine (the tailnet by default). There is no passphrase. A hostile device on the tailnet can add, replace, or delete entries. It still cannot read a stored password or seed back.
- The saved site itself is trusted with the password. Its own script sees what is typed, as it does when you log in by hand. If that site is compromised, or serves a page written by someone else on the same host, the script can re-encode the password (base64, a canvas, a download) and no redaction will catch that. Redaction and the screenshot refusal catch a page that prints the secret as it is, such as a failed login that echoes it. Save the most specific host you can (`platform.example.com`, not `example.com`).
- Logins are typed only on the saved host over https on the default port. API keys are sent only to the saved hosts on port 443.
- v1's default portal is IPv4. An IPv6 tailnet address needs `NANO_VAULT_BIND` and `NANO_VAULT_ALLOW`.

## Layout

| Path | Who |
|---|---|
| `/vault` | `nano-vault`, mode `0700`. One `store.json`, mode `0600`, plus the browser profile. Mount this (see `compose.yaml`); if it is not a mount, the daemon warns that a new container will not have the secrets. |
| `/run/nano-vault/vault.sock` | The agent can connect. It cannot unlink the socket. |
| `/var/lib/nano-vault/downloads` | Files the browser downloaded, readable by the agent, not inside the secret directory. |

`/data/browser` from a browser that ran before the vault is left in place and not migrated.

The daemon is started by `start-root.sh` while the entrypoint is still root, then restarted if it dies. Its environment is a short allow-list. Nano's API keys are not in it. Only packs shipped under `/app/packs` get this root hook.

## Portal

A small HTTP server in the daemon, for the owner, on a tailnet address. It lists entries, and can add, replace, or delete them. It never shows a password or a TOTP seed again. An API key shows its last four characters. Blank secret fields on edit keep the current value.

It binds to the explicit comma-separated addresses in `NANO_VAULT_BIND`, or else the first local IPv4 address in Tailscale's CGNAT range. It does not fall back to every interface or to loopback. A connection is accepted only when its remote address is inside `NANO_VAULT_ALLOW` (that same range, by default), is not one of this machine's own addresses, and is not loopback. `X-Forwarded-For` is ignored. Requests whose `Host` is not the bind address (or a name in `NANO_VAULT_HOSTS`) are refused, and every POST needs an `Origin` matching `Host` plus a CSRF token.

To enable LAN access too, list both interface addresses in `NANO_VAULT_BIND` and include both the tailnet range and your LAN subnet in `NANO_VAULT_ALLOW`. Wildcard interfaces remain refused. The first configured address is used in shared links. LAN HTTP traffic is unencrypted; use it only on a trusted network, or use HTTPS.

`vault url` prints the address for the agent to text the owner. `vault url --add example.com` pre-fills the site field. The owner opens it with Tailscale on.

## Providers and Models & voice

The same portal has **Providers** and **Models & voice** pages. Save a connection with a base URL, optional API key, API format and supported capabilities, then assign it to main conversation, background tasks, private/local work, speech to text or text to speech. Blank assignments retain environment settings; background tasks can follow the main conversation. Speech requires the `speech` pack. Use **Test connection** to check authentication and availability and load model IDs for the selection hints. OpenRouter tests also fetch its transcription and audio catalogs; saved catalog data prevents assigning a model to the wrong capability.

Formats:

- **OpenAI-compatible**: chat completions, multipart audio transcriptions and WAV speech generation. DeepSeek and OpenRouter presets supply their base URLs.
- **Anthropic Messages**: native `/messages` requests, `x-api-key` authentication and API version headers. System prompts, images, tools and tool results are translated at the daemon boundary. Replies and tool calls are converted back for the runtime. An Anthropic preset supplies its base URL. Anthropic connections support chat work.
- **Custom**: JSON request templates and response field mappings, without executable code. Each enabled capability has a `path`, a `request` template and response field paths. A string request template sends plain text; an object sends JSON. Custom chat uses a non-streaming upstream request and can map tool calls using compatible function-call objects. STT templates can send base64 audio. TTS can return audio bytes directly or map a base64 JSON field with `response.audio`. Optional `healthPath` controls connection tests (default `/health`).
- **Bark / Woof**: the native raw-WAV transcription and plain-text speech APIs. Woof's voice is set by its service.

Custom template variables are `{{model}}`, `{{messages}}`, `{{system}}`, `{{tools}}`, `{{text}}`, `{{audio_base64}}`, `{{voice}}` and `{{max_tokens}}`. An exact placeholder preserves the value's JSON type. A response field path such as `result.text` selects a JSON property. Credentials belong in the API key field, with an optional authentication header and prefix, rather than in templates.

Provider keys are stored with the rest of the vault and never returned in settings or model configuration. Changing a connection's base URL clears its key unless a new one is supplied. Requests go only to the owner-configured endpoint: caller model IDs and destination overrides are ignored. Hosted connections require HTTPS and cannot resolve to private addresses. Local connections use literal loopback or private network addresses and may use HTTP. Private work and its fallback require local connections.

Changes apply on the next request. A fallback must be explicitly assigned, and can receive content after a network failure, rate limit or server error. Authentication errors do not trigger fallback. Provider replies are buffered and text is redacted before being returned over the socket, so model output currently arrives after the upstream response completes. New connections are not automatically populated with keys from the agent environment.

Provider metadata is read over the existing Unix socket. That interface offers no settings writes or credential reads. With vault disabled, environment-based model selection continues unchanged.

## Commands

```
vault list
vault url [--add <site>]
vault fetch <name> [-X METHOD] [-H 'Name: value']... [-d body] <url>
browser login <name> [--user ref] [--password ref] [--otp ref]
```

`vault fetch` sends the key as the one header saved with it (default `Authorization: Bearer <key>`). The model cannot put the key in the URL, the body, or another header. A host must be one that was saved, exactly, or a subdomain when the saved pin starts with `*.`. Redirects off that set are refused, and the key header is not sent again after the host changes. A name that resolves to a loopback, link-local, private, or CGNAT address is refused unless the saved pin is that address written out literally.

`browser login` runs only when the top-level page is `https` and its host is the saved site or a subdomain of it. The frame that holds the password field has to match too. `deepseek.com.evil.example` and `evildeepseek.com` do not match `deepseek.com`.

## Settings

See [env.example](env.example). Copy what you need into `.env`.

Three variables exist only for tests. They are read once when the daemon starts, and the agent cannot set the daemon's environment. Leave them unset:

- `NANO_VAULT_INSECURE_ALLOW_LOCAL` lets a loopback client open the portal.
- `NANO_VAULT_ALLOW_HTTP_LOOPBACK` lets a saved login run on `http://127.0.0.1`.
- `NANO_VAULT_INSECURE_TLS` skips TLS verification for `vault fetch`.

When any of them is on, the daemon logs a warning.
