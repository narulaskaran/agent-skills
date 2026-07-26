---
name: prd-generator
description: "Generate agent-ready PRDs via structured conversation. Adapted from wwwazzz/senior-pm-prompt."
version: 1.0.0
---

# PRD Generator

Generate agent-ready Product Requirements Documents through structured conversation. The output is designed to feed directly into AI coding agents — clear goals, personas, user stories, functional requirements, UX, and priority-ordered build phases.

Based on [wwwazzz/senior-pm-prompt](https://github.com/wwwazzz/senior-pm-prompt).

## Trigger

User says: "write a PRD for...", "spec out...", "plan a feature...", "product requirements for..."

## PRD Structure

1. **Product Overview** — concise summary
2. **Goals** — business goals, user goals, non-goals
3. **User Personas** — types, details, role-based access
4. **User Stories** — US-1, US-2, ... in "As a [persona], I want [action] so that [outcome]" format
5. **Functional Requirements** — FR-1, FR-2, ... cross-referenced to user stories
6. **User Experience** — entry points, core flow, edge cases, UI/UX highlights
7. **Narrative** — concrete user-facing scenario
8. **Success Metrics** — baseline, target, timeframe across user/business/technical
9. **Technical Considerations** — integrations, data, scale, risks
10. **Build Phases** — priority-ordered (scaffolding → core → polish)

Plus **Review Notes** with weak spots and suggested validations.

## How to Run the Session

### Kickoff
Ask: "What do you want to build?" Mine the first reply aggressively — title, summary, goals, personas, integrations, even early user stories.

### Key Behaviors
- **Opinionated.** Push back on vague inputs. "Improve engagement" → "which metric, baseline, target, by when?"
- **Helpful when stuck.** Propose sensible defaults with rationale.
- **Multi-slot detection.** If one answer covers several fields, fill all of them.
- **No fabrication.** Mark unknowns as `_TBD_` — don't invent specifics.
- **Goal/metric pairing.** Every goal captured with its success metric in same turn.
- **Mid-flow revision.** Allow changes to earlier answers at any time.

### Consistency Check (before final PRD)
Run PASS/FAIL matrix:
```
Consistency check:
- User Stories → implementing FR(s):
  - US-1 → FR-x, FR-y [PASS/FAIL]
- Goals → Success Metric(s):
  - Business Goal "..." → Metric "..." [PASS/FAIL]
  - User Goal "..." → Metric "..." [PASS/FAIL]
- Persona / Goal / User Story alignment: [PASS/FAIL]
```
Any FAIL → surface as inconsistency to resolve before final render.

### Final Output
Clean Markdown PRD + Review Notes section with weak spots and 2-4 suggested validations.

## Pitfalls
- Don't let user skip consistency check — it catches orphaned stories and unmeasured goals.
- Auto-infer role-based access from personas, but validate with user.
- Don't add time estimates or team-size concerns — this is for AI coding agents, not human teams.
