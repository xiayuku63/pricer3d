"""Built-in printer models for slicer configuration.

Each model defines available nozzle diameters. The actual printer identity for
slicing is the combination of model + nozzle (e.g. bambu_a1 + 0.4 → bambu_a1_04).
"""

PRINTER_MODELS = [
    # ── Bambu Lab A1 Mini (180×180×180mm cantilever) ──
    {
        "id": "bambu_a1_mini",
        "name": "Bambu Lab A1 Mini",
        "bed_width": 180,
        "bed_depth": 180,
        "bed_height": 180,
        "nozzle": 0.4,
        "nozzles": [0.2, 0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_a1_mini.ini",
    },
    # ── Bambu Lab A1 (256×256×256mm cantilever) ──
    {
        "id": "bambu_a1",
        "name": "Bambu Lab A1",
        "bed_width": 256,
        "bed_depth": 256,
        "bed_height": 256,
        "nozzle": 0.4,
        "nozzles": [0.2, 0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_a1.ini",
    },
    # ── Bambu Lab P1P (256×256×256mm CoreXY open frame) ──
    {
        "id": "bambu_p1p",
        "name": "Bambu Lab P1P",
        "bed_width": 256,
        "bed_depth": 256,
        "bed_height": 256,
        "nozzle": 0.4,
        "nozzles": [0.2, 0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_p1p.ini",
    },
    # ── Bambu Lab P1S (256×256×256mm CoreXY enclosed) ──
    {
        "id": "bambu_p1s",
        "name": "Bambu Lab P1S",
        "bed_width": 256,
        "bed_depth": 256,
        "bed_height": 256,
        "nozzle": 0.4,
        "nozzles": [0.2, 0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_p1s.ini",
    },
    # ── Bambu Lab X1 Carbon (256×256×256mm CoreXY enclosed high-temp) ──
    {
        "id": "bambu_x1c",
        "name": "Bambu Lab X1C",
        "bed_width": 256,
        "bed_depth": 256,
        "bed_height": 256,
        "nozzle": 0.4,
        "nozzles": [0.2, 0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_x1c.ini",
    },
    # ── Bambu Lab X1E (256×256×256mm CoreXY enclosed enterprise) ──
    {
        "id": "bambu_x1e",
        "name": "Bambu Lab X1E",
        "bed_width": 256,
        "bed_depth": 256,
        "bed_height": 256,
        "nozzle": 0.4,
        "nozzles": [0.2, 0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_x1e.ini",
    },
    # ── Bambu Lab P2S (256×256×256mm CoreXY enclosed 2nd-Gen) ──
    {
        "id": "bambu_p2s",
        "name": "Bambu Lab P2S",
        "bed_width": 256,
        "bed_depth": 256,
        "bed_height": 256,
        "nozzle": 0.4,
        "nozzles": [0.2, 0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_p1s.ini",
    },
    # ── Bambu Lab H2D (350×320×325mm CoreXY dual-nozzle enclosed) ──
    {
        "id": "bambu_h2d",
        "name": "Bambu Lab H2D",
        "bed_width": 350,
        "bed_depth": 320,
        "bed_height": 325,
        "nozzle": 0.4,
        "nozzles": [0.2, 0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_x1c.ini",
    },
    # ── Bambu Lab H2D Pro (350×320×325mm CoreXY dual-nozzle enclosed) ──
    {
        "id": "bambu_h2d_pro",
        "name": "Bambu Lab H2D Pro",
        "bed_width": 350,
        "bed_depth": 320,
        "bed_height": 325,
        "nozzle": 0.4,
        "nozzles": [0.2, 0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_x1c.ini",
    },
    # ── Bambu Lab X2D (256×256×260mm CoreXY dual-nozzle enclosed) ──
    {
        "id": "bambu_x2d",
        "name": "Bambu Lab X2D",
        "bed_width": 256,
        "bed_depth": 256,
        "bed_height": 260,
        "nozzle": 0.4,
        "nozzles": [0.2, 0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_x1c.ini",
    },
    # ── Creality K1 (220×220×250mm CoreXY enclosed) ──
    {
        "id": "creality_k1",
        "name": "Creality K1",
        "bed_width": 220,
        "bed_depth": 220,
        "bed_height": 250,
        "nozzle": 0.4,
        "nozzles": [0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_a1.ini",
    },
    # ── Creality K1C (220×220×250mm CoreXY enclosed, all-metal hotend) ──
    {
        "id": "creality_k1c",
        "name": "Creality K1C",
        "bed_width": 220,
        "bed_depth": 220,
        "bed_height": 250,
        "nozzle": 0.4,
        "nozzles": [0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_a1.ini",
    },
    # ── Creality K1 Max (300×300×300mm CoreXY enclosed) ──
    {
        "id": "creality_k1_max",
        "name": "Creality K1 Max",
        "bed_width": 300,
        "bed_depth": 300,
        "bed_height": 300,
        "nozzle": 0.4,
        "nozzles": [0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_a1.ini",
    },
    # ── Creality K1 SE (220×220×250mm CoreXY enclosed, budget) ──
    {
        "id": "creality_k1_se",
        "name": "Creality K1 SE",
        "bed_width": 220,
        "bed_depth": 220,
        "bed_height": 250,
        "nozzle": 0.4,
        "nozzles": [0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_a1.ini",
    },
    # ── Creality K2 Plus (350×350×350mm CoreXY enclosed, CFS multi-color) ──
    {
        "id": "creality_k2_plus",
        "name": "Creality K2 Plus",
        "bed_width": 350,
        "bed_depth": 350,
        "bed_height": 350,
        "nozzle": 0.4,
        "nozzles": [0.4, 0.6, 0.8],
        "icon": "3D",
        "profile": "profiles/prusa/printers/bambu_a1.ini",
    },
    # ── Voron V2 (250×250×250mm CoreXY) ──
    {
        "id": "voron_v2_250",
        "name": "Voron V2",
        "bed_width": 250,
        "bed_depth": 250,
        "bed_height": 250,
        "nozzle": 0.4,
        "nozzles": [0.4],
        "icon": "3D",
        "profile": "profiles/prusa/printers/voron_v2_250.ini",
    },
    # ── Prusa MK4 (250×210×220mm) ──
    {
        "id": "prusa_mk4",
        "name": "Prusa MK4",
        "bed_width": 250,
        "bed_depth": 210,
        "bed_height": 220,
        "nozzle": 0.4,
        "nozzles": [0.4],
        "icon": "3D",
        "profile": "profiles/prusa/printers/prusa_mk4.ini",
    },
]


def resolve_printer(printer_id: str, nozzle: float | None = None) -> dict | None:
    """Resolve a printer model by its compound id (e.g. 'bambu_a1_04') or by model+nozzle pair.

    Handles both built-in (bambu_a1_04) and user presets (user_3_04).
    """
    # ── User presets: "user_3_04" or "user_3" ──
    if printer_id.startswith("user_"):
        return _resolve_user_printer(printer_id, nozzle)

    # ── Built-in models ──
    for pm in PRINTER_MODELS:
        for n in pm["nozzles"]:
            nid = _nozzle_suffix(n)
            if printer_id == f"{pm['id']}_{nid}":
                return {**pm, "_nozzle": n, "_compound_id": printer_id}
            if printer_id == pm["id"]:
                nz = nozzle if nozzle is not None else pm["nozzle"]
                if nz in pm["nozzles"]:
                    nid = _nozzle_suffix(nz)
                    return {**pm, "_nozzle": nz, "_compound_id": f"{pm['id']}_{nid}"}
                return {**pm, "_nozzle": pm["nozzle"], "_compound_id": f"{pm['id']}_{_nozzle_suffix(pm['nozzle'])}"}
    return None


def _resolve_user_printer(printer_id: str, nozzle: float | None = None) -> dict | None:
    """Resolve user printer preset by compound id like 'user_3_04'."""
    import re
    from .printer_presets import get_printer_preset_by_id

    # Parse: user_{preset_id} or user_{preset_id}_{nozzle_suffix}
    m = re.match(r"^user_(\d+)(?:_(\d+))?$", printer_id)
    if not m:
        return None
    preset_id = int(m.group(1))
    nozzle_suffix = m.group(2)
    preset = get_printer_preset_by_id(0, preset_id)  # user_id=0 means no auth check (we just need the preset)
    if not preset:
        return None
    nz = float(nozzle_suffix) / 10.0 if nozzle_suffix else (nozzle if nozzle is not None else preset["nozzle"])
    # Generate temp profile file
    import tempfile
    import os

    fd, path = tempfile.mkstemp(suffix=".ini", prefix="prc3d_user_printer_")
    with os.fdopen(fd, "w") as f:
        f.write(
            preset["profile"].decode("utf-8", errors="replace")
            if isinstance(preset["profile"], bytes)
            else str(preset["profile"])
        )
    return {
        "id": f"user_{preset['id']}",
        "name": preset["name"],
        "bed_width": preset["bed_width"],
        "bed_depth": preset["bed_depth"],
        "bed_height": preset["bed_height"],
        "nozzle": nz,
        "nozzles": preset["nozzles"],
        "icon": "3D",
        "profile": path,  # temp file path
        "_nozzle": nz,
        "_compound_id": printer_id,
    }


def _nozzle_suffix(nozzle: float) -> str:
    """0.4 → '04', 0.2 → '02', 0.6 → '06', 0.8 → '08'"""
    return str(nozzle).replace(".", "").replace("0", "0", 1).lstrip("0").rjust(2, "0")
