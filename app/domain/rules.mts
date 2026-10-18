// domain/rules.mts — the shard rules the kernel reads, set once by the loader: setRules() hands them in (app/rules.mts loads and checks the file, Node-only), getRules() reads them and throws until then, so a forgotten call is loud rather than a silent wrong answer. Browser-safe: it never reads a file.
//
// map: rules
// owns: `setRules`, `getRules`
import type { RulesV1 } from "../schema/types.d.mts";

let RULES: RulesV1 | null = null;
export function setRules(r: RulesV1) { RULES = r; }
export function getRules(): RulesV1 {
  if (!RULES) throw new Error("rules not loaded — call setRules() first (see app/rules.mts)");
  return RULES;
}
