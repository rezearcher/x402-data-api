// Offline benchmark of analyzeMcpTool against benchmarks/mcp_tools_list_corpus.json.
// Feeds name + description + JSON.stringify(inputSchema) so schema-embedded payloads
// (e.g. a smuggled `sidenote` exfil parameter) are in scope. Prints recall/precision.
import fs from "fs"; import { transformSync } from "esbuild";
// analyzeMcpTool lives in src/mcp_scan.ts (pure, no imports). Strip `export` so the
// compiled module runs inside a Function scope, then hand analyzeMcpTool out.
const src = fs.readFileSync("src/mcp_scan.ts", "utf8").replace(/^export /gm, "");
const js = transformSync(src + "\nglobalThis.A=analyzeMcpTool;", { loader: "ts" }).code;
new Function(js)();
const D = JSON.parse(fs.readFileSync("benchmarks/mcp_tools_list_corpus.json", "utf8"));
let tp = 0, fn = 0, fp = 0, tn = 0;
for (const s of D.samples) {
  const t = s.tool;
  const f = globalThis.A(t.name, t.description, JSON.stringify(t.inputSchema || {}));
  const flagged = f.length > 0, bad = s.label === "bad";
  if (bad && flagged) tp++;
  else if (bad) { fn++; console.log("MISS", t.name); }
  else if (flagged) { fp++; console.log("FP", t.name, f.map(x => x.rule)); }
  else tn++;
}
console.log({ n: D.samples.length, tp, fn, fp, tn,
  recall: +(tp / Math.max(tp + fn, 1)).toFixed(3),
  precision: +(tp / Math.max(tp + fp, 1)).toFixed(3) });
