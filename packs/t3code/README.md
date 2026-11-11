# t3code pack

Lets Nano hand coding work to [T3 Code](https://github.com/pingdotgg/t3code): the owner texts "have T3 fix the flaky test in repo X", Nano starts a T3 Code thread in that project with a self-contained brief, replies with a link, checks back on a schedule and relays the result.

Built on the `mcp` pack: `NANO_PACKS=core,mcp,t3code`.

## What is in here

| File | Purpose |
|---|---|
| `extension.ts` | Registers T3 Code's MCP server as `t3code` once Nano holds a token; redeems a texted pairing code before the model sees it; rewrites thread links to `NANO_T3CODE_WEB_URL` |
| `auth.ts` | Pairing-code sign-in, token storage, token check, server entry |
| `bin/t3code-connect` | `status`, `pair [code] [--access <level>]`, `disconnect` |
| `skills/t3-code/SKILL.md` | When and how to hand off, write the brief, confirm, check back, relay results |
| `skills/t3-code/connect.md` | The one-time connection walkthrough Nano does with the owner over chat |
| `env.example` | `NANO_T3CODE_URL`, `NANO_T3CODE_WEB_URL`, `NANO_T3CODE_ACCESS` |
| `mcp.json.example` | Optional manual entry, if you want to change which tools Nano can reach |

## How T3 Code's MCP endpoint authenticates

`<t3 code origin>/mcp` is a streamable-HTTP MCP server that requires a bearer token. Without one it answers `401` with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`.

- Protected resource metadata (RFC 9728) names T3 Code itself as the authorization server and offers the scopes `orchestration:read` and `orchestration:operate`.
- Authorization server metadata (`/.well-known/oauth-authorization-server`): OAuth 2.1 authorization code with PKCE (S256), public clients (`token_endpoint_auth_method: none`), dynamic client registration at `/oauth/mcp/register`, and the `iss` response parameter. There is no refresh-token grant.
- Registration is stateless: the client id is a signed blob holding the client name and redirect URIs. Redirect URIs must be `https`, or `http` on a loopback host.
- Approval happens on T3 Code's `/connect-agent` page in one of two ways:
  1. from a browser already signed in to T3 Code with access rights (one click), or
  2. by entering a **one-time pairing code**, made with `t3 pair` or in T3 Code's Connections settings.
- The approver also picks an access level (`read-only`, `approval-required`, `auto-accept-edits`, `auto`, `full-access`). It becomes the token's scopes and the ceiling on the runtime mode of threads the client starts.
- The token endpoint takes `application/x-www-form-urlencoded` only. Tokens are MCP-client sessions valid for **30 days**, shown in T3 Code's connection list under the client name, and revocable there or with `t3 auth session revoke`.

For a headless client like Nano, the supported path is the pairing code. T3 Code links its own environments the same way: register, post the pairing-code decision to `/oauth/mcp/decision`, read the authorization code from the returned redirect (it is never visited), and exchange it at `/oauth/mcp/token`. `t3code-connect pair` and the chat flow do exactly that. Pi's built-in browser sign-in (`pi mcp login`) also works, but it needs a browser on the machine Nano runs on, so it is not used here.

T3 Code's guidance is that a pairing code should never pass through an agent's chat context. When the owner texts `T3 pairing code: <code>`, this pack's `input` hook redeems the code and replaces it in the message before the model runs, so the code never reaches the model, the model provider or the Pi session file. Nano's own daily log and recent-message store still record the raw text. The code is single use and is spent by then, and the pack remembers spent codes so a quoted copy is never redeemed twice.

## Tools Nano can reach

The server offers many tools. This pack exposes only these, with `deferred` exposure so they cost nothing in the standing prompt until `tool_search` loads them:

`t3_project_list`, `t3_project_read`, `t3_thread_search`, `t3_thread_list`, `t3_thread_read`, `t3_thread_launch`, `t3_thread_send`, `t3_thread_interrupt`.

Everything else stays hidden: creating, changing or deleting projects, settings, scheduled tasks, previews and devices. Outside a thread, `t3_thread_launch` needs a `projectId` (or `scratch: true`). It returns the thread id and a `link`.

## Thread links

For an MCP client, T3 Code builds `link` from the origin the client connected to: `<origin>/<environmentId>/<threadId>`. That is a stable deep link into the T3 Code web app. Because Nano usually connects over `http://127.0.0.1:4096`, the raw link only works on the T3 Code machine itself. Set `NANO_T3CODE_WEB_URL` to the address you open T3 Code at, and the pack rewrites links in T3 Code tool results to it.

## Setup

1. Add `mcp` and `t3code` to `NANO_PACKS` and copy the settings you need from `env.example` into `.env`, at least `NANO_T3CODE_WEB_URL`. Restart Nano.
2. Connect once, using one of these:
   - **Over chat:** text Nano "connect to T3 Code". It walks you through steps 3 to 5 below.
   - **On the host:** `docker exec -it nano t3code-connect pair --access approval-required` and paste the code from step 3.
3. On the T3 Code machine, create a pairing code (single use, valid for 5 minutes):
   ```bash
   t3 pair --scope orchestration:read --scope orchestration:operate --label Nano
   ```
   Or create one in T3 Code's Connections settings. Add `--scope settings:write --scope source-control:write` only if you want `full-access`.
4. Text Nano `T3 pairing code: <code>`, optionally followed by an access level, for example `T3 pairing code: <code> auto`.
5. Nano confirms with the access level and expiry date. `t3code-connect status` shows the same and tests the token.

Repeat steps 3 and 4 every 30 days. Nano schedules a reminder two days ahead.

## What remains for the owner

Everything up to the pairing code is implemented and verified against the live T3 Code server: metadata discovery, client registration, the pairing-code decision (an invalid code is rejected with T3 Code's message), the form-encoded token endpoint (an invalid authorization code is rejected with `invalid_grant`), and rejection of an invalid bearer. The full flow, from texted code to launched thread, is covered by `test/t3code-pack.test.ts` against a local stand-in for T3 Code.

The one step only the owner can do is create the pairing code (step 3) and hand it to Nano (step 4). After that, the first real handoff is the end-to-end check: text Nano something like "have T3 add a test for X in <project>".

## Limits

- Tokens cannot be refreshed. After 30 days, or after revocation, Nano reports the connection as expired and asks for a new code.
- Nano cannot approve actions inside T3 Code threads. With `approval-required` access, threads wait for you in T3 Code, and Nano tells you when one is waiting.
- `nano-mcp list` does not show `t3code`, because shell commands do not load extensions. Use `t3code-connect status` instead.
