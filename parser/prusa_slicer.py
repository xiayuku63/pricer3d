"""
PrusaSlicer integration — headless slicing for accurate time & filament estimation.

Uses PrusaSlicer via apt (prusa-slicer CLI) in headless mode.
Config is loaded from profiles/prusa/print.ini (system default) or user presets.
Quote parameters (layer_height, infill%, perimeters, density) override config at
slice time by generating a temporary combined INI file.
"""

import os
import re
import logging
import shlex
import shutil
import subprocess
import tempfile
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _env_file_prusa_executable() -> str:
    """Best-effort read of PRUSA_EXECUTABLE from the project .env file."""
    root = os.path.dirname(os.path.dirname(__file__))
    env_path = os.path.join(root, ".env")
    if not os.path.isfile(env_path):
        return ""
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if key.strip() != "PRUSA_EXECUTABLE":
                    continue
                value = value.strip().strip('"').strip("'")
                return value
    except Exception:
        return ""
    return ""


# ── Executable discovery ──


def prusa_executable() -> Optional[str]:
    """Return path to prusa-slicer binary, or None if not installed.

    Strategy:
    1. Respect explicit ``PRUSA_EXECUTABLE`` if set.
    2. Linux (Docker): directly check ``/usr/bin/prusa-slicer`` (apt install).
    3. Fall back to ``shutil.which()`` for PATH-based lookup.
    4. Check well-known Windows install paths.
    """
    import sys as _sys

    _env = os.getenv("PRUSA_EXECUTABLE", "").strip()
    if _env:
        if _env.startswith("wsl ") or _env.startswith("wsl.exe "):
            # WSL passthrough is only valid on Windows
            if _sys.platform == "win32":
                return _env  # WSL passthrough: "wsl prusa-slicer" or "wsl.exe prusa-slicer"
            logger.warning(
                "PRUSA_EXECUTABLE='%s' but platform is '%s' — ignoring, will auto-detect",
                _env,
                _sys.platform,
            )
            _env = ""  # fall through to auto-detection
        elif os.path.isfile(_env):
            return _env
    _env_file = _env_file_prusa_executable().strip()
    if _env_file:
        if _env_file.startswith("wsl ") or _env_file.startswith("wsl.exe "):
            if _sys.platform == "win32":
                return _env_file
            logger.warning("Ignoring WSL path from .env file on %s platform", _sys.platform)
            _env_file = ""
        elif os.path.isfile(_env_file):
            return _env_file
    # Linux: apt installs to /usr/bin/prusa-slicer
    if _sys.platform != "win32":
        _p = "/usr/bin/prusa-slicer"
        if os.path.isfile(_p):
            return _p
    # Docker: AppImage installed at /usr/local/bin/prusa-slicer
    _p_docker = "/usr/local/bin/prusa-slicer"
    if os.path.isfile(_p_docker):
        return _p_docker
    # PATH-based lookup
    for _name in ("prusa-slicer", "prusa-slicer-console", "prusaslicer", "prusaslicer-console"):
        _c = shutil.which(_name)
        if _c:
            return _c
    # Well-known paths
    for _p in (
        "/snap/bin/prusa-slicer",
        "C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe",
        "C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer.exe",
        "C:/Program Files (x86)/Prusa3D/PrusaSlicer/prusa-slicer-console.exe",
        os.path.expandvars(r"%LOCALAPPDATA%/Programs/PrusaSlicer/prusa-slicer-console.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%/Programs/PrusaSlicer/prusa-slicer.exe"),
    ):
        if os.path.isfile(_p):
            return _p
    return None


