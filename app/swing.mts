// swing.mts — swing speed (issue #217): how long a weapon takes between swings for a character's stamina and Swing Speed Increase, the steps SSI moves it through, and the table both solvers score SSI with when the build scores it by step. Pure and browser-safe, with no imports beyond types.
//
// The formula is stock ServUO's (ML and later, BaseWeapon.GetDelay), in whole quarter seconds: ticks = max(5, floor(N · 100 / (100 + S))) with N = round(4 × weapon speed) − floor(stamina / 30) and S the SSI, capped at 60. A delay is ticks × 0.25 s. Stamina here is full stamina, so a tired character swings slower than shown.
import type { EffectiveProfile } from "./vault-lib.mts";
import type { SwingResult, SwingStep } from "./runs-types.mts";

export type { SwingResult, SwingStep } from "./runs-types.mts";

export const SSI_CAP = 60;       // the formula's own cap on SSI, buffs included
export const MIN_TICKS = 5;      // the fastest swing: one every 1.25 s
const TICK_S = 0.25;

const baseTicks = (speedS: number, stamina: number): number => Math.round(4 * speedS) - Math.floor(Math.max(0, stamina) / 30);
// The ticks between swings at `ssi` effective SSI (gear and buffs, capped at 60 here).
export function swingTicks(speedS: number, stamina: number, ssi: number): number {
  const s = Math.min(SSI_CAP, ssi), n = baseTicks(speedS, stamina);
  return Math.max(MIN_TICKS, Math.floor((100 * n) / (100 + s)));
}
export const swingSeconds = (speedS: number, stamina: number, ssi: number): number => swingTicks(speedS, stamina, ssi) * TICK_S;
// A delay as the page writes it: "2.0 s", "1.75 s".
export const delayText = (seconds: number): string => `${seconds % 0.5 === 0 ? seconds.toFixed(1) : seconds.toFixed(2)} s`;
// The least SSI that brings the swing to `ticks` or faster, with no cap: floor(100 · N / (ticks + 1)) − 99. It is 0 or less for a delay the weapon reaches with no SSI (less than 0 when a little negative SSI, a form's, still keeps it).
const ssiAtLeast = (n: number, ticks: number): number => Math.floor((100 * n) / (ticks + 1)) - 99;
const ssiNeeded = (n: number, ticks: number): number => Math.max(0, ssiAtLeast(n, ticks));
// The least effective SSI that reaches `ticks`, or null when that takes more than the cap (or the swing is never that slow).
export function ssiForTicks(speedS: number, stamina: number, ticks: number): number | null {
  if (ticks < MIN_TICKS) return null;
  const s = ssiNeeded(baseTicks(speedS, stamina), ticks);
  return s <= SSI_CAP ? s : null;
}

// Every step SSI can reach at this stamina, slowest first: the delay and the least effective SSI that gives it. A step the buffs alone reach (`share`, their SSI) is left out, so the list starts at the first one gear has to pay for.
export function swingSteps(speedS: number, stamina: number, share = 0): SwingStep[] {
  const n = baseTicks(speedS, stamina), out: SwingStep[] = [];
  for (let t = n - 1; t >= MIN_TICKS; t--) {
    const s = ssiNeeded(n, t);
    if (s > SSI_CAP) break;
    if (s > share) out.push({ seconds: t * TICK_S, ssi: s });
  }
  return out;
}

// A character's full stamina: raw DEX, the gear's Stamina pool (DEX bonus + Stamina Increase) and the buffs' in-cap shares on both.
export function staminaOf(rawDex: number, totals: Readonly<Record<string, number>>, shares: Readonly<Record<string, number>> = {}): number {
  return rawDex + (totals.stamPool || 0) + (shares.dexBonus || 0) + (shares.stamPool || 0);
}

// One point of the step table: a suit whose item SSI is at least `ssi` and whose gear Stamina pool is at least `stam` swings at a delay worth `credit` SSI points.
export interface SsiStepPoint { ssi: number; stam: number; credit: number }
export interface StepTableInput {
  speedS: number;
  stamBase: number;                          // stamina before gear: raw DEX plus the buffs' shares
  refStamina: number;                        // the worn suit's stamina, which prices each delay
  share: number;                             // the buffs' SSI
  stamRange: { min: number; max: number };   // the lowest and highest gear Stamina pool any suit reaches
}
// The table both solvers score SSI with: one point per delay reachable in each stamina band any suit can be in. `ssi` is in item terms (the step's SSI less the buffs'), `stam` the gear Stamina pool the band needs, and `credit` what the delay costs in gear SSI at the reference stamina, at least 0 (a delay reached only by raising stamina keeps that price, so 1.5 s one band up can credit more than 60). Points worth nothing and points another beats (no less credit for no more SSI and stamina) are left out.
export function stepTable({ speedS, stamBase, refStamina, share, stamRange }: StepTableInput): SsiStepPoint[] {
  const band = (stam: number): number => Math.floor(Math.max(0, stam) / 30);
  const nRef = baseTicks(speedS, refStamina), all: SsiStepPoint[] = [];
  // the slowest delay with a credit above 0: ssiAtLeast(nRef, t) > share
  const tTop = share > -100 ? Math.floor((100 * nRef) / (100 + share)) : nRef;
  for (let b = band(stamBase + stamRange.min); b <= band(stamBase + stamRange.max); b++) {
    const n = Math.round(4 * speedS) - b;
    // every delay worth something, from the slowest (a band above the reference's is faster with no SSI, and a negative
    // share makes even a slower delay cost gear SSI) to the fastest the cap allows
    for (let t = Math.max(n, MIN_TICKS, tTop); t >= MIN_TICKS; t--) {
      const s = ssiAtLeast(n, t);
      if (s > SSI_CAP) break;
      const credit = Math.max(0, ssiAtLeast(nRef, t) - share);
      if (credit > 0) all.push({ ssi: s - share, stam: 30 * b - stamBase, credit });
    }
  }
  const beats = (q: SsiStepPoint, p: SsiStepPoint): boolean => q.credit >= p.credit && q.ssi <= p.ssi && q.stam <= p.stam;
  return all.filter((p, i) => !all.some((q, j) => j !== i && beats(q, p) && (!beats(p, q) || j < i)));
}

