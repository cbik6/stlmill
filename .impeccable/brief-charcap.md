# Character Cap (character-cap/index.html) — surface brief

Scope: the Character Cap tool page. Visitor mode: Operate. Audience: the same home FDM makers; many arrive wanting a seasonal character (pumpkin, ghost) for a bare switch, some bring their own sculpt. Task: pick a built-in character or upload a mesh, size it, choose flat or hollow underside and the stem socket fit, put a face on it as a two-colour inlay, optionally add a switch body, preview, download. Frequency and feel: as the Clicker; builds run 0.3–2 s on the main thread, so the busy pill matters more here. Important states: loading a mesh (parse, "not a closed solid" error with what to do), building, face split into many pieces (warning), hollow walls too thin (warning), empty face. Constraints: everything in-browser (manifold-3d WASM loads once, ~540 kB); uploaded meshes never leave the page; the reference pumpkin/ghost meshes are third-party and never appear in the product; built-in characters are original; standard web controls; must not resemble the Vostok Labs tool.

## Direction contract

THESIS: The Clicker's Bench & Rail, inherited whole: one left rail of hanging cards beside the full-height bench. It refuses a new layout; what is new is the content of the cards (character, underside, socket, face) and a bench that shows a character standing on the plate rather than a flat clicker.

OWN-WORLD: Exactly DESIGN.md's tool-page system: board ground, orange header card with relief label CHARACTER, PLA-white group cards, ink black tab, fixed-digit readout tiles, bench plate with ink toolbar and orange callouts, export dock with the hung tab. No new tokens, faces or motion.

STORY: A maker lands on a pumpkin already built with a smiling face, swaps to the ghost or drops in their own STL, sees it re-cut with the socket underneath, and downloads a cap that presses onto a switch. A newcomer learns from the closed cards' status lines ("Pumpkin · 36 mm", "Flat · tapered socket", "Face: front · 50 %").

FIRST VIEWPORT: Brand pin + "Character Cap" pin. Left rail 360 px: orange header card CHARACTER with a segmented source control Built-in / Upload; Built-in shows the four original characters as small inline previews (pumpkin, ghost, skull, heart) and a width slider; Upload shows a drop zone (STL / 3MF / OBJ, size limit, "closed solid" hint) and the width slider. Group cards: Underside (flat / hollow, flat height, wall thickness, hollow depth), Socket (tapered / straight / round, opening, hole diameter, depth, boss wall, fit), Face (source Text / SVG / Samples, direction front / top, width %, depth, offset x / y), Body (add switch body toggle; height, rim, wall, size when on), Finish (colours: cap, face, body). One group open at a time with status lines; foot pins Undo / Redo / Reset. Bench: the character standing on the plate at print orientation, toolbar Assembled / Exploded (body lifts away when present) · Show switch · Cut open · Grid · Callouts; export dock with "35 × 36 × 25 mm · 2 parts · fits Cherry MX", Download 3MF tab, STL zip, save / load. Warnings slip as on the Clicker. Signature move: unchanged (each group its own swatch); the character itself is the memorable object.

FORM: Bench & Rail, inherited from the Clicker surface (DESIGN.md "Tool pages"); no roll. seed:77b8571b0c69a0b4

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Upload size limit (proposed 15 MB / 500k triangles with a simplify step above 100k).
- Whether uploaded multi-part 3MFs keep their colours as extra parts (engine returns parts[]; v1 merges and warns).
