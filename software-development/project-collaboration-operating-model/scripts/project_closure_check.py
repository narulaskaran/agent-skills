#!/usr/bin/env python3
"""Fail-closed project closure verifier.

Checks repository delivery and local residue. It never deletes or stops anything.
Run scheduler/Kanban diagnostics separately because those sources are deployment-specific.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any


def run(cmd: list[str], cwd: Path, timeout: int = 120) -> dict[str, Any]:
    try:
        p = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"exit_code": 124, "error": type(exc).__name__}
    return {"exit_code": p.returncode, "stdout": p.stdout.strip(), "stderr": p.stderr.strip()}


def workspace_repos(root: Path, canonical: Path) -> list[str]:
    found: list[str] = []
    if not root.is_dir():
        return found
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in {"node_modules", ".next", ".git"}]
        if ".git" in files or ".git" in dirs:
            path = Path(current).resolve()
            if path != canonical and path not in {Path(x) for x in found}:
                found.append(str(path))
            if ".git" in dirs:
                dirs.remove(".git")
    return sorted(found)


def matching_processes(patterns: list[str], ignored: set[int]) -> list[dict[str, Any]]:
    if not patterns:
        return []
    compiled = [re.compile(p) for p in patterns]
    rows: list[tuple[int, str]] = []
    proc_root = Path("/proc")
    if proc_root.is_dir():
        for entry in proc_root.glob("[0-9]*"):
            try:
                pid = int(entry.name)
                parts = [x.decode(errors="replace") for x in (entry / "cmdline").read_bytes().split(b"\0") if x]
                command = " ".join(parts)
                if command:
                    rows.append((pid, command))
            except (OSError, ValueError):
                continue
    else:
        try:
            if os.name == "nt":
                proc = subprocess.run(["tasklist", "/fo", "csv", "/nh"], text=True, capture_output=True, timeout=30)
                import csv
                for row in csv.reader(proc.stdout.splitlines()):
                    if len(row) >= 2 and row[1].isdigit():
                        rows.append((int(row[1]), row[0]))
            else:
                proc = subprocess.run(["ps", "-eo", "pid=,args="], text=True, capture_output=True, timeout=30)
                for line in proc.stdout.splitlines():
                    parts = line.strip().split(maxsplit=1)
                    if len(parts) == 2 and parts[0].isdigit():
                        rows.append((int(parts[0]), parts[1]))
        except (OSError, subprocess.SubprocessError, ValueError):
            return [{"error": "process listing unavailable"}]
    return [
        {"pid": pid, "command": command[:400]}
        for pid, command in rows
        if pid not in ignored and any(rx.search(command) for rx in compiled)
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--remote", default="origin")
    ap.add_argument("--base", default="main")
    ap.add_argument("--expected-sha")
    ap.add_argument("--workspace-root")
    ap.add_argument("--process-pattern", action="append", default=[])
    ap.add_argument("--ignore-pid", action="append", type=int, default=[])
    ap.add_argument("--evidence")
    args = ap.parse_args()
    repo = Path(args.repo).resolve()
    evidence: dict[str, Any] = {"schema": 1, "kind": "project-closure", "status": "failed", "repo": str(repo), "gates": []}

    def gate(name: str, passed: bool, **data: Any) -> None:
        evidence["gates"].append({"name": name, "status": "passed" if passed else "failed", **data})

    gate("repo", (repo / ".git").exists(), path=str(repo))
    if (repo / ".git").exists():
        fetch = run(["git", "fetch", args.remote, args.base, "--prune"], repo)
        gate("fetch", fetch["exit_code"] == 0, exit_code=fetch["exit_code"])
        remote_ref = f"{args.remote}/{args.base}"
        remote = run(["git", "rev-parse", remote_ref], repo)
        head = run(["git", "rev-parse", "HEAD"], repo)
        remote_sha = remote.get("stdout", "")
        head_sha = head.get("stdout", "")
        expected = args.expected_sha or remote_sha
        gate("expected_revision", bool(expected) and head_sha == expected, head_sha=head_sha or None, expected_sha=expected or None, remote_sha=remote_sha or None)
        status = run(["git", "status", "--porcelain=v1", "-uall"], repo)
        dirty = status.get("stdout", "").splitlines()
        gate("clean_canonical_repo", status["exit_code"] == 0 and not dirty, dirty=dirty)
        worktrees = run(["git", "worktree", "list", "--porcelain"], repo)
        entries = [line.removeprefix("worktree ") for line in worktrees.get("stdout", "").splitlines() if line.startswith("worktree ")]
        gate("linked_worktrees", worktrees["exit_code"] == 0 and entries == [str(repo)], worktrees=entries)
    else:
        gate("expected_revision", False, error="not a Git repository")
        gate("clean_canonical_repo", False)
        gate("linked_worktrees", False)

    if args.workspace_root:
        leftovers = workspace_repos(Path(args.workspace_root).resolve(), repo)
        gate("workspace_residue", not leftovers, paths=leftovers)
    processes = matching_processes(args.process_pattern, set(args.ignore_pid) | {os.getpid(), os.getppid()})
    gate("project_processes", not processes, processes=processes)

    evidence["status"] = "passed" if evidence["gates"] and all(g["status"] == "passed" for g in evidence["gates"]) else "failed"
    if args.evidence:
        path = Path(args.evidence)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": evidence["status"], "kind": evidence["kind"], "gates": len(evidence["gates"])}, separators=(",", ":")))
    return 0 if evidence["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
