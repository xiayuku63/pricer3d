/**
 * Onboarding UI – rendering, positioning, and DOM manipulation.
 */
import { t } from '../i18n.js';
import { currentUser } from '../state.js';
import { markOnboardingComplete } from './storage.js';

// ── Mutable state (shared across this module) ──
let _currentStep = 0;
let _steps = [];
let _overlayEl = null;
let _highlightEl = null;
let _tooltipEl = null;
let _activeTargetClass = false;
let _running = false;

// ── State accessors (used by index.js) ──
export function getSteps()          { return _steps; }
export function setSteps(s)         { _steps = s; }
export function getCurrentStep()    { return _currentStep; }
export function setCurrentStep(v)   { _currentStep = v; }
export function isRunning()         { return _running; }
export function setRunning(v)       { _running = v; }

// ── Welcome modal ──
export function showWelcome() {
    _running = true;

    const backdrop = document.createElement('div');
    backdrop.className = 'onb-welcome-backdrop';
    backdrop.innerHTML = `
        <div class="onb-welcome-card">
            <div class="onb-welcome-hero">
                <div class="onb-welcome-icon">
                    <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                    </svg>
                </div>
                <h3 class="onb-welcome-title">${t('onboarding.welcome_title')}</h3>
                <p class="onb-welcome-subtitle">${t('onboarding.welcome_subtitle')}</p>
            </div>
            <div class="onb-welcome-body">
                <ul class="onb-welcome-steps">
                    <li class="onb-welcome-step">
                        <div class="onb-welcome-step-num">1</div>
                        <div class="onb-welcome-step-text">
                            <strong>${t('onboarding.preview_step1_title')}</strong>
                            <span>${t('onboarding.preview_step1_desc')}</span>
                        </div>
                    </li>
                    <li class="onb-welcome-step">
                        <div class="onb-welcome-step-num">2</div>
                        <div class="onb-welcome-step-text">
                            <strong>${t('onboarding.preview_step2_title')}</strong>
                            <span>${t('onboarding.preview_step2_desc')}</span>
                        </div>
                    </li>
                    <li class="onb-welcome-step">
                        <div class="onb-welcome-step-num">3</div>
                        <div class="onb-welcome-step-text">
                            <strong>${t('onboarding.preview_step3_title')}</strong>
                            <span>${t('onboarding.preview_step3_desc')}</span>
                        </div>
                    </li>
                    <li class="onb-welcome-step">
                        <div class="onb-welcome-step-num">4</div>
                        <div class="onb-welcome-step-text">
                            <strong>${t('onboarding.preview_step4_title')}</strong>
                            <span>${t('onboarding.preview_step4_desc')}</span>
                        </div>
                    </li>
                </ul>
            </div>
            <div class="onb-welcome-footer">
                <button class="onb-btn onb-btn-skip" id="onb-welcome-skip">${t('onboarding.skip_guide')}</button>
                <button class="onb-btn onb-btn-next" id="onb-welcome-start">${t('onboarding.start_guide')}</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    // Wire buttons
    backdrop.querySelector('#onb-welcome-skip').addEventListener('click', () => {
        finish();
        backdrop.remove();
    });
    backdrop.querySelector('#onb-welcome-start').addEventListener('click', () => {
        backdrop.remove();
        _currentStep = 0;
        showStep();
    });
    // Click backdrop to dismiss
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            finish();
            backdrop.remove();
        }
    });
}

// ── Step rendering ──
export async function showStep() {
    if (_currentStep >= _steps.length) {
        finish();
        return;
    }

    const step = _steps[_currentStep];

    // Run step action if any
    if (step.action) {
        step.action();
        if (step.waitAfter) {
            await _sleep(step.waitAfter);
        }
    }

    // Determine actual target element
    const targetSelector = step._realTarget || step.target;
    const targetEl = document.querySelector(targetSelector);

    // Create overlay
    _removeUI();

    // Overlay (dark backdrop)
    _overlayEl = document.createElement('div');
    _overlayEl.className = 'onb-overlay';
    document.body.appendChild(_overlayEl);

    // Click overlay to dismiss
    _overlayEl.addEventListener('click', (e) => {
        if (e.target === _overlayEl) {
            // Don't dismiss on overlay click — require button action
        }
    });

    if (targetEl && _isVisible(targetEl)) {
        // Highlight element
        const rect = targetEl.getBoundingClientRect();
        _highlightEl = document.createElement('div');
        _highlightEl.className = 'onb-highlight';
        _positionHighlight(rect);
        document.body.appendChild(_highlightEl);

        // Make target interactive
        targetEl.classList.add('onb-target-active');
        _activeTargetClass = targetEl;

        // Show tooltip
        _showTooltip(step, rect);
    } else {
        // Target not found — show centered tooltip
        _showTooltipCentered(step);
    }
}

function _positionHighlight(rect) {
    if (!_highlightEl) return;
    const pad = 6;
    Object.assign(_highlightEl.style, {
        top: (rect.top - pad + window.scrollY) + 'px',
        left: (rect.left - pad + window.scrollX) + 'px',
        width: (rect.width + pad * 2) + 'px',
        height: (rect.height + pad * 2) + 'px',
    });
}

function _showTooltip(step, targetRect) {
    const position = step.position || 'bottom';
    const stepNum = _currentStep + 1;
    const totalSteps = _steps.length;
    const isLast = _currentStep === _steps.length - 1;

    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'onb-tooltip';
    _tooltipEl.innerHTML = `
        <div class="onb-tooltip-header">
            <div class="onb-tooltip-step">${stepNum}</div>
            <div class="onb-tooltip-title">${t(step.title)}</div>
        </div>
        <div class="onb-tooltip-body">
            <p class="onb-tooltip-desc">${t(step.desc)}</p>
        </div>
        <div class="onb-tooltip-footer">
            <span class="onb-tooltip-progress">${stepNum} / ${totalSteps}</span>
            <div class="onb-tooltip-actions">
                <button class="onb-btn onb-btn-skip" id="onb-skip-btn">${t('onboarding.skip')}</button>
                <button class="onb-btn ${isLast ? 'onb-btn-done' : 'onb-btn-next'}" id="onb-next-btn">
                    ${isLast ? t('onboarding.finish') : t('onboarding.next')}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(_tooltipEl);

    // Position tooltip
    _positionTooltip(targetRect, position);

    // Add arrow between tooltip and target
    _addArrow(targetRect, position);

    // Wire buttons
    _tooltipEl.querySelector('#onb-skip-btn').addEventListener('click', () => finish());
    _tooltipEl.querySelector('#onb-next-btn').addEventListener('click', () => _nextStep());
}

