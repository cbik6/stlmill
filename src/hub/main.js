import '../shared/base.css';
import './hub.css';
import { TOOLS } from './tools.js';

// No theme handling on the hub: the pegboard is one lit scene. Tool pages
// keep using ../shared/theme.js and the dark tokens in base.css.

const reducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const COLORS = new Set(['orange', 'teal', 'white']);
const colorClass = (c) => (COLORS.has(c) ? c : 'white');

// Authored arrow: stroke weight matches the 800-weight stems of the tab type.
const TAB_ARROW =
  '<svg class="tab-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16M13 5l7 7-7 7"/></svg>';

/* ------------------------------------------------------------------ wall */

// A live tool without authored markup: a printed swatch card on a hook.
function renderSwatch(tool) {
  const c = colorClass(tool.color);
  return `
    <article class="hanger" data-tool="${escapeHtml(tool.id)}">
      <span class="peg" aria-hidden="true"></span>
      <div class="swatch swatch-${c} generic-card">
        <span class="hole" aria-hidden="true"></span>
        <h3 class="emb emb-${c} card-label">${escapeHtml(tool.name)}</h3>
        <p class="card-sub">${escapeHtml(tool.sub || tool.tagline || '')}</p>
        <a class="tab" href="${escapeHtml(tool.href)}">${escapeHtml(tool.action || 'Open the mill')}${TAB_ARROW}</a>
      </div>
    </article>`;
}

// A tool that is not built yet: the shadow-board outline of a card on an empty hook.
function renderShadow(tool) {
  return `
    <li class="shadow" data-tool="${escapeHtml(tool.id)}">
      <span class="peg" aria-hidden="true"></span>
      <span class="hole hole-dashed" aria-hidden="true"></span>
      <span class="emb emb-outline shadow-label">${escapeHtml(tool.name)}</span>
      <span class="visually-hidden">— not built yet</span>
    </li>`;
}

function renderWall() {
  const live = document.getElementById('live-tools');
  const soon = document.getElementById('soon-tools');
  if (!live || !soon) return;
  for (const tool of TOOLS) {
    if (tool.status === 'hidden') continue; // parked tools are not on the wall at all
    if (tool.status === 'live') {
      // Authored cards (e.g. the Clicker, which carries the demo) stay as written.
      if (!live.querySelector(`[data-tool="${CSS.escape(tool.id)}"]`)) {
        live.insertAdjacentHTML('beforeend', renderSwatch(tool));
      }
    } else {
      soon.insertAdjacentHTML('beforeend', renderShadow(tool));
    }
  }
}

/* ------------------------------------------------------------------ demo */

function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Vertical tick on a single digit tile. Transform only: the tile never changes
// size, so the readout never reflows.
function tick(el) {
  if (reducedMotion || typeof el.animate !== 'function') return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate(
    [
      { transform: 'translateY(0)' },
      { transform: 'translateY(-5px)', offset: 0.45 },
      { transform: 'translateY(0)' },
    ],
    { duration: 120, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
  );
}

function wireDemo() {
  const region = document.getElementById('demo-clicker');
  const textEl = document.getElementById('demo-text');
  const sizeEl = document.getElementById('demo-size');
  const tens = document.querySelector('.digit[data-digit="tens"]');
  const ones = document.querySelector('.digit[data-digit="ones"]');
  if (!region || !textEl || !sizeEl) return;

  let demo = null;

  const readSize = () => {
    const n = Number(sizeEl.value);
    return Number.isFinite(n) ? n : 35;
  };

  const setDigits = (mm) => {
    const s = String(Math.round(mm)).padStart(2, '0').slice(-2);
    if (tens && tens.textContent !== s[0]) {
      tens.textContent = s[0];
      tick(tens);
    }
    if (ones && ones.textContent !== s[1]) {
      ones.textContent = s[1];
      tick(ones);
    }
    sizeEl.setAttribute('aria-valuetext', `${Math.round(mm)} millimetres`);
  };

  const pushText = debounce((text) => demo && demo.setText(text), 150);
  const pushSize = debounce((mm) => demo && demo.setSize(mm), 150);

  // Carry the typed text into the tool: the Clicker page seeds its design from ?text=.
  const openTab = region.closest('article')?.querySelector('a.tab');
  const syncOpenLink = () => {
    if (!openTab) return;
    const text = textEl.value.trim();
    openTab.href = text ? `./clicker/?text=${encodeURIComponent(text)}` : './clicker/';
  };

  textEl.addEventListener('input', () => {
    pushText(textEl.value);
    syncOpenLink();
  });
  syncOpenLink();
  sizeEl.addEventListener('input', () => {
    const mm = readSize();
    setDigits(mm);
    pushSize(mm);
  });
  setDigits(readSize());

  // The demo module is written separately. If it is missing or fails, the
  // region stays empty and the rest of the page is unaffected.
  (async () => {
    try {
      const mod = await import('./demo-clicker.js');
      if (typeof mod.createDemoClicker !== 'function') throw new Error('createDemoClicker not exported');
      demo = mod.createDemoClicker(region, {
        text: textEl.value,
        size: readSize(),
        colors: { body: '#1C1B19', cap: '#F2EFE9', design: '#F07A2A' },
      });
      region.classList.add('is-live');
    } catch (err) {
      region.classList.add('is-empty');
      console.warn('[stlmill] demo clicker unavailable:', err);
    }
  })();

  window.addEventListener('pagehide', () => {
    if (demo && typeof demo.dispose === 'function') demo.dispose();
    demo = null;
  });
}

/* ------------------------------------------------------------------ boot */

renderWall();
wireDemo();
