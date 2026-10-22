// Types for hold-scroll.mjs (plain JS, served as it is), for scripts/site-demo.test.mts.
export function holdScroll(win: {
  HTMLElement: { prototype: { focus(options?: { preventScroll?: boolean }): void } };
  Element: { prototype: { scrollIntoView(...args: unknown[]): void } };
  addEventListener(type: string, listener: (e: { isTrusted: boolean }) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (e: { isTrusted: boolean }) => void, capture?: boolean): void;
}): void;
