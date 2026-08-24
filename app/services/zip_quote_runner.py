"""Per-model execution orchestration for ZIP quotes."""

import asyncio
import io
import os
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable, Optional

from fastapi import UploadFile

from app.config import ZIP_QUOTE_CONCURRENCY


@dataclass(frozen=True)
class ZipQuoteRunConfig:
    material: str
    color: str
    quantity: int
    user_materials: list
    pricing_config: dict
    default_compound_id: Optional[str]
    default_preset: Any
    effective_layer_height: float
    effective_wall_count: int
    effective_infill: int
    current_user: dict
    process_single_file_sync: Callable[..., dict]
    resolve_color_hex: Callable[..., str]
    match_selected_material: Callable[..., Optional[dict]]
    resolve_checklist_printer: Callable[..., Optional[str]]
    zip_preview_model_path: Callable[..., Optional[str]]


def _open_model_source(stl: dict):
    """Open the model bytes from the pre-saved disk path when available.

    ZIP entries are spooled to disk before the runner starts, so the working
    set stays bounded even for large archives; the in-memory ``file_bytes``
    fallback covers callers that did not pre-save.
    """
    path = stl.get("_pre_saved_path")
    if path and os.path.isfile(path):
        return open(path, "rb"), True
    return io.BytesIO(stl["file_bytes"]), False


