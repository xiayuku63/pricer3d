import asyncio
import io
import json
import zipfile
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import app.services.zip_quote as zip_quote_service
from app.services.zip_quote import (
    _build_missing_checklist_materials,
    _ensure_checklist_material_colors,
    _parse_zip_contents,
    _resolve_checklist_printer,
    _resolve_color_hex,
    _validate_free_zip_capacity,
    download_zip_template,
)
from app.services.quote import _resolve_effective_printer_model
from app.zip_parser import _parse_excel_checklist


def _zip_bytes(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, content in entries:
            zf.writestr(name, content)
    return buf.getvalue()


async def _response_bytes(response):
    content = b""
    async for chunk in response.body_iterator:
        content += chunk
    return content


def test_download_template_parses_only_example_models():
    request = Request({"type": "http", "headers": []})
    content = asyncio.run(_response_bytes(download_zip_template(request)))

    checklist = _parse_excel_checklist(content, "zip_import_template.xlsx")

    assert [item["filename_stem"] for item in checklist] == ["model1", "model2", "model3"]
    assert checklist[1]["layer_height_parsed"] == 0.16
    assert checklist[1]["wall_count_parsed"] == 4
    assert checklist[1]["infill_parsed"] == 15


def test_zip_rejects_expanded_content_over_limit(monkeypatch):
    monkeypatch.setattr(zip_quote_service, "MAX_ZIP_SIZE_BYTES", 10)
    content = _zip_bytes([("model.stl", b"x" * 11)])

    with pytest.raises(HTTPException, match="解压后总大小") as exc_info:
        _parse_zip_contents(content)

    assert exc_info.value.status_code == 400


def test_zip_rejects_duplicate_model_stems():
    content = _zip_bytes(
        [
            ("first/part.stl", b"solid first"),
            ("second/part.obj", b"object second"),
        ]
    )

    with pytest.raises(HTTPException, match="重名模型") as exc_info:
        _parse_zip_contents(content)

    assert exc_info.value.status_code == 400


def test_zip_rejects_legacy_xls_checklist():
    content = _zip_bytes(
        [
            ("checklist.xls", b"legacy workbook"),
            ("model.stl", b"solid model"),
        ]
    )

    with pytest.raises(HTTPException, match="暂不支持旧版 .xls"):
        _parse_zip_contents(content)


def test_zip_rejects_unreadable_xlsx_checklist():
    content = _zip_bytes(
        [
            ("checklist.xlsx", b"not an xlsx workbook"),
            ("model.stl", b"solid model"),
        ]
    )

    with pytest.raises(HTTPException, match="Excel 清单无法读取"):
        _parse_zip_contents(content)


def test_free_zip_capacity_counts_existing_and_incoming_models():
    _validate_free_zip_capacity(existing_count=8, incoming_count=2)

    with pytest.raises(HTTPException, match="当前还可上传 1 个，本次 ZIP 包含 2 个"):
        _validate_free_zip_capacity(existing_count=9, incoming_count=2)


def test_checklist_printer_inherits_default_nozzle_when_nozzle_is_blank():
    assert _resolve_checklist_printer("bambu_a1_08", "Bambu Lab A1", "") == "bambu_a1_08"


def test_checklist_nozzle_can_override_default_printer_without_replacing_model():
    assert _resolve_checklist_printer("bambu_a1_08", "", "0.4") == "bambu_a1_04"


def test_chinese_color_name_resolves_to_hex():
    assert _resolve_color_hex("黑色") == "#000000"


def test_display_name_compound_printer_keeps_requested_nozzle():
    assert _resolve_effective_printer_model("Bambu Lab A1_08", None, None) == "bambu_a1_08"


def test_missing_checklist_color_builds_generic_material():
    materials = [
        {
            "name": "PETG",
            "brand": "Generic",
            "density": 1.27,
            "price_per_kg": 100,
            "color": {"name": "白色", "hex": "#ffffff"},
        }
    ]

    created = _build_missing_checklist_materials(
        materials,
        [{"material_type": "PETG", "color": "黑色"}],
    )

    assert created == [
        {
            "density": 1.27,
            "price_per_kg": 100,
            "name": "PETG",
            "brand": "Generic",
            "color": {"name": "黑色", "hex": "#000000"},
        }
    ]


def test_missing_checklist_material_defaults_to_pla_and_is_persisted(monkeypatch):
    user = SimpleNamespace(materials=None)

    class QueryStub:
        def filter(self, *_args):
            return self

        def first(self):
            return user

    class DbStub:
        def query(self, *_args):
            return QueryStub()

    @contextmanager
    def db_session_stub():
        yield DbStub()

    monkeypatch.setattr(zip_quote_service, "get_db_session", db_session_stub)
    materials = []

    created = _ensure_checklist_material_colors(
        1,
        materials,
        [{"material_type": "", "color": "黑色"}],
    )

    assert created[0]["name"] == "PLA"
    assert created[0]["brand"] == "Generic"
    assert created[0]["color"] == {"name": "黑色", "hex": "#000000"}
    assert json.loads(user.materials) == materials


def test_zip_processing_uses_shared_quote_wrapper_for_printer_profile():
    source = open(zip_quote_service.__file__, encoding="utf-8").read()

    assert "await asyncio.to_thread(" in source
    assert "_process_single_file_sync," in source
    assert "await process_single_file(" not in source
