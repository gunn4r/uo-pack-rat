// hold-scroll.mjs — keeps the framed demo app from scrolling the website around it until the visitor uses the app.
//
// The app focuses its search box and scrolls rows and cards into view on its own, and inside a frame either one scrolls
// the parent page too: a visitor landing on the hero was pulled down to the demo. Until the visitor's first real pointer
// or key press in the frame, every focus() keeps the page still (preventScroll) and scrollIntoView() does nothing; that
// press puts both back. A scripted event (the page's own click on a ring row) is not the visitor and changes nothing.
export function holdScroll(win) {
  const { HTMLElement, Element } = win;
  const focus = HTMLElement.prototype.focus, intoView = Element.prototype.scrollIntoView;
  HTMLElement.prototype.focus = function (options) { focus.call(this, { ...options, preventScroll: true }); };
  Element.prototype.scrollIntoView = function () {};
  const types = ["pointerdown", "keydown"];
  const release = (e) => {
    if (!e.isTrusted) return;
    HTMLElement.prototype.focus = focus;
    Element.prototype.scrollIntoView = intoView;
    for (const type of types) win.removeEventListener(type, release, true);
  };
  for (const type of types) win.addEventListener(type, release, true);
}
