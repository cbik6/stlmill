# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite 8 multi-page site, vanilla JS/HTML/CSS (no framework), three.js + three-bvh-csg for geometry, JSZip for 3MF. Static build deployed by GitHub Actions to GitHub Pages (repo `cbik6/stlmill`), later served at the owner's domain stlmill.com. Relative asset base (`./`) so one build works at both URLs.

## Users

Home 3D-printing hobbyists with generic consumer FDM printers (Ender/Prusa/Bambu-class, any brand). They arrive from maker communities (MakerWorld, Printables, Reddit) or from search, usually with a specific thing in mind to make: a personalised clicker, a keychain, a coaster. Two arrival states, weighted equally: makers who already know what a tool makes and want to be inside it tweaking within seconds, and newcomers who need to understand what STLmill is before trusting it. Non-technical: they know their slicer, not CAD.

## Product Purpose

STLmill is a hub of free, browser-based generators for 3D-printable objects. Each tool lets the visitor customise a parametric object (their own text, logo or image, size, hardware fit, colours), preview it live in 3D, and download a print-ready file. Success: a visitor downloads a file that prints and fits first time, without installing software or creating an account.

## Positioning

Everything runs client-side in the browser: nothing is uploaded, nothing is stored, no account exists. Tools are purpose-built around real hardware fit (e.g. a Cherry MX switch cutout and keycap stem) rather than generic shape extrusion. One consistent hub, one visual language, many tools: a visitor who learns one tool knows them all.

## Operating Context

Visitor flow: hub → tool page → import a design (text / SVG / image) → adjust → preview → download → open in slicer (Bambu Studio, PrusaSlicer, OrcaSlicer, Cura) → print. Exports: 3MF (multi-object, per-part colours for multi-material setups) and STL (zip of parts) with equal standing. Desktop-first for the tools (3D viewport + controls), but tool pages must remain usable on a phone. Hardware vocabulary used in tools: MX switch, keycap, stem, plate, cutout, clearance/tolerance, rim, build plate.

## Capabilities and Constraints

Confirmed first tool: **Clicker Generator** (keyboard-switch fidget: body that holds an MX switch, keycap with raised or engraved design from text/SVG/image, optional keychain loop, colour per part). Confirmed next tools, to be ported and overhauled from Clark's earlier repo `cbik6/lithophane-generator` (single-file HTML tools on three.js r128): **Lithophane** (photo → heightmap plate; flat or bent up to 360°, min/max thickness, gamma curve, invert, chamfered frame, resolution presets; STL export) and **QR Keychain** (QR code + text label as a two-colour tag with holes; the old version is currently broken and must work first time here). Not planned: the old repo's STL Repair and STL Viewer. The hub must show open slots for future tools without faking them as available. Geometry runs on the main thread (no workers); builds are debounced. Browser targets: current Chrome/Edge/Firefox/Safari with WebGL. No backend of any kind. Files generated are licensed for **personal use only**; commercial use is not granted (the site must state this, and must not imply otherwise). Open fact: the exact licence wording.

## Brand Commitments

Name: **STLmill** (that casing). Logo: the millstone mark (circle with square eye, seven orange furrows, one orange triangular facet at top) in `public/logo/`, favicon cut in `public/favicon.svg`; brand orange `#F07A2A`; wordmark set in Space Grotesk 700. The clicker tool's UI must not resemble the Vostok Labs Clicker Generator (vostoklabs.github.io/Clicker-Generator) in layout or styling; it is a reference for functionality only. Maker credit is shown with an optional, quiet tip link (buy-me-a-coffee / MakerWorld boost style); no ads.

## Evidence on Hand

- Logo assets: `public/logo/stlmill-mark.svg`, `stlmill-lockup-light.svg`, `stlmill-lockup-dark.svg`, `public/favicon.svg`.
- Working code: hub shell (`index.html`, `src/hub/`, `src/shared/`), clicker state + 3D viewer modules (`src/clicker/state.js`, `viewer.js`), engine raster/trace layer (`src/clicker/engine/`), sample SVGs (`src/clicker/samples/`).
- No testimonials, download counts, press, or user photos exist; none may be invented. Example renders of real generated clickers do not exist yet and must be produced from the tool itself before being shown as real.

## Product Principles

1. The object is the proof: show the thing being made, live, before asking for anything.
2. Fit over flourish: dimensions, tolerances and hardware compatibility are the product's credibility.
3. Nothing leaves the browser: privacy and zero-setup are features, stated plainly.
4. One language across tools: learn one, know them all; new tools slot in without redesign.
5. Honest surface: no fake social proof, no availability claims for tools that don't exist yet.
