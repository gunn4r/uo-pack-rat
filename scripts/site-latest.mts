#!/usr/bin/env node
// site-latest.mts — the website's latest.json from a published release: each download button's file, URL, size and SHA-256.
//   node scripts/site-latest.mts <release.json> <SHA256SUMS> [--out latest.json]
//
// `release.json` is `gh release view --json tagName,publishedAt,url,isDraft,isPrerelease,assets`; SHA256SUMS is the release's own checksum file. Assets are matched to the five platforms by the end of their names (PLATFORMS); a platform with no asset, or with two, fails the run, so a renamed asset can't quietly break a button on the site. The Pages workflow (`.github/workflows/pages.yml`) runs it on each deploy; the page reads latest.json and falls back to the Releases page without it.
//
// map: tooling
// owns: `PLATFORMS`, `latestJson`, `parseSums`
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A platform's key on the page, its label, and the end of its asset's name (electron-builder's artifactName in
// package.json). The installer's pattern needs the portable build's word ruled out, since both end the same way.
export const PLATFORMS = [
  { key: "win", label: "Windows installer", matches: (name: string): boolean => name.endsWith("-win-x64.exe") && !name.includes("-portable-") },
  { key: "win-portable", label: "Windows portable", matches: (name: string): boolean => name.endsWith("-portable-win-x64.exe") },
  { key: "mac-arm64", label: "macOS, Apple silicon", matches: (name: string): boolean => name.endsWith("-mac-arm64.dmg") },
  { key: "mac-x64", label: "macOS, Intel", matches: (name: string): boolean => name.endsWith("-mac-x64.dmg") },
  { key: "linux", label: "Linux AppImage", matches: (name: string): boolean => name.endsWith("-linux-x86_64.AppImage") },
] as const;
export type PlatformKey = (typeof PLATFORMS)[number]["key"];

export interface ReleaseAsset { name: string; size: number; url: string }
export interface Release { tagName: string; publishedAt: string; url: string; isDraft?: boolean; isPrerelease?: boolean; assets: ReleaseAsset[] }
export interface Download { label: string; file: string; size: number; url: string; sha256: string }
export interface Latest { version: string; published: string; notes: string; checksums: string; downloads: Record<PlatformKey, Download> }

// SHA256SUMS ("<hash>  <file>" per line, as sha256sum writes it) as a map from file name to hash.
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line.trim());
    if (m) sums.set(m[2]!, m[1]!.toLowerCase());
  }
  return sums;
}

// latest.json for a release, or an error naming everything wrong with it.
export function latestJson(release: Release, sumsText: string): Latest {
  const problems: string[] = [];
  if (release.isDraft) problems.push(`${release.tagName} is a draft`);
  if (release.isPrerelease) problems.push(`${release.tagName} is a prerelease`);
  const sums = parseSums(sumsText);
  const checksums = release.assets.find((a) => a.name === "SHA256SUMS");
  if (!checksums) problems.push("the release has no SHA256SUMS");
  const downloads: Partial<Record<PlatformKey, Download>> = {};
  for (const p of PLATFORMS) {
    const found = release.assets.filter((a) => p.matches(a.name));
    if (found.length !== 1) { problems.push(found.length ? `${p.label}: ${found.length} assets match (${found.map((a) => a.name).join(", ")})` : `${p.label}: no asset matches`); continue; }
    const a = found[0]!, sha256 = sums.get(a.name);
    if (!sha256) { problems.push(`${p.label}: ${a.name} is not in SHA256SUMS`); continue; }
    downloads[p.key] = { label: p.label, file: a.name, size: a.size, url: a.url, sha256 };
  }
  if (problems.length) throw new Error(`can't write latest.json for ${release.tagName}:\n  ${problems.join("\n  ")}`);
  return { version: release.tagName.replace(/^v/, ""), published: release.publishedAt, notes: release.url, checksums: checksums!.url, downloads: downloads as Record<PlatformKey, Download> };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
  const [releaseFile, sumsFile] = args;
  if (!releaseFile || !sumsFile) { console.error("usage: node scripts/site-latest.mts <release.json> <SHA256SUMS> [--out latest.json]"); process.exit(2); }
  try {
    const latest = JSON.stringify(latestJson(JSON.parse(readFileSync(releaseFile, "utf8")) as Release, readFileSync(sumsFile, "utf8")), null, 2) + "\n";
    if (out) writeFileSync(out, latest); else process.stdout.write(latest);
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