function _showTooltipCentered(step) {
    const stepNum = _currentStep + 1;
    const totalSteps = _steps.length;
    const isLast = _currentStep === _steps.length - 1;

    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'onb-tooltip';
    _tooltipEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;';
    _tooltipEl.innerHTML = `
        <div class="onb-tooltip-header">
            <div class="onb-tooltip-step">${stepNum}</div>
            <div class="onb-tooltip-title">${t(step.title)}</div>
        </div>
        <div class="onb-tooltip-body">
            <p class="onb-tooltip-desc">${t(step.desc)}</p>
        </div>
        <div class="onb-tooltip-footer">
            <span class="onb-tooltip-progress">${stepNum} / ${totalSteps}</span>
            <div class="onb-tooltip-actions">
                <button class="onb-btn onb-btn-skip" id="onb-skip-btn">${t('onboarding.skip')}</button>
                <button class="onb-btn ${isLast ? 'onb-btn-done' : 'onb-btn-next'}" id="onb-next-btn">
                    ${isLast ? t('onboarding.finish') : t('onboarding.next')}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(_tooltipEl);

    _tooltipEl.querySelector('#onb-skip-btn').addEventListener('click', () => finish());
    _tooltipEl.querySelector('#onb-next-btn').addEventListener('click', () => _nextStep());
}

function _positionTooltip(targetRect, position) {
    if (!_tooltipEl) return;
    const gap = 16;
    const ttRect = _tooltipEl.getBoundingClientRect();
    const vw = window.innerWidth;

    let top, left;
    let arrowClass = '';

    switch (position) {
        case 'bottom':
            top = targetRect.bottom + gap + window.scrollY;
            left = targetRect.left + targetRect.width / 2 - ttRect.width / 2;
            arrowClass = 'onb-arrow onb-arrow-bottom';
            break;
        case 'top':
            top = targetRect.top - ttRect.height - gap + window.scrollY;
            left = targetRect.left + targetRect.width / 2 - ttRect.width / 2;
            arrowClass = 'onb-arrow onb-arrow-top';
            break;
        case 'right':
            top = targetRect.top + targetRect.height / 2 - ttRect.height / 2 + window.scrollY;
            left = targetRect.right + gap;
            arrowClass = 'onb-arrow onb-arrow-right';
            break;
        case 'left':
            top = targetRect.top + targetRect.height / 2 - ttRect.height / 2 + window.scrollY;
            left = targetRect.left - ttRect.width - gap;
            arrowClass = 'onb-arrow onb-arrow-left';
            break;
        default:
            top = targetRect.bottom + gap + window.scrollY;
            left = targetRect.left + targetRect.width / 2 - ttRect.width / 2;
            arrowClass = 'onb-arrow onb-arrow-bottom';
    }

    // Clamp to viewport
    left = Math.max(12, Math.min(left, vw - ttRect.width - 12));
    top = Math.max(12, top);

    _tooltipEl.style.top = top + 'px';
    _tooltipEl.style.left = left + 'px';
}

function _addArrow(targetRect, position) {
    if (!_tooltipEl) return;
    const arrow = document.createElement('div');
    arrow.className = 'onb-arrow';
    const ttRect = _tooltipEl.getBoundingClientRect();

    switch (position) {
        case 'bottom':
            arrow.classList.add('onb-arrow-bottom');
            arrow.style.top = (ttRect.top + window.scrollY - 6) + 'px';
            arrow.style.left = (targetRect.left + targetRect.width / 2 - 6 + window.scrollX) + 'px';
            break;
        case 'top':
            arrow.classList.add('onb-arrow-top');
            arrow.style.top = (ttRect.bottom + window.scrollY - 6) + 'px';
            arrow.style.left = (targetRect.left + targetRect.width / 2 - 6 + window.scrollX) + 'px';
            break;
        case 'right':
            arrow.classList.add('onb-arrow-right');
            arrow.style.top = (targetRect.top + targetRect.height / 2 - 6 + window.scrollY) + 'px';
            arrow.style.left = (ttRect.left + window.scrollX - 6) + 'px';
            break;
        case 'left':
            arrow.classList.add('onb-arrow-left');
            arrow.style.top = (targetRect.top + targetRect.height / 2 - 6 + window.scrollY) + 'px';
            arrow.style.left = (ttRect.right + window.scrollX - 6) + 'px';
            break;
    }
    document.body.appendChild(arrow);
}

// ── Step navigation ──
async function _nextStep() {
    const step = _steps[_currentStep];
    if (step && step.cleanup) step.cleanup();

    _currentStep++;
    showStep();
}

function finish() {
    _running = false;
    _removeUI();

    // Mark as completed
    if (currentUser) {
        const userId = currentUser.username || currentUser.id || '';
        if (userId) {
            markOnboardingComplete(userId);
        }
    }

    // Close user center modal if open
    const modal = document.getElementById('user-center-modal');
    if (modal) modal.classList.add('hidden');
}

// ── Cleanup ──
function _removeUI() {
    if (_overlayEl) { _overlayEl.remove(); _overlayEl = null; }
    if (_highlightEl) { _highlightEl.remove(); _highlightEl = null; }
    if (_tooltipEl) { _tooltipEl.remove(); _tooltipEl = null; }
    // Remove any arrow elements
    document.querySelectorAll('.onb-arrow').forEach(el => el.remove());
    if (_activeTargetClass) {
        _activeTargetClass.classList.remove('onb-target-active');
        _activeTargetClass = false;
    }
}

// ── Helpers ──
function _isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
