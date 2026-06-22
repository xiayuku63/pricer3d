#!/usr/bin/env python3
# Apply the 3 targeted edits to main.js (Issue 1 + Issue 2 color dropdown rewrite).
import io, sys

P = r'D:/Projects/pricer3d/static/js/main.js'
with io.open(P, 'r', encoding='utf-8') as f:
    s = f.read()

A_OLD = """    // ── Global: color dropdown close on outside click + toggle + item selection ──
    document.addEventListener('click', (e) => {
        // Close all color dropdowns on outside click
        if (!e.target.closest('.color-dd-wrapper')) {
            document.querySelectorAll('.color-dd-list:not(.hidden)').forEach(l => l.classList.add('hidden'));
        }"""

A_NEW = """    // ── Color dropdown helpers ──
    // The results table lives inside an .overflow-x-auto wrapper whose computed
    // overflow-y becomes `auto` (when one axis is non-visible the visible one
    // computes to auto), which clips the absolutely-positioned color popup. We
    // switch it to position:fixed for dropdowns trapped in the table / cards /
    // batch toolbar; the options-modal dropdown stays absolute.
    function _resetColorList(list) {
        list.style.position = '';
        list.style.left = '';
        list.style.right = '';
        list.style.top = '';
        list.style.bottom = '';
        list.style.marginTop = '';
        list.style.minWidth = '';
    }
    function _closeColorList(list) {
        _resetColorList(list);
        list.classList.add('hidden');
    }
    function _closeAllColorLists(e) {
        // Don't close when scrolling *inside* a color list (its own overflow-y scroll)
        if (e && e.target && e.target.closest && e.target.closest('.color-dd-list')) return;
        document.querySelectorAll('.color-dd-list:not(.hidden)').forEach(function(l) { _closeColorList(l); });
    }
    function _positionColorList(trigger, list, wrapper) {
        if (!wrapper.closest('#batch-results-body, #batch-results-cards, #batch-color-cell')) return;
        var rect = trigger.getBoundingClientRect();
        if (!rect.width) return;
        var spaceBelow = window.innerHeight - rect.bottom;
        var spaceAbove = rect.top;
        var contentH = list.scrollHeight || 360;
        var maxH = Math.min(360, contentH);
        var placeBelow = spaceBelow >= maxH || spaceBelow >= spaceAbove;
        var fitH = placeBelow ? Math.min(maxH, spaceBelow - 6) : Math.min(maxH, spaceAbove - 6);
        if (fitH < 120) fitH = Math.min(maxH, 120);
        list.style.position = 'fixed';
        list.style.marginTop = '0';
        list.style.maxHeight = fitH + 'px';
        list.style.minWidth = Math.max(rect.width, 160) + 'px';
        list.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 180)) + 'px';
        list.style.right = '';
        if (placeBelow) {
            list.style.top = (rect.bottom + 2) + 'px';
            list.style.bottom = '';
        } else {
            list.style.top = '';
            list.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
        }
    }
    document.addEventListener('scroll', _closeAllColorLists, true);
    window.addEventListener('resize', _closeAllColorLists);

    // ── Global: color dropdown close on outside click + toggle + item selection ──
    document.addEventListener('click', (e) => {
        // Close all color dropdowns on outside click
        if (!e.target.closest('.color-dd-wrapper')) {
            document.querySelectorAll('.color-dd-list:not(.hidden)').forEach(function(l) { _closeColorList(l); });
        }"""

B_OLD = """            const wasHidden = list.classList.contains('hidden');
            // Close all other dropdowns first
            document.querySelectorAll('.color-dd-list:not(.hidden)').forEach(l => l.classList.add('hidden'));
            if (wasHidden) list.classList.remove('hidden');
            return;"""

B_NEW = """            const wasHidden = list.classList.contains('hidden');
            // Close all other dropdowns first
            document.querySelectorAll('.color-dd-list:not(.hidden)').forEach(function(l) {
                if (l !== list) _closeColorList(l);
            });
            if (wasHidden) {
                list.classList.remove('hidden');
                _positionColorList(trigger, list, wrapper);
            } else {
                _closeColorList(list);
            }
            return;"""

C_OLD = """            // Close dropdown
            const list = wrapper.querySelector('.color-dd-list');
            if (list) list.classList.add('hidden');
            // Update quoteOptions if in options modal
            const inModal = wrapper.closest('#options-modal');
            if (inModal) {
                quoteOptions.color = hex;
                refreshOptionsSummary();
            }
            // For table rows: trigger re-quote
            const row = wrapper.closest('tr[data-row-file]');
            if (row) {
                const rowEditEl = row.querySelector('.row-edit');
                if (rowEditEl) rowEditEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });"""

C_NEW = """            // Close dropdown
            const list = wrapper.querySelector('.color-dd-list');
            if (list) _closeColorList(list);
            // Update quoteOptions if in options modal
            const inModal = wrapper.closest('#options-modal');
            if (inModal) {
                quoteOptions.color = hex;
                refreshOptionsSummary();
                return;
            }
            // Inline (table row / card) color change: fast-path recolor only.
            // Color does not affect slicing/price, so skip re-quote and just refresh
            // the thumbnail (cached STL geometry -> instant) + live 3D preview mesh.
            const rowCtx = wrapper.closest('tr[data-row-file], [data-card-file]');
            if (rowCtx) {
                _applyInlineRecolor(rowCtx, hex);
            }
        }
    });

    // ── Inline recolor fast path: thumbnail + 3D preview + result.color, no re-slice ──
    async function _applyInlineRecolor(rowCtx, hex) {
        const filename = rowCtx.getAttribute('data-row-file') || rowCtx.getAttribute('data-card-file');
        if (!filename) return;
        const idx = currentResults.findIndex((i) => i && i.filename === filename);
        if (idx >= 0) currentResults[idx].color = hex;
        const file = selectedFilesMap.get(filename);
        if (file) {
            try { await ensureThumbnailForFile(file, hex); } catch (e) { /* ignore */ }
            const newThumb = thumbnailMap.get(filename);
            if (newThumb) {
                rowCtx.querySelectorAll('button[data-preview-file] img').forEach(function(img) { img.src = newThumb; });
            }
        }
        // Recolor the live 3D preview mesh if the preview modal is open on this file
        try {
            if (dom.previewModal && !dom.previewModal.classList.contains('hidden')
                && currentPreviewFilename === filename) {
                recolorCurrentMesh(hex);
            }
        } catch (e) { /* ignore */ }
    }"""

for name, o, n in (('A', A_OLD, A_NEW), ('B', B_OLD, B_NEW), ('C', C_OLD, C_NEW)):
    c = s.count(o)
    if c != 1:
        print('BLOCK', name, 'count=', c, '(expected 1) -> ABORT')
        sys.exit(1)
    s = s.replace(o, n, 1)
    print('BLOCK', name, 'applied')

with io.open(P, 'w', encoding='utf-8') as f:
    f.write(s)
print('main.js rewritten OK')
