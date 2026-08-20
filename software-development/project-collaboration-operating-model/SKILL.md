---
name: project-collaboration-operating-model
description: "Use for multi-agent delivery, recovery, and closure."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [multi-agent, project-management, orchestration, delivery, verification, recovery, cleanup]
    related_skills: [subagent-driven-development, requesting-code-review, consistency-check]
---

# Project Collaboration Operating Model

Use this skill when a project needs more than one agent, more than one delivery stage, or work that must survive interruption. It is project-agnostic: add the project's repository, tools, domain rules, and acceptance criteria as inputs. Do not encode one product's names, paths, provider quirks, or incident history here.

## Core principle

Optimize for **verified progress**, not activity. A live worker, green status, heartbeat, local commit, HTTP success, screenshot, or worker summary is evidence to inspect—not proof of the claim it accompanies.

A project is complete only when:

1. the intended artifact exists;
2. every requirement maps to an acceptance check;
3. an independent checker tried to falsify the result;
4. delivery or deployment is verified from the authoritative source;
5. no unowned worker, process, workspace, branch, notification, or scheduled action remains.

## Operating graph

Use the smallest graph that makes the work reliable:

```text
brief → plan → implementation → review → QA → release → delivery → closure
```

Add product acceptance, security review, migration, research, or rollback nodes when they are real dependencies. Do not add ceremonial stages with no distinct authority or evidence.

Every node has:

- one owner;
- explicit inputs and constraints;
- one output artifact or decision;
- an objective acceptance check;
- a retry/time/cost ceiling;
- a next gate or escalation path.

Run independent nodes in parallel only when they do not share mutable state and capacity permits. Never parallelize around an unclear contract.

## Role contracts

Keep role authority separate. A single agent may hold multiple roles only when the task is low-risk and the separation is not needed; for release-critical work, use fresh contexts.

- **Orchestrator/ops:** owns scope flow, dependency state, dispatch, liveness, recovery, and closure. Does not infer product or release success from worker status.
- **Product:** owns user problem, priorities, non-goals, acceptance criteria, and trade-offs. Does not silently implement or approve its own implementation.
- **Coder:** owns the isolated implementation artifact and local evidence. Does not self-approve or declare production release.
- **Reviewer:** independently inspects and tries to break the artifact. Has veto authority over its gate. Does not become the implementer during review.
- **QA/bug bash:** tests observable behavior and records reproducible evidence. Does not silently fix the defect it is reporting.
- **Researcher:** provides sourced facts, confidence, contradictions, implications, and unknowns. Never fabricates provenance.
- **Release/operator:** verifies exact artifact identity, CI, deployment, external readback, rollback readiness, and cleanup.

Detailed role prompts and output shapes: `references/role-contracts.md`.

## Handoff contract

Use a structured handoff. Free-form status is insufficient for downstream automation.

```text
goal:
inputs:
constraints:
artifact:
checks_run:
evidence:
known_failures:
next_gate:
ownership:
```

Role-specific additions:

- Product: users, scope, non-goals, acceptance, risks.
- Coder: base revision, workspace, files changed, test results.
- Reviewer: verdict, requirements checked, blockers, required changes.
- QA: build/deployment identity, scenario, expected, actual, reproduction, classification.
- Researcher: sources, claims, confidence, contradictions, implications.
- Ops: state observed, failure class, action, retry count, stable fingerprint, final outcome.

Unknown values must be written as `unknown`. Never fill missing evidence with plausible prose.

## Source and workspace discipline

Before implementation or release:

1. identify the authoritative repository/source;
2. fetch or refresh it;
3. record the exact base/version/commit;
4. validate the workspace and permissions;
5. create one isolated workspace per mutable lane;
6. reject stale, dirty, unrelated, or missing workspaces.

Keep implementation, review, QA, and release workspaces separate when their judgments must be independent. Generated files, package-manager noise, fixtures, and local configuration must not contaminate release evidence.

## Evidence gates

Match evidence to the claim:

| Claim | Required proof |
|---|---|
| File/artifact exists | stat plus readback or parse |
| Code is correct | targeted tests plus independent review |
| Task is complete | all requirements mapped and verified |
| Remote delivery happened | authoritative remote ref/API readback |
| Deployment is correct | exact artifact/version identity plus provider readback |
| User flow works | fresh-context acceptance test with reproducible evidence |
| Message was sent | provider ID/status or sent-folder readback |
| Cron is repaired | config/status, output, and bounded smoke test |
| Project is closed | process, workspace, task, remote, and scheduler sweep |

