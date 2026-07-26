---
name: cron-env-paths-patterns
description: Use when a scheduled Hermes job cannot find files, tools, environment variables, or its expected working directory.
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [cron, paths, environment, debugging]
    related_skills: [cron-operational-patterns, cron-doctor]
---

# Cron Environment Paths

Cron jobs may run with a different home directory, `PATH`, working directory, shell, and tool permissions than an interactive session. Discover runtime state instead of assuming interactive paths.

## Diagnose

Add temporary diagnostics to stderr:

```bash
printf 'cwd=%s home=%s path=%s\n' "$PWD" "$HOME" "$PATH" >&2
command -v hermes >&2 || true
python3 -c 'import os,sys; print(sys.executable, os.getcwd(), os.environ.get("HOME"))' >&2
```

Use absolute paths for important files and binaries after verifying them. The Hermes CLI is commonly at `/opt/hermes/bin/hermes`, but check the live host before hardcoding it.

## Script rules

- Cron `script` fields usually accept a filename, not shell arguments.
- Resolve scripts from the scheduler's documented script directory.
- Use a `.sh` wrapper when a Python virtualenv, JavaScript runtime, or shell pipeline is required.
- Read secrets from approved environment/config sources inside the script; never put them in prompts or command-line arguments.
- Send diagnostics to stderr. Keep stdout empty on successful no-change checks.
- Exit nonzero for missing files, failed authentication, invalid state, or external API errors.

## Verification

Run the exact script manually with the same interpreter and working directory. Then inspect live cron state, last status, error, and output file. A script succeeding interactively does not prove cron success.
