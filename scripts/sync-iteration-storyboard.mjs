import { readFile, writeFile } from "node:fs/promises";

// The explicit lesson runs in an opaque sandbox. Embed the shared component so
// both lessons use the same presentation without relaxing its CSP or sandbox.
const explicitFile = new URL("../dist/explicit-ns-presets.html", import.meta.url);
const componentFile = new URL("../dist/iteration-storyboard.js", import.meta.url);
const styleFile = new URL("../dist/iteration-storyboard.css", import.meta.url);
const [source, component, styles] = await Promise.all([
  readFile(explicitFile, "utf8"),
  readFile(componentFile, "utf8"),
  readFile(styleFile, "utf8")
]);
const attribute = /data-srcdoc="([\s\S]*?)"><\/iframe>/;
const match = source.match(attribute);
if (!match) throw new Error("Expected the explicit animation's data-srcdoc document.");

function decode(value) {
  return value.replace(/&(?:quot|apos|amp|lt|gt|#x[\da-f]+|#\d+);/gi, entity => {
    const named = { "&quot;": '"', "&apos;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">" };
    if (Object.hasOwn(named, entity)) return named[entity];
    const hexadecimal = entity.toLowerCase().startsWith("&#x");
    return String.fromCodePoint(parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10));
  });
}

function encode(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

let document = decode(match[1]);
const factory = component.replace(/^export\s+(?=function mountIterationStoryboard\b)/m, "");
if (factory === component) throw new Error("Expected the self-contained storyboard factory export.");
if (/^\s*(?:import|export)\b/m.test(factory)) throw new Error("The embedded factory must be self-contained.");
const embedded = [
  `<style id="cfd-iteration-storyboard-style">\n${styles.trim()}\n</style>`,
  `<script id="cfd-iteration-storyboard-script">\n${factory.trim()}\n</script>`
];
for (const block of embedded) {
  const id = block.match(/id="([^"]+)"/)[1];
  const tag = block.startsWith("<style") ? "style" : "script";
  const pattern = new RegExp(`<${tag} id="${id}">[\\s\\S]*?<\\/${tag}>`);
  document = pattern.test(document)
    ? document.replace(pattern, () => block)
    : document.replace("</head>", `${block}\n</head>`);
}
const result = source.replace(attribute, () => `data-srcdoc="${encode(document)}"></iframe>`);
if (process.argv.includes("--check")) {
  if (result !== source) throw new Error("Explicit storyboard is out of sync. Run scripts/sync-iteration-storyboard.mjs.");
  console.log("PASS: explicit sandbox and shared iteration storyboard agree.");
} else if (result !== source) {
  await writeFile(explicitFile, result);
  console.log("Updated the explicit animation's embedded iteration storyboard.");
}
