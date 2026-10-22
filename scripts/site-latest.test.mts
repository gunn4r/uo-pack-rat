// site-latest.test.mts — the website's latest.json from a release (scripts/site-latest.mts): the real 0.3.0 release maps each platform to its one asset with its size and SHA-256, and a missing, doubled or unlisted asset, a draft or a prerelease fails with every problem named.
import test from "node:test";
import assert from "node:assert/strict";
import { latestJson, parseSums, PLATFORMS, type Release } from "./site-latest.mts";

// The 0.3.0 release as `gh release view --json` gives it, and its SHA256SUMS.
const DL = "https://github.com/gunn4r/uo-pack-rat/releases/download/v0.3.0";
const RELEASE: Release = {
  tagName: "v0.3.0", publishedAt: "2026-10-21T21:42:37Z", url: "https://github.com/gunn4r/uo-pack-rat/releases/tag/v0.3.0", isDraft: false, isPrerelease: false,
  assets: [
    { name: "latest-linux.yml", size: 392, url: `${DL}/latest-linux.yml` },
    { name: "latest-mac.yml", size: 819, url: `${DL}/latest-mac.yml` },
    { name: "latest.yml", size: 347, url: `${DL}/latest.yml` },
    { name: "PackRat-0.3.0-linux-x86_64.AppImage", size: 128446734, url: `${DL}/PackRat-0.3.0-linux-x86_64.AppImage` },
    { name: "PackRat-0.3.0-mac-arm64.dmg", size: 133986644, url: `${DL}/PackRat-0.3.0-mac-arm64.dmg` },
    { name: "PackRat-0.3.0-mac-arm64.dmg.blockmap", size: 138570, url: `${DL}/PackRat-0.3.0-mac-arm64.dmg.blockmap` },
    { name: "PackRat-0.3.0-mac-arm64.zip", size: 131873281, url: `${DL}/PackRat-0.3.0-mac-arm64.zip` },
    { name: "PackRat-0.3.0-mac-arm64.zip.blockmap", size: 137795, url: `${DL}/PackRat-0.3.0-mac-arm64.zip.blockmap` },
    { name: "PackRat-0.3.0-mac-x64.dmg", size: 140635730, url: `${DL}/PackRat-0.3.0-mac-x64.dmg` },
    { name: "PackRat-0.3.0-mac-x64.dmg.blockmap", size: 146793, url: `${DL}/PackRat-0.3.0-mac-x64.dmg.blockmap` },
    { name: "PackRat-0.3.0-mac-x64.zip", size: 138578942, url: `${DL}/PackRat-0.3.0-mac-x64.zip` },
    { name: "PackRat-0.3.0-mac-x64.zip.blockmap", size: 146024, url: `${DL}/PackRat-0.3.0-mac-x64.zip.blockmap` },
    { name: "PackRat-0.3.0-portable-win-x64.exe", size: 113843520, url: `${DL}/PackRat-0.3.0-portable-win-x64.exe` },
    { name: "PackRat-0.3.0-win-x64.exe", size: 114257637, url: `${DL}/PackRat-0.3.0-win-x64.exe` },
    { name: "PackRat-0.3.0-win-x64.exe.blockmap", size: 120268, url: `${DL}/PackRat-0.3.0-win-x64.exe.blockmap` },
    { name: "SHA256SUMS", size: 1417, url: `${DL}/SHA256SUMS` },
  ],
};
const SUMS = `2b728acbdd8ece0b7af10939eabce406f9063a9237cf89c1dde65ff7baa02cca  PackRat-0.3.0-linux-x86_64.AppImage
b329a1e6959d4e0d0832db1b432eb5993034b101202a42b47744491a703ea7d4  PackRat-0.3.0-mac-arm64.dmg
3aac8fbef38092a04009ec3fbcc36164a4d22cd197eed7d49b7e1dd68bdb8f98  PackRat-0.3.0-mac-arm64.dmg.blockmap
4f6742980f029cb96f783aae1401929d96af9004504c08b1f26c809e03ed256e  PackRat-0.3.0-mac-arm64.zip
f81213fe13c0b9f631eb7ce45c60f51c01a1f23fcd5f307220c1889ddb8954b9  PackRat-0.3.0-mac-arm64.zip.blockmap
a27d97260cd30433e7d501ec241d7d597f3c3dde025f3bfb07d39f5b69ab0eb9  PackRat-0.3.0-mac-x64.dmg
2a2e929dcb8c9b7861d957e28eb190c2a9e5dce27b4360fa116f81ac1fd21b5b  PackRat-0.3.0-mac-x64.dmg.blockmap
1e676780b8441ff1399b5c01e0753a0dc772e2d5eb785733e1aeb39ed6a1aabf  PackRat-0.3.0-mac-x64.zip
b109261fe50570ef636df863bdd14370e7b5c38414051f54dd4cd2b658808eac  PackRat-0.3.0-mac-x64.zip.blockmap
f665cb4691c37fcb3c31a604af03fcabd2009e832562baa202548497eebb2d40  PackRat-0.3.0-portable-win-x64.exe
5638620aebe51c508a29464c4012fce9ba213147300446835de6690e1b9ad997  PackRat-0.3.0-win-x64.exe
660b00522f5a21ee417a1770632bb5f98e2ac740adc3b99945f60ce62b5f4685  PackRat-0.3.0-win-x64.exe.blockmap
273bbe99e6071667823a544b9f49d8578d8b34034d9a23c4bfd1aea57dca281a  latest-linux.yml
c1b1505e3d96bf2a8f90c2af5d7ce1262cde64ce17782b608145e4b900ac0012  latest-mac.yml
5f3eb117f1c57b31ea7bcea4d18c33907323722b741ed93a3e8a32589841a17a  latest.yml
`;
const without = (r: Release, name: string): Release => ({ ...r, assets: r.assets.filter((a) => a.name !== name) });

