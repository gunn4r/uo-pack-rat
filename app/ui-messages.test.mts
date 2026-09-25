// ui-messages.test.mts — app/ui/messages.mts, the plain sentences the page shows for an outcome the
// server reports as a count, a status code or a one-word field. It lives in app/ rather than app/ui/
// for the same reason app/ui-render.test.mts and app/wizard-default-adapter.test.mts do:
// tsconfig.browser.json compiles app/ui/** for the browser. No DOM stub is needed here — messages.mts
// is pure text, which is the whole point of keeping it out of the modules that render it.
// All [fast]. Run: node --test app/ui-messages.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathsFileNote, installedIntoNote, clientFolderGone, clientErrorMessage, hostErrorMessage, optimizeErrorMessage, errorText, dataDirNotice, dataDirBanner, bridgeOfflineText, bridgeView, relativeWhen, cleanupText } from "./ui/messages.mts";
import type { ApiError } from "./ui/api-types.mts";

function apiError(message: string, extra: { status?: number; code?: unknown } = {}): ApiError {
  const e: ApiError = new Error(message);
  if (extra.status !== undefined) e.status = extra.status;
  if (extra.code !== undefined) e.code = extra.code;
  return e;
}

// ---- GET /api/setup's dataDirCheck ------------------------------------------------------------------
test("[fast] a data-folder mismatch names both folders and both fixes", () => {
  const text = dataDirNotice({ status: "mismatch", scriptsDir: "/Users/example/TazUO/LegionScripts", scriptsDataDir: "/Users/example/dev-data", dataDir: "/Users/example/.pack-rat" })!;
  assert.match(text, /\/Users\/example\/TazUO\/LegionScripts/);
  assert.match(text, /write to \/Users\/example\/dev-data/);
  assert.match(text, /reading \/Users\/example\/\.pack-rat/);
  assert.match(text, /npm start -- --data \/Users\/example\/dev-data/);
  assert.match(text, /reinstall the scripts from Settings/);
});

test("[fast] an unreadable packrat-paths.json is reported with the reason; a match or no client says nothing", () => {
  const text = dataDirNotice({ status: "unreadable", scriptsDir: "/Users/example/LegionScripts", error: "it is not valid JSON" })!;
  assert.match(text, /packrat-paths\.json in \/Users\/example\/LegionScripts/);
  assert.match(text, /it is not valid JSON/);
  assert.equal(dataDirNotice({ status: "match", scriptsDir: "/x" }), null);
  assert.equal(dataDirNotice({ status: "none" }), null);
  assert.equal(dataDirNotice(undefined), null, "an older server sends no check at all");
});

test("[fast] the banner says the problem in one short line with no paths; Settings keeps the full sentence", () => {
  const mismatch = dataDirBanner({ status: "mismatch", scriptsDir: "/Users/example/TazUO/LegionScripts", scriptsDataDir: "/Users/example/dev-data", dataDir: "/Users/example/.pack-rat" });
  assert.equal(mismatch, "Your game scripts write scans to a different folder than Pack Rat is reading.");
  const unreadable = dataDirBanner({ status: "unreadable", scriptsDir: "/Users/example/LegionScripts", error: "it is not valid JSON" })!;
  assert.doesNotMatch(unreadable, /\/Users/);
  assert.match(unreadable, /packrat-paths\.json/);
  assert.equal(dataDirBanner({ status: "match", scriptsDir: "/x" }), null);
  assert.equal(dataDirBanner({ status: "none" }), null);
  assert.equal(dataDirBanner(undefined), null);
});

test("[fast] control characters in a data-folder notice are dropped before it reaches a terminal", () => {
  const esc = "\u001b[2J\u001b]0;pwned\u0007";
  const mismatch = dataDirNotice({ status: "mismatch", scriptsDir: "/a", scriptsDataDir: `/b${esc}\nFAKE LINE`, dataDir: "/c" })!;
  const unreadable = dataDirNotice({ status: "unreadable", scriptsDir: "/a", error: `bad${esc}\r\n` })!;
  for (const text of [mismatch, unreadable]) assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f]/, JSON.stringify(text));
  assert.match(mismatch, /\/b\[2J\]0;pwnedFAKE LINE/, "the printable rest is kept");
});

test("[fast] the offline bridge pill says why only when the cause is a data-folder mismatch", () => {
  assert.equal(bridgeOfflineText({ status: "mismatch", scriptsDir: "/a", scriptsDataDir: "/b", dataDir: "/c" }), "Bridge offline — your game scripts write to another folder");
  assert.equal(bridgeOfflineText({ status: "match", scriptsDir: "/a" }), "Bridge offline");
  assert.equal(bridgeOfflineText(undefined), "Bridge offline");
});

// ---- POST /api/setup/install -----------------------------------------------------------------------
test("[fast] only the two packrat-paths.json decisions a player has to know about say anything", () => {
  assert.equal(pathsFileNote("written"), null);
  assert.equal(pathsFileNote("unchanged"), null);
  assert.equal(pathsFileNote(undefined), null);
  assert.match(pathsFileNote("kept")!, /^Kept your existing packrat-paths\.json/);
  assert.match(pathsFileNote("backed-up")!, /packrat-paths\.json\.bak/);
});

