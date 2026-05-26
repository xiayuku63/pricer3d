"""Built-in printer models for slicer configuration."""

PRINTER_MODELS = [
    {
        "id": "voron_v2_250",
        "name": "Voron V2 (250mm)",
        "bed_width": 250, "bed_depth": 250, "bed_height": 250,
        "nozzle": 0.4, "icon": "🖨️",
        "profile": "profiles/prusa/printers/voron_v2_250.ini",
    },
    {
        "id": "prusa_mk4",
        "name": "Prusa MK4",
        "bed_width": 250, "bed_depth": 210, "bed_height": 220,
        "nozzle": 0.4, "icon": "🖨️",
        "profile": "profiles/prusa/printers/prusa_mk4.ini",
    },
    {
        "id": "bambu_a1",
        "name": "Bambu Lab A1",
        "bed_width": 256, "bed_depth": 256, "bed_height": 256,
        "nozzle": 0.4, "icon": "🖨️",
        "profile": "profiles/prusa/printers/bambu_a1.ini",
    },
]