def prusa_executable_diagnostics() -> dict:
    diag = {"found": False, "path": None, "version": None}
    exe = prusa_executable()
    if exe:
        diag["found"] = True
        diag["path"] = exe
        try:
            cmd = shlex.split(exe) if (" " in exe or "\t" in exe) else [exe]
            out = subprocess.check_output(cmd + ["--help"], stderr=subprocess.STDOUT, timeout=10, shell=False)
            lines = out.decode("utf-8", errors="replace").split("\n")
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                if "based on Slic3r" in line or "PrusaSlicer-" in line:
                    diag["version"] = line
                    break
            if not diag["version"]:
                diag["version"] = lines[0].strip() if lines[0].strip() else "OK"
        except Exception as e:
            diag["version"] = f"error: {e}"
    return diag


# ── G-code parsing ──


def parse_prusa_gcode_stats(gcode_path: str) -> dict:
    """Parse PrusaSlicer G-code for filament usage and print time."""
    result: dict = {
        "filament_mm": 0.0,
        "filament_cm3": 0.0,
        "filament_g": 0.0,
        "time_s": 0,
        "time_str": "",
    }
    if not os.path.exists(gcode_path):
        return result

    with open(gcode_path, "r", encoding="utf-8", errors="replace") as f:
        # Stats are at the end of the file — read last 256KB
        f.seek(0, os.SEEK_END)
        file_size = f.tell()
        chunk_size = min(256 * 1024, file_size)
        f.seek(file_size - chunk_size)
        content = f.read(chunk_size)

    if m := re.search(r"; filament used \[mm\] = ([\d.]+)", content):
        result["filament_mm"] = float(m.group(1))
    if m := re.search(r"; filament used \[cm3\] = ([\d.]+)", content):
        result["filament_cm3"] = float(m.group(1))
    if m := re.search(r"; total filament used \[g\] = ([\d.]+)", content):
        result["filament_g"] = float(m.group(1))

    # Parse time: "estimated printing time (normal mode) = Xh Ym Zs" or "Xm Ys"
    if m := re.search(r"; estimated printing time \(normal mode\) = (\d+)h (\d+)m (\d+)s", content):
        result["time_s"] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
        result["time_str"] = f"{m.group(1)}h {m.group(2)}m {m.group(3)}s"
    elif m := re.search(r"; estimated printing time \(normal mode\) = (\d+)m (\d+)s", content):
        result["time_s"] = int(m.group(1)) * 60 + int(m.group(2))
        result["time_str"] = f"{m.group(1)}m {m.group(2)}s"

    return result


# ── Config generation ──

_SYSTEM_INI_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "profiles", "prusa", "print.ini")


def _load_system_ini() -> str:
    """Load system default INI content."""
    if not os.path.exists(_SYSTEM_INI_PATH):
        raise RuntimeError(f"System PrusaSlicer config not found: {_SYSTEM_INI_PATH}")
    with open(_SYSTEM_INI_PATH, "r", encoding="utf-8") as f:
        return f.read()


def _parse_ini_sections(content: str) -> dict[str, dict[str, str]]:
    """Parse INI content into {section_name: {key: value}} dict.

    Preserves section headers — critical for PrusaSlicer which requires
    settings under proper [print:*], [filament:*], [machine:*] sections.
    Flat INI files (no section headers) are auto-assigned to [machine:custom].
    """
    sections: dict[str, dict[str, str]] = {}
    current_section: str | None = None
    for line in content.split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith(";") or stripped.startswith("#"):
            continue
        if stripped.startswith("[") and stripped.endswith("]"):
            current_section = stripped[1:-1]
            sections.setdefault(current_section, {})
            continue
        if "=" in stripped:
            if current_section is None:
                # Flat INI (no section header) → put everything in machine:custom
                current_section = "machine:custom"
                sections.setdefault(current_section, {})
            k, v = stripped.split("=", 1)
            key = k.strip()
            if key:
                sections[current_section][key] = v.strip()
    return sections


