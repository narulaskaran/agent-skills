#!/usr/bin/env python3
"""Deterministic local/repository skill divergence scanner.

The scanner is read-only. It emits stable JSON so cron jobs can gate any
write or PR action on an explicit, reviewable report.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Iterable


AUDIT_PATTERNS = {
    "local_path": re.compile(r"(?:^|[`\s])/(?:home/user|tmp|var/tmp)(?:[/`\s]|$)"),
    "retired_model": re.compile(
        r"\b(?:granite4\.1(?::\S+)?|qwen3\.5(?::\S+)?|qwen2\.5(?::\S+)?|llama3(?:\.\S*)?|gemma4(?::\S+)?|deepseek-r1(?::\S+)?|nemotron(?::\S+)?|lfm2\.5(?::\S+)?)\b",
        re.IGNORECASE,
    ),
}


def skill_files(root: Path) -> dict[str, Path]:
    """Return relative skill directory -> SKILL.md, sorted and git-free."""
    found: dict[str, Path] = {}
    if not root.is_dir():
        return found
    for path in sorted(root.rglob("SKILL.md")):
        rel = path.relative_to(root)
        if ".git" in rel.parts or ".archive" in rel.parts:
            continue
        found[str(rel.parent)] = path
    return found


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def audit_content(path: Path) -> list[str]:
    """Return stable names of likely public-repo hygiene problems."""
    text = path.read_text(encoding="utf-8", errors="replace")
    return sorted(name for name, pattern in AUDIT_PATTERNS.items() if pattern.search(text))


def local_index(roots: Iterable[Path]) -> tuple[dict[str, Path], list[str]]:
    index: dict[str, Path] = {}
    ambiguous: list[str] = []
    for root in roots:
        for rel, path in skill_files(root).items():
            name = Path(rel).name
            if name in index and index[name] != path:
                ambiguous.append(name)
                continue
            index[name] = path
    return index, sorted(set(ambiguous))


def scan(repo: Path, local_roots: list[Path]) -> dict:
    repo_skills = skill_files(repo)
    local, ambiguous = local_index(local_roots)
    entries: list[dict] = []

    for rel in sorted(repo_skills):
        repo_path = repo_skills[rel]
        name = Path(rel).name
        local_path = local.get(name)
        item: dict[str, object] = {"name": name, "repo_path": rel}
        item["audit_flags"] = audit_content(repo_path)
        if local_path is None:
            item["status"] = "repo_only"
        elif name in ambiguous:
            item["status"] = "ambiguous_local"
            item["local_path"] = str(local_path)
        else:
            item["local_path"] = str(local_path)
            item["repo_sha256"] = digest(repo_path)
            item["local_sha256"] = digest(local_path)
            item["local_audit_flags"] = audit_content(local_path)
            item["status"] = "in_sync" if item["repo_sha256"] == item["local_sha256"] else "diverged"
        entries.append(item)

    repo_names = {Path(rel).name for rel in repo_skills}
    for name, local_path in sorted(local.items()):
        if name not in repo_names:
            entries.append({"name": name, "status": "local_only", "local_path": str(local_path),
                            "local_audit_flags": audit_content(local_path)})

    entries.sort(key=lambda item: (item["name"], item.get("repo_path", ""), item.get("local_path", "")))
    counts = {status: sum(item["status"] == status for item in entries)
              for status in ("in_sync", "diverged", "repo_only", "local_only", "ambiguous_local")}
    audit_counts = {
        flag: sum(
            flag in item.get("audit_flags", []) or flag in item.get("local_audit_flags", [])
            for item in entries
        )
        for flag in AUDIT_PATTERNS
    }
    return {
        "schema": 1,
        "repo_root": str(repo),
        "local_roots": [str(root) for root in local_roots],
        "counts": counts,
        "action_required": (
            counts["diverged"] + counts["local_only"] + counts["ambiguous_local"] > 0
            or any(audit_counts.values())
        ),
        "audit_counts": audit_counts,
        "skills": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--local-root", action="append", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = scan(args.repo.resolve(), [root.resolve() for root in args.local_root])
    payload = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
