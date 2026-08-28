/** Tailwind build-time config — replaces the CDN runtime compiler.
 * Regenerate the stylesheet with: npm run build:css
 * Content scan deliberately includes the JS modules: class names that only
 * appear inside template literals / classList toggles must be picked up. */
module.exports = {
    darkMode: 'class',
    content: [
        'static/partials/**/*.html',
        'static/js/main.js',
        'static/js/modules/**/*.js',
    ],
    corePlugins: {
        // The project ships its own reset-ish tokens; preflight is included
        // by the CDN build too, so keep parity.
        preflight: true,
    },
};
