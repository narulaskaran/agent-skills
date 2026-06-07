---
name: consistency-check
description: "Verify multi-part outputs before marking tasks done. Generalized from prd-generator PASS/FAIL pattern."
version: 1.0.0
---

# Consistency Check

Before marking a complex task done, verify the output against its own claims. Adapted from the PRD generator's PASS/FAIL matrix — generalized for any multi-part deliverable.

## When to Use

Any task where output has 3+ distinct components or claims. Examples:
- Code changes with multiple files
- Research with multiple findings
- Configuration changes across services
- Multi-step workflows

## The Check

Run before declaring "done." Answer each. Any FAIL → fix before marking complete.

### 1. Requirements → Output Mapping
```
- Requirement 1 → satisfied by: [file/action] [PASS/FAIL]
- Requirement 2 → satisfied by: [file/action] [PASS/FAIL]
- Edge case X → addressed in: [location] [PASS/FAIL]
```
FAIL = stated requirement has no corresponding output.

### 2. Deliverable Verification
```
- File A written → verified with read_file: [PASS/FAIL]
- File B written → verified with read_file: [PASS/FAIL]
- Config change → verified: [PASS/FAIL]
```
FAIL = claimed deliverable doesn't exist or is empty.

### 3. Cross-Reference Integrity
```
- Component A references B → B exists and handles the call: [PASS/FAIL]
- Import path → file exists at that path: [PASS/FAIL]
- Config key → consumed somewhere: [PASS/FAIL]
```
FAIL = internal references don't resolve.

### 4. Edge Case Coverage
```
- Empty/null input → handled: [PASS/FAIL]
- Error path → handled: [PASS/FAIL]
- Boundary condition → handled: [PASS/FAIL]
```
Skip if N/A. FAIL = known edge case unaddressed.

## Output Format

```
=== Consistency Check ===
[Task name]

Requirements:
  - R1 → [file] [PASS]
  - R2 → [file] [PASS]

Deliverables:
  - [file1] → read verified [PASS]
  - [file2] → read verified [PASS]

Cross-refs:
  - Import A → B [PASS]

Edge cases:
  - Empty input → handled [PASS]

Result: 4/4 PASS — ready to mark done.
```

Any FAIL includes what's missing and suggested fix.

### 5. Independent Code Review (coder tasks only)

When task involved code written by the `coder` profile, spawn reviewer:
```
terminal("hermes -p reviewer chat -q 'Review this code change: [summary]. Diff at [path]. Focus on bugs, security, edge cases, and style. Use review checklist from your SOUL.md.' --quiet", timeout=120)
```

Reviewer runs cold — no shared context with coder. Fresh eyes.

- Blocker found → task NOT done. Fix first.
- Warnings only → note them, mark task done.
- All clean → mark done.

If reviewer flags blockers, fix them and re-run review before completing task.

## Skip When

- Single-file, single-change tasks (reviewer still optional but often overkill)
- Purely conversational/informational tasks
- Tasks user explicitly says are good enough
- Task had no code changes (config, research, planning only)

## Pitfalls

- Don't skip the read_file verification step — "I wrote it" is not verification.
- FAIL rates aren't badges of thoroughness. If you consistently hit FAILs, the real problem is upstream planning.
- This check is FOR YOU, not for the user. Run it silently and only surface results if something fails.
- Reviewer is NOT optional for multi-file code changes from coder profile. Coder self-reports are unreliable.
