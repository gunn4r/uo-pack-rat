// american-spelling.test.mts — [smoke]: standing guard for the project's American spelling in what a player reads
// (issue #10). It reads the string literals of every app/ui/*.mts file (comments and code left out, and a template
// literal's ${…} expressions too) and the whole of app/index.html, and fails on a British form from the list the
// sweep replaced. Identifiers that happen to carry one (a CSS class, an element id, `aria-labelledby`) are allowed
// by name; renaming those is not the point, the words on the page are.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRITISH = /colour|labelled|grey|centre|armour|jewellery|favourite|behaviour/i;
// Whole tokens (letters, digits, '-' and '_') that are identifiers, not words: they may stay as they are.
const ALLOWED = new Set(["aria-labelledby", "lbl-colour", "map-colour", "map-colours", "map-colour-"]);

// The text of each string literal in a TypeScript source: '…', "…" and `…` (minus its ${…} parts), skipping
// comments. Regex literals are not told apart from division, which the page's sources never make ambiguous here.
export function stringLiterals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  const template = (): string => {   // at the char after the opening backtick; returns the literal text
    let text = "";
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") { text += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === "$" && src[i + 1] === "{") { i += 2; code("}"); text += " "; continue; }
      text += src[i++];
    }
    i++;
    return text;
  };
  const code = (until: string | null): void => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i]!;
      if (until && c === "}" && depth === 0) { i++; return; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) i = src.length; continue; }
      if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2); i = i < 0 ? src.length : i + 2; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
        out.push(src.slice(i + 1, j));
        i = j + 1;
        continue;
      }
      if (c === "`") { i++; out.push(template()); continue; }
      i++;
    }
  };
  code(null);
  return out;
}

const offenders = (text: string): string[] =>
  (text.match(/[\w-]+/g) ?? []).filter((w) => BRITISH.test(w) && !ALLOWED.has(w));

test("[smoke] stringLiterals reads strings and template text, not comments, code or ${…} expressions", () => {
  assert.deepEqual(stringLiterals(`// "colour"\nconst colour = "Colour"; /* 'grey' */ f(\`a \${colour + "b"} c\`, 'd');`), ["Colour", "b", "a   c", "d"]);
  assert.deepEqual(offenders("A labelled chest, grey and centred · aria-labelledby map-colour"), ["labelled", "grey", "centred"]);
});

test("[smoke] the page's own words use American spelling: no British form in app/ui/*.mts strings or app/index.html", () => {
  const found: string[] = [];
  const ui = join(root, "app", "ui");
  for (const f of readdirSync(ui).filter((x) => x.endsWith(".mts")).sort()) {
    for (const s of stringLiterals(readFileSync(join(ui, f), "utf8"))) for (const w of offenders(s)) found.push(`app/ui/${f}: "${w}" in ${JSON.stringify(s.slice(0, 80))}`);
  }
  for (const w of offenders(readFileSync(join(root, "app", "index.html"), "utf8"))) found.push(`app/index.html: "${w}"`);
  assert.deepEqual(found, [], `British spelling in user-facing text:\n${found.join("\n")}`);
});
