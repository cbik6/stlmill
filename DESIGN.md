---
name: STLmill
description: A workshop pegboard where every generator hangs as a printed PLA swatch card
colors:
  brand-orange: "#f07a2a"
  filament-teal: "#1fa39a"
  pla-white: "#f2efe9"
  ink: "#1c1b19"
  board: "#a47a52"
  hole: "#6e5036"
  hole-shade: "#4a3322"
  steel: "#2b2521"
  bench: "#2b2b2b"
  bench-edge: "#1a1a1a"
  orange-ink: "#4a2008"
  orange-ink-soft: "#5a2a0e"
  orange-emb: "#c7591a"
  orange-emb-hi: "#ffb37a"
  orange-field: "#fff1e6"
  teal-ink: "#052e2b"
  teal-emb-face: "#cdf3ee"
  teal-emb-shade: "#0a4f4a"
  white-ink-2: "#6e5036"
  tab-text: "#f2efe9"
  # Shared base.css neutrals (--bg, --panel, --border, --text-muted). Still defined; no shipped page uses them.
  tool-bg: "#f6f5f3"
  tool-panel: "#ffffff"
  tool-border: "#dcd9d4"
  tool-text-muted: "#6b6762"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "clamp(56px, 6.4vw, 92px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "clamp(44px, 4.4vw, 64px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0"
  group-title:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.06em"
  action:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.04em"
  action-small:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.04em"
  control-face:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
  readout:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0"
  readout-small:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0"
  lead:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  control-label:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "normal"
  label:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.08em"
  wordmark:
    fontFamily: "Space Grotesk, Barlow, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
rounded:
  tile-small: "3px"
  tile: "4px"
  pin: "6px"
  field: "8px"
  card: "10px"
  bench: "12px"
  tab: "0 0 12px 12px"
  tab-small: "0 0 10px 10px"
  panel: "16px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
  "8": "64px"
  gutter: "72px"
  row: "136px"
  rail: "360px"
  bench-gutter: "40px"
components:
  swatch-orange:
    backgroundColor: "{colors.brand-orange}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "52px 40px 112px"
  swatch-teal:
    backgroundColor: "{colors.filament-teal}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "48px 32px 32px"
  swatch-white:
    backgroundColor: "{colors.pla-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "52px 40px 44px"
  tab-action:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.tab-text}"
    typography: "{typography.action}"
    rounded: "{rounded.tab}"
    padding: "0 36px"
    height: "72px"
  tab-action-mobile:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.tab-text}"
    rounded: "{rounded.tab}"
    padding: "0 24px"
    height: "60px"
  shadow-outline:
    textColor: "{colors.hole-shade}"
    rounded: "{rounded.card}"
    height: "250px"
  field-on-orange:
    backgroundColor: "{colors.orange-field}"
    textColor: "{colors.ink}"
    typography: "{typography.readout}"
    rounded: "{rounded.field}"
    padding: "0 24px"
    height: "88px"
  digit-tile:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.orange-emb-hi}"
    typography: "{typography.readout}"
    rounded: "{rounded.tile}"
    width: "44px"
    height: "64px"
  step-number:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.pla-white}"
    rounded: "{rounded.tile}"
    width: "30px"
    height: "30px"
  pinned-brand:
    backgroundColor: "{colors.pla-white}"
    textColor: "{colors.ink}"
    typography: "{typography.wordmark}"
    rounded: "{rounded.pin}"
    padding: "14px 20px 14px 16px"
  # Tool page (Bench & Rail)
  head-card:
    backgroundColor: "{colors.brand-orange}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "40px 24px 18px"
  group-card:
    backgroundColor: "{colors.pla-white}"
    textColor: "{colors.ink}"
    typography: "{typography.group-title}"
    rounded: "{rounded.card}"
    padding: "28px 24px 14px"
  field-on-card-tool:
    backgroundColor: "{colors.orange-field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pin}"
    padding: "0 14px"
    height: "52px"
  readout-tile-small:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.orange-emb-hi}"
    typography: "{typography.readout-small}"
    rounded: "{rounded.tile-small}"
    width: "22px"
    height: "30px"
  segment-on-card:
    textColor: "{colors.ink}"
    typography: "{typography.control-face}"
    rounded: "{rounded.tile}"
    padding: "0 12px"
    height: "30px"
  segment-on-card-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.pla-white}"
  foot-pin:
    backgroundColor: "{colors.pla-white}"
    textColor: "{colors.ink}"
    typography: "{typography.control-face}"
    rounded: "{rounded.pin}"
    padding: "0 14px"
    height: "32px"
  bench-plate:
    backgroundColor: "{colors.bench}"
    textColor: "{colors.pla-white}"
    rounded: "{rounded.bench}"
  bench-toolbar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.pla-white}"
    rounded: "{rounded.field}"
    padding: "4px"
  bench-toolbar-item:
    textColor: "{colors.pla-white}"
    typography: "{typography.control-face}"
    rounded: "{rounded.pin}"
    padding: "0 14px"
    height: "34px"
  bench-toolbar-item-selected:
    backgroundColor: "{colors.brand-orange}"
    textColor: "{colors.ink}"
  bench-toolbar-item-pressed:
    backgroundColor: "{colors.pla-white}"
    textColor: "{colors.ink}"
  bench-callout:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.brand-orange}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
  export-dock:
    backgroundColor: "{colors.pla-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "14px 16px 10px 20px"
    width: "380px"
  tab-hung:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.tab-text}"
    typography: "{typography.action-small}"
    rounded: "{rounded.tab}"
    padding: "0 22px"
    height: "48px"
  tab-hung-mobile:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.tab-text}"
    rounded: "{rounded.tab-small}"
    padding: "0 12px"
    height: "44px"
  dock-icon:
    textColor: "{colors.ink}"
    rounded: "{rounded.pin}"
    width: "40px"
    height: "40px"
  # Shared base.css primitives (.btn, .panel, .container): defined, but not used by any shipped page
  tool-button:
    backgroundColor: "{colors.tool-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "0 16px"
    height: "40px"
  tool-button-primary:
    backgroundColor: "{colors.brand-orange}"
    textColor: "{colors.tool-panel}"
    rounded: "{rounded.card}"
    padding: "0 16px"
    height: "40px"
  tool-panel:
    backgroundColor: "{colors.tool-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: STLmill

