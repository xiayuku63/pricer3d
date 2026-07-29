from contextlib import contextmanager
from pathlib import Path

from app.services import history


class _FakeQuery:
    def __init__(self, deleted_count: int):
        self.deleted_count = deleted_count

    def filter(self, *_args, **_kwargs):
        return self

    def delete(self):
        return self.deleted_count


class _FakeDb:
    def __init__(self, deleted_count: int):
        self.deleted_count = deleted_count

    def query(self, _model):
        return _FakeQuery(self.deleted_count)


def _write(path: Path, content: bytes = b"artifact") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def test_clear_quote_history_removes_only_current_user_models_and_gcode(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    user_data = tmp_path / "user-data"
    monkeypatch.setenv("USER_DATA_DIR", str(user_data))

    user_folder = "user_7_alice"
    direct_root = tmp_path / "data" / "uploads" / user_folder
    zip_uploads = user_data / user_folder / "uploads"
    outputs = user_data / user_folder / "outputs"
    configs = user_data / user_folder / "configs"
    sibling_user = tmp_path / "data" / "uploads" / "user_8_bob"
    custom_dir = user_data / user_folder / "custom"

    _write(direct_root / "20260729" / "job-a" / "model.stl")
    _write(direct_root / "20260729" / "job-a" / "normalized" / "model.gcode")
    _write(zip_uploads / "zip-job" / "part.3mf")
    _write(outputs / "legacy-job" / "part.gcode")
    _write(configs / "quality.ini", b"keep")
    _write(custom_dir / "notes.txt", b"keep")
    _write(sibling_user / "job" / "other.stl", b"keep")

    @contextmanager
    def fake_db_session():
        yield _FakeDb(deleted_count=4)

    audit_details = []
    monkeypatch.setattr(history, "get_db_session", fake_db_session)
    monkeypatch.setattr(history, "write_audit_event", lambda **kwargs: audit_details.append(kwargs["detail"]))

    result = history.clear_quote_history(
        request=object(),
        current_user={"id": 7, "username": "alice"},
    )

    assert result == {
        "status": "ok",
        "deleted": 4,
        "artifacts": {"roots_deleted": 3, "files_deleted": 4},
    }
    assert not direct_root.exists()
    assert not zip_uploads.exists()
    assert not outputs.exists()
    assert (configs / "quality.ini").read_bytes() == b"keep"
    assert (custom_dir / "notes.txt").read_bytes() == b"keep"
    assert (sibling_user / "job" / "other.stl").read_bytes() == b"keep"
    assert audit_details == [{"deleted_count": 4, "roots_deleted": 3, "files_deleted": 4}]


def test_clear_quote_artifacts_ignores_missing_directories(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("USER_DATA_DIR", str(tmp_path / "user-data"))

    assert history._clear_quote_artifacts({"id": 9, "username": "nobody"}) == {
        "roots_deleted": 0,
        "files_deleted": 0,
    }


def test_clear_quote_artifacts_rejects_unsafe_username(tmp_path, monkeypatch):
    import pytest

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("USER_DATA_DIR", str(tmp_path / "user-data"))
    protected = tmp_path / "data" / "uploads" / "victim" / "keep.stl"
    _write(protected, b"keep")

    with pytest.raises(RuntimeError, match="unsafe username"):
        history._clear_quote_artifacts({"id": 9, "username": "../victim"})

    assert protected.read_bytes() == b"keep"
