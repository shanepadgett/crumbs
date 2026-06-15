/**
 * Cost Report Extension
 *
 * What it does: adds `/cost-report` to turn Pi session usage into a static HTML cost report.
 * How to use it: run `/cost-report month`, `/cost-report week project`, or `/cost-report today open`.
 * Example: `/cost-report month open`
 */

export { default } from "./src/extension.js";
