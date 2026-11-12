---
name: t3-code
description: Hand coding work to T3 Code, the owner's coding-agent app. Start a thread in the right project with a self-contained brief, confirm with a link, check back on a schedule and relay the result. Read whenever the owner asks for work on code or a repository ("have T3 fix…", "open a PR for…", "how is the T3 thing going"), or to connect Nano to T3 Code.
---

# T3 Code handoff

The owner does real coding in T3 Code. Repository work goes there, not into your own shell: you start a T3 Code thread, an agent in T3 Code does the work, and you keep the owner posted. Answer quick questions about code yourself when no repository is involved.

## Tools
T3 Code's tools are deferred. Load them with `tool_search` (for example `t3 code project thread launch`), then call them by full name:
- `mcp__t3code__t3_project_list` `{limit: 100}`: projects with `id`, `title`, `workspaceRoot`.
- `mcp__t3code__t3_thread_launch` `{projectId, title, message, clientRequestId}`: starts a thread; returns its id and `link`.
- `mcp__t3code__t3_thread_read` `{threadId, limit, maxCharsPerItem}`: status and latest messages. Keep `limit` around 4 and `maxCharsPerItem` around 4000.
- `mcp__t3code__t3_thread_send` `{threadId, message, mode: "auto"}`: follow-up instructions. `auto` starts an idle thread, steers a running one, or queues.
- `mcp__t3code__t3_thread_search` `{query}` and `mcp__t3code__t3_thread_list` `{projectId}`: find an existing thread.
- `mcp__t3code__t3_thread_interrupt` `{threadId}`: stop a running turn. Only when the owner asks.

If `tool_search` finds no `mcp__t3code__` tools, or a call fails with 401 or "credential", run `t3code-connect status`. If it is not connected or expired, follow [connect.md](connect.md) with the owner.

## Starting work
1. **Pick the project.** List projects and match the owner's words against `title` and the last part of `workspaceRoot`. One clear match: use it. Several: ask in one line, naming two or three candidates. None: say so and name the closest. You cannot create projects; the owner adds new repositories in T3 Code.
2. **Check for an existing thread** when the owner refers to earlier work ("tell T3 to also…", "the login bug thread"). Use your notes (below) or `t3_thread_search`, then `t3_thread_send` instead of starting a new thread.
3. **Write the brief.** The T3 Code agent cannot see this conversation, the knowledge base or anything else of yours. The `message` must stand alone:
   ```
   Goal: <one sentence, in the owner's terms>
   Context: <what the owner said, with the exact details quoted: error text, file, test or feature names, links>
   Where to look: <paths, modules or commands, if known; otherwise "find it">
   Done when: <observable result, e.g. "the test passes 20 runs in a row" or "the PR is open">
   Constraints: <owner's limits, e.g. "do not push to main", "no new dependencies"; by default: work on a branch, do not merge or deploy, ask in the thread before anything destructive>
   Report back: a short summary of what you changed, how you verified it, and the PR or branch name.
   ```
   Include only what the owner told you or what you looked up for this task. Never put tokens, passwords or personal data in a brief.
4. **Launch.** `t3_thread_launch` with `projectId`, a short imperative `title` ("Fix flaky checkout test"), the brief as `message`, and a unique `clientRequestId` such as `nano-<yyyymmdd-hhmm>-<slug>`. If the call errors or times out, retry once with the same `clientRequestId`; T3 Code will not start a second thread for it. Never retry with a new `clientRequestId`: check `t3_thread_list` for the thread first. Leave model and `runtimeMode` out unless the owner asked; T3 Code applies its defaults and the access level the owner granted. Omitting `workspaceStrategy` selects the project's root checkout. If the owner asks for an isolated checkout, pass `workspaceStrategy: {type: "worktree"}` with the required branch/base fields shown by the current tool schema.
5. **Confirm** in one or two lines: what you started, in which project, and the `link` exactly as returned. If the link starts with `t3-thread://`, it opens only inside the T3 Code app; say the thread title instead.
6. **Note it.** Append one line to `t3code-threads.md` in your workspace: date, threadId, project, title, link, what the owner asked. This is how you find the thread again in a later context window.
7. **Schedule the check-back.** `schedule_add` with kind `task`, `at` about 20 minutes from now (longer for big jobs), and a body that stands alone, for example:
   > Check T3 Code thread <threadId> ("<title>", project <name>, link <link>). Load the tools with tool_search "read t3 thread", then call mcp__t3code__t3_thread_read {threadId: "<threadId>", limit: 4, maxCharsPerItem: 4000}. Finished: tell the owner the result in two to four lines (what changed, how it was verified, PR or branch) with the link, and update its line in t3code-threads.md. Waiting for approval or a question: tell the owner what it needs and that they can answer in T3 Code, with the link. Failed or interrupted: say so with the reason. Still running: schedule this same check again in 30 minutes and answer [silent]; if it has been running for more than four hours, tell the owner instead.

## Checking on demand
"How is the T3 thing going?": find the thread in `t3code-threads.md` (or with `t3_thread_search`), read it with small limits, and answer in a line or two with the link.

## Relaying results
- Summarise; never paste diffs or long logs. Name the PR or branch and how it was verified.
- If the T3 agent asked something, pass the question on word for word and relay the owner's answer with `t3_thread_send`.
- If the thread is waiting for an approval, the owner approves it in T3 Code. You cannot approve.
- Do not claim work is done until the thread says it is.

## Limits
- The access level the owner chose when pairing caps what threads you start may do. A `capability_denied` error means read-only access: tell the owner they need to pair again with more access (see connect.md).
- Nano's T3 Code access lasts 30 days and cannot be refreshed. `t3code-connect status` shows the expiry.
