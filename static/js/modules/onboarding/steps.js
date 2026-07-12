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
    });

    return [
        s('#user-menu-btn',
            'onboarding.step1_title',
            'onboarding.step1_desc',
            { position: 'bottom' }
        ),
        s('#open-user-center-btn',
            'onboarding.step2_title',
            'onboarding.step2_desc',
            {
                position: 'bottom',
                action: () => {
                    // Make sure user dropdown is visible
                    const dropdown = document.getElementById('user-dropdown');
                    if (dropdown) dropdown.classList.remove('hidden');
                },
            }
        ),
        s('#open-user-center-btn',  // Will trigger opening user center
            'onboarding.step3_title',
            'onboarding.step3_desc',
            {
                position: 'bottom',
                action: () => {
                    // Close dropdown, open user center
                    const dropdown = document.getElementById('user-dropdown');
                    if (dropdown) dropdown.classList.add('hidden');
                    const modal = document.getElementById('user-center-modal');
                    if (modal) modal.classList.remove('hidden');
                    // Click the print-params parent tab, then printer sub-tab
                    const parentTab = document.querySelector('.uc-tab-btn[data-uc-tab="print-params"]');
                    if (parentTab) parentTab.click();
                    setTimeout(() => {
                        const printerSub = document.querySelector('.pp-sub-tab-btn[data-pp-tab="printer"]');
                        if (printerSub) printerSub.click();
                    }, 50);
                },
                waitAfter: 300,
                // Target the printer selector inside user center
                _realTarget: '#cfg-printer-model-main',
            }
        ),
        s('.uc-tab-btn[data-uc-tab="print-params"]',
            'onboarding.step4_title',
            'onboarding.step4_desc',
            {
                position: 'right',
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
        s('.uc-tab-btn[data-uc-tab="costs"]',
            'onboarding.step5_title',
            'onboarding.step5_desc',
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
            'onboarding.step6_title',
            'onboarding.step6_desc',
            {
                position: 'top',
            }
        ),
        s('#drop-zone',
            'onboarding.step7_title',
            'onboarding.step7_desc',
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