def _write_ini_sections(sections: dict[str, dict[str, str]]) -> str:
    """Serialize sections dict back to INI string with proper section headers.

    CRITICAL: Strip profile name suffixes so PrusaSlicer CLI activates the
    settings directly.  ``[print:0.20mm_Standard]`` → ``[print]``.
    Without this, PrusaSlicer treats the sections as named profile
    *definitions* (added to its library) rather than active config,
    and silently uses its own built-in defaults.
    """
    lines = []
    for sec_name, settings in sections.items():
        base_type = sec_name.split(":")[0] if ":" in sec_name else sec_name
        lines.append(f"[{base_type}]")
        for key in sorted(settings):
            lines.append(f"{key} = {settings[key]}")
        lines.append("")
    return "\n".join(lines)


def _parse_flat_ini(content: str) -> dict[str, str]:
    """Parse flat INI (no section headers) into key=value dict."""
    settings: dict[str, str] = {}
    for line in content.split("\n"):
        line = line.strip()
        if not line or line.startswith(";") or line.startswith("#") or (line.startswith("[") and line.endswith("]")):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            key = k.strip()
            if key:
                settings[key] = v.strip()
    return settings


def _merge_preset_into_sections(
    sections: dict[str, dict[str, str]],
    preset_content: bytes,
) -> None:
    """Merge preset INI content into sections dict.

    Handles both flat INI (no section headers — treated as print settings)
    and sectioned INI (merged into matching sections).
    """
    raw = preset_content
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    text = raw.decode("utf-8", errors="replace")

    # Detect flat vs sectioned
    has_sections = any(line.strip().startswith("[") and line.strip().endswith("]") for line in text.split("\n"))

    if has_sections:
        preset_sections = _parse_ini_sections(text)
        for sec_name, sec_settings in preset_sections.items():
            sections.setdefault(sec_name, {}).update(sec_settings)
    else:
        # Flat INI: merge into the print section
        flat = _parse_flat_ini(text)
        print_section = None
        for sec_name in sections:
            if sec_name.startswith("print:"):
                print_section = sec_name
                break
        if print_section is None:
            print_section = "print:custom"
            sections[print_section] = {}
        sections[print_section].update(flat)


