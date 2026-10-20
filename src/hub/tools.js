// The STLmill tool registry — the single source of truth for what hangs on the hub.
//
// To add a tool: append ONE entry here. src/hub/main.js renders it:
//   status 'live'  -> a printed swatch card hanging on a hook (colour from `color`),
//                     with an embossed label, a one-line `sub` and a black `action` tab
//                     that links to `href`.
//   status 'soon'  -> a dashed shadow-board outline on an empty hook, labelled with
//                     `name`. Never a card, never a "coming soon" pill: the outline IS
//                     the honest statement that the slot is open.
// A live tool may also author its card in index.html (as the Clicker does, to carry
// its live demo) by giving the element `data-tool="<id>"`; main.js then leaves that
// markup in place instead of rendering a generic card.
//
// Each entry:
//   { id, name, sub, tagline, href, status: 'live' | 'soon', color: 'orange' | 'teal' | 'white', action, icon }
// `icon` is an inline SVG string (24x24 viewBox, stroke = currentColor) kept for tool
// pages and any list view that wants a glyph.
// Remember to also add `<id>/index.html` to build.rollupOptions.input in
// vite.config.js so Vite builds the page.

const svg = (paths) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  // Keyboard switch (keycap on a stem)
  clicker: svg(
    '<rect x="4" y="3" width="16" height="9" rx="2"/>' +
      '<path d="M9 12v3M15 12v3"/>' +
      '<rect x="6" y="15" width="12" height="6" rx="1.5"/>'
  ),
  // Lithophane: a framed plate with a light behind it
  lithophane: svg(
    '<rect x="3" y="4" width="18" height="14" rx="1.5"/>' +
      '<path d="M7 14l3-4 2.5 3 2-2 2.5 3"/>' +
      '<path d="M9 21h6"/>'
  ),
  // Character cap: a rounded character head on a stem
  character: svg(
    '<path d="M5 13a7 7 0 0 1 14 0v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3z"/>' +
      '<circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none"/>' +
      '<path d="M10 21h4M12 18v3"/>'
  ),
  // QR keychain: a tag with a few QR modules
  qr: svg(
    '<path d="M3 8.5V4a1 1 0 0 1 1-1h4.5l12 12-5.5 5.5L3 8.5z"/>' +
      '<circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none"/>' +
      '<path d="M11 11h2v2h-2zM14 14h2v2h-2zM11 14h1M15 11h1"/>'
  ),
};

export const TOOLS = [
  {
    id: 'clicker',
    name: 'Clicker',
    sub: 'A keyboard-switch fidget with your text on top. Type it, print it.',
    tagline:
      'Keyboard-switch clicker — put your text, logo or image on a satisfying MX-switch fidget',
    href: './clicker/',
    status: 'live',
    color: 'orange',
    action: 'Open the mill',
    icon: ICONS.clicker,
  },
  {
    id: 'character-cap',
    name: 'Character Cap',
    sub: 'A pumpkin, ghost or your own sculpt, made into a cap that presses onto a switch.',
    tagline: 'Character cap — a sculpted character turned into an MX-switch cap with a two-colour face',
    href: './character-cap/',
    status: 'live',
    color: 'orange',
    action: 'Open the mill',
    icon: ICONS.character,
  },
  {
    id: 'lithophane',
    name: 'Lithophane',
    sub: 'A photo turned into a plate that only shows its picture when lit from behind.',
    tagline: 'Lithophane — flat or curved, framed, with your photo',
    href: './lithophane/',
    status: 'soon',
    color: 'white',
    action: 'Open the mill',
    icon: ICONS.lithophane,
  },
  {
    id: 'qr-keychain',
    name: 'QR Tag',
    sub: 'A keychain with a scannable QR code and a line of text, in two colours.',
    tagline: 'QR keychain — a scannable code and label as a two-colour tag',
    href: './qr-keychain/',
    status: 'soon',
    color: 'teal',
    action: 'Open the mill',
    icon: ICONS.qr,
  },
];

export default TOOLS;
