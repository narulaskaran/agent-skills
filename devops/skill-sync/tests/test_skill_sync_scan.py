import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from skill_sync_scan import scan


def make_skill(root: Path, category: str, name: str, content: str) -> None:
    path = root / category / name / "SKILL.md"
    path.parent.mkdir(parents=True)
    path.write_text(content, encoding="utf-8")


def test_scan_is_deterministic_and_hashes_content(tmp_path):
    repo = tmp_path / "repo"
    local = tmp_path / "local"
    make_skill(repo, "devops", "same", "same")
    make_skill(local, "other", "same", "same")
    make_skill(repo, "devops", "changed", "repo")
    make_skill(local, "devops", "changed", "local")
    make_skill(repo, "devops", "orphan", "repo")
    make_skill(local, "devops", "new", "local")

    report = scan(repo, [local])
    assert report["counts"] == {
        "in_sync": 1,
        "diverged": 1,
        "repo_only": 1,
        "local_only": 1,
        "ambiguous_local": 0,
    }
    assert report["action_required"] is True
    assert [item["name"] for item in report["skills"]] == ["changed", "new", "orphan", "same"]
    assert report["skills"][-1]["status"] == "in_sync"
    assert len(report["skills"][0]["repo_sha256"]) == 64


def test_archived_and_git_files_are_ignored(tmp_path):
    repo = tmp_path / "repo"
    local = tmp_path / "local"
    make_skill(repo, "devops", "live", "x")
    make_skill(repo / ".archive", "devops", "old", "x")
    make_skill(repo / ".git", "devops", "internal", "x")
    make_skill(local, "devops", "live", "x")

    report = scan(repo, [local])
    assert [item["name"] for item in report["skills"]] == ["live"]


def test_ambiguous_local_names_are_never_auto_actionable(tmp_path):
    repo = tmp_path / "repo"
    first = tmp_path / "first"
    second = tmp_path / "second"
    make_skill(repo, "devops", "same", "repo")
    make_skill(first, "one", "same", "one")
    make_skill(second, "two", "same", "two")

    report = scan(repo, [first, second])
    assert report["counts"]["ambiguous_local"] == 1
    assert report["action_required"] is True
    assert report["skills"][0]["status"] == "ambiguous_local"


def test_audit_flags_public_hygiene_risks(tmp_path):
    repo = tmp_path / "repo"
    local = tmp_path / "local"
    make_skill(repo, "devops", "risky", "Example User uses /home/user and qwen3.5:4b")
    make_skill(local, "devops", "risky", "generic")

    report = scan(repo, [local])
    item = report["skills"][0]
    assert item["audit_flags"] == ["local_path", "retired_model"]
    assert item["local_audit_flags"] == []
    assert report["audit_counts"] == {
        "local_path": 1,
        "retired_model": 1,
    }
