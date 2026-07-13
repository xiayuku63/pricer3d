export function initColorDropdownUI({ quoteOptions, currentResults, selectedFilesMap, thumbnailMap, dom, ensureThumbnailForFile, recolorCurrentMesh, getCurrentPreviewFilename, refreshOptionsSummary }) {
    function resetPanel(panel) {
        panel.style.position = '';
        panel.style.left = '';
        panel.style.right = '';
        panel.style.top = '';
        panel.style.bottom = '';
        panel.style.marginTop = '';
        panel.style.minWidth = '';
        panel.style.width = '';
        panel.style.maxHeight = '';
        if (panel.__portalHost === document.body) {
            panel.__portalOrigin?.appendChild(panel);
        }
        panel.__portalHost = null;
        panel.__portalOrigin = null;
    }
    function closeColorList(list) {
        resetPanel(list);
        list.classList.add('hidden');
    }
    function closeAllColorLists(e) {
        if (e && e.target && e.target.closest && e.target.closest('.color-dd-list')) return;
        document.querySelectorAll('.color-dd-list:not(.hidden)').forEach((list) => closeColorList(list));
    }
    function positionColorList(trigger, list, wrapper) {
        if (!wrapper.closest('#batch-results-body, #batch-results-cards, #batch-color-cell')) return;
        const rect = trigger.getBoundingClientRect();
        if (!rect.width) return;

        // The list is portaled visually with fixed positioning. Read its real
        // dimensions after it becomes visible so it stays anchored to the
        // trigger instead of relying on a hard-coded width estimate.
        if (list.parentElement !== document.body) {
            list.__portalOrigin = list.parentElement;
            document.body.appendChild(list);
            list.__portalHost = document.body;
        }
        list.style.position = 'fixed';
        list.style.marginTop = '0';
        list.style.maxHeight = '360px';
        list.style.minWidth = `${Math.max(rect.width, 160)}px`;
        list.style.left = '0px';
        list.style.top = '0px';
        list.style.bottom = '';
        const listRect = list.getBoundingClientRect();
        const listWidth = Math.max(listRect.width, rect.width, 160);
        const listHeight = Math.min(list.scrollHeight || listRect.height || 360, 360);
        const gap = 6;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - listWidth - 8));
        const spaceBelow = window.innerHeight - rect.bottom - gap;
        const spaceAbove = rect.top - gap;
        const placeBelow = spaceBelow >= listHeight || spaceBelow >= spaceAbove;
        const availableHeight = Math.max(120, Math.min(listHeight, placeBelow ? spaceBelow : spaceAbove));

        list.style.zIndex = '100';
        list.style.width = `${listWidth}px`;
        list.style.maxHeight = `${availableHeight}px`;
        list.style.left = `${left}px`;
        list.style.right = '';
        if (placeBelow) {
            list.style.top = `${rect.bottom + gap}px`;
            list.style.bottom = '';
        } else {
            list.style.top = '';
            list.style.bottom = `${window.innerHeight - rect.top + gap}px`;
        }
    }
    async function applyInlineRecolor(rowCtx, hex) {
        const filename = rowCtx.getAttribute('data-row-file') || rowCtx.getAttribute('data-card-file');
        if (!filename) return;
        const idx = currentResults.findIndex((item) => item && item.filename === filename);
        if (idx >= 0) currentResults[idx].color = hex;
        const file = selectedFilesMap.get(filename);
        if (file) {
            try { await ensureThumbnailForFile(file, hex); } catch (e) { console.warn('Thumbnail generation failed:', e.message); }
            const newThumb = thumbnailMap.get(filename);
            if (newThumb) {
                rowCtx.querySelectorAll('button[data-preview-file] img').forEach((img) => { img.src = newThumb; });
            }
        }
        try {
            if (dom.previewModal && !dom.previewModal.classList.contains('hidden') && getCurrentPreviewFilename() === filename) {
                recolorCurrentMesh(hex);
            }
        } catch (e) {
            console.warn('3D preview recolor failed:', e.message);
        }
    }

    document.addEventListener('scroll', closeAllColorLists, true);
    window.addEventListener('resize', closeAllColorLists);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.color-dd-wrapper')) {
            document.querySelectorAll('.color-dd-list:not(.hidden)').forEach((list) => closeColorList(list));
        }

        const trigger = e.target.closest('.color-dd-trigger');
        if (trigger) {
            e.stopPropagation();
            const wrapper = trigger.closest('.color-dd-wrapper');
            if (!wrapper) return;
            const list = wrapper.querySelector('.color-dd-list');
            if (!list) return;
            const wasHidden = list.classList.contains('hidden');
            document.querySelectorAll('.color-dd-list:not(.hidden)').forEach((other) => {
                if (other !== list) closeColorList(other);
            });
            if (wasHidden) {
                list.classList.remove('hidden');
                // Reset "more colors" when opening
                const extra = wrapper.querySelector('.color-dd-extra');
                if (extra) extra.classList.add('hidden');
                const toggleMore = wrapper.querySelector('.color-dd-toggle-more');
                if (toggleMore) {
                    const chevron = toggleMore.querySelector('svg');
                    if (chevron) chevron.style.transform = '';
                }
                positionColorList(trigger, list, wrapper);
            } else {
                closeColorList(list);
            }
            return;
        }

        const toggleMore = e.target.closest('.color-dd-toggle-more');
        if (toggleMore) {
            e.stopPropagation();
            const wrapper = toggleMore.closest('.color-dd-wrapper');
            if (!wrapper) return;
            const extra = wrapper.querySelector('.color-dd-extra');
            if (!extra) return;
            const isOpen = !extra.classList.contains('hidden');
            if (isOpen) {
                extra.classList.add('hidden');
                const chevron = toggleMore.querySelector('svg');
                if (chevron) chevron.style.transform = '';
            } else {
                extra.classList.remove('hidden');
                const chevron = toggleMore.querySelector('svg');
                if (chevron) chevron.style.transform = 'rotate(180deg)';
                const list = wrapper.querySelector('.color-dd-list');
                if (list) positionColorList(wrapper.querySelector('.color-dd-trigger'), list, wrapper);
            }
            return;
        }

        const item = e.target.closest('.color-dd-item');
        if (!item) return;
        e.stopPropagation();
        const hex = item.getAttribute('data-color-hex');
        if (!hex) return;
        const wrapper = item.closest('.color-dd-wrapper');
        if (!wrapper) return;
        const valueInput = wrapper.querySelector('.row-color-value');
        if (valueInput) valueInput.value = hex;
        const swatch = wrapper.querySelector('.color-dd-swatch');
        if (swatch) swatch.style.background = hex;
        const label = wrapper.querySelector('.color-dd-label');
        if (label) label.textContent = hex;
        // Close list after selecting
        const list = wrapper.querySelector('.color-dd-list');
        if (list) closeColorList(list);

        // Reset "more colors" for next open
        const extra2 = wrapper.querySelector('.color-dd-extra');
        if (extra2) extra2.classList.add('hidden');
        const toggleMore2 = wrapper.querySelector('.color-dd-toggle-more');
        if (toggleMore2) {
            const chevron = toggleMore2.querySelector('svg');
            if (chevron) chevron.style.transform = '';
            toggleMore2.querySelector('.color-dd-extra-hidden')?.classList.remove('hidden');
            toggleMore2.querySelector('.color-dd-extra-visible')?.classList.add('hidden');
        }

        if (wrapper.closest('#options-modal')) {
            quoteOptions.color = hex;
            refreshOptionsSummary();
            return;
        }

        const rowCtx = wrapper.closest('tr[data-row-file], [data-card-file]');
        if (rowCtx) {
            applyInlineRecolor(rowCtx, hex).catch((err) => console.warn('Inline recolor failed:', err.message));
        }
    });
}

