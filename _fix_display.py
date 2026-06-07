# -*- coding: utf-8 -*-
"""Fix slice params display: compact layout, remove duplicates, fix row separation."""

with open('static/js/modules/quote-render.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

changes = 0

# === 1. Rewrite _buildSliceParamsHtml with compact inline layout ===
for i, line in enumerate(lines):
    if '// Helper: build slicing params summary HTML' in line:
        # Find the end of the function (closing })
        start = i
        for j in range(i + 1, len(lines)):
            if lines[j].strip() == '}' and j > i + 5:
                end = j
                break
        # Replace the entire function
        new_func = [
            '// Helper: build slicing params summary HTML (compact inline)\n',
            'function _buildSliceParamsHtml(item) {\n',
            '    const bd = item.cost_breakdown;\n',
            '    const gcode = bd && bd.gcode_summary;\n',
            '    const cp = gcode && gcode.core_params;\n',
            '    const slicerUsed = bd && bd.prusaslicer_used;\n',
            '    const slicerTime = bd && bd.slicer_estimated_time_s;\n',
            '    const presetName = bd && bd.slicer_preset_used;\n',
            '    const fmtTime = (s) => { if (!s||s<=0) return null; const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.round(s%60); return h>0?h+"\u65f6"+m+"\u5206"+sec+"\u79d2":m>0?m+"\u5206"+sec+"\u79d2":sec+"\u79d2"; };\n',
            '    const items = [];\n',
            '    if (item.layer_height) items.push("\u5c42\u9ad8 " + item.layer_height + "mm");\n',
            '    if (item.infill != null) items.push("\u586b\u5145 " + item.infill + "%");\n',
            '    if (cp) {\n',
            '        if (cp.perimeters) items.push("\u58c1\u5c42 " + cp.perimeters);\n',
            '        if (cp.nozzle_diameter) items.push("\u55b7\u5634 " + cp.nozzle_diameter + "mm");\n',
            '        if (cp.first_layer_height) items.push("\u9996\u5c42 " + cp.first_layer_height + "mm");\n',
            '        if (cp.support_material) items.push("\u652f\u6491 " + (cp.support_material==="1"?"\u5f00":"\u5173"));\n',
            '        if (gcode.layer_count) items.push("\u603b\u5c42\u6570 " + gcode.layer_count);\n',
            '    }\n',
            '    if (slicerUsed) { items.push("PrusaSlicer"); const st=fmtTime(slicerTime); if(st) items.push("\u5207\u7247\u65f6\u95f4 "+st); }\n',
            '    if (presetName) items.push("\u9884\u8bbe: " + presetName);\n',
            '    if (items.length === 0) return "";\n',
            '    return \'<div class="flex flex-wrap items-center gap-1.5 text-[10px] text-gray-600 mb-1"><span class="font-medium text-indigo-600">\u5207\u7247\u53c2\u6570:</span>\' + items.map(t=>\'<span class="inline-flex items-center px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded">\'+t+\'</span>\').join("") + \'</div>\';\n',
            '}\n',
        ]
        lines[start:end+1] = new_func
        changes += 1
        print(f"  Rewrote _buildSliceParamsHtml at lines {start+1}-{end+1}")
        break

# === 2. Remove duplicate "当前切片参数" from _buildPrintSuggestionHtml ===
for i, line in enumerate(lines):
    if "// Show actual slicing params if available" in line and i < 620:
        # Find the end of this block (the closing } before "// Printing tips card")
        for j in range(i, i + 25):
            if '// Printing tips card' in lines[j]:
                # Remove lines i..j-1
                for k in range(i, j):
                    lines[k] = ''
                changes += 1
                print(f"  Removed duplicate slice params from print suggestion at lines {i+1}-{j}")
                break
        break

# === 3. Fix row separation CSS ===
# Read the CSS file and add separator between success/failed rows
with open('static/css/table-enhancements.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Add clear visual separator for all data rows
separator_css = """
/* Row separator between all data rows */
#batch-results-body tr[data-row-file] {
    border-bottom: 1px solid #e5e7eb;
}
#batch-results-body tr[data-row-file].table-row-failed {
    border-left: 3px solid #ef4444 !important;
    background-color: #fef2f2;
}
#batch-results-body tr[data-row-file].table-row-failed td:first-child::before {
    background: #ef4444;
}
"""

if 'tr[data-row-file].table-row-failed' not in css:
    css += separator_css
    with open('static/css/table-enhancements.css', 'w', encoding='utf-8') as f:
        f.write(css)
    changes += 1
    print("  Added row separator CSS")

with open('static/js/modules/quote-render.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)
print(f"Total changes: {changes}")