def generate_slice_config(
    layer_height: float = 0.2,
    infill_percent: int = 20,
    perimeters: int = 3,
    material_density: float = 1.24,
    slicer_preset: Optional[dict] = None,
    printer_profile_path: Optional[str] = None,
    top_shell_layers: Optional[int] = None,
    bottom_shell_layers: Optional[int] = None,
    hotend_temp: Optional[int] = None,
    bed_temp: Optional[int] = None,
) -> str:
    """
    Generate a combined PrusaSlicer INI config file for a quote request.

    Merges: printer profile (or system default) → user preset → quote parameters.
    Returns path to temporary INI file.
    """
    # ── Load and parse base config with section awareness ──
    ini_content = ""
    if printer_profile_path and os.path.exists(printer_profile_path):
        with open(printer_profile_path, "r", encoding="utf-8") as f:
            ini_content = f.read()
    if not ini_content:
        try:
            ini_content = _load_system_ini()
        except Exception:
            ini_content = ""

    sections = _parse_ini_sections(ini_content)

    # ── Apply user preset overrides ──
    # System preset (is_default=True) is NOT merged — quote params override it.
    # Only user-created presets are merged; they take precedence over quote form params.
    if (
        slicer_preset
        and isinstance(slicer_preset, dict)
        and slicer_preset.get("content")
        and not slicer_preset.get("is_default")
    ):
        raw = slicer_preset["content"]
        first_byte = raw[:1] if raw else b""
        if first_byte not in (b"{", b"[") and b"=" in raw:
            _merge_preset_into_sections(sections, raw)

    # ── Apply quote parameter overrides into the print section ──
    print_section = None
    for sec_name in sections:
        if sec_name.startswith("print:"):
            print_section = sec_name
            break
    if print_section is None:
        print_section = "print:custom"
        sections[print_section] = {}

    ps = sections[print_section]

    # When a user preset is active, the preset defines slicing parameters —
    # do NOT override them with quote form defaults. Only override when
    # no preset is selected (or using system default).
    _is_user_preset = (
        slicer_preset is not None
        and isinstance(slicer_preset, dict)
        and slicer_preset.get("content")
        and not slicer_preset.get("is_default")
    )

    if not _is_user_preset:
        ps["layer_height"] = str(layer_height)
        ps["first_layer_height"] = str(round(min(layer_height * 1.75, 0.35), 2))
        ps["fill_density"] = f"{infill_percent}%"
        ps["sparse_infill_density"] = f"{infill_percent}%"
        ps["perimeters"] = str(perimeters)
        ps["wall_loops"] = str(perimeters)
        ps["top_shell_layers"] = (
            str(top_shell_layers) if top_shell_layers is not None else str(max(3, min(perimeters + 2, 10)))
        )
        ps["bottom_shell_layers"] = (
            str(bottom_shell_layers) if bottom_shell_layers is not None else str(max(3, min(perimeters + 2, 10)))
        )

    # ── Ensure fill_pattern is compatible with fill_density ──
    # PrusaSlicer rejects many patterns at 100% density.
    # Define known-compatible patterns and force "alignedrectilinear" for
    # ALL fill pattern fields when infill >= 99%.
    _FILL_100_SAFE = frozenset(
        {
            "rectilinear",
            "alignedrectilinear",
        }
    )
    if infill_percent >= 99:
        _safe_pattern = "alignedrectilinear"
        # PrusaSlicer 2.7.x checks ALL fill pattern keys at 100% density —
        # if any single key is set to an incompatible pattern, slicing fails.
        for _field in (
            "fill_pattern",
            "sparse_infill_pattern",
            "solid_fill_pattern",
            "top_fill_pattern",
            "bottom_fill_pattern",
        ):
            _cur = ps.get(_field, "grid")
            if _cur not in _FILL_100_SAFE:
                ps[_field] = _safe_pattern
                logger.info(
                    "PrusaSlicer config: override %s '%s' -> '%s' for %d%% infill",
                    _field,
                    _cur,
                    _safe_pattern,
                    infill_percent,
                )
            elif _field not in ps:
                ps[_field] = _cur
    else:
        for _field in ("fill_pattern", "sparse_infill_pattern"):
            ps.setdefault(_field, "grid")

    # ── Apply filament density and temperature into the filament section ──
    for sec_name in sections:
        if sec_name.startswith("filament:"):
            sections[sec_name]["filament_density"] = str(material_density)
            if hotend_temp is not None:
                sections[sec_name]["temperature"] = str(hotend_temp)
                sections[sec_name]["first_layer_temperature"] = str(hotend_temp)
            if bed_temp is not None:
                sections[sec_name]["bed_temperature"] = str(bed_temp)
                sections[sec_name]["first_layer_bed_temperature"] = str(bed_temp)
            break

    # ── Write temp config FLAT (no section headers, deduplicated) ──
    # CRITICAL: PrusaSlicer 2.7.x CLI --load ONLY accepts flat key=value.
    # Any [section] header causes the ENTIRE file to be ignored.
    # Additionally, duplicate key names (same key appearing twice) causes
    # PrusaSlicer to reject the entire config with:
    #   "Error while reading config file: duplicate key name"
    #
    # We merge all section contents into ONE ordered dict, writing in
    # machine → filament → print priority order (last writer wins).
    # The [preset] section (metadata only) is dropped.
    flat_config: dict[str, str] = {}
    section_order_prefix = ["machine:", "filament:", "print:"]
    for prefix in section_order_prefix:
        for sec_name, sec_settings in sections.items():
            if not sec_name.startswith(prefix):
                continue
            for key in sorted(sec_settings):
                flat_config[key] = sec_settings[key]  # later keys override earlier
    fd, path = tempfile.mkstemp(suffix=".ini", prefix="prc3d_")
    with os.fdopen(fd, "w") as f:
        f.write("; Generated by pricer3d — combined slice config (flat, deduplicated)\n")
        f.write(
            f"; layer_height={layer_height} infill={infill_percent}% perimeters={perimeters} density={material_density}\n\n"
        )
        for key in sorted(flat_config):
            f.write(f"{key} = {flat_config[key]}\n")

    total_settings = sum(len(s) for s in sections.values())
    logger.info(f"PrusaSlicer config: {len(sections)} sections, {total_settings} settings → {path}")
    return path


