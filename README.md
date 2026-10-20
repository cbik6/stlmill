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
public/                 static assets copied as-is (favicon.svg, CNAME)
src/
  hub/                  landing page: tools.js (registry), main.js, hub.css
  shared/               design system shared by hub + tools
    base.css            tokens, dark mode, buttons, inputs, .panel, .badge ...
    theme.js            initTheme() / toggleTheme() (localStorage 'stlmill-theme')
  clicker/              the Clicker tool's source
vite.config.js          multi-page build; base './'
.github/workflows/      GitHub Pages deploy
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

Pushing to `main` runs `.github/workflows/deploy.yml`, which does `npm ci`,
`npm run build`, and publishes `dist/` to GitHub Pages via
`actions/deploy-pages`. In the repository settings, set **Pages → Source** to
**GitHub Actions** once.

### Custom domain

1. Create `public/CNAME` containing just the domain, e.g. `stlmill.com`.
   Vite copies it into `dist/` on every build so Pages keeps the domain.
2. At your DNS provider, point the apex at GitHub Pages
   (`A` records `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`) and add a
   `CNAME` for `www` → `cbik6.github.io`.
3. In **Settings → Pages**, enter the custom domain and enable **Enforce HTTPS**
   once the certificate is issued.

Because `base` is `'./'`, no config change is needed when moving between the
`github.io` subpath and the custom domain.

## License

MIT
