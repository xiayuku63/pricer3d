/**
 * Onboarding step definitions – build the ordered list of guide steps.
 */
import { t } from '../i18n.js';

/**
 * Build the array of step descriptors for the current page.
 * Each step has: target, title, desc, position, action, cleanup, waitAfter.
 * @returns {Array} Step objects.
 */
export function buildSteps() {
    const s = (target, titleKey, descKey, opts = {}) => ({
        target,
        title: titleKey,
        desc: descKey,
        position: opts.position || 'bottom',
        action: opts.action || null,    // function to run before showing this step
        cleanup: opts.cleanup || null,  // function to run when leaving this step
        waitAfter: opts.waitAfter || 0, // ms to wait after action before positioning
        canAdvance: opts.canAdvance || null, // guard for the tooltip's Next button
        advanceOnTargetClick: Boolean(opts.advanceOnTargetClick),
        elevatedTarget: opts.elevatedTarget || null, // container that must remain above the overlay
        _realTarget: opts._realTarget || null,
    });

    return [
        s('#user-menu-btn',
            'onboarding.step1_title',
            'onboarding.step1_desc',
            {
                position: 'bottom',
                // The guide deliberately requires the user to open the menu instead
                // of displaying a menu item that has not been revealed by interaction.
                canAdvance: () => {
                    const dropdown = document.getElementById('user-dropdown');
                    return Boolean(dropdown && !dropdown.classList.contains('hidden'));
                },
            }
        ),
        s('#open-user-center-btn',
            'onboarding.step2_title',
            'onboarding.step2_desc',
            {
                position: 'bottom',
                // Step 1 keeps this menu open. Elevate its stacking context so the
                // actual menu item stays visible above the onboarding overlay.
                elevatedTarget: '#user-dropdown',
                // Continue only after the user selects the real menu entry.
                canAdvance: () => {
                    const modal = document.getElementById('user-center-modal');
                    return Boolean(modal && !modal.classList.contains('hidden'));
                },
                advanceOnTargetClick: true,
            }
        ),
        s('#open-user-center-btn',  // Will trigger opening user center
            'onboarding.step3_title',
            'onboarding.step3_desc',
            {
                position: 'bottom',
                action: () => {
                    // User Center is opened by the actual menu click in step 2.
                    // This step only selects the relevant settings tab afterwards.
                    const modal = document.getElementById('user-center-modal');
                    if (!modal || modal.classList.contains('hidden')) return;
                    const parentTab = document.querySelector('.uc-tab-btn[data-uc-tab="print-params"]');
                    if (parentTab) parentTab.click();
                    setTimeout(() => {
                        const printerSub = document.querySelector('.pp-sub-tab-btn[data-pp-tab="printer"]');
                        if (printerSub) printerSub.click();
                    }, 50);
                },
                waitAfter: 300,
                // Target the printer selector inside user center
                _realTarget: '#gen-printer-model',
            }
        ),
        s('.pp-sub-tab-btn[data-pp-tab="materials"]',
            'onboarding.step4_title',
            'onboarding.step4_desc',
            {
                position: 'bottom',
                action: () => {
                    // Switch to print-params tab, then materials sub-tab
                    const tab = document.querySelector('.uc-tab-btn[data-uc-tab="print-params"]');
                    if (tab) tab.click();
                    setTimeout(() => {
                        const subTab = document.querySelector('.pp-sub-tab-btn[data-pp-tab="materials"]');
                        if (subTab) subTab.click();
                    }, 50);
                },
                waitAfter: 200,
            }
        ),
        s('.pp-sub-tab-btn[data-pp-tab="slicer"]',
            'onboarding.step5_title',
            'onboarding.step5_desc',
            {
                position: 'bottom',
                action: () => {
                    // Switch to print-params tab, then slicer sub-tab
                    const tab = document.querySelector('.uc-tab-btn[data-uc-tab="print-params"]');
                    if (tab) tab.click();
                    setTimeout(() => {
                        const subTab = document.querySelector('.pp-sub-tab-btn[data-pp-tab="slicer"]');
                        if (subTab) subTab.click();
                    }, 50);
                },
                waitAfter: 200,
            }
        ),
        s('.uc-tab-btn[data-uc-tab="costs"]',
            'onboarding.step6_title',
            'onboarding.step6_desc',
            {
                position: 'right',
                action: () => {
                    const tab = document.querySelector('.uc-tab-btn[data-uc-tab="costs"]');
                    if (tab) tab.click();
                },
                waitAfter: 200,
            }
        ),
        s('#user-center-save-btn',
            'onboarding.step7_title',
            'onboarding.step7_desc',
            {
                position: 'top',
            }
        ),
        s('#drop-zone',
            'onboarding.step8_title',
            'onboarding.step8_desc',
            {
                position: 'top',
                action: () => {
                    // Close user center modal
                    const modal = document.getElementById('user-center-modal');
                    if (modal) modal.classList.add('hidden');
                },
                waitAfter: 400,
            }
        ),
    ];
}
