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
  action:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.04em"
  readout:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "44px"
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
  tile: "4px"
  pin: "6px"
  field: "8px"
  card: "10px"
  tab: "0 0 12px 12px"
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

The scene is physical, so it is lit once. The hub pins `color-scheme: light` and never swaps with the OS theme; the shared tokens carry a dimmed board for tool pages that keep the theme toggle, but the swatches stay as printed in both. Density is generous on the hub (one big card, wide gutters, nothing competing with the live object) and should tighten on tool pages, where the 3D viewport is the hero and controls sit in flat panels on the neutral tool ground.

The hub refuses the headline, subline, button, card-grid arrangement. There is no hero copy above the fold; the live three.js clicker rebuilding as the visitor types is the proof, and the only large words are the names of things you can make.

**Key Characteristics:**
- Hardboard ground (#a47a52) with a 48 px drilled-hole grid and SVG feTurbulence grain; the one lit scene, never theme-swapped on the hub.
- Three card materials only: brand orange, filament teal, PLA white. Secondary text on a card is an ink tint of that card's hue, never gray.
- Raised display type (Barlow Semi Condensed 800, uppercase) with a per-hue relief recipe; body in Barlow 400/600; Space Grotesk 700 for the wordmark only.
- Black tabs as actions, with the authored 3-stroke arrow in brand orange.
- Shadow-board dashed outlines (#4a3322) for tools that are not built yet.
- One hover motion: the card lifts 4 px off its peg in 160 ms; the peg stays. Digit readouts tick 5 px on change. Nothing else animates.

## Colors

A small set of printed materials on a warm brown board: three PLA swatch colours, near-black ink and steel, and ink tints derived per card hue so every card stays legible without any gray.

### Primary
- **Brand Orange** (`brand-orange`): the first live tool's card, the tab arrow, the field focus ring on the board, the orange facet in the millstone mark. It is a card material, not a UI accent: it fills whole cards and is used in small amounts elsewhere.
- **Orange Ink** (`orange-ink`, >= 4.5:1 on orange): control labels, hints and placeholders on an orange card. **Orange Ink Soft** (`orange-ink-soft`, >= 3:1): large sub-copy (24 px / 600) and field borders on orange only.
- **Orange Relief** (`orange-emb` face, `orange-emb-hi` highlight): the raised CLICKER label; the highlight also lights the digits inside black readout tiles. **Orange Field** (`orange-field`): the warm off-white well of a text field sitting on an orange card.

### Secondary
- **Filament Teal** (`filament-teal`): the second card material; carries the Fit spec card and is the assigned colour for the Keychain and Box tools once live.
- **Teal Ink** (`teal-ink`, >= 4.5:1 on teal): uppercase dt labels and sub-copy on teal.
- **Teal Relief** (`teal-emb-face`, `teal-emb-shade`): teal is mid-value, so a dark face muddies; the raised label is a light face with one dark extrusion step and a tighter cast shadow.

### Tertiary
- **PLA White** (`pla-white`): the third card material; the brand pin, the hanging tag, the instruction sheet, and the text on black tabs (`tab-text`). On white, raised type is ink with a 1 px white highlight.
- **White Ink 2** (`white-ink-2`): secondary copy on a white card, warmed from the board hole colour rather than gray.

### Neutral
- **Ink** (`ink`): all primary text, every black tab, digit tiles, step-number tiles, the focus ring on cards, the selection background, the caret.
- **Board** (`board`), **Hole** (`hole`), **Hole Shade** (`hole-shade`): the hardboard, the drilled-hole floor, and the hole's upper-lip shadow. Hole Shade is also the shadow-board colour for dashed outlines and unlit labels.
- **Steel** (`steel`): pegs and pins, with a 28% white inset highlight.
- **Tool ground** (`tool-bg`, `tool-panel`, `tool-border`, `tool-text-muted`): the neutral warm grays in the shared tokens for tool-page panels and controls; they do not appear on the hub.

### Named Rules
**The Three Filaments Rule.** A card is orange, teal or PLA white. There is no fourth card colour; a new tool picks one of the three in `tools.js` and inherits that hue's ink tints and relief recipe.

**The Tinted Ink Rule.** Secondary text on a card is an ink tint of the card's own hue (`orange-ink`, `teal-ink`, `white-ink-2`). Gray text never appears on a swatch.

**The Black Tab Rule.** The primary action on a card is a near-black (`ink`) tab, never an orange button. Orange is a material the card is made of, not a call-to-action colour.

## Typography

**Display Font:** Barlow Semi Condensed 800 (with Barlow, system-ui)
**Body Font:** Barlow 400 / 600 (with system-ui)
**Wordmark Font:** Space Grotesk 700, wordmark only (brand commitment)

**Character:** Condensed, heavy, uppercase display that reads as moulded letters standing off a plastic card; a plain, slightly narrow grotesk for everything the visitor reads. Only three families are loaded, all self-hosted in `public/fonts/`; the hub preloads the 800 display and the wordmark.

### Hierarchy
- **Display** (800, clamp(56px, 6.4vw, 92px) desktop / clamp(48px, 15vw, 64px) under 900, line-height 1, -0.02em, uppercase): the hero card's tool name, in relief.
- **Headline** (800, clamp(44px, 4.4vw, 64px), line-height 1, uppercase): the name on a generic live card; the sheet title is 44 px and the Fit label 56 px, both in relief.
- **Title** (800, 26px, line-height 1, letter-spacing 0, uppercase): step titles on the instruction sheet, ink relief.
- **Action** (800, 30px desktop / 22px mobile, 0.04em, uppercase): black tab text.
- **Readout** (800, 44px, tabular-nums): a single digit in a 44 x 64 tile; the field on the orange card uses the same face at 52 px.
- **Lead** (Barlow 600, 24px, line-height 1.25-1.3): one-line sub under a tool name; the tag's lead line. 20 px on generic cards and under 900.
- **Body** (Barlow 400, 17-19px, line-height 1.4-1.45): step text, fit values, the tag lines. Measure is governed by card width, max-width 420 px on subs.
- **Label** (Semi Condensed 600, 14-15px, 0.06-0.08em, uppercase): control labels and dl terms, always tied to a control or a value, coloured with the card's ink tint.
- **Unlit** (800, clamp(24px, 2.6vw, 40px), 0.06em, uppercase, `hole-shade`, no relief): the name inside a shadow-board outline.

### Named Rules
**The Relief Rule.** A tool name or section title on a card is raised, never flat. Use the hue's recipe: orange face with two extrusion steps (#a4430f, #8e3a0c) and a 3/6/7 cast shadow; teal light face with one step; ink with a white up-left edge. Unlit labels in shadow outlines get no relief at all.

**The Label Is A Label Rule.** Uppercase small type exists only as a form label, a dl term, or a shadow-outline name. It never introduces a heading as a kicker or eyebrow.

**The One Wordmark Rule.** Space Grotesk appears only in the pinned brand's wordmark (26 px / 22 px). It is never used for headings, labels or body.

## Layout

Full-bleed board. `main` has 48 px padding on desktop (32 px top, 16 px gutters under 900), the brand pin row 40 px top / 48 px sides. Row 1 ("the wall") is a two-column grid `minmax(0, 780px) minmax(440px, 1fr)` with a 72 px column gap: live cards stack left at 72 px gaps, the aside column holds the shadow outlines (grid 1.15fr 1fr, 30 x 20 px gaps) above the hanging tag (max 520 px, pushed to the bottom). Row 2 repeats the same columns 136 px below for the instruction sheet and the Fit card. The hero card is a fixed grid (`head demo / text size`, 40 x 44 px gaps, min-height 620 px) so the live object sits top-right and the controls bottom. Every live card reserves 26 px under itself for its tab.

Breakpoints: under 1280 everything drops to one column (max-width 900 for cards, three outlines across), under 900 the hero card stacks to one column (demo fixed at 320 px tall, tab 60 px, labels 24 px), and under 560 the outlines go one per row at 120 px tall. The 48 px hole grid is the board's own rhythm; card edges do not snap to it, cards hang over it.

Tool pages (Operate surfaces) are a different density: desktop-first, viewport-first. The 3D viewport takes the space; controls sit in `tool-panel` panels (16 px radius, 1 px `tool-border`, 24 px padding, `--shadow-sm`) at 40 px control height on the neutral `tool-bg` ground using the shared 4-64 px spacing scale, and the `.container` is capped at 1120 px. Tool pages keep the OS theme toggle; the dimmed board (#6b4d33) exists in tokens for any board surface they show.

## Elevation & Depth

Depth is physical, not tonal: cards cast real drop shadows because they hang in front of a board, and the board itself is drilled. A peg sits at z-index 2 over the card's hole, so the card visibly hangs on it. Raised type has its own light (above-left) and its own cast shadow. Tool-page panels use the quiet shared `--shadow-sm` instead.

### Shadow Vocabulary
- **Hung card** (`box-shadow: 0 22px 36px rgba(0,0,0,0.35), inset 0 2px 0 rgba(255,255,255,0.25)`): orange and teal swatches at rest; the inset line is the lit top edge of the plastic.
- **Hung card, lifted** (`0 30px 44px rgba(0,0,0,0.42)`, same inset): the hover state, with the card translated -4 px.
- **White card** (`0 10px 18px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.7)`; lifted `0 16px 26px rgba(0,0,0,0.36)`): PLA white hangs closer to the board and its edge highlight is brighter.
- **Pinned brand** (`0 8px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.7)`): a small swatch, pinned not hung.
- **Tab** (`0 10px 18px rgba(0,0,0,0.3)`): the black tab below the card edge.
- **Peg / pin** (`inset 0 2px 2px rgba(255,255,255,0.28), 0 1px 2px rgba(0,0,0,0.5)`): a 12 px (8 px on the brand pin) steel dome.
- **Hole** (`inset 0 2px 3px rgba(0,0,0,0.45)` on a 16 px `board`-coloured disc): the punched hole in a card.
- **Field well** (`inset 0 2px 4px rgba(90,42,14,0.18)`): the text field is sunk into the orange card.
- **Tool panel** (`--shadow-sm: 0 1px 2px rgba(20,18,15,0.06)`; `--shadow`, `--shadow-lg` available): flat, quiet layering for tool pages.

### Named Rules
**The Peg Stays Rule.** Hover lifts the card (translateY(-4px), 160 ms cubic-bezier(0.23,1,0.32,1), deeper shadow); the peg and the hole do not move. Under `prefers-reduced-motion` the lift is removed entirely.

**The Lit Scene Rule.** Shadows always fall downward with no horizontal offset on cards; raised type is lit from above-left. Nothing glows, nothing is elevated by colour alone.

## Shapes

Printed plastic with a small fillet: cards and shadow outlines are 10 px radius, the pinned brand 6 px, fields and the demo frame 8 px, digit and step tiles 4 px, the black tab square on top and 12 px on its two bottom corners so it reads as cut from the card edge. Holes, pegs and pins are perfect circles. Shadow outlines are a 4 px dashed stroke (3 px under 900) in `hole-shade`, with a 3 px dashed 16 px circle where the hole would be. Tool-page panels use the larger 16 px radius and 1 px solid borders; the pill (999 px) is reserved for badges and the toggle track on tool pages. Icons are stroked SVG, 2-3 px, round caps and joins; the tab arrow is 3 px to match the 800-weight stems beside it.

## Components

### Swatch card (hanger)
- **Character:** a printed PLA sample hanging on a steel peg.
- **Structure:** `.hanger` (relative) holds a `.peg` (12 px steel dome at top 17 px, centred) and a `.swatch` with a `.hole` (16 px board-coloured disc at top 18 px) punched through it. The tag variant hangs sideways: peg and hole at left 24 px, vertically centred.
- **Colour:** `swatch-orange`, `swatch-teal`, `swatch-white`; text is `ink`, secondary text the card's ink tint.
- **Padding:** hero 52 / 40 / 112 px (the bottom reserves room for the controls and tab); generic live card 52 / 40 / 100 px, min-height 300 px; sheet 52 / 40 / 44 px; fit 48 / 32 / 32 px; tag 22 / 28 / 22 / 60 px.
- **Hover:** lifts 4 px with the deeper shadow in 160 ms; **focus-visible** inside a card is a 3 px `ink` ring, offset 3 px.

### Tab (the action)
- **Shape:** absolute, left 40 px, hanging 26 px below the card's bottom edge; 72 px tall, 0 36 px padding, radius 0 0 12px 12px. Under 900: left 20 px, 22 px overhang, 60 px tall, 0 24 px.
- **Colour:** `ink` background, `tab-text` label, arrow in `brand-orange` (1 em, 0.6 em gap, 3 px stroke).
- **Type:** Barlow Semi Condensed 800, 30 px (22 px mobile), 0.04em, uppercase, one line.
- **States:** hover changes nothing (the card under it lifts); active scales to 0.97 in 120 ms; focus-visible is the card's 3 px ink ring.

### Shadow outline (a tool not built yet)
- **Shape:** 4 px dashed `hole-shade` border, 10 px radius, min-height 250 px (230 px on every third, 220 under 1280, 170 under 900, 120 under 560); a real peg at top 13 px and a dashed hole at 14 px.
- **Label:** the tool name in unlit type, `hole-shade`, centred 30 px from the bottom; a visually-hidden "not built yet" follows it.
- **Never:** a pill, a badge, a greyed card, or a link. It has no hover.

### Field on a card
- **Style:** 88 px tall (72 under 900), 3 px solid `orange-ink-soft` border, 8 px radius, `orange-field` well with the inset field shadow, display 800 at 52 px (40 mobile) in `ink`, 0.02em.
- **Focus:** border turns `ink`; focus-visible adds the 3 px `ink` ring at 3 px offset. No glow, no transition.
- **Label / hint:** uppercase Semi Condensed 600 15 px label above (10 px gap), Barlow 14 px hint below (8 px gap), both in `orange-ink`.

### Digit readout
- **Style:** two 44 x 64 px `ink` tiles (4 px radius, 8 px gap) showing one tabular digit each in `orange-emb-hi` at 44 px, followed by a 24 px / 600 unit in `orange-ink-soft`. Values are always two fixed digits (zero-padded, mm).
- **Motion:** a changed digit ticks up 5 px and back in 120 ms (cubic-bezier(0.23,1,0.32,1)); transform only, so nothing reflows. Skipped under reduced motion.

### Range on a card
- **Style:** 6 px track in `orange-ink` with a 1 px inset shade, 3 px radius; 22 px `ink` thumb with a 3 px `orange-field` border and a 2 px drop. No hover scale.
- **Focus-visible:** thumb ring `0 0 0 3px brand-orange, 0 0 0 6px ink`.

### Pinned brand
- **Style:** PLA-white swatch, 6 px radius, 14 / 20 / 14 / 16 px padding, an 8 px steel pin at 6, 6; the millstone mark at 30 px (stone in `currentColor` ink, furrows and facet in brand orange) beside the wordmark. 24 px mark and 22 px wordmark under 900.
- **States:** no hover change; focus-visible is the 3 px ink ring.

### Instruction sheet step
- **Style:** a 30 px `ink` number tile (4 px radius, display 800 19 px in PLA white) and a 30 px stroked icon in a 12 px-gap row, then an ink-relief 26 px title and 17 px `white-ink-2` text. Three across at 32 px gaps, stacking under 900.

### Spec list (Fit card)
- **Style:** dl rows on a 136 px / 1fr grid (112 px under 900), 12 px between rows; terms in Semi Condensed 600 14 px uppercase `teal-ink`, values in Barlow 600 `ink`.

### Tool-page primitives (shared tokens, not on the hub)
- **Button:** 40 px control height, 1 px `tool-border`-strong border, 10 px radius, Barlow 600 at 14 px; primary fills brand orange with white text, hover #d9661a, active #c2570f; ghost is transparent with a 12% orange wash on hover.
- **Input / select / textarea:** 40 px, 1 px border, 10 px radius, white; focus swaps the border to orange and adds a 3 px 45%-orange ring.
- **Panel / card:** white, 1 px `tool-border`, 16 px radius, 24 px padding, `--shadow-sm`; an interactive card lifts 1 px with `--shadow`.
- **Badge:** pill, 12 px / 600, sunken gray; `badge-accent` orange wash, `badge-live` green wash.
- **Toggle:** 40 x 22 px pill track, 16 px white knob, orange when checked.

## Do's and Don'ts

### Do:
- **Do** hang every live tool as a swatch card on a peg with a punched hole, in one of the three filaments, with its name in that hue's relief recipe and a black tab as its only action.
- **Do** show an unbuilt tool as a 4 px dashed `hole-shade` outline on an empty peg, labelled in unlit uppercase, with no link and no badge.
- **Do** colour secondary text with the card's ink tint (`orange-ink` / `orange-ink-soft`, `teal-ink`, `white-ink-2`) and keep large-only tints (`orange-ink-soft`) at 20 px / 600 or larger.
- **Do** keep the hub pinned to light (`color-scheme: light`, `meta theme-color #a47a52`); use the dimmed board only on tool pages that honour the OS theme.
- **Do** set millimetre readouts as fixed two-digit tiles with tabular numerals and a transform-only tick; never let a changing value reflow its neighbours.
- **Do** carry the board ground, the three swatch materials, the relief recipes, the black tab and the shared tokens into tool pages, then tighten: 40 px controls, 16 px radius panels, the 4-64 px spacing scale, viewport first and controls beside it.
- **Do** draw icons as stroked inline SVG (2 px, round caps) in `currentColor`; the tab arrow is 3 px to match 800-weight stems.

### Don't:
- **Don't** open any surface with a headline, subline and button stacked over a card grid; the hub's first viewport is the board with the live object on a card.
- **Don't** use orange as a button colour; the primary action on a card is the `ink` tab. (Tool-page `btn-primary` is the one exception, in shared tokens, for in-app controls on the neutral ground.)
- **Don't** put gray text on a swatch, and don't put a fourth card colour on the board.
- **Don't** add hover motion beyond the 4 px lift, or any ambient animation; the live 3D object and the digit tick are the only other things that move.
- **Don't** write a "coming soon" pill, a greyed-out card, or a disabled tab for a tool that is not built; the dashed outline is the whole statement.
- **Don't** use Space Grotesk anywhere but the wordmark, or any system display face; load only the self-hosted Barlow, Barlow Semi Condensed and Space Grotesk files.
- **Don't** add uppercase kickers or eyebrows above headings; uppercase small type is a control label, a dl term, or a shadow-outline name.
