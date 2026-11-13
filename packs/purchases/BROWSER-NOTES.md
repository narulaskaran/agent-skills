# Browser operation and Stagehand assessment

Nano currently uses a custom Playwright-backed CLI, not Playwright MCP. The vault owns one persistent browser context. Keep one browser instance for now; future parallel agents need serialized operations or separate profiles with explicit ownership before concurrent browsing is enabled.

The default 15-minute idle close is resource housekeeping, not a credential-expiration guarantee. Cookies and local storage remain in the profile, but live page state and pending JavaScript are lost. For an always-on personal server, `NANO_BROWSER_IDLE_MINUTES=0` keeps the browser open until explicitly closed or the process restarts. Positive values retain automatic idle shutdown. Website session expiry still applies.

Stagehand v4 is a plausible future browser layer. It exposes natural-language `act`, `observe` and `extract` operations, local browser profiles, and native WebMCP discovery/invocation with `page.tools()`. It does not require giving up WebMCP. Its old autonomous `agent()` loop was removed in v4; Nano should remain the orchestrator. Local action caching from v3 is not available in v4; documented caching runs server-side with Browserbase.

Recommendation: retain the current vault-owned browser for now. A Stagehand experiment should run locally inside that boundary and prove credential redaction, origin restrictions, profile persistence, iframe WebMCP, and Link approval behavior before replacing the implementation. Natural-language page operations can help with changing layouts; they do not establish a reliable way through a website's CAPTCHA or payment authentication requirements.

WebMCP remains enabled in Chromium and supported by the existing CLI, including tools in cross-origin frames. A local checkout fixture verified discovery and invocation after the lifecycle change. Explicit close/reopen also retained profile storage.

Link app spending approval is intentional and remains required. Web Bot Auth is a future research item only: investigate issuer enrollment, credentials, site acceptance and operational maintenance before proposing integration. No setup is enabled by these notes.

Primary references:
- https://docs.stagehand.dev/v4/first-steps/introduction
- https://docs.stagehand.dev/v4/basics/webmcp
- https://docs.stagehand.dev/v4/configuration/browser
- https://docs.stagehand.dev/v4/migrations/v3
