// ui/prefs.mts — the one writer of the page's view choices (PUT /api/ui-prefs). They live on the server, not
// in localStorage, because the desktop page's origin changes per launch. A write is fire and forget: the page
// already shows the choice, so a failure only says so in one toast (messages.mts's prefsSaveFailed), and `quiet`
// writes (the sidebar, a dismissed update notice, the copied scanner version) say nothing, since losing one only
// means the next launch starts from the default.
import { api } from "./api.mts";
import { toast } from "./dom.mts";
import { prefsSaveFailed } from "./messages.mts";
import type { UiPrefs } from "./api-types.mts";

export const prefs = {
  set(patch: UiPrefs, opts: { quiet?: boolean } = {}): void {
    api("/api/ui-prefs", { method: "PUT", body: patch }).catch((e: unknown) => { if (!opts.quiet) toast(prefsSaveFailed(e), "bad"); });
  },
};