# ── Slice ──

_SLICE_TIMEOUT = int(os.getenv("PRUSA_SLICE_TIMEOUT", "120"))


def run_prusa_slice(
    model_path: str,
    output_gcode_path: str,
    layer_height: float = 0.2,
    infill_percent: int = 20,
    perimeters: int = 3,
    material_density: float = 1.24,
    slicer_preset: Optional[dict] = None,
    enable_supports: bool = False,
    printer_profile_path: Optional[str] = None,
    top_shell_layers: Optional[int] = None,
    bottom_shell_layers: Optional[int] = None,
    hotend_temp: Optional[int] = None,
    bed_temp: Optional[int] = None,
) -> dict:
    """
    Run PrusaSlicer headless. Merges system/user/quote config into temp INI.

    Returns dict from parse_prusa_gcode_stats() plus:
      - preset_used: str (config source description)
      - error: str (only on failure)
    """
    exe = prusa_executable()
    if not exe:
        import sys as _sys

        if _sys.platform == "win32":
            raise RuntimeError(
                "PrusaSlicer not found on Windows - install PrusaSlicer, set PRUSA_EXECUTABLE=wsl prusa-slicer, or run: wsl -d Ubuntu apt-get install prusa-slicer"
            )
        raise RuntimeError("PrusaSlicer not found - install: apt-get install prusa-slicer")

    out_dir = os.path.dirname(output_gcode_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    config_path = generate_slice_config(
        layer_height=layer_height,
        infill_percent=infill_percent,
        perimeters=perimeters,
        material_density=material_density,
        slicer_preset=slicer_preset,
        printer_profile_path=printer_profile_path,
        top_shell_layers=top_shell_layers,
        bottom_shell_layers=bottom_shell_layers,
        hotend_temp=hotend_temp,
        bed_temp=bed_temp,
    )

    preset_label = "系统默认"
    if printer_profile_path:
        base = os.path.basename(printer_profile_path)
        preset_label = f"{os.path.splitext(base)[0]} 系统默认"
    if slicer_preset and slicer_preset.get("name"):
        preset_label = str(slicer_preset["name"])

    # ── Detect WSL passthrough and translate paths ──
    cmd_parts = shlex.split(exe)
    _is_wsl = cmd_parts and cmd_parts[0] in ("wsl", "wsl.exe")

    def _wsl_path(p: str) -> str:
        """Translate a Windows path to a WSL path (/mnt/c/...)."""
        if not _is_wsl:
            return p
        import sys as _sys

        if _sys.platform == "win32":
            # Resolve relative paths against the project root
            p = os.path.abspath(p)
            # Convert D:\... to /mnt/d/...
            p = p.replace("\\", "/")
            if len(p) >= 2 and p[1] == ":":
                drive = p[0].lower()
                return f"/mnt/{drive}{p[2:]}"
        return p

    cmd = cmd_parts + [
        "--ignore-nonexistent-config",
        "--load",
        _wsl_path(config_path),
    ]
    # WSL prusa-slicer (2.8.x) does not support --headless
    if not _is_wsl:
        cmd.append("--headless")
    cmd.extend(
        [
            "--export-gcode",
            "--output",
            _wsl_path(output_gcode_path),
        ]
    )
    if enable_supports:
        cmd.append("--support-material")
        cmd.append("--support-material-style=organic")
    cmd.append(_wsl_path(model_path))

    logger.info(
        f"PrusaSlicer: preset={preset_label} model={os.path.basename(model_path)} profile={printer_profile_path or 'none'}"
    )
    logger.debug(f"PrusaSlicer command: {' '.join(cmd)}")

    try:
        # WSL stderr may contain UTF-16LE proxy warnings mixed with
        # UTF-8 program output → read as bytes, decode robustly
        proc = subprocess.run(cmd, capture_output=True, text=False, timeout=_SLICE_TIMEOUT)

        def _safe_decode(data: bytes) -> str:
            if not data:
                return ""
            try:
                return data.decode("utf-8")
            except UnicodeDecodeError:
                # Strip null bytes (from WSL UTF-16LE proxy warnings)
                # then decode remaining ASCII/UTF-8 content
                return data.replace(b"\x00", b"").decode("utf-8", errors="replace").strip()

        stdout = _safe_decode(proc.stdout).strip()
        stderr = _safe_decode(proc.stderr).strip()

        if proc.returncode != 0 and not os.path.exists(output_gcode_path):
            # Check WSL path variant if using WSL
            if _is_wsl and not os.path.exists(output_gcode_path):
                _wsl_alt = _wsl_path(output_gcode_path)
                if os.path.exists(_wsl_alt):
                    output_gcode_path = _wsl_alt
            if not os.path.exists(output_gcode_path):
                error_msg = stderr or stdout or f"exit code {proc.returncode}"
                raise RuntimeError(f"PrusaSlicer failed: {error_msg[:400]}")

        if stderr:
            logger.debug(f"PrusaSlicer stderr: {stderr[:200]}")

        stats = parse_prusa_gcode_stats(output_gcode_path)
        stats["preset_used"] = preset_label
        logger.info(f"PrusaSlicer result: cm³={stats['filament_cm3']} g={stats['filament_g']} time={stats['time_str']}")
        return stats

    except subprocess.TimeoutExpired:
        raise RuntimeError(f"PrusaSlicer timed out ({_SLICE_TIMEOUT}s)")
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"PrusaSlicer error: {e}")
    finally:
        # Cleanup temp config
        try:
            if os.path.exists(config_path):
                os.unlink(config_path)
        except OSError:
            pass