## Overview

**Creative North Star: "The Swatch Wall"**

STLmill is a workshop pegboard. The ground is tempered hardboard with a 48 px grid of drilled holes and a faint fractal grain; everything that exists hangs on it as a printed PLA swatch card on a steel peg, with a real hole punched through the card. Type on a card is not printed flat, it is raised: a light edge up-left, a stepped extrusion down-right, a soft cast shadow. Actions are the card's own black tab, hanging off its bottom edge. Tools that do not exist yet are the shadow-board outline of a card, dashed in the dark hole colour on an empty peg: honest, unlit, never a "coming soon" pill.

The scene is physical, so it is lit once. The hub pins `color-scheme: light` and never swaps with the OS theme; tool pages keep the OS theme, which only dims the board (the shop light goes off) while every swatch, the bench and the export dock stay as printed (`color-scheme: light` on the card). Density is generous on the hub (one big card, wide gutters, nothing competing with the live object) and tightens on tool pages, which are the same world in a different arrangement: Bench & Rail. A 360 px rail of smaller swatch cards hangs on the board beside a recessed charcoal bench, the live object sits on the bench, and the export hangs as a PLA card with its black tab at the bench's corner. There is no neutral tool ground and no flat white panel.

The hub refuses the headline, subline, button, card-grid arrangement. There is no hero copy above the fold; the live three.js clicker rebuilding as the visitor types is the proof, and the only large words are the names of things you can make. The tool page refuses the three-column "tabs | viewport | import panel" configurator; the first viewport is the bench with the object already built.

