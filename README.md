# STLmill

**Free generators for things you can print.**

STLmill is a collection of small, browser-based tools that generate 3D-printable
models. Each tool runs entirely client-side (Three.js + CSG), so nothing is
uploaded and no account is needed: tweak a few parameters, preview the model in
3D, and download a print-ready file (3MF / STL).

Live site: https://cbik6.github.io/stlmill/ (later: https://stlmill.com)

## Tools

| Tool | Status | What it makes |
| --- | --- | --- |
| [Clicker](./clicker/) | live | Keyboard-switch clicker — put your text, logo or image on a satisfying MX-switch fidget |
| Keychain | soon | Keychain & tag maker |
| Coaster | soon | Coaster generator |
| Box | soon | Parametric box |

The list above mirrors `src/hub/tools.js`, which drives the cards on the landing page.

## Develop

Requires Node 20.11+ (CI uses Node 22).

```sh
npm install
npm run dev        # Vite dev server; hub at /, tools at /<id>/
npm run build      # production build to dist/
npm run preview    # serve dist/ locally
```

## Project layout

```
index.html              hub landing page
clicker/index.html      a tool's page (one folder per tool)
public/                 static assets copied as-is (favicon.svg, logo/, fonts/)
src/
  hub/                  landing page: tools.js (registry), main.js, hub.css
  shared/               design system shared by hub + tools
    base.css            tokens, dark mode, buttons, inputs, .panel, .badge ...
    theme.js            initTheme() / toggleTheme() (localStorage 'stlmill-theme')
  clicker/              the Clicker tool's source
vite.config.js          multi-page build; base './'
```

Every tool imports `src/shared/base.css` and calls `initTheme()` from
`src/shared/theme.js` so the whole site shares one look and one theme setting.

## Adding a new tool

1. **Create the page**: `<id>/index.html` (e.g. `coaster/index.html`) with a
   `<meta name="viewport">`, a link back to `../` (the hub), and a module script
   pointing at `../src/<id>/main.js`.
2. **Create the source**: `src/<id>/` containing `main.js`, which should start with

   ```js
   import '../shared/base.css';
   import { initTheme } from '../shared/theme.js';
   initTheme();
   ```

3. **Register it** in `src/hub/tools.js` — one entry in the `TOOLS` array:

   ```js
   { id: 'coaster', name: 'Coaster', tagline: 'Coaster generator',
     href: './coaster/', status: 'live', icon: ICONS.coaster },
   ```

   Use `status: 'soon'` to show a disabled "Coming soon" card before the tool ships.
4. **Add the entry to the build** in `vite.config.js`:

   ```js
   input: {
     main: resolve(__dirname, 'index.html'),
     clicker: resolve(__dirname, 'clicker/index.html'),
     coaster: resolve(__dirname, 'coaster/index.html'),
   }
   ```

All links use relative paths (`./clicker/`, `../`) so the build works both under
`https://<user>.github.io/<repo>/` and at a custom domain root.

## Deploy

The site is fully static: build with `npm run build` and serve `dist/`. Any
static host works; the repo is connected to **Vercel** (framework preset: Vite,
build `npm run build`, output `dist`), which deploys every push to `main` and
gives preview URLs for branches.

Equivalent free options, same settings: Cloudflare Pages, Netlify, GitHub Pages
(public repo; needs a Pages workflow and **Settings → Pages → Source: GitHub
Actions**).

### Custom domain

Add the domain in the host's dashboard and create the DNS records it tells you
to (an `A`/`ALIAS` for the apex and a `CNAME` for `www`); HTTPS is issued
automatically. Because `base` is `'./'`, no config change is needed when moving
between a subpath (e.g. `user.github.io/repo/`) and a domain root.

## License

MIT
