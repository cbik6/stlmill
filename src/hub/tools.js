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
  // Tag with ring
  keychain: svg(
    '<path d="M3 8.5V4a1 1 0 0 1 1-1h4.5l12 12-5.5 5.5L3 8.5z"/>' +
      '<circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none"/>'
  ),
  // Coaster: ring with droplet
  coaster: svg(
    '<circle cx="12" cy="13" r="8"/>' +
      '<circle cx="12" cy="13" r="4.5"/>' +
      '<path d="M12 3.5v2"/>'
  ),
  // Box with lid
  box: svg(
    '<path d="M3 9l9-5 9 5-9 5-9-5z"/>' +
      '<path d="M3 9v7l9 5 9-5V9"/>' +
      '<path d="M12 14v7"/>'
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
    id: 'keychain',
    name: 'Keychain',
    sub: 'A tag with your name, logo or image, and a loop for the ring.',
    tagline: 'Keychain & tag maker',
    href: './keychain/',
    status: 'soon',
    color: 'teal',
    action: 'Open the mill',
    icon: ICONS.keychain,
  },
  {
    id: 'coaster',
    name: 'Coaster',
    sub: 'A round or square coaster with your design on top.',
    tagline: 'Coaster generator',
    href: './coaster/',
    status: 'soon',
    color: 'white',
    action: 'Open the mill',
    icon: ICONS.coaster,
  },
  {
    id: 'box',
    name: 'Box',
    sub: 'A parametric box with a fitted lid.',
    tagline: 'Parametric box',
    href: './box/',
    status: 'soon',
    color: 'teal',
    action: 'Open the mill',
    icon: ICONS.box,
  },
];

export default TOOLS;
