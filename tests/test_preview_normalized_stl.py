import asyncio
from io import BytesIO
from types import SimpleNamespace

from fastapi import UploadFile

from app import routes_preview


def test_preview_as_stl_returns_normalized_mesh_bytes(tmp_path, monkeypatch):
    normalized_path = tmp_path / "normalized.stl"
    normalized_path.write_bytes(b"solid normalized\nendsolid normalized\n")
    cleanup_calls = []

    def fake_normalize_model(source_path, output_dir):
        assert source_path.endswith(".stp")
        return SimpleNamespace(mesh_path=str(normalized_path), cleanup=lambda: cleanup_calls.append(True))

    monkeypatch.setattr(routes_preview, "normalize_model", fake_normalize_model)
    upload = UploadFile(filename="screen-bracket.stp", file=BytesIO(b"ISO-10303-21"))

    response = asyncio.run(routes_preview.preview_as_stl(upload))

    assert response.media_type == "model/stl"
    assert response.body == normalized_path.read_bytes()
    assert cleanup_calls == [True]