test("[fast] the install reports the folder the server resolved, not nothing at all", () => {
  assert.equal(installedIntoNote("/Users/example/TazUO/TazUO/LegionScripts"), "Installed into /Users/example/TazUO/TazUO/LegionScripts");
  assert.equal(installedIntoNote(undefined), null);
});

// ---- a client folder that is no longer there ------------------------------------------------------
test("[fast] both routes' ways of saying 'that folder is gone' become one sentence", () => {
  // POST /api/setup/install answers 400 with code "badDir"; PUT /api/settings names the field.
  assert.equal(clientFolderGone(apiError("no scripts folder found there for that client", { status: 400, code: "badDir" })), true);
  assert.equal(clientFolderGone(apiError("settings.client.scriptsDir: no scripts folder found there for that client", { status: 400 })), true);
  assert.equal(clientFolderGone(apiError("a Pack Rat script is running in the client", { status: 409, code: "running" })), false);
  assert.match(clientErrorMessage(apiError("no scripts folder found there for that client", { status: 400, code: "badDir" })), /run setup again/);
});

test("[fast] every other install failure is shown exactly as the server worded it", () => {
  const running = "a Pack Rat script is running in the client — type -stopall in game";
  assert.equal(clientErrorMessage(apiError(running, { status: 409, code: "running" })), running);
});

// ---- POST /api/host/* ------------------------------------------------------------------------------
test("[fast] a host call the desktop app never answered says so instead of showing a bare timeout", () => {
  const timedOut = apiError("the desktop app did not answer", { status: 504 });
  assert.equal(hostErrorMessage(timedOut, "Could not open that folder"), "Could not open that folder — the desktop app didn't answer. Try again.");
  assert.equal(hostErrorMessage(apiError("something else", { status: 400 }), "Could not open that folder"), "something else");
});

// ---- POST /api/optimize ----------------------------------------------------------------------------
test("[fast] a 429 explains that the builds are somebody else's, not a failure of this one", () => {
  assert.match(optimizeErrorMessage(apiError("too many builds are already running; try again in a moment", { status: 429 })), /Wait for it to finish/);
  assert.equal(optimizeErrorMessage(apiError("character not found", { status: 400 })), "character not found");
});

test("[fast] errorText survives a rejection that isn't an Error at all", () => {
  assert.equal(errorText("plain string"), "plain string");
  assert.equal(errorText(new Error("real error")), "real error");
});

test("[fast] bridgeView: ready and busy whenever the bridge answers, else no client or offline", () => {
  const client = { clientSet: true, clientName: "TazUO" };
  assert.deepEqual(bridgeView({ online: true, character: "Kestrel" }, client), { state: "ready", dot: "ok", label: "Bridge ready · Kestrel", title: "Bridge ready", detail: "packrat-bridge.py is running on Kestrel. Highlight, Grab and Go to reach the game." });
  const busy = bridgeView({ online: true, character: "Kestrel", current: { action: "grab", name: "Mighty Orc Mask" } }, { clientSet: false, clientName: null });
  assert.equal(busy.state, "busy");
  assert.equal(busy.label, "Kestrel · grab Mighty Orc Mask");
  const off = bridgeView({ online: false }, client);
  assert.deepEqual([off.state, off.dot, off.label], ["offline", "", "Bridge offline"]);
  assert.match(off.detail, /Press Play on it in TazUO/);
  const none = bridgeView(null, { clientSet: false, clientName: "TazUO" });
  assert.deepEqual([none.state, none.dot, none.label], ["noclient", "warn", "No client set up"]);
  assert.match(none.detail, /go to TazUO by default/);
  // A data-folder mismatch is named as the cause, client or not.
  const mismatch = { status: "mismatch", scriptsDir: "/s", scriptsDataDir: "/b", dataDir: "/c" } as const;
  const m = bridgeView({ online: false }, { clientSet: false, clientName: null, check: mismatch });
  assert.deepEqual([m.state, m.label], ["offline", "Bridge offline — your game scripts write to another folder"]);
  assert.match(m.detail, /write to \/b, but Pack Rat is reading \/c/);
});

test("[fast] relativeWhen: relative under a day, then month day and time, with the year only when it differs", () => {
  const now = new Date(2026, 8, 22, 21, 0);
  assert.equal(relativeWhen(new Date(2026, 8, 22, 20, 59, 40).toISOString(), now), "just now");
  assert.equal(relativeWhen(new Date(2026, 8, 22, 20, 5).toISOString(), now), "55 min ago");
  assert.equal(relativeWhen(new Date(2026, 8, 22, 18, 0).toISOString(), now), "3 h ago");
  assert.equal(relativeWhen(new Date(2026, 0, 1, 12, 0).toISOString(), now), "Jan 1, 12:00");
  assert.equal(relativeWhen(new Date(2025, 11, 31, 9, 5).toISOString(), now), "Dec 31, 2025, 09:05");
  assert.equal(relativeWhen("not a date", now), "");
  assert.equal(relativeWhen(null, now), "");
});

test("[fast] Clean up now's counts: both kinds, one kind, singular, and nothing", () => {
  assert.equal(cleanupText({ scans: 1042, runs: 7 }), "1,042 scans and 7 runs");
  assert.equal(cleanupText({ scans: 1, runs: 0 }), "1 scan");
  assert.equal(cleanupText({ scans: 0, runs: 1 }), "1 run");
  assert.equal(cleanupText({ scans: 0, runs: 0 }), "nothing");
});
