// Offline benchmark of analyzeMcpTool (extracted from src/index.ts) against benchmarks/mcp_scan_corpus.json
import fs from "fs"; import { transformSync } from "esbuild";
// analyzeMcpTool now lives in src/mcp_scan.ts (pure module); strip `export` so it
// runs inside a Function scope, then hand the function out.
const src = fs.readFileSync("src/mcp_scan.ts", "utf8").replace(/^export /gm, "");
const js = transformSync(src + "\nglobalThis.A=analyzeMcpTool;", { loader: "ts" }).code;
new Function(js)();
const C = JSON.parse(fs.readFileSync("benchmarks/mcp_scan_corpus.json", "utf8"));
let tp=0,fn=0,fp=0,tn=0;
for (const c of C) {
  const f = globalThis.A(c.name, c.description, "{}");
  const flagged = f.length > 0, bad = c.label === "bad";
  if (bad && flagged) tp++; else if (bad) { fn++; console.log("MISS", c.name); } else if (flagged) { fp++; console.log("FP", c.name, f.map(x=>x.rule)); } else tn++;
}
console.log({ tp, fn, fp, tn, recall: +(tp/(tp+fn)).toFixed(3), precision: +(tp/Math.max(tp+fp,1)).toFixed(3) });
