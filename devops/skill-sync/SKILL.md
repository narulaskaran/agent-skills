---
name: skill-sync
description: Deterministic audit and gated PR workflow for syncing local agent skills to a public repository.
version: 1.0.0
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [skills, synchronization, git, pull-requests]
---

# Skill Sync

Synchronize local `SKILL.md` files with a public skills repository without hardcoded skill lists, accidental overwrites, or direct pushes to the default branch.

## Deterministic scan

Run the bundled read-only scanner before any copy or git action:

```bash
python3 devops/skill-sync/scripts/skill_sync_scan.py \
  --repo /path/to/agent-skills \
  --local-root /path/to/local/skills \
  --output /tmp/skill-sync-report.json
```

The scanner discovers every `SKILL.md`, ignores `.git/` and `.archive/`, compares content with SHA-256, and emits stable JSON. It reports `in_sync`, `diverged`, `repo_only`, `local_only`, and `ambiguous_local`. It also flags likely public-repo hygiene risks (`local_path` and retired model references) in `audit_flags` / `local_audit_flags`, with totals in `audit_counts`. Only `diverged` and approved `local_only` entries are copy candidates. `repo_only` entries require review. `ambiguous_local` entries are never auto-copied. Any audit flag keeps `action_required` true.

## Gated PR flow

1. Read the JSON report and select an explicit set of copy candidates. Do not infer approval from a count field.
2. Confirm public-repo content is provider-neutral and contains no names, emails, addresses, secrets, private paths, or payment identifiers.
3. Fetch the default branch and create a branch named `hermes/skill-sync-<short-description>`. Refuse to continue if the current branch is `main` or `master`.
4. Copy only selected files and supporting `references/`, `scripts/`, `templates/`, and `assets/` files.
5. Run tests, the repository pre-commit hook, and `git diff --check`. A failed gate stops the flow.
6. Commit only on the feature branch. Push only that branch. Never commit, push, merge, close, or delete branches on behalf of the user.
7. Open a PR with the report summary, files changed, tests, and PII audit result. Assign the requested human reviewer when repository policy requires it.
8. Verify the PR URL, head branch, commit SHA, changed paths, and CI status through GitHub. A successful local push is not proof that the remote PR is correct.

## Public-repo audit

Before staging, inspect all tracked files, not only changed `SKILL.md` files. Use generic placeholders such as `Jane Doe`, `user@example.com`, `/home/user/`, and `pm_visa_xxxxxxxxxxxx`. Never bypass a PII hook; rewrite false positives instead.

## Cron integration

Cron should run the scanner and produce a report first. Any write or PR step must consume that report and enforce the branch, test, hook, and remote-verification gates. When the report has no approved candidates, emit a short no-op result and make no git changes.
