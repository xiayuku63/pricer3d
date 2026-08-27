"""Ownership checks for direct-upload artifact deletion."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import init_orm

init_orm()

from app.services.artifact_cleanup import (
    delete_directories,
    list_user_direct_upload_dirs,
    resolve_job_dir,
)


def _make_tree(tmp_path, monkeypatch, user_dir="user_5_bob"):
    """Fake data/uploads tree; helper paths are cwd-relative ('data/uploads')."""
    (tmp_path / "data" / "uploads" / user_dir / "20260827" / "job_a").mkdir(parents=True)
    model = tmp_path / "data" / "uploads" / user_dir / "20260827" / "job_a" / "m.stl"
    model.write_bytes(b"x")
    monkeypatch.chdir(tmp_path)
    return str(model)


def test_resolve_returns_job_dir_for_owner(tmp_path, monkeypatch):
    saved = _make_tree(tmp_path, monkeypatch)
    job_dir = resolve_job_dir(saved, 5)
    assert job_dir is not None
    assert os.path.basename(job_dir) == "job_a"


def test_resolve_rejects_other_users_and_escapes(tmp_path, monkeypatch):
    saved = _make_tree(tmp_path, monkeypatch, user_dir="user_9_eve")
    assert resolve_job_dir(saved, 5) is None, "another user's file must not resolve"
    assert resolve_job_dir("../secrets/keys.pem", 5) is None
    assert resolve_job_dir("", 5) is None


def test_delete_directories_refuses_paths_outside_uploads(tmp_path, monkeypatch):
    victim = tmp_path / "elsewhere" / "precious"
    victim.mkdir(parents=True)
    monkeypatch.chdir(tmp_path)
    assert delete_directories([str(victim)]) == 0
    assert victim.exists(), "deletion outside the uploads root must be refused"


def test_clear_all_lists_only_own_user_dirs(tmp_path, monkeypatch):
    _make_tree(tmp_path, monkeypatch, user_dir="user_5_bob")
    (tmp_path / "data" / "uploads" / "user_7_amy").mkdir(parents=True)
    monkeypatch.chdir(tmp_path)

    mine = list_user_direct_upload_dirs(5)
    assert len(mine) == 1 and "user_5_bob" in mine[0]

    deleted = delete_directories(mine)
    assert deleted == 1
    assert list_user_direct_upload_dirs(5) == []
    assert (tmp_path / "data" / "uploads" / "user_7_amy").exists()
