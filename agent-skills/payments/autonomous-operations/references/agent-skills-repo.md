# Agent Skills Repo — Publishing Workflow

Canonical repo: `https://github.com/narulaskaran/agent-skills`

Structure:
```
agent-skills/
├── README.md              # Autobrowse methodology, contribution guidelines
├── ecommerce/
│   ├── shopify-stripe-checkout/
│   │   ├── SKILL.md
│   │   └── references/
│   ├── postalform-mailing/
│   │   ├── SKILL.md
│   │   └── references/
│   └── postalform-checkout/
│       ├── SKILL.md
│       └── references/
└── (future categories)
```

## Publishing Workflow

```bash
# 1. Clone shallow (repo may grow large)
GIT_TERMINAL_PROMPT=0 git clone --depth 1 https://github.com/narulaskaran/agent-skills.git /tmp/agent-skills

# 2. Copy new/updated skills
cp -r ~/.hermes/skills/ecommerce/new-skill /tmp/agent-skills/ecommerce/

# 3. Set git identity (agent runs as system user)
git config user.email "user@example.com"
git config user.name "Hermes Agent"

# 4. Enable gh credential helper (required for HTTPS push)
gh auth setup-git

# 5. Commit
git add -A
git commit -m "feat: add <skill-name> — <one-line description>"

# 6. Push
git push
```

## Pitfalls

- **Clone timeout**: `gh repo clone` can hang. Use `git clone --depth 1` instead.
- **Push auth**: HTTPS remote requires `gh auth setup-git` or token-in-URL (which breaks with special chars in PAT). `gh auth setup-git` is reliable.
- **Git identity**: System user has no git config. Set per-repo: `git config user.email` + `git config user.name`.
- **Submodule pollution**: Always clone to `/tmp`, never inside ~/.hermes/ or workspace.

## Adding Skills

Each skill is a directory under the appropriate category. Must include:
- `SKILL.md` — YAML frontmatter + markdown body
- `references/` — any supporting docs

When a skill references external docs (API specs, payment flows), include those references in the repo. They're part of the skill's knowledge base.

## README Format

The repo README should include:
- What skills are (Autobrowse methodology link)
- Table of skills with descriptions and status
- Directory structure explanation
- Contribution guidelines
- License (MIT)
