/**
 * Onboarding Guide – barrel re-export.
 *
 * The original monolithic module has been split into:
 *   onboarding/steps.js   – step definitions & navigation
 *   onboarding/ui.js      – UI rendering, tooltips, overlays
 *   onboarding/storage.js – localStorage persistence helpers
 *
 * This file preserves the original import path so consumers
 * that import from './onboarding.js' continue to work unchanged.
 */
export * from './onboarding/index.js';
