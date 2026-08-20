#!/usr/bin/env python3
"""Fail-closed project workspace preflight.

Read-only except for Git remote refs and optional evidence output.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def run(cmd: list[str], cwd: Path, timeout: int = 120) -> dict[str, Any]:
    try:
        p = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"exit_code": 124, "error": type(exc).__name__}
    return {"exit_code": p.returncode, "stdout": p.stdout.strip(), "stderr": p.stderr.strip()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--remote", default="origin")
    ap.add_argument("--base", default="main")
    ap.add_argument("--require-command", action="append", default=[])
    ap.add_argument("--allow-base-branch", action="store_true")
    ap.add_argument("--evidence")
    args = ap.parse_args()
    repo = Path(args.repo).resolve()
    evidence: dict[str, Any] = {
        "schema": 1,
        "kind": "project-preflight",
        "status": "failed",
        "repo": str(repo),
        "remote": args.remote,
        "base": args.base,
        "gates": [],
    }

    def gate(name: str, passed: bool, **data: Any) -> None:
        evidence["gates"].append({"name": name, "status": "passed" if passed else "failed", **data})

    gate("repo", (repo / ".git").exists(), path=str(repo))
    if not (repo / ".git").exists():
        return finish(evidence, args.evidence)

    fetch = run(["git", "fetch", args.remote, args.base, "--prune"], repo)
    gate("fetch", fetch["exit_code"] == 0, exit_code=fetch["exit_code"])

    branch = run(["git", "branch", "--show-current"], repo)
    branch_name = branch.get("stdout", "")
    gate(
        "feature_branch",
        branch["exit_code"] == 0 and bool(branch_name) and (args.allow_base_branch or branch_name not in {args.base, "master"}),
        branch=branch_name or None,
    )

    status = run(["git", "status", "--porcelain=v1", "-uall"], repo)
    dirty = status.get("stdout", "").splitlines()
    gate("clean_workspace", status["exit_code"] == 0 and not dirty, dirty=dirty)

    head = run(["git", "rev-parse", "HEAD"], repo)
    remote_ref = f"{args.remote}/{args.base}"
    remote_head = run(["git", "rev-parse", remote_ref], repo)
    head_sha = head.get("stdout", "")
    remote_sha = remote_head.get("stdout", "")
    gate("authoritative_base", remote_head["exit_code"] == 0, ref=remote_ref, sha=remote_sha or None)
    gate("fresh_base", bool(head_sha) and head_sha == remote_sha, head_sha=head_sha or None, base_sha=remote_sha or None)

    command_results = {}
    for command in args.require_command:
        path = shutil.which(command) if not Path(command).is_absolute() else command if Path(command).is_file() else None
        command_results[command] = path
    gate("required_commands", all(command_results.values()), commands=command_results)

    return finish(evidence, args.evidence)


def finish(evidence: dict[str, Any], output: str | None) -> int:
    evidence["status"] = "passed" if evidence["gates"] and all(g["status"] == "passed" for g in evidence["gates"]) else "failed"
    if output:
        path = Path(output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": evidence["status"], "kind": evidence["kind"], "gates": len(evidence["gates"])}, separators=(",", ":")))
    return 0 if evidence["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
