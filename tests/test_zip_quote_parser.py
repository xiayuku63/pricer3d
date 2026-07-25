import io
import zipfile

from fastapi import HTTPException

from app.services.zip_quote_parser import parse_zip_contents


def _zip_bytes(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return buffer.getvalue()


def test_parser_returns_models_and_ignores_metadata_entries():
    parsed = parse_zip_contents(
        _zip_bytes(
            [
                ("__MACOSX/._model.stl", b"metadata"),
                ("folder/model.stl", b"solid model"),
                ("folder/readme.txt", b"ignored"),
            ]
        ),
        max_size_bytes=1024,
        max_files=10,
        supported_extensions={".stl"},
    )

    assert [item["filename"] for item in parsed["stl_files"]] == ["model.stl"]
    assert parsed["match_result"]["match_mode"] == "none"


def test_parser_applies_injected_file_limit():
    content = _zip_bytes([("one.stl", b"1"), ("two.stl", b"2")])

    try:
        parse_zip_contents(
            content,
            max_size_bytes=1024,
            max_files=1,
            supported_extensions={".stl"},
        )
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "数量不能超过 1" in exc.detail
    else:
        raise AssertionError("expected model-count validation to fail")