def prusa_support_diff_stats(
    model_path: str,
    layer_height: float = 0.2,
    infill_percent: int = 20,
    perimeters: int = 3,
    output_dir: Optional[str] = None,
    output_prefix: Optional[str] = None,
    printer_profile_path: Optional[str] = None,
) -> dict:
    """Slice with & without supports; return support material diff + time."""
    result: dict = {
        "support_g": 0.0,
        "estimated_time_s": None,
        "filament_g": None,
        "no_support_time_s": None,
        "no_support_filament_g": None,
    }
    if not os.path.exists(model_path):
        return result

    out_dir = output_dir or tempfile.mkdtemp()
    prefix = output_prefix or "prusa_support"

    def _slice_and_get_stats(supports: bool) -> tuple[float, int]:
        """Slice once and return (filament_g, time_s)."""
        gcode = os.path.join(out_dir, f"{prefix}_{'with' if supports else 'no'}_support.gcode")
        stats = run_prusa_slice(
            model_path,
            gcode,
            layer_height=layer_height,
            infill_percent=infill_percent,
            perimeters=perimeters,
            enable_supports=supports,
            printer_profile_path=printer_profile_path,
        )
        g = float(stats.get("filament_g") or 0)
        if g <= 0 and float(stats.get("filament_cm3") or 0) > 0:
            g = float(stats["filament_cm3"]) * 1.24
        time_s = int(stats.get("time_s") or 0)
        return g, time_s

    try:
        no_sup_g, no_sup_time = _slice_and_get_stats(False)
        with_sup_g, with_sup_time = _slice_and_get_stats(True)
        result["no_support_filament_g"] = no_sup_g
        result["no_support_time_s"] = no_sup_time if no_sup_time > 0 else None
        result["filament_g"] = with_sup_g
        result["estimated_time_s"] = with_sup_time if with_sup_time > 0 else None
        result["support_g"] = round(max(0.0, with_sup_g - no_sup_g), 3)
    except Exception as e:
        logger.error(f"PrusaSlicer support diff failed: {e}")

    return result