test("[fast] site-latest: the 0.3.0 release gives each platform its file, URL, size and SHA-256", () => {
  const latest = latestJson(RELEASE, SUMS);
  assert.equal(latest.version, "0.3.0");
  assert.equal(latest.published, "2026-10-21T21:42:37Z");
  assert.equal(latest.notes, "https://github.com/gunn4r/uo-pack-rat/releases/tag/v0.3.0");
  assert.equal(latest.checksums, `${DL}/SHA256SUMS`);
  assert.deepEqual(Object.fromEntries(Object.entries(latest.downloads).map(([k, d]) => [k, d.file])), {
    win: "PackRat-0.3.0-win-x64.exe", "win-portable": "PackRat-0.3.0-portable-win-x64.exe",
    "mac-arm64": "PackRat-0.3.0-mac-arm64.dmg", "mac-x64": "PackRat-0.3.0-mac-x64.dmg", linux: "PackRat-0.3.0-linux-x86_64.AppImage",
  });
  assert.deepEqual(latest.downloads.win, { label: "Windows installer", file: "PackRat-0.3.0-win-x64.exe", size: 114257637, url: `${DL}/PackRat-0.3.0-win-x64.exe`, sha256: "5638620aebe51c508a29464c4012fce9ba213147300446835de6690e1b9ad997" });
  assert.equal(latest.downloads["mac-arm64"].sha256, "b329a1e6959d4e0d0832db1b432eb5993034b101202a42b47744491a703ea7d4", "the .dmg, not its .blockmap or the .zip");
  assert.equal(PLATFORMS.length, Object.keys(latest.downloads).length);
});

test("[fast] site-latest: a missing platform, two matching assets or a file missing from SHA256SUMS fails, naming each", () => {
  assert.throws(() => latestJson(without(RELEASE, "PackRat-0.3.0-linux-x86_64.AppImage"), SUMS), /Linux AppImage: no asset matches/);
  const doubled: Release = { ...RELEASE, assets: [...RELEASE.assets, { name: "PackRat-0.3.0-arm-mac-arm64.dmg", size: 1, url: `${DL}/x` }] };
  assert.throws(() => latestJson(doubled, SUMS), /macOS, Apple silicon: 2 assets match/);
  const unlisted = SUMS.split("\n").filter((l) => !l.endsWith(" PackRat-0.3.0-win-x64.exe")).join("\n");
  assert.throws(() => latestJson(RELEASE, unlisted), /Windows installer: PackRat-0.3.0-win-x64.exe is not in SHA256SUMS/);
  assert.throws(() => latestJson(without(RELEASE, "SHA256SUMS"), SUMS), /no SHA256SUMS/);
  // Every problem at once, so one run says everything to fix.
  assert.throws(() => latestJson(without(without(RELEASE, "PackRat-0.3.0-mac-x64.dmg"), "PackRat-0.3.0-portable-win-x64.exe"), SUMS), (e: Error) => /macOS, Intel/.test(e.message) && /Windows portable/.test(e.message));
});

test("[fast] site-latest: a draft or a prerelease is refused", () => {
  assert.throws(() => latestJson({ ...RELEASE, isDraft: true }, SUMS), /is a draft/);
  assert.throws(() => latestJson({ ...RELEASE, isPrerelease: true }, SUMS), /is a prerelease/);
});

test("[fast] site-latest: SHA256SUMS lines are read in text and binary mode, with CRLF line ends", () => {
  const sums = parseSums(`${"a".repeat(64)}  one.exe\r\n${"B".repeat(64)} *two.dmg\r\nnot a line\n`);
  assert.deepEqual([...sums], [["one.exe", "a".repeat(64)], ["two.dmg", "b".repeat(64)]]);
});
