# Public Skills Repository Workflow

Use a fresh clone of `https://github.com/OWNER/agent-skills.git` or an isolated worktree. Public skills must be reusable, provider-neutral where possible, and free of personal data, credentials, private paths, and payment identifiers.

## Structure

```text
agent-skills/
├── README.md
├── browser-use/
├── payments/
├── devops/
└── <other categories>/
    └── <skill>/SKILL.md
```

Each skill may include `references/`, `scripts/`, `templates/`, or `assets/` when those files are required by its workflow.

## Publishing

1. Fetch `origin/main` and verify repository root.
2. Create a feature branch; never commit or push `main`/`master`.
3. Copy only approved skill files and required supporting files.
4. Replace names, emails, addresses, paths, IDs, tokens, and credentials with generic placeholders.
5. Update README when adding or renaming skills.
6. Stage all files and run the repository PII hook plus `git diff --check`.
7. Commit and push feature branch.
8. Open a PR and stop for human merge.
9. Verify PR URL, branch, head SHA, changed paths, and fresh-clone contents.

```bash
git fetch origin main
git checkout -b hermes/skill-<short-name>
git rev-parse --show-toplevel
git add -A
.githooks/pre-commit
git diff --cached --check
git commit -m "skill: <concise change>"
git push -u origin HEAD
```

Never bypass PII checks. If a check flags a legitimate example, replace it with a generic placeholder rather than weakening the check.
