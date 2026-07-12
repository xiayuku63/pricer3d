/**
 * Onboarding Guide – lightweight first-use walkthrough
 *
 * No external dependencies. Uses overlay + highlight + tooltip.
 * Completion state persisted in localStorage per-user.
 */
import { authToken, currentUser } from '../state.js';
import { buildSteps } from './steps.js';
import { isOnboardingComplete, removeOnboardingProgress, _getUserId } from './storage.js';
import {
    setSteps, setRunning, isRunning as _isRunning,
    showWelcome, showStep as _showStep,
    setCurrentStep,
} from './ui.js';

// Re-export sub-module public symbols so external consumers
// can still `import { ... } from './onboarding.js'` (which now
// resolves to this barrel file).
export { buildSteps } from './steps.js';
export {
    isOnboardingComplete,
    removeOnboardingProgress,
} from './storage.js';
export {
    isRunning,
    showStep,
    showWelcome,
} from './ui.js';

// ── Public API ──
export function initOnboarding() {
    // Listen for login success events (from login modal)
    window.addEventListener('pricer3d-auth-success', () => {
        // Small delay to let settings fetch complete
        setTimeout(() => checkAndStart(), 800);
    });
}

/**
 * Check if the current user needs the onboarding guide.
 * Returns true if guide was started.
 */
export function checkAndStart() {
    if (!authToken || !currentUser) return false;

    const userId = currentUser.username || currentUser.id || '';
    if (!userId) return false;

    // Already completed?
    if (isOnboardingComplete(userId)) return false;

    // Build steps for this user
    const steps = buildSteps();
    if (steps.length === 0) return false;

    setSteps(steps);

    // Show welcome modal first
    showWelcome();
    return true;
}

/**
 * Force-start the guide (for "replay" functionality).
 */
export function startGuide() {
    setSteps(buildSteps());
    setCurrentStep(0);
    showWelcome();
}

/**
 * Reset onboarding for current user (so it can be replayed).
 */
export function resetOnboarding() {
    const userId = _getUserId();
    if (userId) {
        removeOnboardingProgress(userId);
    }
}