export function initMobileNavigation({ mobileNav, dom, getCurrentUser, getAuthToken, openLoginModal, handleLogout, openMembershipModal, loadQuoteHistory, renderUserCenterUI, fetchPrinterModels, fetchSlicerPresets, fetchPrinterPresets, renderPrinterVisibilityList, closePreviewModal, langApi }) {
    function bind(el, event, handler) {
        if (el) el.addEventListener(event, handler);
    }
    function syncMobileNavAuthState() {
        const currentUser = getCurrentUser();
        if (currentUser) {
            if (mobileNav.openLoginBtn) mobileNav.openLoginBtn.classList.add('hidden');
            if (mobileNav.logoutBtn) mobileNav.logoutBtn.classList.remove('hidden');
            if (mobileNav.openMembershipBtn) mobileNav.openMembershipBtn.classList.toggle('hidden', false);
            if (mobileNav.openUserCenterBtn) mobileNav.openUserCenterBtn.classList.remove('hidden');
            if (mobileNav.openAdminUsersBtn) mobileNav.openAdminUsersBtn.classList.toggle('hidden', !currentUser.is_admin);
        } else {
            if (mobileNav.openLoginBtn) mobileNav.openLoginBtn.classList.remove('hidden');
            if (mobileNav.logoutBtn) mobileNav.logoutBtn.classList.add('hidden');
            if (mobileNav.openMembershipBtn) mobileNav.openMembershipBtn.classList.add('hidden');
            if (mobileNav.openUserCenterBtn) mobileNav.openUserCenterBtn.classList.add('hidden');
            if (mobileNav.openAdminUsersBtn) mobileNav.openAdminUsersBtn.classList.add('hidden');
        }
    }
    function openMobileNav() {
        if (!mobileNav.drawer) return;
        mobileNav.drawer.classList.add('open');
        mobileNav.backdrop.classList.add('visible');
        mobileNav.menuBtn.classList.add('open');
        mobileNav.menuBtn.setAttribute('aria-expanded', 'true');
        document.body.classList.add('nav-open');
        syncMobileNavAuthState();
    }
    function closeMobileNav() {
        if (!mobileNav.drawer) return;
        mobileNav.drawer.classList.remove('open');
        mobileNav.backdrop.classList.remove('visible');
        mobileNav.menuBtn.classList.remove('open');
        mobileNav.menuBtn.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('nav-open');
    }
    function highlightActiveMobileNavItem() {
        const path = window.location.pathname;
        document.querySelectorAll('.mobile-nav-item').forEach((item) => item.classList.remove('active'));
        let activeSelector = '[data-page="quote"]';
        if (path.includes('/admin/users')) activeSelector = '[data-page="admin"]';
        const activeItem = document.querySelector(`.mobile-nav-item${activeSelector}`);
        if (activeItem) activeItem.classList.add('active');
    }

    highlightActiveMobileNavItem();
    bind(mobileNav.menuBtn, 'click', () => mobileNav.drawer?.classList.contains('open') ? closeMobileNav() : openMobileNav());
    bind(mobileNav.closeBtn, 'click', closeMobileNav);
    bind(mobileNav.backdrop, 'click', closeMobileNav);
    bind(mobileNav.openLoginBtn, 'click', () => { closeMobileNav(); openLoginModal(); });
    bind(mobileNav.logoutBtn, 'click', () => { closeMobileNav(); handleLogout(); });
    bind(mobileNav.openMembershipBtn, 'click', () => { closeMobileNav(); openMembershipModal(); });
    bind(mobileNav.openQuoteHistoryBtn, 'click', () => {
        closeMobileNav();
        loadQuoteHistory(getAuthToken());
        const histBtn = document.getElementById('open-quote-history-btn');
        if (histBtn) histBtn.click();
    });
    bind(mobileNav.openAdminUsersBtn, 'click', () => { closeMobileNav(); window.__navigateIfLeaving('/admin/users'); });
    bind(mobileNav.openUserCenterBtn, 'click', () => {
        closeMobileNav();
        const currentUser = getCurrentUser();
        if (!currentUser) return;
        renderUserCenterUI();
        if (dom.userCenterSetDefaultsBtn) dom.userCenterSetDefaultsBtn.classList.toggle('hidden', !(currentUser && currentUser.is_admin));
        if (dom.ucOldPassword) dom.ucOldPassword.value = '';
        if (dom.ucNewPassword) dom.ucNewPassword.value = '';
        if (dom.ucConfirmPassword) dom.ucConfirmPassword.value = '';
        if (dom.ucPasswordMsg) { dom.ucPasswordMsg.textContent = ''; dom.ucPasswordMsg.className = 'text-xs hidden'; }
        const defaultTab = document.querySelector('.uc-tab-btn[data-uc-tab="print-params"]') || document.querySelector('.uc-tab-btn');
        if (defaultTab) defaultTab.click();
        dom.userCenterModal.classList.remove('hidden');
        fetchPrinterModels();
        fetchSlicerPresets();
        fetchPrinterPresets();
        renderPrinterVisibilityList();
    });

    if (mobileNav.langSwitchBtn) {
        const updateMobileLangBtn = () => {
            if (mobileNav.langLabel) mobileNav.langLabel.textContent = `${langApi.flag()} ${langApi.label()}`;
        };
        updateMobileLangBtn();
        mobileNav.langSwitchBtn.addEventListener('click', () => {
            langApi.toggle();
            updateMobileLangBtn();
        });
    }

    if (mobileNav.appVersion) {
        const desktopVersion = document.getElementById('app-version');
        if (desktopVersion) {
            const observer = new MutationObserver(() => {
                mobileNav.appVersion.textContent = desktopVersion.textContent;
            });
            observer.observe(desktopVersion, { childList: true, characterData: true, subtree: true });
        }
    }

    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;
    if (mobileNav.drawer) {
        mobileNav.drawer.addEventListener('touchstart', (e) => {
            if (!mobileNav.drawer.classList.contains('open')) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isSwiping = false;
        }, { passive: true });
        mobileNav.drawer.addEventListener('touchmove', (e) => {
            if (!mobileNav.drawer.classList.contains('open')) return;
            const dx = e.touches[0].clientX - touchStartX;
            const dy = e.touches[0].clientY - touchStartY;
            if (Math.abs(dx) > Math.abs(dy) && dx < -30) isSwiping = true;
        }, { passive: true });
        mobileNav.drawer.addEventListener('touchend', () => {
            if (isSwiping) closeMobileNav();
            isSwiping = false;
        }, { passive: true });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileNav.drawer?.classList.contains('open')) closeMobileNav();
    });

    window.__syncMobileNavAuthState = syncMobileNavAuthState;
}

