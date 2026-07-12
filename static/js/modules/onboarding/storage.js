/**
 * Onboarding storage – localStorage persistence helpers
 */
import { currentUser } from '../state.js';

const STORAGE_KEY_PREFIX = 'pricer3d_onboarding_done_';

/**
 * Get the current user's onboarding storage key.
 * @returns {string} The userId used as storage key suffix, or empty string.
 */
export function _getUserId() {
    if (!currentUser) return '';
    return currentUser.username || currentUser.id || '';
}

/**
 * Check whether the given user has completed onboarding.
 * @param {string} userId
 * @returns {boolean}
 */
export function isOnboardingComplete(userId) {
    return !!localStorage.getItem(STORAGE_KEY_PREFIX + userId);
}

/**
 * Mark onboarding as completed for the given user.
 * @param {string} userId
 */
export function markOnboardingComplete(userId) {
    localStorage.setItem(STORAGE_KEY_PREFIX + userId, String(Date.now()));
}

/**
 * Remove onboarding completion flag for the given user (replay support).
 * @param {string} userId
 */
export function removeOnboardingProgress(userId) {
    localStorage.removeItem(STORAGE_KEY_PREFIX + userId);
}
