# Printer Lifecycle G-code

Research date: 2026-08-05

## Scope

Pricer3D uses PrusaSlicer to estimate time and material. Printer profiles now define four native PrusaSlicer lifecycle hooks:

| Phase | PrusaSlicer key | When it runs |
| --- | --- | --- |
| Before printing | `start_gcode` | Once, before the first toolpath |
| During printing | `before_layer_gcode` | Before each layer change |
| During printing | `layer_gcode` | After each layer change |
| After printing | `end_gcode` | Once, after the final toolpath |

The supported firmware flavors exposed by custom printer presets are `marlin`, `marlin2`, `klipper`, and `reprapfirmware`.

The custom-printer editor loads these canonical defaults from `/api/printer/gcode-defaults`; the HTML does not contain a second copy.

## Default start sequence

```gcode
G90
M82
M140 S[first_layer_bed_temperature]
M104 S[first_layer_temperature]
G28
M190 S[first_layer_bed_temperature]
M109 S[first_layer_temperature]
G92 E0
```

Rationale:

- `G90` and `M82` make coordinate modes explicit and match PrusaSlicer's default absolute-extrusion output.
- `M140` and `M104` begin heating without blocking, allowing homing to happen while the machine warms.
- `M190` and `M109` wait for the requested bed and nozzle temperatures before extrusion starts.
- `G28` is universal homing. The default intentionally omits `G29`, because probing behavior and mesh commands are printer-specific.
- The template intentionally omits purge-line coordinates. A universal purge move can collide with clips, excluded bed areas, tool changers, or unusual kinematics.

## During-print hooks

The default pre-layer hook updates the printer display and emits layer metadata:

```gcode
;BEFORE_LAYER_CHANGE
M117 Layer [layer_num] Z[layer_z] ; update printer display
; layer=[layer_num] z=[layer_z]
```

```gcode
;AFTER_LAYER_CHANGE
; layer=[layer_num] z=[layer_z]
```

`M117` is a broadly supported Marlin/Klipper display-message command, so the default provides visible per-layer progress without changing motion, extrusion, pressure advance, or fan state. The after-layer hook remains metadata-only. Users may replace either hook with firmware-specific macros when needed.

## Default end sequence

```gcode
M400
M107
M104 S0
M140 S0
M84
```

Rationale:

- `M400` drains buffered motion before shutdown commands.
- `M107`, `M104 S0`, and `M140 S0` stop cooling and heating outputs.
- `M84` releases the stepper motors.
- The default intentionally does not retract, lift Z, or park X/Y. Those moves depend on extrusion mode, remaining Z travel, bed origin, and machine geometry.

## Klipper note

`START_PRINT` and `END_PRINT` are conventional user-defined Klipper macros, not guaranteed built-in commands. Pricer3D therefore does not insert them automatically. A user whose `printer.cfg` defines those macros can select the Klipper flavor and replace the lifecycle fields, for example:

```gcode
START_PRINT BED_TEMP=[first_layer_bed_temperature] EXTRUDER_TEMP=[first_layer_temperature]
```

```gcode
END_PRINT
```

Klipper evaluates an entire macro template before executing its generated commands, so state-changing macro designs should follow Klipper's documented `SAVE_GCODE_STATE` / `RESTORE_GCODE_STATE` practices.

## Vendor-specific profiles

Bambu Lab calibration, nozzle wiping, build-plate detection, AMS handling, timelapse, and proprietary `M1002`/`M620`-style commands are model- and firmware-specific. Prusa MK4 probing and purge behavior is also maintained in official Prusa profiles. Pricer3D's defaults are injected centrally when a profile does not define lifecycle hooks; they are not copied into vendor profile files or represented as official vendor sequences. They are a conservative fallback for quoting and generic output. Production G-code should use the exact vendor profile when machine-specific procedures are required.

## Primary sources

- [PrusaSlicer placeholder reference](https://help.prusa3d.com/article/list-of-placeholders_205643)
- [PrusaSlicer lifecycle option definitions](https://github.com/prusa3d/PrusaSlicer/blob/master/src/libslic3r/PrintConfig.cpp)
- [PrusaSlicer custom G-code processing](https://github.com/prusa3d/PrusaSlicer/blob/master/src/libslic3r/GCode.cpp)
- [Marlin G28: Auto Home](https://marlinfw.org/docs/gcode/G028.html)
- [Marlin M104: Set Hotend Temperature](https://marlinfw.org/docs/gcode/M104.html)
- [Marlin M109: Wait for Hotend Temperature](https://marlinfw.org/docs/gcode/M109.html)
- [Marlin M140: Set Bed Temperature](https://marlinfw.org/docs/gcode/M140.html)
- [Marlin M190: Wait for Bed Temperature](https://marlinfw.org/docs/gcode/M190.html)
- [Marlin M117: Set LCD Message](https://marlinfw.org/docs/gcode/M117.html)
- [Marlin M400: Finish Moves](https://marlinfw.org/docs/gcode/M400.html)
- [Marlin M84: Disable Steppers](https://marlinfw.org/docs/gcode/M018.html)
- [Klipper command templates](https://www.klipper3d.org/Command_Templates.html)
- [OrcaSlicer generic Marlin profile](https://github.com/OrcaSlicer/OrcaSlicer/blob/main/resources/profiles/Custom/machine/MyMarlin%200.4%20nozzle.json)
- [OrcaSlicer generic Klipper profile](https://github.com/OrcaSlicer/OrcaSlicer/blob/main/resources/profiles/Custom/machine/fdm_klipper_common.json)
