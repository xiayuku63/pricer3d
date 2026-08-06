"""Printer lifecycle G-code defaults and INI serialization helpers.

The defaults deliberately use only broadly supported Marlin-style commands.
Vendor-specific calibration, probing, purge, AMS/MMU, and parking sequences must
be supplied by a printer's official profile or by the user.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Final

GCODE_FIELD_MAX_LEN: Final = 20_000


class GcodeFlavor(str, Enum):
    """Firmware dialects exposed by Pricer3D custom printer presets."""

    MARLIN = "marlin"
    MARLIN2 = "marlin2"
    KLIPPER = "klipper"
    REPRAP_FIRMWARE = "reprapfirmware"


SUPPORTED_GCODE_FLAVORS: Final = frozenset(flavor.value for flavor in GcodeFlavor)

DEFAULT_START_GCODE: Final = """; Pricer3D generic start G-code
G90 ; absolute XYZ coordinates
M82 ; absolute extrusion coordinates
M140 S[first_layer_bed_temperature] ; start heating bed without waiting
M104 S[first_layer_temperature] ; start heating nozzle without waiting
G28 ; home all axes
M190 S[first_layer_bed_temperature] ; wait for bed temperature
M109 S[first_layer_temperature] ; wait for nozzle temperature
G92 E0 ; reset extruder position"""

DEFAULT_BEFORE_LAYER_GCODE: Final = """;BEFORE_LAYER_CHANGE
M117 Layer [layer_num] Z[layer_z] ; update printer display
; layer=[layer_num] z=[layer_z]"""

DEFAULT_LAYER_GCODE: Final = """;AFTER_LAYER_CHANGE
; layer=[layer_num] z=[layer_z]"""

DEFAULT_END_GCODE: Final = """; Pricer3D generic end G-code
M400 ; finish buffered moves
M107 ; turn off part cooling fan
M104 S0 ; turn off nozzle heater
M140 S0 ; turn off bed heater
M84 ; disable stepper motors"""

LIFECYCLE_KEYS: Final = (
    "start_gcode",
    "before_layer_gcode",
    "layer_gcode",
    "end_gcode",
)


def normalize_gcode_flavor(value: str | GcodeFlavor | None) -> GcodeFlavor:
    """Return a supported PrusaSlicer firmware flavor."""
    if isinstance(value, GcodeFlavor):
        return value
    flavor = str(value or GcodeFlavor.MARLIN2.value).strip().lower()
    try:
        return GcodeFlavor(flavor)
    except ValueError as exc:
        allowed = ", ".join(sorted(SUPPORTED_GCODE_FLAVORS))
        raise ValueError(f"Unsupported G-code flavor '{flavor}'. Allowed: {allowed}") from exc


def normalize_lifecycle_gcode(value: str | None, *, default: str) -> str:
    """Normalize user G-code while preserving intentional blank values."""
    text = default if value is None else str(value)
    if "\x00" in text:
        raise ValueError("G-code must not contain NUL bytes")
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    if len(text) > GCODE_FIELD_MAX_LEN:
        raise ValueError(f"G-code exceeds the {GCODE_FIELD_MAX_LEN} character limit")
    return text


def encode_ini_gcode(value: str) -> str:
    """Encode multiline G-code as PrusaSlicer's one-line INI representation."""
    normalized = normalize_lifecycle_gcode(value, default="")
    return normalized.replace("\n", "\\n")


def decode_ini_gcode(value: str | None) -> str:
    """Decode PrusaSlicer's escaped-newline INI representation for editing."""
    if value is None:
        return ""
    return str(value).replace("\\r\\n", "\n").replace("\\r", "\n").replace("\\n", "\n")


@dataclass(frozen=True)
class PrinterLifecycleGcode:
    """Validated lifecycle hooks for one printer preset."""

    gcode_flavor: GcodeFlavor
    start_gcode: str
    before_layer_gcode: str
    layer_gcode: str
    end_gcode: str

    @classmethod
    def build(
        cls,
        *,
        gcode_flavor: str | GcodeFlavor | None = GcodeFlavor.MARLIN2,
        start_gcode: str | None = None,
        before_layer_gcode: str | None = None,
        layer_gcode: str | None = None,
        end_gcode: str | None = None,
    ) -> "PrinterLifecycleGcode":
        return cls(
            gcode_flavor=normalize_gcode_flavor(gcode_flavor),
            start_gcode=normalize_lifecycle_gcode(start_gcode, default=DEFAULT_START_GCODE),
            before_layer_gcode=normalize_lifecycle_gcode(
                before_layer_gcode,
                default=DEFAULT_BEFORE_LAYER_GCODE,
            ),
            layer_gcode=normalize_lifecycle_gcode(layer_gcode, default=DEFAULT_LAYER_GCODE),
            end_gcode=normalize_lifecycle_gcode(end_gcode, default=DEFAULT_END_GCODE),
        )

    def as_dict(self) -> dict[str, str]:
        return {
            "gcode_flavor": self.gcode_flavor.value,
            "start_gcode": self.start_gcode,
            "before_layer_gcode": self.before_layer_gcode,
            "layer_gcode": self.layer_gcode,
            "end_gcode": self.end_gcode,
        }

    def as_ini_settings(self) -> dict[str, str]:
        values = self.as_dict()
        return {
            "gcode_flavor": values["gcode_flavor"],
            **{key: encode_ini_gcode(values[key]) for key in LIFECYCLE_KEYS},
        }


def lifecycle_settings(
    *,
    gcode_flavor: str | GcodeFlavor | None = GcodeFlavor.MARLIN2,
    start_gcode: str | None = None,
    before_layer_gcode: str | None = None,
    layer_gcode: str | None = None,
    end_gcode: str | None = None,
) -> dict[str, str]:
    """Build validated INI-ready lifecycle settings."""
    return PrinterLifecycleGcode.build(
        gcode_flavor=gcode_flavor,
        start_gcode=start_gcode,
        before_layer_gcode=before_layer_gcode,
        layer_gcode=layer_gcode,
        end_gcode=end_gcode,
    ).as_ini_settings()


def default_lifecycle_values() -> dict[str, str]:
    """Return editable, multiline defaults for the printer preset UI."""
    return PrinterLifecycleGcode.build().as_dict()


def extract_lifecycle_from_profile(content: str | bytes) -> dict[str, str]:
    """Extract editable lifecycle fields from a flat or sectioned INI profile."""
    if isinstance(content, bytes):
        text = content.decode("utf-8", errors="replace")
    else:
        text = str(content)

    raw_settings: dict[str, str] = {}
    wanted = {"gcode_flavor", *LIFECYCLE_KEYS}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith((";", "#", "[")) or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key in wanted:
            raw_settings[key] = value.strip()

    return {
        "gcode_flavor": raw_settings.get("gcode_flavor", GcodeFlavor.MARLIN2.value),
        "start_gcode": decode_ini_gcode(raw_settings.get("start_gcode")),
        "before_layer_gcode": decode_ini_gcode(raw_settings.get("before_layer_gcode")),
        "layer_gcode": decode_ini_gcode(raw_settings.get("layer_gcode")),
        "end_gcode": decode_ini_gcode(raw_settings.get("end_gcode")),
    }
