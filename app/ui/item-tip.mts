// ui/item-tip.mts — where the one item tooltip (dom.mts's #tip) gets the item it shows (issue #10). DOM-free, so
// app/ui-item-tip.test.mts runs it under plain node:test.
//
// A screen that draws an item registers it on the element it drew (dom.mts's itemTip, which also sets data-serial):
// a registered record that carries its tooltip lines is shown as it is. Anything else (a piece the Suit Builder only
// knows by serial and name, a plan's move) is looked up: the page's item cache, else one GET by serial. A serial the
// server does not know is asked for once; until forget() (a new inventory), the partial record, if any, is shown.

// The item shape the tooltip reads: looser than vault-lib.mts's Item, since suit-builder candidates and partial
// records only ever carry some of it.
export interface TooltipItem {
  lines?: string[] | undefined;
  name: string;
  amount?: number | undefined;
  rarity?: string | null | undefined;
  tags?: string[] | undefined;
  location?: { text: string } | undefined;
}

// Complete enough to draw: it carries the item's own tooltip lines (line 0 is the name).
export const tipComplete = (it: TooltipItem | null | undefined): it is TooltipItem => !!it && Array.isArray(it.lines) && it.lines.length > 0;

export interface TipResolver {
  register(host: object, item: TooltipItem): void;
  // The record to draw for `host` (whose data-serial is `serial`): at once when it is known, else a promise of it
  // (null when nothing at all is known about it).
  resolve(host: object, serial: number): TooltipItem | null | Promise<TooltipItem | null>;
  forget(): void;
}
export function createTipResolver(cache: { get(serial: number): TooltipItem | undefined }, fetchOne: (serial: number) => Promise<TooltipItem | undefined>): TipResolver {
  const registered = new WeakMap<object, TooltipItem>();
  const missed = new Set<number>();
  const asking = new Map<number, Promise<TooltipItem | undefined>>();
  return {
    register(host, item) { registered.set(host, item); },
    resolve(host, serial) {
      const own = registered.get(host);
      if (tipComplete(own)) return own;
      const cached = cache.get(serial);
      if (cached) return cached;
      if (missed.has(serial)) return own ?? null;
      let ask = asking.get(serial);
      if (!ask) {
        ask = fetchOne(serial).catch(() => undefined).then((it) => { asking.delete(serial); if (!it) missed.add(serial); return it; });
        asking.set(serial, ask);
      }
      return ask.then((it) => it ?? own ?? null);
    },
    forget() { missed.clear(); },
  };
}
