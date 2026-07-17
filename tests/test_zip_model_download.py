import os

import pytest
from fastapi import HTTPException

from app.services.zip_quote import _zip_preview_model_path, download_zip_model


def test_zip_preview_path_prefers_downloadable_presaved_model():
    result = {"_saved_path": os.path.join("data", "uploads", "model.stl")}
    model = {"_pre_saved_path": os.path.join("user", "user_1_demo", "uploads", "job", "model.stl")}

    assert _zip_preview_model_path(result, model) == model["_pre_saved_path"]


def test_download_zip_model_accepts_relative_user_data_dir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    model_path = tmp_path / "user" / "user_1_demo" / "uploads" / "job" / "model.stl"
    model_path.parent.mkdir(parents=True)
    model_path.write_bytes(b"solid model")

    response = download_zip_model(os.path.relpath(model_path), {"id": 1, "username": "demo"})

    assert response.path == os.path.realpath(model_path)


def test_download_zip_model_rejects_path_outside_user_uploads(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    outside = tmp_path / "model.stl"
    outside.write_bytes(b"solid model")

    with pytest.raises(HTTPException) as exc_info:
        download_zip_model(os.path.relpath(outside), {"id": 1, "username": "demo"})

    assert exc_info.value.status_code == 403
