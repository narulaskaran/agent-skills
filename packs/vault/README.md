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
- The portal trusts every tailnet device that is not this machine. There is no passphrase. A hostile device on the tailnet can add, replace, or delete entries. It still cannot read a stored password or seed back.
- A page can copy a filled secret into some other element after the command returns. Text the daemon returns is redacted; a later screenshot can still show pixels. Password fields and fields the vault filled are masked, and a failed login clears leftover password fields before the command returns.
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

It binds to `NANO_VAULT_BIND`, or else the first local IPv4 address in Tailscale's CGNAT range. It does not fall back to every interface or to loopback. A connection is accepted only when its remote address is inside `NANO_VAULT_ALLOW` (that same range, by default), is not one of this machine's own addresses, and is not loopback. `X-Forwarded-For` is ignored. Requests whose `Host` is not the bind address (or a name in `NANO_VAULT_HOSTS`) are refused, and every POST needs an `Origin` matching `Host` plus a CSRF token.

`vault url` prints the address for the agent to text the owner. `vault url --add example.com` pre-fills the site field. The owner opens it with Tailscale on.

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
