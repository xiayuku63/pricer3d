import asyncio

from app.services.zip_quote_runner import ZipQuoteRunConfig, ZipQuoteRunner


class RequestStub:
    def __init__(self, disconnected=False):
        self.disconnected = disconnected

    async def is_disconnected(self):
        return self.disconnected


def make_runner(processor, match_material=None, concurrency=None):
    config = ZipQuoteRunConfig(
            material="PLA",
            color="White",
            quantity=2,
            user_materials=[{"name": "PETG", "brand": "BrandX"}],
            pricing_config={"base": 1},
            default_compound_id="printer_08",
            default_preset={"id": 7},
            effective_layer_height=0.2,
            effective_wall_count=3,
            effective_infill=20,
            current_user={"id": 1, "username": "demo"},
            process_single_file_sync=processor,
            resolve_color_hex=lambda value, fallback="": "#112233" if value else fallback,
            match_selected_material=match_material or (lambda materials, material, brand, color: {
                "name": material,
                "brand": brand or "Generic",
                "color": color,
            }),
            resolve_checklist_printer=lambda default, printer, nozzle: "printer_04" if printer else default,
            zip_preview_model_path=lambda result, model: model.get("_pre_saved_path"),
        )
    return ZipQuoteRunner(config, concurrency=concurrency) if concurrency is not None else ZipQuoteRunner(config)


def collect_events(runner, request, items):
    async def collect():
        return [event async for event in runner.stream(request, items)]

    return asyncio.run(collect())


def test_runner_applies_matched_checklist_overrides():
    calls = []

    def processor(file, **kwargs):
        calls.append(kwargs)
        return {"status": "success", "cost_cny": 12, "weight_g": 3, "estimated_time_h": 1}

    runner = make_runner(processor)
    item = {
        "checklist": {
            "material_type": "PETG",
            "material_brand": "BrandX",
            "color": "Blue",
            "quantity_parsed": 4,
            "layer_height_parsed": "0.16",
            "wall_count_parsed": "4",
            "infill_parsed": "25",
            "printer_model": "Printer A",
            "nozzle": "0.4",
        },
        "stl": {"filename": "part.stl", "file_bytes": b"solid", "_pre_saved_path": "saved.stl"},
    }

    events = collect_events(runner, RequestStub(), [("matched", item)])

    assert [event["type"] for event in events] == ["progress", "complete"]
    assert events[0]["status"] == "success"
    assert events[1]["results"][0]["checklist_file_path"] == "saved.stl"
    assert calls[0]["material"] == "PETG"
    assert calls[0]["quantity"] == 4
    assert calls[0]["layer_height"] == 0.16
    assert calls[0]["perimeters"] == 4
    assert calls[0]["infill"] == 25
    assert calls[0]["pricing_config"]["printer_model"] == "printer_04"


def test_runner_uses_mapped_checklist_color_for_processing_and_result():
    calls = []
    material_lookups = []

    def match_material(materials, material, brand, color):
        material_lookups.append(color)
        return {"name": material, "brand": brand or "Generic", "color": color}

    def processor(file, **kwargs):
        calls.append(kwargs)
        return {"status": "success", "color": "#000000"}

    runner = make_runner(processor, match_material)
    item = {
        "checklist": {
            "material_type": "PETG",
            "color": "??",
            "_original_color": "??",
            "_mapped_color": {"name": "??", "hex": "#ca8a04"},
        },
        "stl": {"filename": "mapped.stl", "file_bytes": b"solid"},
    }

    events = collect_events(runner, RequestStub(), [("matched", item)])

    assert calls[0]["color"] == "#ca8a04"
    assert material_lookups == ["??"]
    assert events[-1]["results"][0]["color"] == "#ca8a04"
    assert events[-1]["results"][0]["_checklist_source"]["source_color"] == "??"


def test_runner_processes_stl_only_with_global_defaults():
    calls = []

    def processor(file, **kwargs):
        calls.append(kwargs)
        return {"status": "success"}

    runner = make_runner(processor)
    stl = {"filename": "default.stl", "file_bytes": b"solid", "_pre_saved_path": "default.stl"}

    events = collect_events(runner, RequestStub(), [("stl_only", stl)])

    assert events[-1]["results"][0]["_checklist_params"] is False
    assert calls[0]["material"] == "PLA"
    assert calls[0]["quantity"] == 2
    assert calls[0]["layer_height"] == 0.2
    assert calls[0]["perimeters"] == 3
    assert calls[0]["pricing_config"]["printer_model"] == "printer_08"


def test_runner_converts_item_exception_to_failed_result():
    def processor(file, **kwargs):
        raise RuntimeError("slice failed")

    runner = make_runner(processor)
    stl = {"filename": "broken.stl", "file_bytes": b"bad", "_pre_saved_path": "broken.stl"}

    events = collect_events(runner, RequestStub(), [("stl_only", stl)])

    assert events[0] == {
        "type": "progress",
        "current": 1,
        "total": 1,
        "filename": "broken.stl",
        "status": "failed",
    }
    assert events[1]["results"][0]["error"] == "slice failed"
    assert events[1]["results"][0]["checklist_file_path"] == "broken.stl"


def test_runner_stops_before_processing_when_client_disconnects():
    calls = []

    def processor(file, **kwargs):
        calls.append(kwargs)
        return {"status": "success"}

    runner = make_runner(processor)
    stl = {"filename": "cancelled.stl", "file_bytes": b"solid"}

    events = collect_events(runner, RequestStub(disconnected=True), [("stl_only", stl)])

    # "processed" now reports completed work (none ran), not the loop position
    assert events == [{"type": "cancelled", "processed": 0}]
    assert calls == []

def test_runner_processes_models_concurrently():
    """Models run in parallel (bounded): wall time collapses and progress
    counters stay monotonic in completion order."""
    import time as _time

    active = 0
    peak = 0

    def processor(file, **kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        _time.sleep(0.05)
        active -= 1
        return {"status": "success", "cost_cny": 1, "weight_g": 1, "estimated_time_h": 1}

    runner = make_runner(processor, concurrency=2)
    items = [("stl_only", {"filename": f"m{i}.stl", "file_bytes": b"x"}) for i in range(6)]

    started = _time.perf_counter()
    events = collect_events(runner, RequestStub(), items)
    elapsed = _time.perf_counter() - started

    assert events[-1]["type"] == "complete"
    assert len(events[-1]["results"]) == 6
    progresses = [e for e in events if e["type"] == "progress"]
    assert [e["current"] for e in progresses] == [1, 2, 3, 4, 5, 6]
    # 6 files × 50ms with 2 workers ≈ 150ms; serial would be ≥300ms
    assert elapsed < 0.3
    assert peak == 2
