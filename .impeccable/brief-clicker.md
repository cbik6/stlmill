# Clicker Generator (clicker/index.html) — surface brief

Scope: the Clicker Generator tool page. Visitor mode: Operate. Audience: home FDM makers who arrived from the hub (already saw a live clicker) or from a direct link. Task: put their text / SVG / image on a keyboard-switch clicker, adjust footprint, switch fit and finish, preview in 3D, download a 3MF or STL zip that prints and fits first time. Frequency: a few minutes per visit, occasional returns; sliders are dragged dozens of times per session, so rebuilds must feel immediate (debounced, single-flight) and never block input. Important states: building (spinner over the bench, controls stay live), engine warnings (short body, clipped engraving, disjoint islands → hull), empty design (no source yet), load/save project, export in progress. Constraints: everything in-browser; standard web controls only; no claims beyond PRODUCT.md; the page must not resemble the Vostok Labs Clicker Generator in layout or styling.

## Direction contract

THESIS: A classic configurator built from the Swatch Wall's own materials: one left column of hanging cards beside a full-height bench, export floating at the bench's corner. It refuses the three-column "tabs | viewport | import panel" arrangement of the reference tool.

OWN-WORLD: Inherited from DESIGN.md: hardboard board ground with hole grid and grain; the bench is a recessed charcoal build plate (#2B2B2B, faint 10 mm grid, inset edge) set into the board; control cards are PLA-white swatches with an orange header card; ink #1C1B19 black tabs for actions with the 3 px orange SVG arrow; fixed-digit readouts (ink tiles, orange-tint digits) on every numeric control; Barlow Semi Condensed 800 relief only for the card header; Barlow 400/600 everywhere else; standard inputs, selects, range sliders, segmented radios styled from base.css.

STORY: The maker lands with the demo text already built on the bench, types their own, watches it rebuild, opens the fit card only if their switch doesn't seat, and downloads. A newcomer reads each closed card's status line to know what the tool can do before touching it.

FIRST VIEWPORT: Brand pin and "Clicker Generator" pin top-left. Left column 360 px: an orange header card (relief CLICKER, source segmented control Text / SVG / Image / Samples, the design field or drop zone), then PLA-white group cards Footprint, Switch & fit, Finish — one open at a time, each closed header carrying a status line ("Outline · 35 mm", "MX · 14.0 / 15.6", "3 colours · loop on"); undo / redo / reset as small pins at the column foot. Right: the bench full height with the live assembled clicker, a floating ink toolbar top-centre (Assembled / Exploded / Show switch / Cut open), dimension callouts in mm drawn on the plate, and an export dock bottom-right (size × parts summary, black Download 3MF tab, STL zip, save / load icons). Warnings clip to the dock as an orange slip. Signature move: each control group is its own swatch hanging on the board. Motion grammar: hover lifts a card 4 px (Peg Stays); loading a preset cascades the digit readouts one tile at a time; nothing else animates. Phones: bench on top (45vh, sticky), column as an accordion below.

FORM: Bench & Rail, candidate 1 of 7 on the grounded structure list (dealt third by the roll, chosen by the user). seed:77b8571b0c69a0b4

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Tip link destination (hub carries the placeholder).
- Whether the demo text on the hub should carry over to the tool via a URL parameter (nice to have).