// The largest credit among the points a suit with `ssi` item SSI and `stam` gear Stamina pool reaches, 0 when it reaches none: what SSI by step scores (scripts/optimizer-core.mts optStepCredit, which keeps its own copy: the core imports nothing).
export function stepCredit(points: readonly SsiStepPoint[], ssi: number, stam: number): number {
  let best = 0;
  for (const p of points) if (ssi >= p.ssi - 1e-9 && stam >= p.stam - 1e-9 && p.credit > best) best = p.credit;
  return best;
}

// The one base speed every weapon a suit can hold shares: the hand slots' candidates (the pool and the worn piece) that carry a speed. A two-handed weapon is no candidate while the one-handed slot must keep its worn piece (locked: not among `optionalSlots`), as in the solvers. Null, with the reason, when there is none or they differ.
export function weaponSpeedOf(pools: Partial<Record<string, Held[]>>, current: Partial<Record<string, Held | null | undefined>>, optionalSlots?: readonly string[]): { speed: number | null; reason: string | null } {
  const oneKept = !!optionalSlots && !optionalSlots.includes("oneHanded") && !!current.oneHanded;
  const speeds = new Set<number>();
  for (const slot of ["oneHanded", "twoHanded"]) for (const it of [...(pools[slot] || []), current[slot]]) {
    if (it && typeof it.speed === "number" && it.speed > 0 && !(oneKept && slot === "twoHanded" && it.twoHanded)) speeds.add(it.speed);
  }
  if (speeds.size === 1) return { speed: [...speeds][0]!, reason: null };
  return { speed: null, reason: speeds.size ? `the pool holds weapons with ${speeds.size} different speeds` : "no weapon in the pool has a known speed" };
}
// The held weapon of a suit: the two-hander, else the one-hander, when it has a speed.
export type Held = { speed?: number | undefined; twoHanded?: boolean | undefined };
export function heldWeapon<T extends Held>(suit: Partial<Record<string, T | null | undefined>> | null | undefined): T | null {
  const two = suit?.twoHanded, one = suit?.oneHanded;
  const w = two?.twoHanded ? two : one;
  return w && typeof w.speed === "number" && w.speed > 0 ? w : null;
}

// What a build knows of its character's swing (vault-lib.mts EffectiveProfile `swing`, set by build-spec.mts planBuild when there is a character).
export type SwingProfile = NonNullable<EffectiveProfile["swing"]>;
// The buffs' share of SSI: the cap before them less the cap the gear has left.
export function ssiShareOf(profile: { caps?: Record<string, number> | undefined; buffs?: { caps?: Record<string, number> | undefined } | undefined }): number {
  const now = profile.caps?.ssi, before = profile.buffs?.caps?.ssi ?? now;
  return typeof now === "number" && typeof before === "number" ? before - now : 0;
}
// A result's swing (runs-types.mts SwingResult) for a suit's item totals.
export function swingOf(speedS: number, stamBase: number, totals: Readonly<Record<string, number>>, share: number): SwingResult {
  const stamina = stamBase + (totals.stamPool || 0), ssi = Math.min(SSI_CAP, (totals.ssi || 0) + share);
  return { speed: speedS, stamina, ssi, share, seconds: swingSeconds(speedS, stamina, ssi), steps: swingSteps(speedS, stamina, share) };
}

// The step table a build scores SSI with, or why it scores SSI per point though steps were asked for (`note`, a reason for a sentence). Steps need the character's swing with steps on, a positive SSI weight (a negative one stays per point, unsaid) and one weapon speed across the hand slots' candidates. `stamRange` is the gear Stamina pool's range over every suit (app/mip.mts propertyReach).
export function stepsFor(profile: Pick<EffectiveProfile, "swing" | "weights" | "caps" | "buffs">, pools: Parameters<typeof weaponSpeedOf>[0], current: Parameters<typeof weaponSpeedOf>[1], stamRange: { min: number; max: number }, optionalSlots?: readonly string[]): { ssiSteps: SsiStepPoint[] | null; note: string | null } {
  const sw = profile.swing;
  if (!sw?.steps || !((profile.weights?.ssi ?? 0) > 0)) return { ssiSteps: null, note: null };
  const { speed, reason } = weaponSpeedOf(pools, current, optionalSlots);
  if (speed == null) return { ssiSteps: null, note: reason };
  return { ssiSteps: stepTable({ speedS: speed, stamBase: sw.stamBase, refStamina: sw.refStamina, share: ssiShareOf(profile), stamRange }), note: null };
}