**Key Characteristics:**
- Hardboard ground (#a47a52) with a 48 px drilled-hole grid and SVG feTurbulence grain; the one lit scene, never theme-swapped on the hub, only dimmed on tool pages.
- Three card materials only: brand orange, filament teal, PLA white. Secondary text on a card is an ink tint of that card's hue, never gray.
- Raised display type (Barlow Semi Condensed 800, uppercase) with a per-hue relief recipe; body in Barlow 400/600; Space Grotesk 700 for the wordmark only.
- Black tabs as actions, with the authored 3-stroke arrow in brand orange.
- Shadow-board dashed outlines (#4a3322) for tools that are not built yet.
- The bench: a charcoal build plate (#2b2b2b) recessed into the board with an inset edge and a faint 10 mm grid; the only dark surface in the world, and the only place orange is used as a line colour (dimension callouts).
- One hover motion: the card lifts 4 px off its peg in 160 ms (small pins lift 2 px); the peg stays. Digit readouts tick 5 px on change. Nothing else animates except a status spinner while the engine builds.

## Colors

A small set of printed materials on a warm brown board: three PLA swatch colours, near-black ink and steel, a charcoal bench, and ink tints derived per card hue so every card stays legible without any gray.

### Primary
- **Brand Orange** (`brand-orange`): the first live tool's card and its header card on the tool page, the tab arrow, the field focus ring on the board, the orange facet in the millstone mark. On the bench it becomes the selected state of the view radio (solid block with ink text) and the colour of dimension lines and callout digits. It is a card material, not a UI accent: it fills whole cards and is used in small amounts elsewhere.
- **Orange Ink** (`orange-ink`, >= 4.5:1 on orange): control labels, hints and placeholders on an orange card. **Orange Ink Soft** (`orange-ink-soft`, >= 3:1): large sub-copy (24 px / 600) and field borders on orange only.
- **Orange Relief** (`orange-emb` face, `orange-emb-hi` highlight): the raised CLICKER label; the highlight also lights the digits inside black readout tiles. **Orange Field** (`orange-field`): the warm off-white well of a text field, select, drop zone or sample button sitting on an orange card.

### Secondary
- **Filament Teal** (`filament-teal`): the second card material; carries the Fit spec card and is the assigned colour for the Keychain and Box tools once live.
- **Teal Ink** (`teal-ink`, >= 4.5:1 on teal): uppercase dt labels and sub-copy on teal.
- **Teal Relief** (`teal-emb-face`, `teal-emb-shade`): teal is mid-value, so a dark face muddies; the raised label is a light face with one dark extrusion step and a tighter cast shadow.

### Tertiary
- **PLA White** (`pla-white`): the third card material; the brand pin, the hanging tag, the instruction sheet, the tool page's group cards, foot pins and export dock, and the text on black tabs (`tab-text`) and the bench toolbar. On white, raised type is ink with a 1 px white highlight. A pressed toolbar toggle fills with PLA white.
- **White Ink 2** (`white-ink-2`): secondary copy on a white card (group status lines, dock summary, readout units, disabled labels), warmed from the board hole colour rather than gray.

### Neutral
- **Ink** (`ink`): all primary text, every black tab, digit tiles, step-number tiles, the bench toolbar and callout pills, the selected segment on a card, slider tracks on cards, the focus ring on cards, the selection background, the caret.
- **Board** (`board`), **Hole** (`hole`), **Hole Shade** (`hole-shade`): the hardboard, the drilled-hole floor, and the hole's upper-lip shadow. Hole Shade is also the shadow-board colour for dashed outlines and unlit labels. Rules between control rows are the hole colour at 25% (`rgba(110,80,54,0.25)`).
- **Steel** (`steel`): pegs and pins, with a 28% white inset highlight.
- **Bench** (`bench`), **Bench Edge** (`bench-edge`): the charcoal build plate and its 2 px inset rim. The three.js plate material is a notch darker (#232323) so the lit render matches the flat CSS colour; the grid and inset lines are white at 8% and 16%.
- **Shared neutrals** (`tool-bg`, `tool-panel`, `tool-border`, `tool-text-muted`): base.css still defines `--bg`, `--panel`, `--border` and `--text-muted` with light and dark values, but no shipped page renders them. They are not a tool-page ground; see Layout.

### Named Rules
**The Three Filaments Rule.** A card is orange, teal or PLA white. There is no fourth card colour; a new tool picks one of the three in `tools.js` and inherits that hue's ink tints and relief recipe.

**The Tinted Ink Rule.** Secondary text on a card is an ink tint of the card's own hue (`orange-ink`, `teal-ink`, `white-ink-2`). Gray text never appears on a swatch.

**The Black Tab Rule.** The primary action on a card is a near-black (`ink`) tab, never an orange button. Orange is a material the card is made of, not a call-to-action colour. On the bench, orange marks the selected view and the dimensions; it is still not a button.

**The One Dark Surface Rule.** The bench is the only large dark surface. Everything placed on it is an ink object (toolbar, callout, busy pill) or a hung PLA card (the export dock); nothing on the bench is gray or translucent white.

## Typography

**Display Font:** Barlow Semi Condensed 800 (with Barlow, system-ui)
**Body Font:** Barlow 400 / 600 (with system-ui)
**Wordmark Font:** Space Grotesk 700, wordmark only (brand commitment)

**Character:** Condensed, heavy, uppercase display that reads as moulded letters standing off a plastic card; a plain, slightly narrow grotesk for everything the visitor reads. Only three families are loaded, all self-hosted in `public/fonts/`; the hub preloads the 800 display and the wordmark, the tool page preloads the 800 and 600 display and Barlow 600.

### Hierarchy
- **Display** (800, clamp(56px, 6.4vw, 92px) desktop / clamp(48px, 15vw, 64px) under 900, line-height 1, -0.02em, uppercase): the hero card's tool name, in relief. On the tool page's header card the same relief label is 46 px (40 px on phones).
- **Headline** (800, clamp(44px, 4.4vw, 64px), line-height 1, uppercase): the name on a generic live card; the sheet title is 44 px and the Fit label 56 px, both in relief.
- **Title** (800, 26px, line-height 1, letter-spacing 0, uppercase): step titles on the instruction sheet, ink relief.
- **Group title** (800, 22px, 0.06em, uppercase, flat ink): the name of a control group card on the tool page (Footprint, Switch & fit, Finish). No relief: only the header card's name is raised on a tool page.
- **Action** (800, 30px desktop / 22px mobile, 0.04em, uppercase): black tab text. The tab hung from the export dock is 22 px (16 px on phones).
- **Control face** (Semi Condensed 600, 15px toolbar / 14px foot pins / 13px segments and labels on cards, 0.04-0.08em, uppercase): the face of a segmented radio, toolbar button, foot pin, callout pill or the tool-name pin (20 px / 800).
- **Readout** (800, 44px, tabular-nums): a single digit in a 44 x 64 tile on the hub; the field on the orange card uses the same face at 52 px. On the tool page the tile readout is 19 px in 22 x 30 tiles and the header field is 30 px.
- **Lead** (Barlow 600, 24px, line-height 1.25-1.3): one-line sub under a tool name; the tag's lead line. 20 px on generic cards and under 900.
- **Body** (Barlow 400, 17-19px, line-height 1.4-1.45): step text, fit values, the tag lines. Measure is governed by card width, max-width 420 px on subs. Tool-page prose is smaller: 14 px status lines and dock summary, 13 px hints and slips, 15 px for the empty-bench note.
- **Control label** (Barlow 600, 14px, line-height 1.15, sentence case, ink): the name beside a slider or toggle in a control row on a white card. Disabled rows drop to `white-ink-2`.
- **Label** (Semi Condensed 600, 14-15px, 0.06-0.08em, uppercase): dl terms on the hub and control labels on an orange card (13 px on the tool page), always tied to a control or a value, coloured with the card's ink tint.
- **Unlit** (800, clamp(24px, 2.6vw, 40px), 0.06em, uppercase, `hole-shade`, no relief): the name inside a shadow-board outline.

### Named Rules
**The Relief Rule.** A tool name or section title on a card is raised, never flat. Use the hue's recipe: orange face with two extrusion steps (#a4430f, #8e3a0c) and a 3/6/7 cast shadow; teal light face with one step; ink with a white up-left edge. Unlit labels in shadow outlines get no relief at all. On a tool page only the header card's name is in relief; group titles are flat display.

**The Label Is A Label Rule.** Uppercase small type exists only as a form label, a dl term, the face of a control (segment, toolbar button, pin, tab), a group-card title, or a shadow-outline name. It never introduces a heading as a kicker or eyebrow.

**The One Wordmark Rule.** Space Grotesk appears only in the pinned brand's wordmark (26 px / 22 px). It is never used for headings, labels or body.

## Layout

Full-bleed board. `main` has 48 px padding on desktop (32 px top, 16 px gutters under 900), the brand pin row 40 px top / 48 px sides. Row 1 ("the wall") is a two-column grid `minmax(0, 780px) minmax(440px, 1fr)` with a 72 px column gap: live cards stack left at 72 px gaps, the aside column holds the shadow outlines (grid 1.15fr 1fr, 30 x 20 px gaps) above the hanging tag (max 520 px, pushed to the bottom). Row 2 repeats the same columns 136 px below for the instruction sheet and the Fit card. The hero card is a fixed grid (`head demo / text size`, 40 x 44 px gaps, min-height 620 px) so the live object sits top-right and the controls bottom. Every live card reserves 26 px under itself for its tab.

Breakpoints: under 1280 everything drops to one column (max-width 900 for cards, three outlines across), under 900 the hero card stacks to one column (demo fixed at 320 px tall, tab 60 px, labels 24 px), and under 560 the outlines go one per row at 120 px tall. The 48 px hole grid is the board's own rhythm; card edges do not snap to it, cards hang over it.

Tool pages (Operate surfaces) are **Bench & Rail** on the same full-bleed board. The page is a 100dvh grid of two rows (`auto minmax(0, 1fr)`, overflow hidden): a pin row (28 px top, 40 px gutters; the brand pin beside a PLA-white tool-name pin) and the shop floor, a two-column grid `360px minmax(0, 1fr)` with a 40 px column gap and `24px 40px 40px` padding. The rail (left) scrolls on its own with a thin ink scrollbar (8 px, `rgba(28,27,25,0.45)`) and 24 px of slack for card shadows; cards hang 16 px apart: one orange header card, then one PLA-white group card per control group (one open at a time, the rest closed to a title and status line), then a centred row of foot pins (Undo / Redo / Reset, 10 px gaps). The bench (right) fills the remaining width and the full row height; the live object sits on it with the toolbar floating top-centre (18 px down), the busy pill top-left (22 px), the empty-bench note bottom-left (22 / 24 px) and the export dock bottom-right (24 px in, 50 px up so the hung tab clears the bench edge by 24 px). Control rows inside a card are a `84px minmax(0,1fr) auto` grid (label, slider, readout) at 10 px gaps and 5 px vertical padding, separated by a 1 px `rule` line. There is no `.container` cap and no neutral panel ground; the shared 4-64 px spacing scale is used inside cards.

Tool-page breakpoints: short desktops (`max-height: 640px` at >= 900 wide) let the page scroll and make the bench sticky at 20 px with `calc(100vh - 40px)` height (min 420 px). Under 900 the page becomes a single scrolling column with 16 px gutters: the bench moves to the top as a sticky 45dvh plate (min 300 px, z-index 5, 10 px radius), its toolbar stacks into two rows and its dock becomes a full-width bar across its bottom edge (76 px tall, radius only on the bottom corners), the render frame insets 76 px top and bottom so neither overlay covers the model, and the rail below becomes an accordion whose opened card scrolls to `45vh + 12px` so it lands under the bench, not behind it. Under 420 the dock icons stack vertically at 32 px.

## Elevation & Depth

Depth is physical, not tonal: cards cast real drop shadows because they hang in front of a board, and the board itself is drilled. A peg sits at z-index 2 over the card's hole, so the card visibly hangs on it. Raised type has its own light (above-left) and its own cast shadow. The bench is the one recessed surface: it is cut into the board (inset rim and inner shadow) and still throws a shadow below its lip; objects on the bench (toolbar, callouts, busy pill, export dock) float above it with their own drop shadows. The rail's cards are smaller than the hub's, so they hang closer to the board with a lighter shadow.

### Shadow Vocabulary
- **Hung card** (`box-shadow: 0 22px 36px rgba(0,0,0,0.35), inset 0 2px 0 rgba(255,255,255,0.25)`): orange and teal swatches at rest on the hub; the inset line is the lit top edge of the plastic.
- **Hung card, lifted** (`0 30px 44px rgba(0,0,0,0.42)`, same inset): the hover state, with the card translated -4 px.
- **White card** (`0 10px 18px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.7)`; lifted `0 16px 26px rgba(0,0,0,0.36)`): PLA white hangs closer to the board and its edge highlight is brighter.
- **Rail card** (`0 14px 24px rgba(0,0,0,0.3)`; lifted `0 20px 30px rgba(0,0,0,0.36)`): every card in a tool-page rail, orange or white, no inset line.
- **Pinned brand** (`0 8px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.7)`): a small swatch, pinned not hung. The tool-name pin shares it.
- **Foot pin** (`0 6px 10px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.7)`; hover `0 9px 14px rgba(0,0,0,0.28)` at -2 px; active `0 3px 6px rgba(0,0,0,0.25)`; disabled `0 3px 6px rgba(0,0,0,0.18)`): the small Undo / Redo / Reset pins.
- **Tab** (`0 10px 18px rgba(0,0,0,0.3)`): the black tab below a card edge. The smaller tab hung from the export dock uses `0 6px 12px rgba(0,0,0,0.3)`.
- **Peg / pin** (`inset 0 2px 2px rgba(255,255,255,0.28), 0 1px 2px rgba(0,0,0,0.5)`): a 12 px (8 px on the brand pin) steel dome.
- **Hole** (`inset 0 2px 3px rgba(0,0,0,0.45)` on a 16 px `board`-coloured disc; 14 px and 0.4 alpha on rail cards): the punched hole in a card.
- **Field well** (`inset 0 2px 4px rgba(90,42,14,0.18)`): a text field or drop zone sunk into the orange card.
- **Bench recess** (`inset 0 0 0 2px #1a1a1a, inset 0 3px 8px rgba(0,0,0,0.55), 0 14px 24px rgba(0,0,0,0.35)`): the build plate set into the board, 12 px radius; on phones the sticky bench keeps it.
- **Bench toolbar** (`0 8px 16px rgba(0,0,0,0.4)`): the floating ink bar. The busy pill uses `0 6px 12px rgba(0,0,0,0.4)`, a callout pill `0 2px 4px rgba(0,0,0,0.4)`.
- **Export dock** (`0 14px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.7)`): the PLA card hung over the bench corner. Its warning slip, tucked behind the dock's top edge, throws `0 -4px 10px rgba(0,0,0,0.2)` upward.
- **Shared tool shadows** (`--shadow-sm`, `--shadow`, `--shadow-lg` in base.css): defined for the unused `.panel` / `.card` / `.btn` primitives; no shipped page uses them.

### Named Rules
**The Peg Stays Rule.** Hover lifts the card (translateY(-4px), 160 ms cubic-bezier(0.23,1,0.32,1), deeper shadow); a small pin lifts 2 px in 120 ms; the peg and the hole do not move. Under `prefers-reduced-motion` the lift is removed entirely.

**The Lit Scene Rule.** Shadows always fall downward with no horizontal offset on cards; raised type is lit from above-left. Nothing glows, nothing is elevated by colour alone.

**The Recess Rule.** Only the bench is cut into the board. Nothing else is recessed and nothing sits inside the bench's surface: every bench object floats above the plate with its own shadow.

## Shapes

Printed plastic with a small fillet: cards and shadow outlines are 10 px radius, the pinned brand 6 px, fields and the demo frame 8 px, digit and step tiles 4 px, the black tab square on top and 12 px on its two bottom corners so it reads as cut from the card edge. The bench is a 12 px-radius slab (10 px on phones) with a 2 px inset rim. On the denser tool page the fillets scale down with the parts: the header field, select, drop zone, sample buttons, foot pins and dock icons are 6 px; segments 4 px; readout tiles 3 px; the toolbar 8 px with 6 px items; the hung tab keeps the 0 0 12px 12px cut (0 0 10px 10px on phones). Holes, pegs, pins and colour chips are perfect circles. Shadow outlines are a 4 px dashed stroke (3 px under 900) in `hole-shade`, with a 3 px dashed 16 px circle where the hole would be; the drop zone on an orange card is a 3 px dashed `orange-ink-soft` well that turns solid ink when a file is over it. The pill (999 px) belongs to objects on the bench: dimension callouts and the "Building…" status, plus the toggle track. Controls on cards are outlined in 2 px ink (segments, the colour picker, dock icons) or 2-3 px `orange-ink-soft` on orange. Icons are stroked SVG, 2-3 px, round caps and joins; the tab arrow is 3 px to match the 800-weight stems beside it. The shared 16 px panel radius exists in base.css for the unused `.panel`.

## Components

### Swatch card (hanger)
- **Character:** a printed PLA sample hanging on a steel peg.
- **Structure:** `.hanger` (relative) holds a `.peg` (12 px steel dome at top 17 px, centred) and a `.swatch` with a `.hole` (16 px board-coloured disc at top 18 px) punched through it. The tag variant hangs sideways: peg and hole at left 24 px, vertically centred. Rail cards on a tool page use the same parts at a smaller scale: peg at top 13 px, 14 px hole at top 14 px.
- **Colour:** `swatch-orange`, `swatch-teal`, `swatch-white`; text is `ink`, secondary text the card's ink tint.
- **Padding:** hero 52 / 40 / 112 px (the bottom reserves room for the controls and tab); generic live card 52 / 40 / 100 px, min-height 300 px; sheet 52 / 40 / 44 px; fit 48 / 32 / 32 px; tag 22 / 28 / 22 / 60 px. Tool-page header card 40 / 24 / 18 px; group card 28 / 24 / 14 px (12 px bottom when open).
- **Hover:** lifts 4 px with the deeper shadow in 160 ms; **focus-visible** inside a card is a 3 px `ink` ring, offset 3 px. Every card sets `color-scheme: light` so native controls on it stay light under a dark OS theme.

### Tab (the action)
- **Shape:** absolute, left 40 px, hanging 26 px below the card's bottom edge; 72 px tall, 0 36 px padding, radius 0 0 12px 12px. Under 900: left 20 px, 22 px overhang, 60 px tall, 0 24 px.
- **Colour:** `ink` background, `tab-text` label, arrow in `brand-orange` (1 em, 0.6 em gap, 3 px stroke).
- **Type:** Barlow Semi Condensed 800, 30 px (22 px mobile), 0.04em, uppercase, one line.
- **States:** hover changes nothing (the card under it lifts); active scales to 0.97 in 120 ms; focus-visible is the card's 3 px ink ring. A tab that is a `<button>` mid-export is disabled at 0.7 opacity with a progress cursor.

### Shadow outline (a tool not built yet)
- **Shape:** 4 px dashed `hole-shade` border, 10 px radius, min-height 250 px (230 px on every third, 220 under 1280, 170 under 900, 120 under 560); a real peg at top 13 px and a dashed hole at 14 px.
- **Label:** the tool name in unlit type, `hole-shade`, centred 30 px from the bottom; a visually-hidden "not built yet" follows it.
- **Never:** a pill, a badge, a greyed card, or a link. It has no hover.

### Field on a card
- **Style:** 88 px tall (72 under 900), 3 px solid `orange-ink-soft` border, 8 px radius, `orange-field` well with the inset field shadow, display 800 at 52 px (40 mobile) in `ink`, 0.02em. The tool page's header field is the tightened variant: 52 px tall, 0 14 px padding, 6 px radius, 30 px display.
- **Focus:** border turns `ink`; focus-visible adds the 3 px `ink` ring at 3 px offset. No glow, no transition.
- **Label / hint:** uppercase Semi Condensed 600 15 px label above (10 px gap; 13 px and 6 px on the tool page), Barlow 14 px hint below (8 px gap; 13 px on the tool page), both in `orange-ink`. An error hint is `ink` at 600.
- **Companions on orange:** a select or textarea is a 36 px `orange-field` well with a 2 px `orange-ink-soft` border, 6 px radius, Barlow 600 14 px and an `orange-ink` chevron; a drop zone is the same well with a 3 px dashed border (solid ink when hovered, focused or a file is over it); sample silhouettes are 54 px `orange-field` buttons in a five-across 8 px grid, pressed = ink fill with an `orange-emb-hi` glyph.

### Digit readout
- **Style:** two 44 x 64 px `ink` tiles (4 px radius, 8 px gap) showing one tabular digit each in `orange-emb-hi` at 44 px, followed by a 24 px / 600 unit in `orange-ink-soft`. Values are always fixed-width (zero-padded, mm). On the tool page the small variant is one 22 x 30 px tile per character (3 px radius, 3 px gap, 19 px digits), a 10 px-wide tile for the decimal point and a sign tile where the value can go negative, then a 12 px / 600 unit in `white-ink-2` (`orange-ink` on orange).
- **Motion:** a changed digit ticks up 5 px and back in 120 ms (cubic-bezier(0.23,1,0.32,1)); transform only, so nothing reflows. On the tool page an ordinary slider change swaps the digit in place; only a bulk change (load, reset, undo, redo) ticks, cascading the changed tiles 60 ms apart across the rail. Skipped under reduced motion.

### Range on a card
- **Style (hub, on orange):** 6 px track in `orange-ink` with a 1 px inset shade, 3 px radius; 22 px `ink` thumb with a 3 px `orange-field` border and a 2 px drop. No hover scale.
- **Style (tool page, any card):** 4 px `ink` track with a 1 px inset shade, 2 px radius; 18 px `brand-orange` thumb with a 3 px `ink` rim and a 1 px drop; hover and active darken the thumb to `--accent-hover` / `--accent-active` with no scale. Disabled at 0.4 opacity.
- **Focus-visible:** thumb ring `0 0 0 3px brand-orange, 0 0 0 6px ink` on the hub; on the tool page `0 0 0 3px pla-white, 0 0 0 6px ink` (`orange-field` for the inner ring on an orange card).

### Pinned brand
- **Style:** PLA-white swatch, 6 px radius, 14 / 20 / 14 / 16 px padding, an 8 px steel pin at 6, 6; the millstone mark at 30 px (stone in `currentColor` ink, furrows and facet in brand orange) beside the wordmark. 24 px mark and 22 px wordmark under 900. On the tool page the pin row is denser (10 / 16 px padding, 26 px mark, 22 px wordmark; 8 / 12 px on phones) and a second pin carries the tool name as the page `h1` in display 800 20 px (16 px on phones), 0.04em, uppercase.
- **States:** no hover change; focus-visible is the 3 px ink ring.

### Instruction sheet step
- **Style:** a 30 px `ink` number tile (4 px radius, display 800 19 px in PLA white) and a 30 px stroked icon in a 12 px-gap row, then an ink-relief 26 px title and 17 px `white-ink-2` text. Three across at 32 px gaps, stacking under 900.

### Spec list (Fit card)
- **Style:** dl rows on a 136 px / 1fr grid (112 px under 900), 12 px between rows; terms in Semi Condensed 600 14 px uppercase `teal-ink`, values in Barlow 600 `ink`.

### Segmented radio on a card
- **Style:** native radios with styled labels in a 4 px-gap wrap; each face is a 30 px, 0 12 px, 2 px `ink` outline at 4 px radius in Semi Condensed 600 13 px uppercase 0.04em.
- **States:** hover 10% ink wash, active 20%; checked fills `ink` with `pla-white` text; focus-visible 3 px ink ring at 2 px; disabled 0.45 opacity. The ink-bar variant on the bench is below.

### Group card with status line (tool page)
- **Character:** one control group per PLA-white card; closed cards read as a labelled drawer.
- **Head:** a full-width button on a `1fr auto auto` baseline grid (10 px gaps): the group title (display 800 22 px, 0.06em, uppercase), the status line (Barlow 14 px `white-ink-2`, one line, ellipsised, e.g. "Outline · 35 mm", "MX · 14.0 / 14.8", "3 colours · loop off") and a 14 px stroked chevron in `white-ink-2` that rotates 180° in 160 ms when open. Hover underlines the title 2 px in `brand-orange` at 4 px offset; focus-visible is the card's ink ring.
- **Body:** 6 px below the head; control rows (below) separated by 1 px `rule` lines; a control that is disabled greys its label to `white-ink-2` and its tiles to 0.45.
- **Behaviour:** one open at a time; on phones an opened card scrolls to clear the sticky bench.

### Control row with readout tiles (tool page)
- **Style:** a `84px minmax(0,1fr) auto` grid at 10 px gaps and 5 px vertical padding: Barlow 600 14 px label, the card range, then the small digit readout (fixed-width per-character tiles plus unit). Variants: `ctl-stack` (one column, 8 px gap) for a segmented radio under its label; `ctl-color` (`84px auto 1fr`) for the 36 x 30 px native colour picker (2 px ink outline, 6 px radius) beside six 20 px preset chips (2 px 35%-ink rim; hover ink rim; pressed `0 0 0 2px pla-white, 0 0 0 4px ink` ring; active scales 0.92); `ctl-toggle` (`1fr auto`) for a 40 x 22 px toggle whose track is `white-ink-2` (`orange-ink-soft` on orange) and `ink` when checked, with a white 16 px knob.

### Foot pins (tool page)
- **Style:** Undo / Redo / Reset as 32 px PLA-white pins (6 px radius, 0 14 px, Semi Condensed 600 14 px uppercase 0.06em) centred under the rail with 10 px gaps and the foot-pin shadow.
- **States:** hover lifts 2 px in 120 ms with a deeper shadow; active drops back with a shallow one; disabled is `white-ink-2` text at 0.55 opacity with no lift; focus-visible is the 3 px ink ring.

### Bench plate (tool page)
- **Character:** a recessed charcoal build plate cut into the board; the live object sits on it.
- **Style:** `bench` (#2b2b2b) fill, 12 px radius, the bench-recess shadow, `overflow: hidden` with its own stacking context. The renderer draws a 120 mm square plate in #232323 with a 4 mm inset line (white at 16%) and a 10 mm grid (white at 8%) inside it, both fading out across the top 78-93% of the frame so the far edge never shows; the canvas clears transparent so the CSS bench shows through.
- **Callouts:** width and height dimension lines in `brand-orange` at 95% drawn 5 mm off the body with 2.4 mm end ticks; their labels are CSS2D pills (`ink` fill, `brand-orange` Semi Condensed 600 13 px, 4 / 8 px, 999 px) that keep clear of the dock and slip.
- **Empty state:** a left-aligned note (15 px PLA white on 85% ink, 8 px radius, 12 / 16 px) bottom-left; never a centred placeholder graphic.
- **Busy state:** a "Building…" pill top-left (30 px, 999 px, `ink`, Semi Condensed 600 13 px uppercase) with a 14 px spinner whose top arc is `brand-orange` on a 25% white ring, 800 ms linear. Controls stay live.
- **Focus:** anything focused on the bench gets the 2 px `brand-orange` ring at 2 px (the board's ring), not the card's ink ring.

### Bench toolbar (tool page)
- **Style:** a floating `ink` bar top-centre (18 px down; 10 px on phones), 4 px padding, 8 px radius, 4 px gaps, the toolbar shadow. Items are 34 px, 0 14 px, 6 px radius, transparent, PLA-white Semi Condensed 600 15 px uppercase 0.04em (30 px / 0 9 px / 13 px on phones). A 1 px 18%-white separator (6 / 4 px margins) divides the view radio from the toggles; on phones the separator hides and the bar stacks into two centred rows.
- **View radio (Assembled / Exploded):** hover 12% white wash, active 20%; the selected view is a solid `brand-orange` block with `ink` text.
- **Toggles (Show switch / Cut open / Grid / Callouts):** `aria-pressed` buttons; pressed = `pla-white` fill with `ink` text (pure white on hover).
- **Focus-visible:** 2 px `brand-orange` ring at 2 px; on the selected orange block the ring is `pla-white`.

### Export dock with hung tab (tool page)
- **Character:** the page's one black tab, hung from a PLA card that floats over the bench corner.
- **Style:** absolute bottom-right (24 px in, 50 px up), min-width 380 px, a `summary icons / tab foot` grid (6 x 16 px gaps), 14 / 16 / 10 / 20 px padding, 10 px radius, `pla-white`, `color-scheme: light`, the dock shadow. The summary is Barlow 14 px `white-ink-2` under a bold tabular `ink` size line ("35 × 22 × 18.5 mm"); the icon pair (save / load) is two 40 px ghost squares with a 2 px `ink` outline and 20 px stroked icons (hover 8% ink wash, active 16%, disabled 0.45).
- **Tab:** the `.tab` recipe at 48 px, 0 22 px, 22 px display, in flow on the dock's bottom row with a -36 px bottom margin so it hangs 26 px below the card edge; `tab-text` label and the 3 px orange arrow; active scales 0.97; focus-visible 3 px ink ring at 3 px. The quiet second export ("STL as a zip") sits beside it as a 13 px / 600 ink link underlined 2 px in `brand-orange` (ink on hover).
- **Warning slip:** an orange list tucked behind the dock's top edge (`bottom: calc(100% - 8px)`, z-index -1), 6 px top radius, Barlow 600 13 px `ink`, with a 44 x 7 px ink clip bar centred on its top; engine warnings appear here, never as a toast or a modal.
- **Phones:** the dock becomes a bar across the bench's bottom edge (`summary tab icons` columns, min-height 76 px, 8 / 12 px, radius 0 0 10px 10px); the tab is static at 44 px, 0 12 px, 16 px, radius 0 0 10px 10px; icons 36 px (32 px under 420, stacked).

### Sticky phone bench (tool page)
- **Behaviour:** under 900 the bench is ordered first and sticks to the top of the scroll at 45dvh (min 300 px, z-index 5); the render frame insets 76 px top and bottom so the stacked toolbar and the dock bar sit outside the model's frame; the busy pill moves to bottom-left above the dock bar; the empty note moves to the top-left of the frame. The rail becomes a plain accordion below with `scroll-margin-top: calc(45vh + 12px)` on every group head.

### Shared base.css primitives (defined, not used by any shipped page)
- base.css still ships `.btn` / `.btn-primary` / `.btn-ghost` (40 px, 1 px border, 10 px radius, orange primary), `.panel` / `.card` (white, 1 px `tool-border`, 16 px radius, 24 px padding, `--shadow-sm`), `.badge` (pill) and `.container` (1120 px cap) on the neutral `--bg` ground, with light and dark values. Neither the hub nor the Clicker tool page renders any of them. They are not the tool-page treatment and should not be reached for by a new surface; a new tool page starts from the Bench & Rail components above. Keep them until base.css drops them.

## Do's and Don'ts

### Do:
- **Do** hang every live tool as a swatch card on a peg with a punched hole, in one of the three filaments, with its name in that hue's relief recipe and a black tab as its only action.
- **Do** show an unbuilt tool as a 4 px dashed `hole-shade` outline on an empty peg, labelled in unlit uppercase, with no link and no badge.
- **Do** colour secondary text with the card's ink tint (`orange-ink` / `orange-ink-soft`, `teal-ink`, `white-ink-2`) and keep large-only tints (`orange-ink-soft`) at 20 px / 600 or larger.
- **Do** keep the hub pinned to light (`color-scheme: light`, `meta theme-color #a47a52`); on tool pages that honour the OS theme let only the board dim, and pin every card and the dock to `color-scheme: light` so the printed parts never change.
- **Do** set millimetre readouts as fixed-width per-character ink tiles with tabular numerals (zero-padded, a narrow tile for the point, a sign tile where needed) and a transform-only tick; never let a changing value reflow its neighbours.
- **Do** build a tool page as Bench & Rail: the board ground, a 360 px rail of hanging cards (one orange header card, PLA-white group cards with a title and status line, foot pins), and a recessed charcoal bench with its ink toolbar, orange callouts and the export dock with the hung tab at its corner; on phones the bench sticks on top at 45dvh and the rail becomes an accordion.
- **Do** place every control on a card and every view control on the bench's ink toolbar; selected view = solid orange block, pressed toggle = PLA-white fill, both with ink text.
- **Do** draw icons as stroked inline SVG (2 px, round caps) in `currentColor`; the tab arrow is 3 px to match 800-weight stems.

### Don't:
- **Don't** open any surface with a headline, subline and button stacked over a card grid; the hub's first viewport is the board with the live object on a card, the tool page's is the bench with the object already built.
- **Don't** use orange as a button colour; the primary action on a card or dock is the `ink` tab. On the bench orange marks the selected view and the dimension callouts, nothing else.
- **Don't** put gray text on a swatch, and don't put a fourth card colour on the board.
- **Don't** add hover motion beyond the 4 px card lift (2 px for small pins), or any ambient animation; the live 3D object, the digit tick and cascade, the group chevron and the build spinner are the only other things that move.
- **Don't** write a "coming soon" pill, a greyed-out card, or a disabled tab for a tool that is not built; the dashed outline is the whole statement.
- **Don't** use Space Grotesk anywhere but the wordmark, or any system display face; load only the self-hosted Barlow, Barlow Semi Condensed and Space Grotesk files.
- **Don't** add uppercase kickers or eyebrows above headings; uppercase small type is a control label, a dl term, a control face, a group title, or a shadow-outline name.
- **Don't** lay a tool page out on the neutral `tool-bg` ground in flat `tool-panel` panels inside a 1120 px container; those base.css primitives are unused by every shipped page and a new surface must not revive them.
- **Don't** put a second dark surface or a translucent white sheet on the board; the bench is the only recess, and what sits on it is ink or a hung PLA card.
