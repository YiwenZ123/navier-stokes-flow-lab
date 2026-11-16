import { readFile, writeFile } from "node:fs/promises";
import { SPATIAL_GRID } from "../dist/spatial-grid.js";

// The explicit animation runs in a sandboxed srcdoc and cannot import local modules.
// Synchronize only its numeric configuration; preserve its CSP and iframe sandbox.
const file = new URL("../dist/explicit-ns-presets.html", import.meta.url);
const source = await readFile(file, "utf8");
const pattern = /const spatialGrid = \{ intervals: \d+, length: [\d.eE+-]+ \};/g;
const matches = source.match(pattern);
if (matches?.length !== 1) throw new Error("Expected one explicit spatial-grid configuration.");
const expected = `const spatialGrid = { intervals: ${SPATIAL_GRID.intervals}, length: ${SPATIAL_GRID.length} };`;
if (process.argv.includes("--check")) {
  if (matches[0] !== expected) throw new Error("Explicit spatial grid is out of sync. Run scripts/sync-spatial-grid.mjs.");
  console.log("PASS: explicit sandbox and shared spatial grid agree.");
} else if (matches[0] !== expected) {
  await writeFile(file, source.replace(pattern, expected));
  console.log("Updated explicit sandbox spatial grid.");
}
