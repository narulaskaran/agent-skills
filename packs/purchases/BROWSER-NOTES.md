# Browser operation and Stagehand assessment

Nano currently uses a custom Playwright-backed CLI, not Playwright MCP. The vault owns one persistent browser context. Keep one browser instance for now; future parallel agents need serialized operations or separate profiles with explicit ownership before concurrent browsing is enabled.

The default 15-minute idle close is resource housekeeping, not a credential-expiration guarantee. Cookies and local storage remain in the profile, but live page state and pending JavaScript are lost. For an always-on personal server, `NANO_BROWSER_IDLE_MINUTES=0` keeps the browser open until explicitly closed or the process restarts. Positive values retain automatic idle shutdown. Website session expiry still applies.

The browser now installs full Chromium and selects Playwright's `chromium` channel, using its current headless mode instead of the separate headless shell. This keeps the existing Chromium/CDP WebMCP implementation and vault isolation. No virtual display or remote browser service is needed for this mode.

In a live owner-authorized DeepSeek test, the previous shell had repeatedly reset the accessibility challenge. With full Chromium, one complete set of three answers was accepted, and DeepSeek requested the verification email. The existing webhook woke Nano, which retrieved the code through the vault, completed login, reached top-up, and requested Link app approval. Approval remained pending at the validation checkpoint. This proves one successful pre-payment flow, not repeatable success under every challenge or a causal diagnosis of the old loop. Do not retry charges to test authentication.

CamoFox remains an alternative to evaluate if failures recur. Its project uses Camoufox/Firefox, so the existing Chromium DevTools WebMCP implementation would need a separate compatibility plan. It was not installed: the smaller full-Chromium change completed the blocked flow. Hosted CAPTCHA-capable browsers are also possible but would add an external party trusted with browser state and need a separate target-specific proof of concept. No external account was provisioned.

Stagehand v4 is a plausible future browser layer. It exposes natural-language `act`, `observe` and `extract` operations, local browser profiles, and native WebMCP discovery/invocation with `page.tools()`. It does not require giving up WebMCP. Its old autonomous `agent()` loop was removed in v4; Nano should remain the orchestrator. Local action caching from v3 is not available in v4; documented caching runs server-side with Browserbase.

Recommendation: retain the current vault-owned browser for now. A Stagehand experiment should run locally inside that boundary and prove credential redaction, origin restrictions, profile persistence, iframe WebMCP, and Link approval behavior before replacing the implementation. Natural-language page operations can help with changing layouts; they do not establish a reliable way through a website's CAPTCHA or payment authentication requirements.

WebMCP remains enabled in Chromium and supported by the existing CLI, including tools in cross-origin frames. A local checkout fixture verified discovery and invocation after the lifecycle change. Explicit close/reopen also retained profile storage.

Link app spending approval is intentional and remains required. Web Bot Auth is a future research item only: investigate issuer enrollment, credentials, site acceptance and operational maintenance before proposing integration. No setup is enabled by these notes.

Primary references:
- https://docs.stagehand.dev/v4/first-steps/introduction
- https://docs.stagehand.dev/v4/basics/webmcp
- https://docs.stagehand.dev/v4/configuration/browser
- https://docs.stagehand.dev/v4/migrations/v3
- https://playwright.dev/docs/browsers#chromium-new-headless-mode
- https://github.com/jo-inc/camofox-browser
- https://docs.browserbase.com/platform/identity/captcha-solving
