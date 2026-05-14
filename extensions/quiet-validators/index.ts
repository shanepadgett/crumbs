/**
 * Quiet Validators Extension
 *
 * What it does: runs configured mise tasks after relevant file changes and prevents duplicate manual checks.
 * How to use it: configure extensions.quietMiseTask in crumbs config, then edit files normally.
 * Example: changing a .swift file can run mise task check:swift quietly in background.
 */

export { default } from "./src/extension.js";
