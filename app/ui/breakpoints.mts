// ui/breakpoints.mts — the page's width breakpoints in CSS pixels, each the widest window its narrower layout applies to (a `max-width` query; a `min-width` query starts one pixel above it). CSS media queries cannot read custom properties, so the stylesheets write these numbers as literals and `tokens.css` lists them; scripts/css-guard.test.mts fails on a width in a media query or a matchMedia() that is not one of them.
export const BREAKPOINTS = {
  tight: 720,     // Settings' MCP rows put the control under the title
  compact: 1023,  // the Suit Builder's panel stacks above the result
  stacked: 1099,  // the House map lays its panes out in one column
  narrow: 1179,   // the sidebar collapses, the peek and the Manual picker lie over the page, the Inventory toolbar sheds its unset chips
  medium: 1279,   // tighter Inventory and Suit Builder columns, a narrower peek
  roomy: 1599,    // the runs drawer takes its wide width above this
  wide: 1799,     // the House map folds its levels pane while the contents drawer is open, up to here
} as const;
// The media query for a window at most `px` wide.
export const upTo = (px: number): string => `(max-width: ${px}px)`;
