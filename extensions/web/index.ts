/**
 * Web Extension
 *
 * What it does: adds primitive web tools: `webfetch`, `websearch`, and `codesearch`.
 * How to use it: call tools directly, or let `web-research` subagent compose them.
 * Example: `websearch({ query: "Bun HTMLRewriter docs" })`
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import codeSearchExtension from "./src/code-search.js";
import fetchExtension from "./src/fetch.js";
import searchExtension from "./src/search.js";

export default function webExtension(pi: ExtensionAPI): void {
  fetchExtension(pi);
  searchExtension(pi);
  codeSearchExtension(pi);
}