class ZipQuoteRunner:
    """Execute matched and unmatched ZIP models with progress events.

    Models run concurrently (bounded by ZIP_QUOTE_CONCURRENCY); progress
    events are emitted in completion order with a monotonic counter.
    """

    def __init__(self, config: ZipQuoteRunConfig, concurrency: int = ZIP_QUOTE_CONCURRENCY):
        self.config = config
        self._concurrency = max(1, int(concurrency))

    async def stream(self, request, files_to_process: list[tuple[str, dict]]) -> AsyncIterator[dict]:
        total_files = len(files_to_process)
        results: list[Optional[dict]] = [None] * total_files
        completed = 0
        cancelled = False
        semaphore = asyncio.Semaphore(self._concurrency)
        events: asyncio.Queue = asyncio.Queue()

        async def _worker(index: int, file_type: str, item) -> None:
            nonlocal cancelled
            if cancelled:
                return
            async with semaphore:
                if cancelled or await request.is_disconnected():
                    return
                try:
                    if file_type == "matched":
                        result, filename, pre_saved = await self._process_matched(item)
                    else:
                        result, filename, pre_saved = await self._process_stl_only(item)
                    if not result.get("checklist_file_path") and pre_saved:
                        result["checklist_file_path"] = pre_saved
                    results[index] = result
                    status = "success" if result.get("status") == "success" else "failed"
                except Exception as exc:
                    filename, pre_saved = self._failure_metadata(file_type, item)
                    result = {
                        "filename": filename,
                        "status": "failed",
                        "error": str(exc),
                        "cost_cny": 0,
                        "weight_g": 0,
                        "estimated_time_h": 0,
                    }
                    if pre_saved:
                        result["checklist_file_path"] = pre_saved
                    results[index] = result
                    status = "failed"
                await events.put((filename, status))

        tasks = [
            asyncio.create_task(_worker(index, file_type, item))
            for index, (file_type, item) in enumerate(files_to_process)
        ]
        try:
            while completed < total_files:
                if await request.is_disconnected():
                    cancelled = True
                    yield {"type": "cancelled", "processed": completed}
                    return
                try:
                    filename, status = await asyncio.wait_for(events.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                completed += 1
                yield {
                    "type": "progress",
                    "current": completed,
                    "total": total_files,
                    "filename": filename,
                    "status": status,
                }
            yield {"type": "complete", "results": [result for result in results if result is not None]}
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _process_matched(self, item: dict) -> tuple[dict, str, Optional[str]]:
        config = self.config
        checklist = item["checklist"]
        stl = item["stl"]
        layer_height_raw = checklist.get("layer_height_parsed")
        wall_count_raw = checklist.get("wall_count_parsed")
        infill_raw = checklist.get("infill_parsed")
        has_print_params = any([layer_height_raw, wall_count_raw, infill_raw])
        layer_height = self._parse_float(layer_height_raw)
        wall_count = self._parse_int(wall_count_raw)
        infill = self._parse_int(infill_raw)
        checklist_quantity = checklist.get("quantity_parsed", config.quantity)
        mapped_color = checklist.get("_mapped_color") if isinstance(checklist.get("_mapped_color"), dict) else {}
        checklist_color_raw = str(checklist.get("color", "") or "").strip()
        checklist_color = str(mapped_color.get("hex") or "").strip() or config.resolve_color_hex(
            checklist_color_raw, config.resolve_color_hex(config.color)
        )
        checklist_material = checklist.get("material_type", "").strip() or config.material
        checklist_brand = checklist.get("material_brand", "").strip()
        material_lookup_color = str(
            mapped_color.get("name") or mapped_color.get("hex") or checklist_color_raw or checklist_color
        ).strip()
        material_spec = config.match_selected_material(
            config.user_materials, checklist_material, checklist_brand, material_lookup_color
        )
        checklist_printer = str(checklist.get("printer_model", "")).strip()
        checklist_nozzle = str(checklist.get("nozzle", "")).strip()
        has_printer_override = bool(checklist_printer)
        has_nozzle_override = bool(checklist_nozzle)
        compound_id = config.resolve_checklist_printer(
            config.default_compound_id, checklist_printer, checklist_nozzle
        )
        file_pricing = dict(config.pricing_config)
        if compound_id:
            file_pricing["printer_model"] = compound_id
        if has_print_params:
            file_preset = None
            effective_layer_height = layer_height if layer_height is not None else config.effective_layer_height
            effective_wall_count = wall_count if wall_count is not None else config.effective_wall_count
            effective_infill = infill if infill is not None else config.effective_infill
        else:
            file_preset = config.default_preset
            effective_layer_height = config.effective_layer_height
            effective_wall_count = config.effective_wall_count
            effective_infill = config.effective_infill
        source, owns_handle = _open_model_source(stl)
        fake_file = UploadFile(filename=stl["filename"], file=source)
        try:
            result = await asyncio.to_thread(
                config.process_single_file_sync,
                fake_file,
                material=checklist_material,
                layer_height=effective_layer_height,
                infill=effective_infill,
                quantity=checklist_quantity,
                color=checklist_color,
                user_materials=config.user_materials,
                pricing_config=file_pricing,
                slicer_preset=file_preset,
                perimeters=effective_wall_count,
                current_user=config.current_user,
                auto_orient=False,
                selected_material_spec=material_spec,
            )
        finally:
            if owns_handle:
                source.close()
        # The processing wrapper may preserve a stale color from an existing
        # material/result. The checklist mapping is authoritative for both the
        # rendered result and the saved quote history.
        result["color"] = checklist_color
        result["_checklist_params"] = True
        result["brand"] = (
            str(material_spec.get("brand") or checklist_brand or "Generic")
            if material_spec
            else (checklist_brand or "Generic")
        )
        result["_printer_model_explicit"] = has_printer_override or has_nozzle_override
        result["_slicer_preset_explicit"] = has_print_params
        result["_checklist_source"] = {
            "layer_height": effective_layer_height if has_print_params else "",
            "wall_count": effective_wall_count if has_print_params else "",
            "infill": effective_infill if has_print_params else "",
            "printer_model": checklist_printer,
            "nozzle": checklist_nozzle,
            "material_type": checklist.get("material_type", ""),
            "material_brand": checklist.get("material_brand", ""),
            "color": str(mapped_color.get("name") or checklist_color_raw),
            "source_color": checklist.get("_original_color", checklist_color_raw),
            "mapped_color": mapped_color,
            "quantity": checklist_quantity,
        }
        result["checklist_file_path"] = config.zip_preview_model_path(result, stl)
        return result, stl["filename"], stl.get("_pre_saved_path")

    async def _process_stl_only(self, stl: dict) -> tuple[dict, str, Optional[str]]:
        config = self.config
        source, owns_handle = _open_model_source(stl)
        fake_file = UploadFile(filename=stl["filename"], file=source)
        file_pricing = dict(config.pricing_config)
        if config.default_compound_id:
            file_pricing["printer_model"] = config.default_compound_id
        try:
            result = await asyncio.to_thread(
                config.process_single_file_sync,
                fake_file,
                material=config.material,
                layer_height=config.effective_layer_height,
                infill=config.effective_infill,
                quantity=config.quantity,
                color=config.resolve_color_hex(config.color),
                user_materials=config.user_materials,
                pricing_config=file_pricing,
                slicer_preset=config.default_preset,
                perimeters=config.effective_wall_count,
                current_user=config.current_user,
                auto_orient=False,
                selected_material_spec=config.match_selected_material(
                    config.user_materials, config.material, "", config.color
                ),
            )
        finally:
            if owns_handle:
                source.close()
        result["_checklist_params"] = False
        result["checklist_file_path"] = config.zip_preview_model_path(result, stl)
        return result, stl["filename"], stl.get("_pre_saved_path")

    @staticmethod
    def _parse_float(value) -> Optional[float]:
        if not value:
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _parse_int(value) -> Optional[int]:
        if not value:
            return None
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _failure_metadata(file_type: str, item: dict) -> tuple[str, Optional[str]]:
        if not isinstance(item, dict):
            return "unknown", None
        if file_type == "matched":
            stl = item.get("stl", {})
            return stl.get("filename", "unknown"), stl.get("_pre_saved_path")
        return item.get("filename", "unknown"), item.get("_pre_saved_path")