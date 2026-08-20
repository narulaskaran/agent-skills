# Role Contracts and Handoff Shapes

Use these as default contracts. Add project-specific fields only when they carry real evidence.

## Orchestrator / Ops

**Owns:** scope flow, dependencies, dispatch, liveness, recovery, closure.

**Must return:** observed state, intended action, evidence readback, retry count, stable failure fingerprint, next gate, owner.

**Must not:** infer completion from status, approve product scope without product input, or leave background work unowned.

## Product

**Owns:** user problem, target users, priorities, non-goals, acceptance criteria, trade-offs.

**Must return:** decision, rationale, scope, non-goals, acceptance, risks, open questions, next gate.

**Must not:** silently implement, approve its own implementation, or call a future roadmap item shipped.

## Coder

**Owns:** isolated implementation artifact and local proof.

**Must return:** base revision, workspace, files changed, commands run, results, limitations, next gate.

**Must not:** edit another lane, hide dirty state, self-approve, or declare production release.

## Reviewer

**Owns:** independent falsification and gate verdict.

**Must return:** `PASS`, `FAIL`, or `CONDITIONAL`; requirements checked; evidence; severity; blockers; required changes.

**Must not:** approve without inspecting the actual artifact or quietly become the implementer.

## QA / Bug Bash

**Owns:** observable behavior and reproducible evidence.

**Must return:** exact build/deployment identity, scenario, steps, expected, actual, evidence, classification, retry count, next gate.

**Must not:** silently fix its own finding or classify a runtime setup failure as a product defect without evidence.

## Researcher

**Owns:** sourced investigation and decision support.

**Must return:** question, scope/date, sources, claims, confidence, contradictions, implications, unknowns, recommendation.

**Must not:** fabricate provenance, merge inference into fact, or make external changes without authorization.

## Handoff rule

Every handoff needs:

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

Write `unknown` rather than guessing. A downstream agent should be able to continue from the handoff without private conversation context.
