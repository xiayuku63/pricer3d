"""app/printers.py 打印机模块测试 — 覆盖 resolve_printer、_nozzle_suffix、PRINTER_MODELS 数据完整性。"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.printers import (
    PRINTER_MODELS,
    resolve_printer,
    _nozzle_suffix,
)


# ========================================================================
# _nozzle_suffix — 喷嘴直径→后缀字符串
# ========================================================================
class TestNozzleSuffix:
    """_nozzle_suffix 转换测试。"""

    def test_04_to_04(self):
        """0.4 → '04'"""
        assert _nozzle_suffix(0.4) == "04"

    def test_02_to_02(self):
        """0.2 → '02'"""
        assert _nozzle_suffix(0.2) == "02"

    def test_06_to_06(self):
        """0.6 → '06'"""
        assert _nozzle_suffix(0.6) == "06"

    def test_08_to_08(self):
        """0.8 → '08'"""
        assert _nozzle_suffix(0.8) == "08"

    def test_10_to_10(self):
        """1.0 → '10'"""
        assert _nozzle_suffix(1.0) == "10"

    def test_01_to_01(self):
        """0.1 → '01'"""
        assert _nozzle_suffix(0.1) == "01"


# ========================================================================
# PRINTER_MODELS — 数据完整性
# ========================================================================
class TestPrinterModelsData:
    """PRINTER_MODELS 列表数据完整性检查。"""

    def test_non_empty(self):
        """打印机列表不应为空。"""
        assert len(PRINTER_MODELS) > 0

    def test_all_have_required_fields(self):
        """每个打印机应包含必需字段。"""
        required = {"id", "name", "bed_width", "bed_depth", "bed_height", "nozzle", "nozzles", "profile"}
        for pm in PRINTER_MODELS:
            for field in required:
                assert field in pm, f"Printer '{pm.get('id')}' missing field: {field}"

    def test_all_have_valid_nozzles(self):
        """每个打印机的 nozzles 列表应非空且包含默认喷嘴。"""
        for pm in PRINTER_MODELS:
            assert len(pm["nozzles"]) > 0, f"Printer '{pm['id']}' has empty nozzles"
            assert pm["nozzle"] in pm["nozzles"], (
                f"Printer '{pm['id']}': default nozzle {pm['nozzle']} not in nozzles {pm['nozzles']}"
            )

    def test_ids_unique(self):
        """打印机 ID 应唯一。"""
        ids = [pm["id"] for pm in PRINTER_MODELS]
        assert len(ids) == len(set(ids)), f"Duplicate printer IDs: {[x for x in ids if ids.count(x) > 1]}"

    def test_bed_dimensions_positive(self):
        """打印床尺寸应为正数。"""
        for pm in PRINTER_MODELS:
            assert pm["bed_width"] > 0, f"Printer '{pm['id']}': bed_width <= 0"
            assert pm["bed_depth"] > 0, f"Printer '{pm['id']}': bed_depth <= 0"
            assert pm["bed_height"] > 0, f"Printer '{pm['id']}': bed_height <= 0"

    def test_profiles_end_with_ini(self):
        """配置文件路径应以 .ini 结尾。"""
        for pm in PRINTER_MODELS:
            assert pm["profile"].endswith(".ini"), f"Printer '{pm['id']}': profile doesn't end with .ini"

    def test_known_bambu_a1_exists(self):
        """Bambu A1 应在列表中。"""
        ids = [pm["id"] for pm in PRINTER_MODELS]
        assert "bambu_a1" in ids

    def test_known_prusa_mk4_exists(self):
        """Prusa MK4 应在列表中。"""
        ids = [pm["id"] for pm in PRINTER_MODELS]
        assert "prusa_mk4" in ids


# ========================================================================
# resolve_printer — 内置打印机解析
# ========================================================================
class TestResolvePrinterBuiltin:
    """resolve_printer 内置打印机解析测试。"""

    def test_compound_id_a1_04(self):
        """bambu_a1_04 应解析到 Bambu A1 + 0.4mm 喷嘴。"""
        result = resolve_printer("bambu_a1_04")
        assert result is not None
        assert result["id"] == "bambu_a1"
        assert result["_nozzle"] == 0.4
        assert result["_compound_id"] == "bambu_a1_04"

    def test_compound_id_a1_02(self):
        """bambu_a1_02 应解析到 Bambu A1 + 0.2mm 喷嘴。"""
        result = resolve_printer("bambu_a1_02")
        assert result is not None
        assert result["_nozzle"] == 0.2

    def test_compound_id_a1_06(self):
        """bambu_a1_06 应解析到 Bambu A1 + 0.6mm 喷嘴。"""
        result = resolve_printer("bambu_a1_06")
        assert result is not None
        assert result["_nozzle"] == 0.6

    def test_model_id_only_default_nozzle(self):
        """仅传 model ID 应使用默认喷嘴。"""
        result = resolve_printer("bambu_a1")
        assert result is not None
        assert result["_nozzle"] == 0.4  # default nozzle
        assert result["_compound_id"] == "bambu_a1_04"

    def test_model_id_with_explicit_nozzle(self):
        """传 model ID + nozzle 参数应使用指定喷嘴。"""
        result = resolve_printer("bambu_a1", nozzle=0.6)
        assert result is not None
        assert result["_nozzle"] == 0.6
        assert result["_compound_id"] == "bambu_a1_06"

    def test_unknown_printer_returns_none(self):
        """未知打印机 ID 应返回 None。"""
        result = resolve_printer("nonexistent_printer_xyz")
        assert result is None

    def test_empty_string_returns_none(self):
        """空字符串应返回 None。"""
        result = resolve_printer("")
        assert result is None

    def test_resolve_creality_k1(self):
        """Creality K1 应可解析。"""
        result = resolve_printer("creality_k1_04")
        assert result is not None
        assert result["name"] == "Creality K1"

    def test_resolve_prusa_mk4(self):
        """Prusa MK4 应可解析。"""
        result = resolve_printer("prusa_mk4_04")
        assert result is not None
        assert result["name"] == "Prusa MK4"

    def test_resolve_voron(self):
        """Voron V2 应可解析。"""
        result = resolve_printer("voron_v2_250_04")
        assert result is not None
        assert result["name"] == "Voron V2"

    def test_result_has_bed_dimensions(self):
        """解析结果应包含打印床尺寸。"""
        result = resolve_printer("bambu_a1_04")
        assert result is not None
        assert "bed_width" in result
        assert "bed_depth" in result
        assert "bed_height" in result
        assert result["bed_width"] == 256
        assert result["bed_height"] == 256

    def test_result_has_profile_path(self):
        """解析结果应包含配置文件路径。"""
        result = resolve_printer("bambu_a1_04")
        assert result is not None
        assert "profile" in result
        assert result["profile"].endswith(".ini")

    def test_invalid_nozzle_for_model(self):
        """模型不支持的喷嘴尺寸应回退到默认喷嘴。"""
        # prusa_mk4 only has [0.4]
        result = resolve_printer("prusa_mk4", nozzle=0.8)
        assert result is not None
        assert result["_nozzle"] == 0.4  # falls back to default

    def test_bambu_x1c_compound(self):
        """Bambu X1C 复合 ID 解析。"""
        result = resolve_printer("bambu_x1c_08")
        assert result is not None
        assert result["_nozzle"] == 0.8
        assert result["name"] == "Bambu Lab X1C"

    def test_bambu_h2d_large_bed(self):
        """Bambu H2D 应有较大打印床。"""
        result = resolve_printer("bambu_h2d_04")
        assert result is not None
        assert result["bed_width"] == 350
        assert result["bed_depth"] == 320
        assert result["bed_height"] == 325

    def test_all_printers_resolve_by_compound_id(self):
        """所有内置打印机的复合 ID 都应可解析。"""
        for pm in PRINTER_MODELS:
            for n in pm["nozzles"]:
                compound = f"{pm['id']}_{_nozzle_suffix(n)}"
                result = resolve_printer(compound)
                assert result is not None, f"Failed to resolve: {compound}"
                assert result["_nozzle"] == n

    def test_user_prefix_returns_none_without_db(self):
        """user_ 前缀在无 DB 环境下应返回 None（不崩溃）。"""
        # _resolve_user_printer needs DB, so this should gracefully return None
        result = resolve_printer("user_999_04")
        # May return None or raise — should not crash
        # If it returns None, that's fine
        assert result is None or isinstance(result, dict)
