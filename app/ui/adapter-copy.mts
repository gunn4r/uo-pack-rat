// ui/adapter-copy.mts — what the page says about each game client, written per adapter rather than
// assembled from its README title ("Run ClassicUO web client adapter (paste transport)'s scanner" is
// the sentence this replaces). Pure and DOM-free like ui/adapters.mts, so the wording is pinned by
// app/adapter-copy.test.mts. An adapter this table does not know yet (a new one added to adapters/)
// still gets plain, correct text built from its own name and summary, never a blank.
import type { AdapterLike } from "./adapters.mts";
import { platformCompatible } from "./adapters.mts";

export interface AdapterCopy {
  short: string;                 // the name in running text: "TazUO", "ClassicUO web client"
  badge: { text: string; tone?: "ok" | undefined };
  blurb: string;                 // one plain sentence under the name on the wizard's client card
  blurbUnavailable: string;      // the same card when this machine can't run the client
  folderQuestion?: string;       // wizard step 3 (folder transport)
  folderHelp?: string;
  folderPick?: string;           // the native folder picker's title
  installQuestion?: string;      // wizard step 4 (folder transport)
  installHelp?: string;
  pasteHelp?: string;            // wizard steps 3-4 (paste transport)
}

const KNOWN: Record<string, AdapterCopy> = {
  tazuo: {
    short: "TazUO",
    badge: { text: "In-game actions", tone: "ok" },
    blurb: "Scans every layer, the bank, ground containers and nested bags. Highlight, Grab and Go to work from Pack Rat.",
    blurbUnavailable: "Scans every layer, the bank, ground containers and nested bags, with in-game actions.",
    folderQuestion: "Where is TazUO?",
    folderHelp: "Pick the TazUO folder or the LegionScripts folder inside it. Pack Rat puts its scanner in LegionScripts.",
    folderPick: "Choose your TazUO folder",
    installQuestion: "Install the scanner into TazUO",
    installHelp: "Pack Rat copies its scripts into LegionScripts. A script that is running can't be replaced, so stop them in game first.",
  },
  "razor-enhanced": {
    short: "Razor Enhanced",
    badge: { text: "In-game actions", tone: "ok" },
    blurb: "Scans every layer, the bank, ground containers and nested bags. Highlight, Grab and Go to work from Pack Rat.",
    blurbUnavailable: "Scans every layer, the bank, ground containers and nested bags, with in-game actions.",
    folderQuestion: "Where is Razor Enhanced?",
    folderHelp: "Pick the folder Razor.exe is in, or the Scripts folder inside it. Pack Rat puts its scanner in Scripts.",
    folderPick: "Choose your Razor Enhanced folder",
    installQuestion: "Install the scanner into Razor Enhanced",
    installHelp: "Pack Rat copies its scripts into the Scripts folder. A script that is running can't be replaced, so stop them in game first.",
  },
  "classicuo-web": {
    short: "ClassicUO web client",
    badge: { text: "Paste scans" },
    blurb: "Scans every layer, ground containers and nested bags. Nothing to install: you paste what its scanner prints into Import.",
    blurbUnavailable: "Scans every layer, ground containers and nested bags. You paste what its scanner prints into Import.",
    pasteHelp: "The web client runs in your browser and can't save files, so there is no folder to find and nothing to copy into it. Its scanner prints your scan in the game window instead.",
  },
};

const PLATFORM_NAMES: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };
export const platformName = (p: string | null | undefined): string => (p && PLATFORM_NAMES[p]) || p || "";
// "Not available on this Mac" — the machine the page runs on, in the words its owner uses for it.
export const thisMachine = (p: string | null | undefined): string => (p === "darwin" ? "this Mac" : "this computer");

export interface AdapterForCopy extends AdapterLike { name?: string | undefined; summary?: string | undefined }

export function adapterCopy(a: AdapterForCopy): AdapterCopy {
  const known = KNOWN[a.id];
  if (known) return known;
  const short = a.name || a.id;
  const paste = a.transport === "paste";
  const blurb = a.summary || (paste ? "You paste what its scanner prints into Import." : "Pack Rat installs a scanner into it.");
  return {
    short, blurb, blurbUnavailable: blurb,
    badge: paste ? { text: "Paste scans" } : { text: "Scanner scripts" },
    folderQuestion: `Where is ${short}?`,
    folderHelp: "Pick the client's folder or its scripts folder. Pack Rat finds the scripts folder inside it.",
    folderPick: `Choose your ${short} folder`,
    installQuestion: `Install the scanner into ${short}`,
    installHelp: "Pack Rat copies its scripts into the client's scripts folder. A script that is running can't be replaced, so stop them in game first.",
    pasteHelp: "This client can't save files, so there is no folder to find and nothing to copy into it.",
  };
}
export const shortName = (a: AdapterForCopy): string => adapterCopy(a).short;

// The client card on the wizard's step 2, and the option in the Import drawer's client select, for an
// adapter this machine can or cannot run.
export function clientCard(a: AdapterForCopy, platform: string | null | undefined): { name: string; badge: { text: string; tone?: "ok" | undefined }; sentence: string; available: boolean } {
  const c = adapterCopy(a);
  if (platformCompatible(a, platform)) return { name: c.short, badge: c.badge, sentence: c.blurb, available: true };
  return { name: c.short, badge: { text: `${platformName(a.platform)} only` }, sentence: `Not available on ${thisMachine(platform)}. ${c.blurbUnavailable}`, available: false };
}
export function importOptionLabel(a: AdapterForCopy, platform: string | null | undefined): string {
  const c = adapterCopy(a);
  if (!platformCompatible(a, platform)) return `${c.short} (${platformName(a.platform)} only)`;
  return a.transport === "paste" ? `${c.short} (paste)` : c.short;
}

// The wizard's named steps. The paste branch renames steps 3 and 4 the moment a paste client is picked,
// so the stepper shows up front that there is nothing to install.
export function wizardSteps(paste: boolean): string[] {
  return paste ? ["Shard", "Client", "Nothing to install", "Paste your first scan"] : ["Shard", "Client", "Client folder", "Install scanner"];
}
