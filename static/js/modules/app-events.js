import { currentUser, authToken, currentResults } from './state.js';

export function initSettingsAreaEvents({
    dom,
    state,
    settings,
    presets,
    quote,
    preview,
    i18n,
}) {
    const {
        MATERIAL_OPTIONS,
        quoteOptions,
        MATERIAL_TYPE_PRESETS,
        getUsedBrandOptions,
        getMaterialsByBrand,
        escapeHtml,
    } = state;

    const {
        renderUserCenterUI,
        openColorEditor,
        closeColorEditor,
        addColorToMaterial,
        removeColorFromMaterial,
        syncPricingFromInputs,
        validateCurrentFormulas,
        saveUserSettings,
        setAsDefaults,
        changePassword,
        restoreDefaultMaterials,
    } = settings;

    const {
        fetchPrinterModels,
        fetchSlicerPresets,
        fetchPrinterPresets,
        savePrinterPreset,
        restoreDefaultPrinters,
        addEnabledPrinterSlot,
        showCustomPrinterForm,
        hideCustomPrinterForm,
        saveCustomPrinter,
        downloadSelectedPreset,
        deleteSelectedPreset,
        uploadSlicerPreset,
        generateSlicerPreset,
    } = presets;

    const { t } = i18n;

    const bind = (el, event, handler) => {
        if (el) el.addEventListener(event, handler);
    };

    const hideUserCenter = () => {
        dom.userCenterModal.classList.add('hidden');
        dom.userCenterMsg.classList.add('hidden');
    };

    bind(dom.userCenterCloseBtn, 'click', hideUserCenter);
    bind(dom.userCenterBackdrop, 'click', hideUserCenter);
    bind(dom.userCenterSaveBtn, 'click', saveUserSettings);
    bind(dom.userCenterSetDefaultsBtn, 'click', setAsDefaults);
    bind(dom.ucChangePasswordBtn, 'click', changePassword);

    bind(dom.slicerPresetsRefreshBtn, 'click', fetchSlicerPresets);
    bind(dom.slicerPresetsDownloadBtn, 'click', downloadSelectedPreset);
    bind(dom.slicerPresetsDeleteBtn, 'click', deleteSelectedPreset);
    bind(dom.slicerPresetUploadBtn, 'click', uploadSlicerPreset);
    bind(dom.slicerPresetGenerateBtn, 'click', generateSlicerPreset);

    const ppAddBtn = document.getElementById('printer-preset-add-btn');
    const ppSaveBtn = document.getElementById('pp-save-btn');
    const ppCancelBtn = document.getElementById('pp-cancel-btn');
    bind(ppAddBtn, 'click', () => document.getElementById('printer-preset-form')?.classList.remove('hidden'));
    bind(ppCancelBtn, 'click', () => document.getElementById('printer-preset-form')?.classList.add('hidden'));
    bind(ppSaveBtn, 'click', savePrinterPreset);

    bind(document.getElementById('printer-restore-defaults-btn'), 'click', restoreDefaultPrinters);
    bind(document.getElementById('printer-add-slot-btn'), 'click', addEnabledPrinterSlot);
    bind(document.getElementById('printer-add-custom-btn'), 'click', showCustomPrinterForm);
    bind(document.getElementById('custom-pp-save-btn'), 'click', saveCustomPrinter);
    bind(document.getElementById('custom-pp-cancel-btn'), 'click', hideCustomPrinterForm);

    const ucPrinterSel = document.getElementById('cfg-printer-model-main');
    if (ucPrinterSel) {
        ucPrinterSel.addEventListener('change', () => {
            const batchPrinter = document.getElementById('batch-printer-model');
            if (batchPrinter && ucPrinterSel.value) {
                batchPrinter.value = ucPrinterSel.value;
                batchPrinter.dispatchEvent(new Event('change'));
            }
        });
    }

    const ucNozzleSel = document.getElementById('cfg-nozzle-diameter');
    if (ucNozzleSel) {
        ucNozzleSel.addEventListener('change', () => {
            const batchNozzle = document.getElementById('batch-nozzle-diameter');
            if (batchNozzle && ucNozzleSel.value) {
                batchNozzle.value = ucNozzleSel.value;
                batchNozzle.dispatchEvent(new Event('change'));
            }
        });
    }

    const ucMaterialSel = document.getElementById('uc-default-material');
    if (ucMaterialSel) {
        ucMaterialSel.addEventListener('change', () => {
            const batchMat = document.getElementById('batch-material');
            if (batchMat && ucMaterialSel.value) {
                batchMat.value = ucMaterialSel.value;
                batchMat.dispatchEvent(new Event('change'));
            }
            if (ucMaterialSel.value) quoteOptions.material = ucMaterialSel.value;
        });
    }

    dom.ucTabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-uc-tab');
            dom.ucTabBtns.forEach((b) => {
                b.classList.remove('tw-text-primary', 'tw-bg-active', 'active');
                b.classList.add('tw-text-secondary');
            });
            btn.classList.add('tw-text-primary', 'tw-bg-active', 'active');
            btn.classList.remove('tw-text-secondary');
            dom.ucTabPanes.forEach((pane) => {
                pane.classList.add('hidden');
                pane.classList.remove('block');
            });
            const targetPane = document.getElementById(`uc-tab-${tabId}`);
            if (targetPane) {
                targetPane.classList.remove('hidden');
                targetPane.classList.add('block');
            }
            if (dom.userCenterSaveBtn) dom.userCenterSaveBtn.classList.toggle('hidden', tabId === 'security');
            if (dom.userCenterHint) dom.userCenterHint.classList.toggle('invisible', tabId !== 'security');
            if (tabId === 'security') dom.userCenterMsg.classList.add('hidden');
        });
    });

    const ppSubTabBtns = document.querySelectorAll('.pp-sub-tab-btn');
    const ppSubPanes = document.querySelectorAll('.pp-sub-pane');
    ppSubTabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const subTabId = btn.getAttribute('data-pp-tab');
            ppSubTabBtns.forEach((b) => {
                b.classList.remove('tw-text-primary', 'border-primary');
                b.classList.add('tw-text-muted', 'border-transparent');
            });
            btn.classList.add('tw-text-primary', 'border-primary');
            btn.classList.remove('tw-text-muted', 'border-transparent');
            ppSubPanes.forEach((pane) => pane.classList.add('hidden'));
            const targetPane = document.getElementById(`pp-sub-${subTabId}`);
            if (targetPane) targetPane.classList.remove('hidden');
        });
    });
    const firstSubTab = document.querySelector('.pp-sub-tab-btn');
    if (firstSubTab) firstSubTab.click();

    if (dom.materialsTbody) {
        dom.materialsTbody.addEventListener('change', (e) => {
            const target = e.target;
            if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT') return;
            const idx = target.getAttribute('data-idx');
            const field = target.getAttribute('data-field');
            if (field === 'name') {
                MATERIAL_OPTIONS[idx].name = target.value;
                const preset = MATERIAL_TYPE_PRESETS[target.value];
                if (preset) {
                    const row = target.closest('tr');
                    const densityInput = row.querySelector('[data-field="density"]');
                    const priceInput = row.querySelector('[data-field="price_per_kg"]');
                    if (densityInput) { densityInput.value = preset.density; MATERIAL_OPTIONS[idx].density = preset.density; }
                    if (priceInput) { priceInput.value = preset.price_per_kg; MATERIAL_OPTIONS[idx].price_per_kg = preset.price_per_kg; }
                }
            } else if (field === 'brand') {
                MATERIAL_OPTIONS[idx].brand = target.value;
                const brandSel = document.getElementById('uc-default-brand');
                const matSel = document.getElementById('uc-default-material');
                if (brandSel) {
                    const usedBrands = getUsedBrandOptions();
                    const prevBrand = brandSel.value;
                    brandSel.innerHTML = usedBrands.map((b) => '<option value="' + escapeHtml(b) + '"' + (b === prevBrand ? ' selected' : '') + '>' + escapeHtml(b) + '</option>').join('');
                    if (!brandSel.value && brandSel.options.length) brandSel.value = brandSel.options[0].value;
                    quoteOptions.brand = brandSel.value;
                }
                if (matSel) {
                    const selectedBrand = brandSel ? brandSel.value : '';
                    const prevMat = matSel.value;
                    const materials = getMaterialsByBrand(selectedBrand);
                    matSel.innerHTML = materials.map((m) => '<option value="' + escapeHtml(m.name) + '"' + (m.name === prevMat ? ' selected' : '') + '>' + escapeHtml(m.name) + '</option>').join('');
                    if (!matSel.value && matSel.options.length) matSel.value = matSel.options[0].value;
                    quoteOptions.material = matSel.value;
                }
            } else if (field === 'density') {
                MATERIAL_OPTIONS[idx].density = parseFloat(target.value) || 1.0;
            } else if (field === 'price_per_kg') {
                MATERIAL_OPTIONS[idx].price_per_kg = parseFloat(target.value) || 0.0;
            }
        });

        dom.materialsTbody.addEventListener('input', (e) => {
            const target = e.target;
            if (target.tagName !== 'INPUT' || target.type === 'number') return;
            const idx = target.getAttribute('data-idx');
            const field = target.getAttribute('data-field');
            if (idx == null || !field) return;
            if (field === 'brand' || field === 'name') {
                MATERIAL_OPTIONS[idx][field] = target.value;
                const knownBrands = ['Generic','eSUN','Polymaker','Hatchbox','Prusament','Prusa','SUNLU','Creality','Overture','ColorFabb','MatterHackers','Bambu Lab','Anycubic','Elegoo','Jayo','Eryone','Voron'];
                const presetTypes = Object.keys(MATERIAL_TYPE_PRESETS);
                const cell = target.closest('td');
                if (cell) {
                    const badge = cell.querySelector('.combo-badge');
                    const isCustom = field === 'brand' ? !knownBrands.includes(target.value.trim()) : !presetTypes.includes(target.value.trim());
                    if (badge) badge.classList.toggle('hidden', !isCustom);
                }
            }
        });

        dom.materialsTbody.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-material-btn')) {
                const idx = e.target.getAttribute('data-idx');
                MATERIAL_OPTIONS.splice(idx, 1);
                const remainingBrands = getUsedBrandOptions();
                if (!remainingBrands.includes(quoteOptions.brand)) quoteOptions.brand = remainingBrands[0] || '';
                const remainingMaterials = getMaterialsByBrand(quoteOptions.brand);
                if (!remainingMaterials.some((m) => m.name === quoteOptions.material)) {
                    quoteOptions.material = remainingMaterials[0]?.name || '';
                }
                renderUserCenterUI();
            } else if (e.target.classList.contains('edit-colors-btn')) {
                openColorEditor(parseInt(e.target.getAttribute('data-idx'), 10));
            }
        });
    }

    bind(dom.addMaterialBtn, 'click', () => {
        const defaultType = Object.keys(MATERIAL_TYPE_PRESETS)[0] || 'PLA';
        const defaultPreset = MATERIAL_TYPE_PRESETS[defaultType] || { density: 1.24, price_per_kg: 80 };
        MATERIAL_OPTIONS.push({ name: defaultType, brand: (quoteOptions.brand || 'Generic'), density: defaultPreset.density, price_per_kg: defaultPreset.price_per_kg, colors: [{ name: '黑色', hex: '#000000' }, { name: '白色', hex: '#ffffff' }] });
        renderUserCenterUI();
    });
    bind(document.getElementById('material-restore-defaults-btn'), 'click', restoreDefaultMaterials);

    const colorEditorList = document.getElementById('color-editor-list');
    if (colorEditorList) {
        colorEditorList.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-color-btn');
            if (btn) removeColorFromMaterial(btn.getAttribute('data-color-hex'));
        });
    }
    bind(document.getElementById('color-editor-close'), 'click', closeColorEditor);
    bind(document.getElementById('color-editor-add'), 'click', addColorToMaterial);

    if (dom.formulaVarsToggleBtn) {
        dom.formulaVarsToggleBtn.addEventListener('click', () => {
            const hidden = dom.formulaVarsPanel.classList.contains('hidden');
            dom.formulaVarsPanel.classList.toggle('hidden', !hidden);
            dom.formulaVarsToggleBtn.textContent = hidden ? t('settings.collapseVarDict') : t('settings.expandVarDict');
        });
    }
    if (dom.formulaResetBtn) {
        dom.formulaResetBtn.addEventListener('click', () => {
            dom.cfgUnitCostFormula.value = '((effective_weight_g * (price_per_kg / 1000.0)) + (unit_time_h * machine_hourly_rate_cny) + post_process_fee_per_part_cny) + support_cost_per_part_cny';
            dom.cfgTotalCostFormula.value = 'max((unit_cost_cny * quantity) + setup_fee_cny, min_job_fee_cny)';
            syncPricingFromInputs();
            if (dom.formulaValidateMsg) dom.formulaValidateMsg.classList.add('hidden');
        });
    }
    bind(dom.formulaValidateBtn, 'click', validateCurrentFormulas);

    [
        dom.cfgMachineHourlyRate, dom.cfgSetupFee, dom.cfgMinJobFee, dom.cfgMaterialWaste,
        dom.cfgSupportPercent, dom.cfgPostPerPart, dom.cfgTimeOverheadMin, dom.cfgTimeVolMinPerCm3,
        dom.cfgDifficultyCoefficient, dom.cfgDifficultyRatioLow, dom.cfgDifficultyRatioHigh,
        dom.cfgSupportPricePerG, dom.cfgUnitCostFormula, dom.cfgTotalCostFormula,
    ].forEach((el) => el && el.addEventListener('change', syncPricingFromInputs));
}