export function initAppLifecycle({ mobileNav, loadAppVersion, preloadPrinterSelectors, updateViewerSize, getSelectedFilesCount }) {
    let isLeavingAfterConfirmation = false;

    loadAppVersion();
    preloadPrinterSelectors();
    window.addEventListener('resize', updateViewerSize);

    window.addEventListener('beforeunload', (event) => {
        if (!isLeavingAfterConfirmation && getSelectedFilesCount() > 0) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    document.addEventListener('keydown', (e) => {
        if (getSelectedFilesCount() === 0) return;
        const isRefresh = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r');
        if (!isRefresh) return;
        e.preventDefault();
        showLeaveConfirmModal(() => { window.location.reload(); });
    });

    document.addEventListener('click', (e) => {
        if (getSelectedFilesCount() === 0) return;
        const link = e.target.closest('a[href]');
        if (!link || link.target === '_blank') return;
        const href = link.getAttribute('href');
        if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('blob:')) return;
        e.preventDefault();
        showLeaveConfirmModal(() => { window.location.href = href; });
    });

    // Also expose for buttons that navigate
    window.__navigateIfLeaving = (url) => {
        if (getSelectedFilesCount() > 0) {
            showLeaveConfirmModal(() => { window.location.href = url; });
        } else {
            window.location.href = url;
        }
    };

    function showLeaveConfirmModal(onConfirm) {
        const modal = document.getElementById('leave-confirm-modal');
        const cancelBtn = document.getElementById('leave-confirm-cancel');
        const okBtn = document.getElementById('leave-confirm-ok');
        const leave = () => {
            isLeavingAfterConfirmation = true;
            onConfirm();
        };
        if (!modal) { leave(); return; }
        modal.classList.remove('hidden');
        function close() {
            modal.classList.add('hidden');
            cancelBtn.onclick = null;
            okBtn.onclick = null;
        }
        cancelBtn.onclick = close;
        okBtn.onclick = () => { close(); leave(); };
        modal.querySelector('.bg-black\/50')?.addEventListener('click', close, { once: true });
    }
}
