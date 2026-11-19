/**
 * Contract test: the FIRST copy-paste install command in every integrations/*\/README.md
 * must be an install path that actually resolves today.
 *
 *   node tests/test_integration_readme_install.mjs
 *
 * Why this exists: the @grey-ridge npm scope is unpublished (publishing is 2FA-atom
 * gated), so a README that LEADS with `npm i @grey-ridge/<pkg>` hands the buyer a 404
 * on the very first line — a silent funnel break. Our standing distribution policy
 * while npm is gated is git-install (`npm i github:...`, `pip install git+...`) or the
 * one published pip package (`greyridge-x402-tools`). langchain-defi-data shipped the
 * broken lead for weeks because nothing checked it; this guards the whole family.
 *
 * The README set is ENUMERATED from the filesystem at runtime (no hardcoded file list),
 * so new integrations are covered automatically. When npm Trusted Publishing is enabled
 * (open atom) and the scope actually publishes, relax INSTALLABLE_LEAD to allow a
 * verified-published `@grey-ridge/*` lead.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const intDir = join(root, "integrations");

// An install command the buyer can run today: a git install (npm/yarn github: or
// git+), or the published pip package. A bare `@grey-ridge/<pkg>` npm install is NOT
// installable (unpublished scope) and must never be the first command.
const INSTALLABLE_LEAD = /(github:|git\+https?:\/\/|pip install\s+["']?git\+|pip install\s+["']?greyridge-x402-tools)/;
const BARE_NPM_SCOPE = /^\s*(npm (i|install)|yarn add)\s+["']?@grey-ridge\//;
const INSTALL_LINE = /^\s*(npm (i|install)|yarn add|pip install)\b/;

const readmes = readdirSync(intDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(intDir, d.name, "README.md"))
  .filter((p) => existsSync(p));

assert.ok(readmes.length >= 1, "no integrations/*/README.md found — did the layout change?");

let checked = 0;
for (const path of readmes) {
  const lines = readFileSync(path, "utf8").split("\n");
  const first = lines.find((l) => INSTALL_LINE.test(l));
  // A README with no install command at all (e.g. a pure pointer doc) is out of scope.
  if (!first) continue;
  const rel = path.slice(root.length + 1);
  assert.ok(
    !BARE_NPM_SCOPE.test(first),
    `${rel} leads with an unpublished @grey-ridge npm install (404 for the buyer):\n    ${first.trim()}\n  Lead with the git install instead (npm i github:rezearcher/<repo>).`
  );
  assert.ok(
    INSTALLABLE_LEAD.test(first),
    `${rel} first install command is not a resolvable path:\n    ${first.trim()}\n  Expected a git install (github:/git+) or pip install greyridge-x402-tools.`
  );
  checked++;
}

assert.ok(checked >= 1, "no install commands checked — regex may have drifted from README format");
console.log(`ok: ${checked} integration README(s) lead with a resolvable install command (of ${readmes.length} dirs)`);