export function initResultsAreaEvents({
    dom,
    state,
    quote,
    preview,
    upload,
    zipUpload,
    auth,
    i18n,
}) {
    const {
        selectedFilesMap,
        thumbnailMap,
        setCurrentResults,
        quoteOptions,
        MATERIAL_OPTIONS,
        getColorsForMaterial,
        pickAllowedColor,
    } = state;

    const {
        handleRowEditChange,
        handleCardEditChange,
        renderResultsTable,
        recalcSummaryFromCurrentResults,
        quoteSingleFileWithOptions,
        mergeResultsByFilename,
        openMaterialCompare,
        exportCSV,
        exportExcel,
    } = quote;

    const { previewByFilename, closePreviewModal } = preview;
    const { renderFilePreviewChips, setupEnhancedDragDrop } = upload;
    const { handleFileSelection } = zipUpload;
    const { openLoginModal } = auth;
    const { t } = i18n;

    if (dom.batchResultsBody) {
        dom.batchResultsBody.addEventListener('change', handleRowEditChange);
        dom.batchResultsBody.addEventListener('click', (event) => {
            const deleteBtn = event.target.closest('[data-delete-file]');
            if (deleteBtn) {
                const filename = deleteBtn.getAttribute('data-delete-file');
                selectedFilesMap.delete(filename);
                thumbnailMap.delete(filename);
                setCurrentResults(currentResults.filter((item) => item && item.filename !== filename));
                renderResultsTable();
                recalcSummaryFromCurrentResults();
                if (selectedFilesMap.size === 0) {
                    dom.fileNameDisplay.textContent = t('quote.noFileSelected');
                    dom.fileNameDisplay.classList.remove('text-indigo-600', 'font-medium');
                } else {
                    dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件`;
                    dom.fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
                }
                closePreviewModal();
                return;
            }

            const previewBtn = event.target.closest('[data-preview-file]');
            if (previewBtn) {
                previewByFilename(previewBtn.getAttribute('data-preview-file'), previewBtn.getAttribute('data-preview-ext'));
                return;
            }

            const toggleBtn = event.target.closest('[data-toggle-detail]');
            if (toggleBtn) {
                const filename = toggleBtn.getAttribute('data-toggle-detail');
                const detailContent = document.querySelector('[data-detail-content="' + filename + '"]');
                if (detailContent) {
                    const isHidden = detailContent.classList.contains('hidden');
                    detailContent.classList.toggle('hidden');
                    const svg = toggleBtn.querySelector('svg');
                    if (svg) svg.style.transform = isHidden ? 'rotate(180deg)' : '';
                }
                return;
            }

            const requoteBtn = event.target.closest('[data-requote-file]');
            if (requoteBtn) {
                const filename = requoteBtn.getAttribute('data-requote-file');
                const file = selectedFilesMap.get(filename);
                if (file) {
                    const existing = currentResults.find((r) => r && r.filename === filename);
                    const material = existing?.material || quoteOptions.material;
                    const allowedColors = getColorsForMaterial(material);
                    const color = pickAllowedColor(allowedColors, existing?.color, quoteOptions.color);
                    const quantity = existing?.quantity || quoteOptions.quantity || 1;
                    const pm = existing?._printer_model || '';
                    const sp = existing?._slicer_preset_id;
                    const idx = currentResults.findIndex((item) => item && item.filename === filename);
                    if (idx >= 0) currentResults[idx] = { ...currentResults[idx], _recalculating: true };
                    renderResultsTable();
                    recalcSummaryFromCurrentResults();
                    quoteSingleFileWithOptions(file, { material, color, quantity, _printer_model: pm, _slicer_preset_id: sp })
                        .then((updated) => {
                            mergeResultsByFilename([updated]);
                            renderResultsTable();
                            recalcSummaryFromCurrentResults();
                        })
                        .catch((err) => {
                            mergeResultsByFilename([{ filename, status: 'failed', error: err.message || '重算失败', material, color, quantity }]);
                            renderResultsTable();
                            recalcSummaryFromCurrentResults();
                        });
                }
                return;
            }

            const compareBtn = event.target.closest('[data-compare-material]');
            if (compareBtn) openMaterialCompare(compareBtn.getAttribute('data-compare-material'));
        });
    }

    const cardsContainer = document.getElementById('batch-results-cards');
    if (cardsContainer) {
        cardsContainer.addEventListener('change', handleCardEditChange);
        cardsContainer.addEventListener('click', (event) => {
            const deleteBtn = event.target.closest('[data-delete-file]');
            if (deleteBtn) {
                const filename = deleteBtn.getAttribute('data-delete-file');
                selectedFilesMap.delete(filename);
                thumbnailMap.delete(filename);
                setCurrentResults(currentResults.filter((item) => item && item.filename !== filename));
                renderResultsTable();
                recalcSummaryFromCurrentResults();
                if (selectedFilesMap.size === 0) {
                    dom.fileNameDisplay.textContent = t('quote.noFileSelected');
                    dom.fileNameDisplay.classList.remove('text-indigo-600', 'font-medium');
                } else {
                    dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件`;
                    dom.fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
                }
                closePreviewModal();
                return;
            }
            const previewBtn = event.target.closest('[data-preview-file]');
            if (previewBtn) {
                previewByFilename(previewBtn.getAttribute('data-preview-file'), previewBtn.getAttribute('data-preview-ext'));
                return;
            }
            const toggleBtn = event.target.closest('[data-toggle-detail]');
            if (toggleBtn) {
                const filename = toggleBtn.getAttribute('data-toggle-detail');
                const detailContent = document.querySelector('[data-detail-content="' + filename + '"]');
                if (detailContent) {
                    const isHidden = detailContent.classList.contains('hidden');
                    detailContent.classList.toggle('hidden');
                    const svg = toggleBtn.querySelector('svg');
                    if (svg) svg.style.transform = isHidden ? 'rotate(180deg)' : '';
                }
                return;
            }
            const compareBtn = event.target.closest('[data-compare-material]');
            if (compareBtn) openMaterialCompare(compareBtn.getAttribute('data-compare-material'));
        });
    }

    const exportCsvBtn = document.getElementById('export-csv-btn');
    const exportExcelBtn = document.getElementById('export-excel-btn');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);
    if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportExcel);

    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (exportPdfBtn) exportPdfBtn.addEventListener('click', handleExportPdfFromResults);

    async function handleExportPdfFromResults() {
        if (!currentUser || !authToken) { openLoginModal(); return; }
        const successItems = currentResults.filter((r) => r && r.status === 'success');
        if (successItems.length === 0) {
            alert('没有可导出的报价结果，请先上传模型并报价');
            return;
        }
        const btn = document.getElementById('export-pdf-btn');
        const origText = btn?.textContent;
        try {
            if (btn) { btn.disabled = true; btn.textContent = t('common.loading') || '生成中...'; }
            const batchNozzle = document.getElementById('batch-nozzle-diameter')?.value || '';
            const batchLayerHeight = document.getElementById('gen-layer-height')?.value || '';
            const batchWallCount = document.getElementById('gen-wall-count')?.value || '';
            const batchInfill = document.getElementById('gen-infill')?.value || '';
            const items = successItems.map((r) => {
                const rawThumb = thumbnailMap.get(r.filename) || '';
                return {
                    filename: r.filename || '',
                    material: r.material || '',
                    color: r.color || '',
                    quantity: r.quantity || 1,
                    volume_cm3: r.volume_cm3 || 0,
                    weight_g: r.weight_g || 0,
                    estimated_time_h: r.estimated_time_h || 0,
                    cost_cny: r.cost_cny || 0,
                    printer_model: r._printer_model || quoteOptions.printer_model || '',
                    nozzle_diameter: batchNozzle,
                    layer_height: r.cost_breakdown?.gcode_summary?.core_params?.layer_height || batchLayerHeight || '',
                    wall_count: r.cost_breakdown?.gcode_summary?.core_params?.perimeters || batchWallCount || '',
                    infill_percent: r.cost_breakdown?.gcode_summary?.core_params?.fill_density || batchInfill || '',
                    brand: (MATERIAL_OPTIONS.find((m) => m.name === r.material) || {}).brand || quoteOptions.brand || '',
                    created_at: new Date().toISOString(),
                    thumbnail_b64: rawThumb.includes(',') ? rawThumb.split(',')[1] : rawThumb,
                };
            });
            const resp = await state.authFetch('/api/quote/export-pdf-inline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
            });
            if (resp.status === 403) {
                alert('会员专属功能，请先升级会员');
                return;
            }
            if (!resp.ok) throw new Error('导出失败');
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `quote_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert(e.message || '导出失败');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = origText; }
        }
    }

    if (dom.fileInput) {
        dom.fileInput.addEventListener('change', async (e) => {
            const newFiles = Array.from(e.target.files || []);
            dom.fileInput.value = '';
            await handleFileSelection(newFiles);
        });
        setupEnhancedDragDrop(dom.fileInput, async (droppedFiles) => {
            await handleFileSelection(droppedFiles);
        });
    }

    const previewChipsContainer = document.getElementById('file-preview-chips');
    if (previewChipsContainer) {
        previewChipsContainer.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('[data-remove-file]');
            if (!removeBtn) return;
            const filename = removeBtn.getAttribute('data-remove-file');
            selectedFilesMap.delete(filename);
            thumbnailMap.delete(filename);
            setCurrentResults(currentResults.filter((item) => item && item.filename !== filename));
            renderResultsTable();
            recalcSummaryFromCurrentResults();
            renderFilePreviewChips([]);
            if (selectedFilesMap.size === 0) {
                dom.fileNameDisplay.textContent = t('quote.noFileSelected');
                dom.fileNameDisplay.classList.remove('text-indigo-600', 'font-medium');
            } else {
                dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件`;
            }
        });
    }
}