# ── Config generation for user presets ──


def generate_prusa_config(
    layer_height: float = 0.2,
    infill_percent: int = 20,
    perimeters: int = 3,
    top_shell_layers: int = 5,
    bottom_shell_layers: int = 5,
    brim_width: int = 0,
    nozzle_diameter: float = 0.4,
    filament_diameter: float = 1.75,
    filament_density: float = 1.24,
    filament_type: str = "PLA",
    bed_size_x: int = 256,
    bed_size_y: int = 256,
    max_print_height: int = 256,
    printer_profile_path: Optional[str] = None,
) -> str:
    """Generate a downloadable PrusaSlicer config for a given preset snapshot.

    Unlike generate_slice_config() which writes a temp file for CLI use,
    this function returns a path to a temp file containing the .ini content
    the caller can read / serve / persist.
    """
    # Load base config from printer profile or system default
    ini_content = ""
    if printer_profile_path and os.path.exists(printer_profile_path):
        with open(printer_profile_path, "r", encoding="utf-8") as f:
            ini_content = f.read()
    if not ini_content:
        try:
            ini_content = _load_system_ini()
        except Exception:
            ini_content = ""

    sections = _parse_ini_sections(ini_content)

    # Find or create print section
    print_sec = None
    for sn in sections:
        if sn.startswith("print:"):
            print_sec = sn
            break
    if print_sec is None:
        print_sec = "print:custom"
        sections[print_sec] = {}

    ps = sections[print_sec]
    ps["layer_height"] = str(layer_height)
    ps["first_layer_height"] = str(round(min(layer_height * 1.75, 0.35), 2))
    ps["fill_density"] = f"{infill_percent}%"
    ps["sparse_infill_density"] = f"{infill_percent}%"
    ps["perimeters"] = str(perimeters)
    ps["wall_loops"] = str(perimeters)
    ps["top_shell_layers"] = str(top_shell_layers)
    ps["bottom_shell_layers"] = str(bottom_shell_layers)
    ps["brim_width"] = str(brim_width)

    # Ensure fill_pattern compatibility with 100% infill
    _FILL_100_SAFE = frozenset(
        {
            "rectilinear",
            "alignedrectilinear",
        }
    )
    if infill_percent >= 99:
        _safe_pattern = "alignedrectilinear"
        for _field in (
            "fill_pattern",
            "sparse_infill_pattern",
            "solid_fill_pattern",
            "top_fill_pattern",
            "bottom_fill_pattern",
        ):
            _cur = ps.get(_field, "grid")
            if _cur not in _FILL_100_SAFE:
                ps[_field] = _safe_pattern
            elif _field not in ps:
                ps[_field] = _cur
    else:
        ps.setdefault("fill_pattern", "grid")
        ps.setdefault("sparse_infill_pattern", ps.get("fill_pattern", "grid"))

    # Filament section
    fil_sec = None
    for sn in sections:
        if sn.startswith("filament:"):
            fil_sec = sn
            break
    if fil_sec is None:
        fil_sec = "filament:custom"
        sections[fil_sec] = {}

    fs = sections[fil_sec]
    fs["filament_diameter"] = str(filament_diameter)
    fs["filament_density"] = str(filament_density)
    fs["filament_type"] = filament_type

    # Machine section
    mac_sec = None
    for sn in sections:
        if sn.startswith("machine:"):
            mac_sec = sn
            break
    if mac_sec is None:
        mac_sec = "machine:custom"
        sections[mac_sec] = {}

    ms = sections[mac_sec]
    ms["nozzle_diameter"] = str(nozzle_diameter)
    ms["bed_size"] = f"{bed_size_x},{bed_size_y}"
    ms["max_print_height"] = str(max_print_height)

    body = _write_ini_sections(sections)
    fd, path = tempfile.mkstemp(suffix=".ini", prefix="prc3d_preset_")
    with os.fdopen(fd, "w") as f:
        f.write(body)
    return path
