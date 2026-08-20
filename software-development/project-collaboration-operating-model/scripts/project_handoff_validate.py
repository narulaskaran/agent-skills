#!/usr/bin/env python3
"""Validate a machine-readable project handoff without external side effects."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

REQUIRED = ("schema", "goal", "artifact", "evidence", "next_gate", "owner")
NONEMPTY = ("goal", "artifact", "evidence", "next_gate", "owner")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True)
    ap.add_argument("--evidence")
    args = ap.parse_args()
    result: dict[str, Any] = {"schema": 1, "kind": "project-handoff", "status": "invalid", "errors": []}
    try:
        data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        result["errors"].append(f"cannot read JSON: {type(exc).__name__}")
        return finish(result, args.evidence)
    if not isinstance(data, dict):
        result["errors"].append("top-level value must be an object")
    else:
        missing = [key for key in REQUIRED if key not in data]
        result["errors"].extend(f"missing required field: {key}" for key in missing)
        if data.get("schema") != 1:
            result["errors"].append("schema must equal 1")
        for key in NONEMPTY:
            value = data.get(key)
            if value is None or value == "" or value == [] or value == {}:
                result["errors"].append(f"field must be non-empty: {key}")
        if "known_failures" not in data and "risks" not in data:
            result["errors"].append("include known_failures or risks explicitly; use [] when none")
        result["fields"] = sorted(data.keys())
    result["status"] = "valid" if not result["errors"] else "invalid"
    return finish(result, args.evidence)


def finish(result: dict[str, Any], output: str | None) -> int:
    if output:
        path = Path(output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["status"] == "valid" else 1


if __name__ == "__main__":
    raise SystemExit(main())