Missing proof means `blocked`, `awaiting evidence`, or `unknown`; never silently promote it to `done` or `released`.

## Liveness and recovery

For every active worker, inspect all of:

- task/run identity;
- PID or process ownership;
- heartbeat age;
- meaningful log/artifact advancement;
- child-process outcomes;
- latest successful or failed command;
- workspace ownership.

Heartbeat is liveness evidence, not health or completion evidence. A parent process can remain alive after a child command fails.

Recovery loop:

```text
observe → classify → act once → reread → verify → record → stop or escalate
```

Classify before retrying: product defect, environment/tooling, dependency, permission, network, timeout, stale state, or operator error. Use a stable failure fingerprint based on task and failure evidence, not a run ID. Bound retries by count, time, and unchanged failure state. After the ceiling, stop and expose the blocker.

Do not create duplicate retries for one failure. Do not keep a worker alive merely to preserve a green heartbeat. Do not pause unrelated jobs while repairing project automation.

## Closure gate

Closure is an explicit stage, not an afterthought. Reconcile:

- terminal task and child-task states;
- worker claims and OS processes;
- child processes and dev servers;
- workspaces, worktrees, branches, and dirty files;
- local revision versus authoritative remote revision;
- deployment and QA evidence;
- stale cards, duplicate notifications, and sent markers;
- project-specific cron/watchdog state.

Stop or remove unowned background work. Pause project automation when no actionable work remains. Preserve unrelated services and jobs. Report anything intentionally retained, such as source documents or local operational configuration.

## SOUL and skill design

SOUL files should contain identity, role authority, boundaries, collaboration rules, and concise handoff shapes. Do not copy a giant generic constitution into every profile. Put detailed commands, provider procedures, domain recipes, and incident-specific reproductions in skills and `references/`.

Use a shared charter plus distinct role contract. If every profile has the same behavior, role separation is fake. If roles disagree about completion, the shared evidence gate wins.

## Failure patterns

- **Heartbeat masking child failure:** inspect subprocess exit and log fingerprints.
- **Worker self-report treated as delivery:** verify artifacts and external sources independently.
- **First semantic match selected:** select the first candidate that satisfies all release gates, not merely the first matching description.
- **Run-ID retry loop:** fingerprint stable task/failure evidence, not ephemeral run identity.
- **Stale local work stranded:** fetch remote, compare exact refs, clean or remove stale workspaces before closure.
- **Shared workspace contamination:** isolate lanes and reject dirty/unowned directories.
- **Noisy idle watchdog:** persist state transitions, suppress unchanged output, and auto-pause when idle.
- **Ceremonial parallelism:** add workers only after contracts, capacity, and ownership are clear.

## Bundled deterministic tools

This skill includes provider-agnostic reference tools under `scripts/` and templates under `templates/`:

- `scripts/project_preflight.py` — fresh source, clean workspace, exact base, required commands;
- `scripts/project_handoff_validate.py` — schema-checked JSON handoffs;
- `scripts/project_closure_check.py` — remote revision, worktree, workspace, and process closure;
- `templates/project-contract.yaml` — project-specific contract starter;
- `templates/project-handoff.json` — structured handoff starter.

Copy or invoke the bundled scripts from the skill directory. They are read-only except for optional evidence files and Git remote-ref refreshes. They never delete, stop, commit, push, or publish. Pair them with project-specific Kanban, scheduler, deployment, and QA checks rather than pretending one generic script can prove every external system.

## Verification checklist

- [ ] Current milestone and non-goals are explicit.
- [ ] Every active node has an owner, artifact, acceptance check, and next gate.
- [ ] Workspaces and source revisions are fresh and isolated.
- [ ] Implementation, review, QA, and release judgments are separated where needed.
- [ ] Handoffs contain structured evidence.
- [ ] Worker liveness includes child-command outcomes.
- [ ] Retries are bounded and fingerprints stable.
- [ ] Exact delivery identity is verified remotely.
- [ ] Fresh acceptance evidence exists for user-facing claims.
- [ ] Closure sweep found no orphaned work or background compute.

If any box is unknown, report the unknown or continue the work. Do not guess.
