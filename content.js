(() => {
  if (window.__fontInspectorLoaded) {
    window.__fontInspectorInit?.();
    return;
  }
  window.__fontInspectorLoaded = true;
  // Restore log state from previous session if any
  if (window.__fontInspectorLogsEnabled) {
    logsEnabled = true;
  }

  let tooltip = null;
  let lastTarget = null;
  let locked = false;
  let highlightedEl = null;
  let pageFontsCache = null;
  let currentFamily = null;
  let logsEnabled = false;
  let logPanel = null;
  let logLines = [];

  const cyrillicCache = new Map();
  const fullNameCache = new Map(); // family → full name from font file

  const SYSTEM_FONT_ALIASES = {
    '-apple-system':            'System UI · San Francisco',
    '-apple-system-body':       'System UI · San Francisco',
    '-apple-system-headline':   'System UI · San Francisco',
    '-apple-system-subheadline':'System UI · San Francisco',
    'blinkmacsystemfont':       'System UI · San Francisco',
    'system-ui':                'System UI',
    'ui-sans-serif':            'System UI · Sans-serif',
    'ui-serif':                 'System UI · Serif',
    'ui-monospace':             'System UI · Monospace',
    'ui-rounded':               'System UI · Rounded',
  };

  function resolveFamilyName(family) {
    return SYSTEM_FONT_ALIASES[family.toLowerCase()] || family;
  }

  function resolveActualFont(fontFamilyStack) {
    const fonts = fontFamilyStack.split(',').map(f => f.trim().replace(/['"]/g, ''));
    for (const font of fonts) {
      // Skip known system aliases that don't correspond to real font names
      const key = font.toLowerCase();
      if (SYSTEM_FONT_ALIASES[key]) {
        // Check if this alias actually works (it will on the intended platform)
        try {
          if (document.fonts.check(`12px "${font}"`)) return font;
        } catch(e) {}
        continue;
      }
      // For real font names check availability
      try {
        if (document.fonts.check(`12px "${font}"`)) return font;
      } catch(e) {}
    }
    // Fallback: return first non-generic font, or first font
    const nonGeneric = fonts.find(f => !['sans-serif','serif','monospace','cursive','fantasy','system-ui'].includes(f.toLowerCase()));
    return nonGeneric || fonts[0];
  }

  function resolveLineHeight(el, computedLH, fontSize) {
    if (computedLH !== 'normal') return computedLH;
    // Calculate real line-height by measuring element height
    try {
      const tmp = document.createElement('div');
      tmp.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;font:${getComputedStyle(el).font};line-height:normal;padding:0;margin:0;border:none`;
      tmp.textContent = 'Ag';
      document.body.appendChild(tmp);
      const h = Math.round(tmp.getBoundingClientRect().height);
      document.body.removeChild(tmp);
      return h > 0 ? `~${h}px` : computedLH;
    } catch(e) { return computedLH; }
  }

  const WEIGHT_NAMES = {
    100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
    500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black'
  };

  function weightLabel(weight) {
    const n = parseInt(weight);
    return WEIGHT_NAMES[n] ? `${n} · ${WEIGHT_NAMES[n]}` : String(n);
  }

  // ── Google Fonts DB lookup ────────────────────────────────
  function normalizeForGF(name) {
    return name.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  function lookupGF(family) {
    if (typeof GF_DB === 'undefined') return null;
    const key = normalizeForGF(family);
    if (GF_DB[key]) return { key, family: GF_DB[key][0], cyrillic: GF_DB[key][1] === 1 };
    for (const k of Object.keys(GF_DB)) {
      if (key.startsWith(k) || k.startsWith(key)) {
        return { key: k, family: GF_DB[k][0], cyrillic: GF_DB[k][1] === 1 };
      }
    }
    return null;
  }

  function gfUrl(gfFamily) {
    return 'https://fonts.google.com/specimen/' + gfFamily.replace(/ /g, '+');
  }
  const debugLog = new Map(); // family → string[]

  // ── Logging ──────────────────────────────────────────────
  function log(family, msg) {
    if (!debugLog.has(family)) debugLog.set(family, []);
    const line = `[${family}] ${msg}`;
    debugLog.get(family).push(msg);
    logLines.push(line);
    if (logsEnabled) updateLogPanel();
  }

  function updateLogPanel() {
    if (!logPanel) return;
    const body = logPanel.querySelector('#__fi_log_body');
    if (!body) return;
    body.innerHTML = logLines.map(l =>
      `<div style="padding:1px 0;border-bottom:1px solid rgba(255,255,255,0.04);word-break:break-all">${escHtml(l)}</div>`
    ).join('');
    body.scrollTop = body.scrollHeight;
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function createLogPanel() {
    if (logPanel) return;
    const el = document.createElement('div');
    el.id = '__fi_log_panel';
    el.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      width: 720px;
      height: 40vh;
      min-height: 240px;
      z-index: 2147483646;
      background: rgba(10,10,10,0.92);
      border: 1px solid #2a2a2a;
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      font: 14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
      color: #aaa;
      backdrop-filter: blur(6px);
      box-shadow: 0 8px 28px rgba(0,0,0,.5);
      cursor: text;
    `;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;border-bottom:1px solid #1e1e1e;flex-shrink:0;cursor:default">
        <span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Font Inspector · Логи</span>
        <div style="display:flex;gap:10px;align-items:center">
          <span id="__fi_log_open" style="font-size:10px;color:#555;cursor:pointer;padding:2px 6px;border:1px solid #2a2a2a;border-radius:4px">открыть полностью ↗</span>
          <span id="__fi_log_copy" style="font-size:10px;color:#555;cursor:pointer;padding:2px 6px;border:1px solid #2a2a2a;border-radius:4px">копировать</span>
          <span id="__fi_log_clear" style="font-size:10px;color:#555;cursor:pointer">очистить</span>
        </div>
      </div>
      <div id="__fi_log_body" style="flex:1;overflow-y:auto;padding:8px 12px;cursor:text;user-select:text"></div>
    `;
    document.documentElement.appendChild(el);
    logPanel = el;

    el.querySelector('#__fi_log_open').addEventListener('click', () => {
      const content = logLines.join('\n') || '(пусто)';
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Font Inspector Logs</title>
        <style>body{background:#0a0a0a;color:#aaa;font:13px/1.6 ui-monospace,SFMono-Regular,monospace;padding:24px;margin:0;white-space:pre-wrap;word-break:break-all}</style>
        </head><body>${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</body></html>`;
      const blob = new Blob([html], {type:'text/html'});
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    });
    el.querySelector('#__fi_log_copy').addEventListener('click', () => {
      navigator.clipboard.writeText(logLines.join('\n'));
      const btn = el.querySelector('#__fi_log_copy');
      btn.textContent = 'скопировано!';
      setTimeout(() => { btn.textContent = 'копировать'; }, 1500);
    });
    el.querySelector('#__fi_log_clear').addEventListener('click', () => {
      logLines = [];
      updateLogPanel();
    });

    updateLogPanel();
  }

  function destroyLogPanel() {
    if (logPanel) { logPanel.remove(); logPanel = null; }
  }

  // Listen for messages from background (log toggle)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggleAnimSettings') {
      createAnimSettingsPanel();
    }
    if (msg.action === 'setLogs') {
      logsEnabled = msg.enabled;
      window.__fontInspectorLogsEnabled = msg.enabled;
      if (logsEnabled) {
        createLogPanel();
      } else {
        destroyLogPanel();
      }
    }
  });

  // ── Font URL extraction ───────────────────────────────────
  // Normalize font name for fuzzy matching: lowercase, strip spaces/dashes/underscores
  function normalizeFontName(name) {
    return name.toLowerCase().replace(/[\s_\-]+/g, '');
  }

  function getFontUrls() {
    const map = new Map(); // normalized name → [url, ...]
    try {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch(e) { continue; }
        if (!rules) continue;
        for (const rule of rules) {
          if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
          const rawFamily = (rule.style.getPropertyValue('font-family') || '')
            .replace(/['"]/g, '').trim();
          if (!rawFamily) continue;
          const key = normalizeFontName(rawFamily);
          const src = rule.style.getPropertyValue('src') || '';
          const urls = [...src.matchAll(/url\(["']?([^"')]+)["']?\)/g)]
            .map(m => m[1])
            .filter(u => /\.(woff2?|ttf|otf)(\?.*)?$/i.test(u));
          if (urls.length) {
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(...urls);
          }
        }
      }
    } catch(e) {}
    return map;
  }

  // ── opentype.js ───────────────────────────────────────────
  // opentype.js is injected as a content script before this file by background.js
  // so window.opentype is available directly in the isolated world
  function loadOpentype() {
    if (window.opentype) return Promise.resolve(window.opentype);
    return Promise.reject(new Error('opentype not available'));
  }

  async function checkFontFileCyrillic(family, url) {
    const absUrl = new URL(url, location.href).href;
    log(family, `fetch → ${absUrl.slice(0, 80)}`);
    const res = await fetch(absUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    log(family, `fetched ${(buffer.byteLength/1024).toFixed(1)}kb`);
    const opentype = await loadOpentype();
    const font = opentype.parse(buffer);
    // Store full name for tooltip display
    const fullName = font.names?.fullName?.en || font.names?.postScriptName?.en || null;
    if (fullName) fullNameCache.set(family, fullName);
    const testPoints = [[0x0428,'Ш'],[0x0401,'Ё'],[0x044C,'ь'],[0x0414,'Д'],[0x0416,'Ж']];
    const results = testPoints.map(([cp, ch]) => {
      const g = font.charToGlyph(String.fromCodePoint(cp));
      return `${ch}:${g && g.index !== 0 ? '✓' : '✗'}`;
    });
    log(family, `cmap: ${results.join(' ')}`);
    return results.some(r => r.endsWith('✓'));
  }

  async function canvasFallback(family) {
    log(family, 'canvas fallback…');
    try { await document.fonts.load(`24px "${family}"`); } catch(e) {}
    const size = 40;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    for (const char of ['Д','Ж','Ш']) {
      ctx.clearRect(0,0,size,size);
      ctx.font = `24px "${family}", sans-serif`;
      ctx.fillText(char, 4, 30);
      const d1 = ctx.getImageData(0,0,size,size).data;
      ctx.clearRect(0,0,size,size);
      ctx.font = `24px sans-serif`;
      ctx.fillText(char, 4, 30);
      const d2 = ctx.getImageData(0,0,size,size).data;
      let diff = 0;
      for (let i = 0; i < d1.length; i++) diff += Math.abs(d1[i]-d2[i]);
      log(family, `canvas "${char}" diff=${diff}`);
      if (diff > 300) return true;
    }
    return false;
  }

  async function checkCyrillic(family) {
    // Step 1: Google Fonts DB (fastest, most reliable)
    const gf = lookupGF(family);
    if (gf !== null) {
      log(family, `GF DB match: "${gf.key}" → cyrillic: ${gf.cyrillic ? '✓' : '✗'}`);
      return gf.cyrillic;
    }
    log(family, 'not in GF DB, checking @font-face…');

    // Step 2: Check if any element on the page uses this font with actual Cyrillic text.
    // If the browser is rendering Cyrillic in this font → it definitely supports it.
    const cyrillicRegex = /[\u0400-\u04FF]/;
    const allEls = document.body.querySelectorAll('*');
    for (const el of allEls) {
      const cs = getComputedStyle(el);
      const elFamily = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (elFamily.toLowerCase() !== family.toLowerCase()) continue;
      // Check direct text nodes for Cyrillic
      for (const node of el.childNodes) {
        if (node.nodeType === 3 && cyrillicRegex.test(node.textContent)) {
          log(family, 'found Cyrillic text rendered in this font on page → ✓');
          return true;
        }
      }
    }
    log(family, 'no Cyrillic text found on page for this font');

    const fontUrls = getFontUrls();
    const key = normalizeFontName(family);

    if (fontUrls.size > 0) {
      log(family, `known @font-face: ${[...fontUrls.keys()].join(', ')}`);
    }

    let urls = fontUrls.get(key) || [];
    if (urls.length === 0) {
      for (const [k, v] of fontUrls.entries()) {
        if (key.includes(k) || k.includes(key)) {
          urls = v;
          log(family, `fuzzy match → "${k}"`);
          break;
        }
      }
    }
    log(family, `@font-face URLs: ${urls.length > 0 ? urls.length : 'none (system font)'}`);

    if (urls.length === 0) {
      log(family, 'system font → ✓');
      return true;
    }

    try {
      log(family, 'loading opentype.js…');
      await loadOpentype();
      log(family, 'opentype.js OK');
    } catch(e) {
      log(family, `opentype.js failed: ${e.message}`);
    }

    for (const url of urls) {
      try {
        const result = await checkFontFileCyrillic(family, url);
        log(family, `result → ${result ? '✓' : '✗'}`);
        return result;
      } catch(e) {
        log(family, `error: ${e.message}`);
      }
    }

    return canvasFallback(family);
  }

  async function prefetchCyrillicForPage() {
    const fonts = getPageFonts();
    for (const font of fonts) {
      if (!cyrillicCache.has(font)) {
        cyrillicCache.set(font, null);
        try {
          const result = await checkCyrillic(font);
          cyrillicCache.set(font, result);
        } catch(e) {
          cyrillicCache.set(font, false);
          log(font, `unexpected error: ${e.message}`);
        }
        // Re-render tooltip if it's currently showing this font
        if (currentFamily === font && lastTarget && tooltip && tooltip.style.display === 'flex') {
          onMouseMove.__lastEvent && onMouseMove.__lastEvent instanceof MouseEvent
            ? null : null;
          // Rebuild tooltip HTML in place
          if (hasText(lastTarget)) {
            const s = getComputedStyle(lastTarget);
            const fam = s.fontFamily.split(',')[0].replace(/['"]/g,'').trim();
            if (fam === font) {
              setTooltipContent(buildTooltipForEl(lastTarget));
            }
          }
          clearInterval(spinnerInterval);
        }
      }
    }
  }

  // ── Tooltip helpers ───────────────────────────────────────
  function cyrillicBadge(state) {
    if (state === null)
      return `<span id="__fi_cyr" style="color:#555"><span class="__fi_spin">⠋</span></span>`;
    const color = state ? '#4caf50' : '#e05252';
    return `<span id="__fi_cyr" style="color:${color};font-weight:500">${state ? '✓' : '✗'}</span>`;
  }

  let spinnerInterval = null;

  // ── Animation state ───────────────────────────────────────
  let animTarget  = { x: 0, y: 0 };
  let animCurrent = { x: 0, y: 0 };
  let animTilt    = { x: 0, z: 0 };
  let animRafId   = null;
  let animSettings = { enabled: true, speed: 0.12, tilt: 8 };

  function lerp(a, b, t) { return a + (b - a) * t; }

  function animLoop() {
    animRafId = requestAnimationFrame(animLoop);
    if (!tooltip || tooltip.style.display === 'none') return;

    if (!animSettings.enabled) {
      tooltip.style.left      = animTarget.x + 'px';
      tooltip.style.top       = animTarget.y + 'px';
      tooltip.style.transform = '';
      animCurrent.x = animTarget.x;
      animCurrent.y = animTarget.y;
      animTilt.x = 0; animTilt.z = 0;
      return;
    }

    const dx = animTarget.x - animCurrent.x;
    const dy = animTarget.y - animCurrent.y;

    animCurrent.x = lerp(animCurrent.x, animTarget.x, animSettings.speed);
    animCurrent.y = lerp(animCurrent.y, animTarget.y, animSettings.speed);

    const maxT = animSettings.tilt;
    animTilt.z = lerp(animTilt.z, Math.max(-maxT, Math.min(maxT, -dx * 0.55)), 0.10);
    animTilt.x = lerp(animTilt.x, Math.max(-maxT, Math.min(maxT,  dy * 0.40)), 0.10);

    tooltip.style.left      = animCurrent.x.toFixed(1) + 'px';
    tooltip.style.top       = animCurrent.y.toFixed(1) + 'px';
    tooltip.style.transform = `perspective(800px) rotateX(${animTilt.x.toFixed(2)}deg) rotateZ(${animTilt.z.toFixed(2)}deg)`;
  }

  // ── Tooltip content transitions ───────────────────────────
  const _T_SIZE    = 180;  // ms — width/height animation
  const _T_FADE    = 140;  // ms — content fade-in
  const _T_EASE    = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const DELAY_OUT  = 200;  // ms — wait before hiding old content
  const DELAY_IN   = 200;  // ms — wait after hiding before showing new content

  let outTimer     = null;  // fires DELAY_OUT ms after new content queued → fade out
  let inTimer      = null;  // fires DELAY_IN ms after fade-out → commitContent
  let fadeInTimer  = null;  // tiny delay inside commitContent before opacity → 1
  let cleanTimer   = null;  // cleanup overflow/transition after size animation
  let pendingHtml  = null;  // latest html waiting to be committed
  let pendingSize  = null;  // height in px measured for pendingHtml
  let contentEmpty = false; // true while wrap opacity === 0 (between out and in)
  let lastTooltipKey = null;

  // Measure HTML height in an off-screen ghost — matches tooltip geometry exactly
  function measureContent(html) {
    const g = document.createElement('div');
    g.style.cssText = [
      'position:fixed','top:-9999px','left:-9999px',
      'visibility:hidden','pointer-events:none',
      'display:flex','flex-direction:column','gap:8px',
      'width:310px','padding:20px 8px 8px',
      'border:1px solid transparent','border-radius:20px',
      'box-sizing:border-box','overflow:hidden',
      'color:white',
      'font:500 14px/1.4 Helvetica Neue,HelveticaNeue,-apple-system,BlinkMacSystemFont,sans-serif',
    ].join(';');
    g.innerHTML = html;
    document.documentElement.appendChild(g);
    const h = g.offsetHeight;
    g.remove();
    return h;
  }

  function clearTransitionTimers() {
    clearTimeout(outTimer);
    clearTimeout(inTimer);
    clearTimeout(fadeInTimer);
    outTimer = inTimer = fadeInTimer = null;
    // cleanTimer is NOT cancelled here — it must always run to remove overflow:hidden
  }

  // Commit pendingHtml/pendingSize into the visible tooltip with size+fade animation
  function commitContent() {
    const wrap = tooltip.querySelector('#__fi_wrap');
    if (!wrap || !pendingHtml) return;
    clearTimeout(cleanTimer); cleanTimer = null;

    const html = pendingHtml;
    const toH  = pendingSize;
    pendingHtml = null; pendingSize = null;

    // Freeze height + clip BEFORE injecting HTML — width is always fixed 310px
    const rect = tooltip.getBoundingClientRect();
    tooltip.style.transition = '';
    tooltip.style.height   = rect.height + 'px';
    tooltip.style.overflow = 'hidden';
    wrap.style.transition  = '';
    wrap.style.opacity     = '0';
    tooltip.offsetHeight;

    wrap.innerHTML = html;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      tooltip.style.transition = `height ${_T_SIZE}ms ${_T_EASE}`;
      tooltip.style.height = toH + 'px';

      fadeInTimer = setTimeout(() => {
        wrap.style.transition = `opacity ${_T_FADE}ms ease-out`;
        wrap.style.opacity = '1';
        contentEmpty = false;
      }, 20);
    }));

    cleanTimer = setTimeout(() => {
      tooltip.style.overflow   = '';
      tooltip.style.transition = '';
    }, _T_SIZE + 40);
  }

  function setTooltipContent(html, instant) {
    clearTransitionTimers();
    const wrap = tooltip.querySelector('#__fi_wrap');

    if (instant || !wrap) {
      contentEmpty = false;
      pendingHtml = null; pendingSize = null;
      tooltip.style.height   = '';
      tooltip.style.overflow = '';
      tooltip.style.transition = '';
      tooltip.innerHTML = `<div id="__fi_wrap" style="opacity:1">${html}</div>`;
      return;
    }

    // Always update pending — it's what will be shown when the delay fires
    pendingHtml = html;
    pendingSize = measureContent(html);

    if (contentEmpty) {
      // Content already hidden — skip the out-delay, just wait DELAY_IN to show new
      inTimer = setTimeout(commitContent, DELAY_IN);
    } else {
      // Content visible — wait DELAY_OUT, then hide, then wait DELAY_IN to show new
      outTimer = setTimeout(() => {
        const w2 = tooltip.querySelector('#__fi_wrap');
        if (w2) {
          w2.style.transition = `opacity ${_T_FADE}ms ease-in`;
          w2.style.opacity = '0';
        }
        contentEmpty = true;
        inTimer = setTimeout(commitContent, DELAY_IN);
      }, DELAY_OUT);
    }
  }

  function startSpinner() {
    const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
    let i = 0;
    return setInterval(() => {
      const el = document.querySelector('.__fi_spin');
      if (el) el.textContent = frames[i++ % frames.length];
    }, 80);
  }

  function rgb2hex(rgb) {
    const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return rgb;
    return '#' + [m[1],m[2],m[3]].map(x => ('0'+parseInt(x).toString(16)).slice(-2)).join('');
  }

  function row(k, v) {
    return `<div style="display:flex;justify-content:space-between;gap:16px;padding:2px 0">
      <span style="color:#666;font-size:13px">${k}</span>
      <span style="color:#e8e8e8;font-weight:500;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;text-align:right">${v}</span>
    </div>`;
  }
  function rowRaw(k, vHtml) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:2px 0">
      <span style="color:#666;font-size:13px">${k}</span>${vHtml}
    </div>`;
  }
  function swatch(hex) {
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${hex};border:1px solid rgba(255,255,255,.12);margin-right:4px;vertical-align:middle;position:relative;top:-1px"></span>${hex}`;
  }

  function hasText(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName.toLowerCase();
    if (['script','style','svg','img','video','iframe','input','textarea','select','canvas'].includes(tag)) return false;
    for (const node of el.childNodes)
      if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
    return false;
  }

  function getPageFonts() {
    if (pageFontsCache) return pageFontsCache;
    const fonts = new Set();
    for (const el of document.body.querySelectorAll('*')) {
      const f = resolveActualFont(getComputedStyle(el).fontFamily);
      if (f) fonts.add(f);
    }
    pageFontsCache = [...fonts].sort((a,b) => a.localeCompare(b));
    return pageFontsCache;
  }

  function setHighlight(el) {
    if (highlightedEl === el) return;
    clearHighlight();
    el.dataset.__fiPrevUnderline = el.style.textDecoration || '';
    el.style.setProperty('text-decoration','underline rgba(120,180,255,0.7) 1.5px','important');
    highlightedEl = el;
  }
  function clearHighlight() {
    if (!highlightedEl) return;
    highlightedEl.style.removeProperty('text-decoration');
    if (highlightedEl.dataset.__fiPrevUnderline)
      highlightedEl.style.textDecoration = highlightedEl.dataset.__fiPrevUnderline;
    delete highlightedEl.dataset.__fiPrevUnderline;
    highlightedEl = null;
  }

  function createTooltip() {
    document.getElementById('__fi_tip')?.remove();
    const el = document.createElement('div');
    el.id = '__fi_tip';
    el.style.cssText = [
      'position:fixed','z-index:2147483647','pointer-events:none',
      'width:310px','box-sizing:border-box',
      'background:rgba(22,22,22,0.81)',
      'backdrop-filter:blur(3px)','-webkit-backdrop-filter:blur(3px)',
      'border:1px solid rgba(255,255,255,0.1)','border-radius:20px',
      'padding:20px 8px 8px',
      'display:none','flex-direction:column','gap:8px','overflow:hidden',
      'color:white',
      'font:500 14px/1.4 Helvetica Neue,HelveticaNeue,-apple-system,BlinkMacSystemFont,sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,.5)',
      'transform-style:preserve-3d','will-change:transform','left:0','top:0',
    ].join(';');
    document.documentElement.appendChild(el);
    return el;
  }

  // Figma icon SVGs (exact assets from design)
  const _ICON_SIZE = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M6.66602 7.25C7.08023 7.25 7.41602 7.58579 7.41602 8V10.3125C7.41606 10.3193 7.41699 10.3262 7.41699 10.333C7.41699 10.3395 7.41606 10.346 7.41602 10.3525V12.667C7.41584 13.0811 7.08012 13.417 6.66602 13.417C6.34919 13.417 6.07864 13.2202 5.96875 12.9424C5.82351 13.0334 5.67274 13.1157 5.51367 13.1816C5.13959 13.3366 4.73792 13.417 4.33301 13.417C3.92821 13.4169 3.52731 13.3366 3.15332 13.1816C2.77937 13.0267 2.43956 12.7999 2.15332 12.5137C1.86706 12.2274 1.63932 11.8877 1.48438 11.5137C1.32942 11.1396 1.25 10.7379 1.25 10.333C1.25004 9.92823 1.32948 9.52729 1.48438 9.15332C1.63933 8.77923 1.86701 8.43963 2.15332 8.15332C2.43963 7.86701 2.77923 7.63933 3.15332 7.48438C3.52729 7.32948 3.92823 7.25004 4.33301 7.25C4.73792 7.25 5.13958 7.32942 5.51367 7.48438C5.67281 7.55031 5.82447 7.63146 5.96973 7.72266C6.08007 7.44587 6.34987 7.25 6.66602 7.25ZM11.667 2.58301C12.4847 2.58301 13.2694 2.90821 13.8477 3.48633C14.4256 4.06439 14.7508 4.84859 14.751 5.66602V12.666C14.751 13.0801 14.415 13.4158 14.001 13.416C13.5868 13.416 13.251 13.0802 13.251 12.666V9.41699H10.084V12.666C10.084 13.0802 9.7482 13.416 9.33398 13.416C8.91977 13.416 8.58398 13.0802 8.58398 12.666V5.66602C8.58417 4.84851 8.90923 4.0644 9.4873 3.48633C10.0654 2.90828 10.8494 2.58309 11.667 2.58301ZM4.33301 8.75C4.12528 8.75004 3.91947 8.79066 3.72754 8.87012C3.53544 8.94969 3.36089 9.06684 3.21387 9.21387C3.06684 9.36089 2.94969 9.53544 2.87012 9.72754C2.79066 9.91947 2.75004 10.1253 2.75 10.333C2.75 10.5409 2.79055 10.7474 2.87012 10.9395C2.94969 11.1315 3.06685 11.3061 3.21387 11.4531C3.36086 11.6001 3.53551 11.7164 3.72754 11.7959C3.91953 11.8754 4.1252 11.9169 4.33301 11.917C4.54093 11.917 4.74735 11.8755 4.93945 11.7959C5.13145 11.7163 5.30617 11.6001 5.45312 11.4531C5.60008 11.3062 5.71633 11.1314 5.7959 10.9395C5.8731 10.7531 5.91362 10.5532 5.91602 10.3516V10.3135C5.91346 10.1123 5.87293 9.91351 5.7959 9.72754C5.71636 9.53551 5.60007 9.36086 5.45312 9.21387C5.30611 9.06685 5.13154 8.94969 4.93945 8.87012C4.74735 8.79055 4.54093 8.75 4.33301 8.75ZM11.667 4.08301C11.2473 4.08309 10.8447 4.25013 10.5479 4.54688C10.2511 4.84364 10.0842 5.24634 10.084 5.66602V7.91699H13.251V5.66602C13.2508 5.24642 13.0838 4.84363 12.7871 4.54688C12.4902 4.25006 12.0868 4.08301 11.667 4.08301Z" fill="white"/>
</svg>`;
  const _ICON_LH   = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M4.02637 2.58398C4.03288 2.58422 4.03939 2.58456 4.0459 2.58496C4.08421 2.58728 4.12166 2.59273 4.1582 2.60059C4.19319 2.60813 4.22692 2.62023 4.26074 2.63281C4.27195 2.63699 4.28398 2.63887 4.29492 2.64355C4.38034 2.68009 4.46057 2.73306 4.53027 2.80273L6.53027 4.80273C6.82308 5.09554 6.82291 5.57037 6.53027 5.86328C6.23738 6.15617 5.76262 6.15617 5.46973 5.86328L4.75 5.14355V10.8564L5.46973 10.1367C5.76262 9.84383 6.23738 9.84383 6.53027 10.1367C6.82291 10.4296 6.82308 10.9045 6.53027 11.1973L4.53027 13.1973C4.47734 13.2502 4.41617 13.2895 4.35352 13.3232C4.33122 13.3353 4.30971 13.3486 4.28613 13.3584C4.2559 13.3709 4.22468 13.3793 4.19336 13.3877C4.1783 13.3917 4.16386 13.3983 4.14844 13.4014C4.14103 13.4029 4.13342 13.403 4.12598 13.4043C4.09181 13.4101 4.05706 13.4131 4.02148 13.4141C4.0068 13.4145 3.99223 13.4145 3.97754 13.4141C3.94197 13.413 3.9072 13.4101 3.87305 13.4043C3.86561 13.403 3.85799 13.4029 3.85059 13.4014C3.83517 13.3983 3.82072 13.3917 3.80566 13.3877C3.77436 13.3793 3.7431 13.3709 3.71289 13.3584C3.68974 13.3488 3.66839 13.336 3.64648 13.3242C3.58365 13.2904 3.5228 13.2503 3.46973 13.1973L1.46973 11.1973C1.17687 10.9044 1.17694 10.4296 1.46973 10.1367C1.76262 9.84383 2.23738 9.84383 2.53027 10.1367L3.25 10.8564V5.14355L2.53027 5.86328C2.23738 6.15617 1.76262 6.15617 1.46973 5.86328C1.17694 5.57038 1.17687 5.09559 1.46973 4.80273L3.46973 2.80273L3.52637 2.75098C3.53692 2.74237 3.54867 2.73548 3.55957 2.72754C3.57345 2.71743 3.58796 2.70837 3.60254 2.69922C3.62987 2.68207 3.65765 2.6666 3.68652 2.65332C3.7003 2.64696 3.71431 2.64127 3.72852 2.63574C3.75772 2.62442 3.78723 2.61495 3.81738 2.60742C3.84243 2.60115 3.86758 2.59451 3.89355 2.59082C3.89747 2.59026 3.90135 2.58936 3.90527 2.58887C3.93623 2.58497 3.96798 2.58301 4 2.58301C4.00883 2.58301 4.01761 2.58368 4.02637 2.58398ZM13.333 11.25C13.747 11.2503 14.083 11.5859 14.083 12C14.083 12.4141 13.747 12.7497 13.333 12.75H8.66602C8.2518 12.75 7.91602 12.4142 7.91602 12C7.91602 11.5858 8.2518 11.25 8.66602 11.25H13.333ZM13.333 7.25C13.747 7.25026 14.083 7.58594 14.083 8C14.083 8.41406 13.747 8.74974 13.333 8.75H8.66602C8.2518 8.75 7.91602 8.41421 7.91602 8C7.91602 7.58579 8.2518 7.25 8.66602 7.25H13.333ZM13.333 3.25C13.747 3.25026 14.083 3.58594 14.083 4C14.083 4.41406 13.747 4.74974 13.333 4.75H8.66602C8.2518 4.75 7.91602 4.41421 7.91602 4C7.91602 3.58579 8.2518 3.25 8.66602 3.25H13.333Z" fill="white"/>
</svg>`;
  const _ICON_LS   = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M10.8037 10.1366C11.0966 9.8437 11.5714 9.8437 11.8643 10.1366L13.1973 11.4696C13.2457 11.518 13.283 11.5731 13.3154 11.6298C13.331 11.6569 13.3473 11.6836 13.3594 11.7128C13.3802 11.7631 13.3949 11.8151 13.4043 11.868C13.4119 11.9109 13.417 11.9548 13.417 11.9999C13.417 12.0453 13.411 12.0895 13.4033 12.1327C13.4025 12.1372 13.4023 12.1418 13.4014 12.1464C13.3974 12.1661 13.3902 12.1848 13.3848 12.204C13.377 12.2315 13.3704 12.2594 13.3594 12.286C13.3371 12.3399 13.308 12.3897 13.2744 12.4364C13.2511 12.4688 13.2264 12.501 13.1973 12.5302L11.8643 13.8641C11.5714 14.1566 11.0965 14.1566 10.8037 13.8641C10.5109 13.5713 10.5111 13.0965 10.8037 12.8036L10.8574 12.7499H5.14355L5.19727 12.8036C5.49003 13.0965 5.49012 13.5713 5.19727 13.8641C4.90438 14.1565 4.42947 14.1568 4.13672 13.8641L2.80371 12.5302C2.77446 12.5009 2.74899 12.4689 2.72559 12.4364C2.69207 12.3898 2.66284 12.3398 2.64062 12.286C2.62964 12.2594 2.62302 12.2315 2.61523 12.204C2.60981 12.1848 2.60254 12.1661 2.59863 12.1464C2.59774 12.1418 2.59749 12.1372 2.59668 12.1327C2.58897 12.0896 2.58398 12.0452 2.58398 11.9999C2.58399 11.9549 2.5881 11.9109 2.5957 11.868C2.60477 11.8169 2.61894 11.7664 2.63867 11.7177L2.64258 11.7079C2.65416 11.6805 2.66994 11.6554 2.68457 11.6298C2.71699 11.5729 2.7552 11.5181 2.80371 11.4696L4.13672 10.1366C4.42956 9.84376 4.90436 9.84387 5.19727 10.1366C5.49003 10.4295 5.49012 10.9043 5.19727 11.1971L5.14453 11.2499H10.8564L10.8037 11.1971C10.5109 10.9043 10.5109 10.4295 10.8037 10.1366ZM5.00098 1.91687C5.6418 1.91696 6.25682 2.17174 6.70996 2.62488C7.16289 3.07805 7.41699 3.69313 7.41699 4.33386V7.99988C7.41686 8.41398 7.08112 8.74988 6.66699 8.74988C6.25301 8.7497 5.91713 8.41387 5.91699 7.99988V6.08386H4.08398V7.99988C4.08385 8.41398 3.74812 8.74988 3.33398 8.74988C2.91985 8.74988 2.58412 8.41398 2.58398 7.99988V4.33386C2.58398 3.69298 2.83886 3.07808 3.29199 2.62488C3.74521 2.17167 4.36004 1.91687 5.00098 1.91687ZM11.9639 2.4032C12.1094 2.01557 12.542 1.81932 12.9297 1.96472C13.3173 2.11031 13.5136 2.54284 13.3682 2.93054L11.3682 8.26355C11.2583 8.55614 10.9786 8.74988 10.666 8.74988C10.3535 8.74988 10.0737 8.55614 9.96387 8.26355L7.96387 2.93054C7.81848 2.54284 8.01477 2.11031 8.40234 1.96472C8.79008 1.81932 9.22261 2.01557 9.36816 2.4032L10.666 5.86414L11.9639 2.4032ZM5.00098 3.41687C4.75786 3.41687 4.52445 3.51352 4.35254 3.68542C4.18071 3.85732 4.08398 4.09081 4.08398 4.33386V4.58386H5.91699V4.33386C5.91699 4.09081 5.82027 3.85732 5.64844 3.68542C5.47662 3.5137 5.2439 3.41696 5.00098 3.41687Z" fill="white"/>
</svg>`;
  const _ICON_GF   = `<svg width="105" height="17" viewBox="0 0 105 17" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M4 14.2647L12.1497 1.31946H17.2081V3.12054L10.1825 14.2647" fill="#FBBC04"/>
<path d="M17.2088 14.2647H12.1504V1.31946H17.2088V14.2647Z" fill="#1A73E8"/>
<path d="M20.8603 10.6062C20.8603 12.6268 19.2248 14.2646 17.207 14.2646V6.94775C19.2248 6.94775 20.8603 8.58561 20.8603 10.6062Z" fill="#34A853"/>
<path d="M17.208 14.2646C15.1902 14.2646 13.5547 12.6268 13.5547 10.6062C13.5547 8.58561 15.1902 6.94775 17.208 6.94775V14.2646Z" fill="#0D652D"/>
<path d="M20.0173 4.13364C20.0173 5.68763 18.7594 6.94783 17.207 6.94783V1.31946C18.7594 1.31946 20.0173 2.57965 20.0173 4.13364Z" fill="#1A73E8"/>
<path d="M17.2067 6.94783C15.6543 6.94783 14.3965 5.68763 14.3965 4.13364C14.3965 2.57965 15.6543 1.31946 17.2067 1.31946V6.94783Z" fill="#174EA6"/>
<path d="M4.2793 3.85222C4.2793 2.45357 5.41182 1.31946 6.8085 1.31946C8.20518 1.31946 9.3377 2.45357 9.3377 3.85222C9.3377 5.25087 8.20518 6.38499 6.8085 6.38499C5.41182 6.38499 4.2793 5.25087 4.2793 3.85222Z" fill="#EA4335"/>
<path d="M31.5977 12.924C28.7015 12.924 26.2656 10.573 26.2656 7.68452C26.2656 4.7966 28.7015 2.44507 31.5977 2.44507C33.2007 2.44507 34.3411 3.07151 35.2005 3.88931L34.1865 4.89847C33.5717 4.32382 32.7387 3.87636 31.5977 3.87636C29.4828 3.87636 27.8292 5.57613 27.8292 7.68452C27.8292 9.79347 29.4828 11.4932 31.5977 11.4932C32.9691 11.4932 33.7515 10.9433 34.2517 10.4452C34.6615 10.036 34.9312 9.44845 35.033 8.64303H31.5977V7.21173H36.4308C36.4819 7.46726 36.5072 7.77457 36.5072 8.10664C36.5072 9.17997 36.2121 10.5088 35.2634 11.455C34.3405 12.4129 33.1619 12.924 31.5977 12.924Z" fill="#0F1914"/>
<path d="M43.982 9.55028C43.982 11.4926 42.4836 12.9239 40.6457 12.9239C38.8084 12.9239 37.3105 11.4926 37.3105 9.55028C37.3105 7.59498 38.8084 6.17664 40.6457 6.17664C42.4836 6.17664 43.982 7.59498 43.982 9.55028ZM42.5218 9.55028C42.5218 8.33624 41.6523 7.50549 40.6457 7.50549C39.6391 7.50549 38.7702 8.33624 38.7702 9.55028C38.7702 10.7514 39.6391 11.5951 40.6457 11.5951C41.6523 11.5951 42.5218 10.7514 42.5218 9.55028Z" fill="#0F1914"/>
<path d="M51.4605 9.55028C51.4605 11.4926 49.9621 12.9239 48.1242 12.9239C46.2875 12.9239 44.7891 11.4926 44.7891 9.55028C44.7891 7.59498 46.2875 6.17664 48.1242 6.17664C49.9621 6.17664 51.4605 7.59498 51.4605 9.55028ZM50.0003 9.55028C50.0003 8.33624 49.1314 7.50549 48.1242 7.50549C47.1176 7.50549 46.2493 8.33624 46.2493 9.55028C46.2493 10.7514 47.1176 11.5951 48.1242 11.5951C49.1314 11.5951 50.0003 10.7514 50.0003 9.55028Z" fill="#0F1914"/>
<path d="M58.7497 6.38095V12.4388C58.7497 14.931 57.276 15.9531 55.5325 15.9531C53.8919 15.9531 52.905 14.8539 52.5335 13.9595L53.8273 13.4226C54.0583 13.9719 54.622 14.6237 55.5325 14.6237C56.6476 14.6237 57.3401 13.9342 57.3401 12.6431V12.1573H57.2889C56.9556 12.5665 56.3143 12.9239 55.5072 12.9239C53.8149 12.9239 52.2637 11.4549 52.2637 9.56323C52.2637 7.65915 53.8149 6.17664 55.5072 6.17664C56.3143 6.17664 56.9556 6.5346 57.2889 6.93084H57.3401V6.38095H58.7497ZM57.4424 9.56323C57.4424 8.37508 56.6476 7.50549 55.6354 7.50549C54.6096 7.50549 53.7508 8.37508 53.7508 9.56323C53.7508 10.739 54.6096 11.5951 55.6354 11.5951C56.6476 11.5951 57.4424 10.739 57.4424 9.56323Z" fill="#0F1914"/>
<path d="M61.3563 12.719H59.8691V2.80298H61.3563V12.719Z" fill="#0F1914"/>
<path d="M67.1996 10.6618L68.3534 11.4284C67.9825 11.9783 67.0843 12.9233 65.5337 12.9233C63.6115 12.9233 62.2227 11.4419 62.2227 9.55077C62.2227 7.54425 63.6233 6.17712 65.3673 6.17712C67.1237 6.17712 67.9825 7.56958 68.2641 8.32322L68.4175 8.70651L63.8931 10.5723C64.2393 11.2494 64.7772 11.595 65.5337 11.595C66.2896 11.595 66.8157 11.2241 67.1996 10.6618ZM63.6491 9.44777L66.6746 8.19602C66.5077 7.77446 66.008 7.48009 65.4179 7.48009C64.6619 7.48009 63.6115 8.14424 63.6491 9.44777Z" fill="#0F1914"/>
<path d="M73.5448 8.74602V12.7202H72.3555V3.45142H77.759V4.59003H73.5448V7.63217H77.3459V8.74602H73.5448Z" fill="#0F1914"/>
<path d="M78.2969 9.54863C78.2969 8.5738 78.6026 7.76669 79.2147 7.12787C79.8352 6.48905 80.6153 6.16992 81.5545 6.16992C82.4942 6.16992 83.2693 6.48905 83.8814 7.12787C84.5019 7.76669 84.8121 8.5738 84.8121 9.54863C84.8121 10.5325 84.5019 11.3396 83.8814 11.9694C83.2693 12.6082 82.4942 12.9273 81.5545 12.9273C80.6153 12.9273 79.8352 12.6082 79.2147 11.9694C78.6026 11.3306 78.2969 10.5235 78.2969 9.54863ZM79.4862 9.54863C79.4862 10.2302 79.6846 10.7824 80.0808 11.2051C80.477 11.6283 80.9683 11.8394 81.5545 11.8394C82.1407 11.8394 82.6319 11.6283 83.0282 11.2051C83.4244 10.7824 83.6228 10.2302 83.6228 9.54863C83.6228 8.87548 83.4244 8.32728 83.0282 7.90459C82.6229 7.47289 82.1317 7.25732 81.5545 7.25732C80.9767 7.25732 80.4855 7.47289 80.0808 7.90459C79.6846 8.32728 79.4862 8.87548 79.4862 9.54863Z" fill="#0F1914"/>
<path d="M85.8242 6.37705H86.9618V7.25676H87.0135C87.1945 6.94664 87.4727 6.68773 87.8476 6.48061C88.2225 6.27292 88.612 6.16992 89.0178 6.16992C89.7934 6.16992 90.3897 6.39168 90.8073 6.83632C91.2255 7.2804 91.4346 7.91303 91.4346 8.73308V12.7202H90.2453V8.81019C90.2194 7.77457 89.6984 7.25676 88.6811 7.25676C88.2067 7.25676 87.8105 7.44925 87.4918 7.8331C87.1726 8.21752 87.0135 8.6768 87.0135 9.21149V12.7202H85.8242V6.37705Z" fill="#0F1914"/>
<path d="M95.0934 12.8237C94.5763 12.8237 94.1469 12.6639 93.8069 12.3442C93.4663 12.025 93.292 11.581 93.283 11.0114V7.46437H92.1719V6.37753H93.283V4.43518H94.4729V6.37753H96.0236V7.46437H94.4729V10.623C94.4729 11.0457 94.5544 11.3333 94.7185 11.4841C94.8821 11.6356 95.0675 11.7098 95.2738 11.7098C95.3688 11.7098 95.4615 11.6997 95.552 11.6783C95.6431 11.6569 95.7268 11.6282 95.8044 11.5933L96.1793 12.6549C95.869 12.7669 95.5065 12.8237 95.0934 12.8237Z" fill="#0F1914"/>
<path d="M101.863 10.9597C101.863 11.5118 101.622 11.9784 101.14 12.3578C100.657 12.7371 100.049 12.9273 99.3168 12.9273C98.6789 12.9273 98.118 12.7607 97.6357 12.4287C97.1529 12.0972 96.8084 11.6587 96.6016 11.115L97.661 10.6619C97.8167 11.0418 98.0426 11.3373 98.34 11.549C98.6373 11.76 98.9633 11.8658 99.3168 11.8658C99.6962 11.8658 100.013 11.7842 100.267 11.6199C100.521 11.4561 100.648 11.2619 100.648 11.0373C100.648 10.6315 100.338 10.3344 99.7175 10.1441L98.6311 9.87226C97.3985 9.56158 96.7825 8.9661 96.7825 8.08582C96.7825 7.50778 97.0169 7.04344 97.4868 6.69449C97.9567 6.34496 98.558 6.16992 99.2909 6.16992C99.8507 6.16992 100.357 6.30388 100.81 6.57122C101.262 6.83914 101.578 7.19654 101.759 7.64568L100.699 8.08582C100.579 7.81847 100.383 7.6091 100.112 7.45769C99.8401 7.30742 99.5354 7.23143 99.1999 7.23143C98.8896 7.23143 98.6114 7.3091 98.3658 7.46445C98.1202 7.61979 97.9977 7.80947 97.9977 8.03404C97.9977 8.3965 98.3383 8.65541 99.0184 8.81075L99.9761 9.05671C101.234 9.3674 101.863 10.0017 101.863 10.9597Z" fill="#0F1914"/>
</svg>`;
  // Color: filled circle using actual color value
  function _iconColor(hex) {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" fill="${hex}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/></svg>`;
  }

  function getSemanticTag(el) {
    let node = el;
    while (node && node !== document.body) {
      const tag = node.tagName?.toLowerCase();
      if (/^h[1-6]$/.test(tag)) return tag.toUpperCase();
      node = node.parentElement;
    }
    return '';
  }

  const _u = (name) => chrome.runtime.getURL(`icons/${name}`);
  const _ICON_ARROW_DARK  = `<img src="${_u('icon-redirect-dark.png')}"  width="14" height="14" style="display:block">`;
  const _ICON_ARROW_LIGHT = `<img src="${_u('icon-redirect-light.png')}" width="14" height="14" style="display:block">`;

  function buildTooltipForEl(el) {
    const s = getComputedStyle(el);
    const family = resolveActualFont(s.fontFamily);
    currentFamily = family;
    const colorHex = rgb2hex(s.color);
    const cyrState = cyrillicCache.has(family) ? cyrillicCache.get(family) : null;
    const gfInfo = lookupGF(family);
    const fullName = fullNameCache.get(family);
    const displayFamily = resolveFamilyName(fullName || family);
    const displayLH = resolveLineHeight(el, s.lineHeight, s.fontSize);
    const displayLS = (s.letterSpacing === 'normal' || parseFloat(s.letterSpacing) === 0) ? '0px' : s.letterSpacing;
    const wNum = parseInt(s.fontWeight);
    const wName = {100:'Thin',200:'ExtraLight',300:'Light',400:'Regular',500:'Medium',600:'SemiBold',700:'Bold',800:'ExtraBold',900:'Black'}[wNum] || '';
    const semTag = getSemanticTag(el);

    // bg-light blob — color depends on state
    const blobGradient = gfInfo && cyrState === true
      ? 'radial-gradient(ellipse 230px 180px at 80% 120%, rgba(50,110,230,0.6) 0%, transparent 70%), radial-gradient(ellipse 200px 160px at 10% 120%, rgba(20,180,140,0.5) 0%, transparent 70%)'
      : gfInfo
        ? 'radial-gradient(ellipse 280px 200px at 50% 130%, rgba(50,110,230,0.65) 0%, transparent 70%)'
        : cyrState !== false
          ? 'radial-gradient(ellipse 280px 200px at 50% 130%, rgba(20,180,140,0.6) 0%, transparent 70%)'
          : 'radial-gradient(ellipse 280px 200px at 50% 130%, rgba(200,140,30,0.55) 0%, transparent 70%)';

    const CHIP = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;overflow:hidden;min-width:1px';
    const chipVal = (v) => `<span style="font-size:12px;font-weight:500;color:white;white-space:nowrap">${v}</span>`;
    const chipRight = (html) => `<div style="flex-shrink:0;display:flex;align-items:center">${html}</div>`;

    // Cyrillic chip (null → spinner, true → check, false → hidden)
    let cyrChip = '';
    if (cyrState === null) {
      cyrChip = `<div style="${CHIP};flex:none;width:100%">${chipVal('<span class="__fi_spin">⠋</span> Кириллица')}${chipRight(`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/></svg>`)}</div>`;
    } else if (cyrState === true) {
      cyrChip = `<div style="${CHIP};flex:none;width:100%">${chipVal('Кириллица')}${chipRight(`<img src="${_u('icon-cyrillic.png')}" width="16" height="16" style="display:block">`)}</div>`;
    }

    // CTA button
    const btnStyle = 'flex-shrink:0;width:100%;height:36px;border-radius:8px 8px 16px 16px;display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;overflow:hidden';
    let btn = '';
    if (gfInfo) {
      btn = `<div style="${btnStyle};background:white;padding:8px 16px 8px 14px">${_ICON_GF}${_ICON_ARROW_DARK}</div>`;
    } else {
      btn = `<div style="${btnStyle};background:rgba(255,255,255,0.1);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:8px 16px"><span style="font-size:14px;font-weight:400;color:rgba(255,255,255,0.8);white-space:nowrap">Нажмите, чтобы найти шрифт</span>${_ICON_ARROW_LIGHT}</div>`;
    }

    return `
<div style="position:absolute;bottom:0;left:0;right:0;height:228px;pointer-events:none;background:${blobGradient}"></div>
<div style="display:flex;flex-direction:column;gap:12px;position:relative;width:100%">
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;padding:0 16px">
    <span style="font-size:20px;font-weight:500;color:white">${displayFamily}</span>
    ${wName ? `<span style="font-size:20px;font-weight:500;color:rgba(255,255,255,0.6)">${wName}</span>` : ''}
  </div>
  <div style="display:flex;flex-direction:column;gap:8px;width:100%">
    <div style="display:flex;gap:8px;align-items:stretch">
      <div style="${CHIP};flex:1">${chipVal(s.fontSize)}${chipRight(semTag ? `<span style="font-size:12px;font-weight:500;color:rgba(255,255,255,0.5)">${semTag}</span>` : '')}</div>
      <div style="${CHIP};flex:1">${chipVal(displayLH)}${chipRight(`<img src="${_u('icon-line-height.png')}" width="16" height="16" style="display:block">`)}</div>
    </div>
    <div style="display:flex;gap:8px;align-items:stretch">
      <div style="${CHIP};flex:1">${chipVal(displayLS)}${chipRight(`<img src="${_u('icon-letter-spacing.png')}" width="16" height="16" style="display:block">`)}</div>
      <div style="${CHIP};flex:1">${chipVal(colorHex)}${chipRight(`<div style="width:12px;height:12px;border-radius:50%;background:${colorHex};border:1px solid rgba(255,255,255,0.25);flex-shrink:0"></div>`)}</div>
    </div>
    ${cyrChip}
  </div>
</div>
${btn}`;
  }

  function onMouseMove(e) {
    if (locked) return;
    const el = e.target;
    if (!el || el === tooltip || el === logPanel || logPanel?.contains(el)) return;
    lastTarget = el;

    let html, contentKey;
    if (hasText(el)) {
      setHighlight(el);
      const s = getComputedStyle(el);
      const family = resolveActualFont(s.fontFamily);
      currentFamily = family;
      const cyrState = cyrillicCache.has(family) ? cyrillicCache.get(family) : null;
      // Fingerprint: all fields that change tooltip content
      contentKey = `${family}|${s.fontSize}|${s.fontWeight}|${s.color}|${cyrState}`;

      html = buildTooltipForEl(el);
      if (cyrState === null) {
        clearInterval(spinnerInterval);
        spinnerInterval = startSpinner();
      } else {
        clearInterval(spinnerInterval);
      }
    } else {
      clearHighlight();
      currentFamily = null;
      clearInterval(spinnerInterval);
      contentKey = '__nontext__';
      const pageFonts = getPageFonts();
      html = `
<div style="position:absolute;bottom:0;left:0;right:0;height:228px;pointer-events:none;background:radial-gradient(ellipse 260px 180px at 50% 130%, rgba(80,80,80,0.45) 0%, transparent 70%)"></div>
<div style="display:flex;flex-direction:column;gap:20px;position:relative;width:100%;padding:0 16px 8px">
  <span style="font-size:12px;font-weight:400;color:rgba(255,255,255,0.8)">Шрифты на странице</span>
  <div style="display:flex;flex-direction:column;gap:12px">
    ${pageFonts.map(f => `<span style="font-size:12px;font-weight:500;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f}</span>`).join('')}
  </div>
</div>`;
    }

    const wasHidden = tooltip.style.display !== 'flex';
    tooltip.style.display = 'flex';
    if (wasHidden || contentKey !== lastTooltipKey) {
      lastTooltipKey = contentKey;
      setTooltipContent(html, wasHidden);
    }

    const pad = 14, tw = 310, th = 280;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + tw > window.innerWidth) x = e.clientX - tw - pad;
    if (y + th > window.innerHeight) y = e.clientY - th - pad;
    animTarget.x = Math.max(4, x);
    animTarget.y = Math.max(4, y);
    if (wasHidden) {
      animCurrent.x = animTarget.x; animCurrent.y = animTarget.y;
      animTilt.x = 0; animTilt.z = 0;
      tooltip.style.left = animTarget.x + 'px';
      tooltip.style.top  = animTarget.y + 'px';
      tooltip.style.transform = '';
    }
  }

  function onClick(e) {
    if (!lastTarget) return;
    if (e.target === logPanel || logPanel?.contains(e.target)) return;
    if (!hasText(lastTarget)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const family = getComputedStyle(lastTarget).fontFamily.split(',')[0].replace(/['"]/g,'').trim();
    const gfMatch = lookupGF(family);
    navigator.clipboard.writeText(family).then(() => {
      locked = true;
      clearInterval(spinnerInterval);
      const actionLabel = gfMatch ? 'открываю Google Fonts…' : 'открываю поиск…';
      setTooltipContent(`<div style="text-align:center;padding:6px 0">
        <div style="font-size:22px;margin-bottom:6px;color:#4caf50">✓</div>
        <div style="font-size:13px;font-weight:600;color:#4caf50;margin-bottom:4px">${family}</div>
        <div style="font-size:11px;color:#555">Скопировано · ${actionLabel}</div>
      </div>`, true);
      if (gfMatch) {
        chrome.runtime.sendMessage({ action: 'openUrl', url: gfUrl(gfMatch.family) });
      } else {
        chrome.runtime.sendMessage({ action: 'searchFont', font: family });
      }
      setTimeout(() => { locked = false; tooltip.style.display = 'none'; }, 1200);
    }).catch(() => {
      locked = true;
      setTooltipContent(`<div style="text-align:center;padding:6px 0;font-size:12px;color:#f44">Clipboard blocked</div>`, true);
      setTimeout(() => { locked = false; tooltip.style.display = 'none'; }, 1500);
    });
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      // Hide tooltip and deactivate inspector, but keep log panel visible
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeydown, true);
      document.documentElement.removeEventListener('mouseleave', onMouseLeave);
      document.documentElement.style.removeProperty('cursor');
      clearHighlight();
      clearInterval(spinnerInterval);
      clearTransitionTimers();
      contentEmpty = false; pendingHtml = null; pendingSize = null;
      currentFamily = null; lastTooltipKey = null;
      if (tooltip) tooltip.style.display = 'none';
      // Notify background that inspector is now off
      chrome.runtime.sendMessage({ action: 'inspectorOff' });
    }
  }
  function onMouseLeave(e) {
    if (e.target === logPanel || logPanel?.contains(e.target)) return;
    if (!locked) { tooltip.style.display = 'none'; clearHighlight(); clearInterval(spinnerInterval); clearTransitionTimers(); contentEmpty = false; pendingHtml = null; pendingSize = null; lastTooltipKey = null; }
  }

  // ── Animation settings panel ──────────────────────────────
  let animSettingsPanel = null;
  function createAnimSettingsPanel() {
    if (animSettingsPanel) { animSettingsPanel.remove(); animSettingsPanel = null; return; }
    const el = document.createElement('div');
    el.id = '__fi_anim_panel';
    el.style.cssText = `
      position:fixed;bottom:16px;left:16px;z-index:2147483646;
      background:rgba(10,10,10,0.92);border:1px solid #2a2a2a;border-radius:10px;
      padding:14px 16px;width:280px;
      font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#aaa;
      backdrop-filter:blur(6px);box-shadow:0 8px 28px rgba(0,0,0,.5);
    `;

    function makeSlider(label, key, min, max, step) {
      const val = animSettings[key];
      const id = `__fi_s_${key}`;
      return `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.06em">${label}</span>
            <span id="${id}_lbl" style="color:#aaa;font-size:11px">${val}</span>
          </div>
          <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"
            style="width:100%;accent-color:#4caf50;cursor:pointer">
        </div>`;
    }

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Анимация тултипа</span>
        <span id="__fi_anim_close" style="color:#555;cursor:pointer;font-size:14px;line-height:1;padding:2px 4px">✕</span>
      </div>
      <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <input id="__fi_s_enabled" type="checkbox" ${animSettings.enabled ? 'checked' : ''}
          style="accent-color:#4caf50;cursor:pointer;width:14px;height:14px">
        <label for="__fi_s_enabled" style="color:#aaa;font-size:12px;cursor:pointer">Включить анимацию</label>
      </div>
      ${makeSlider('Скорость', 'speed', 0.04, 0.35, 0.01)}
      ${makeSlider('Наклон', 'tilt', 0, 20, 0.5)}
    `;

    document.documentElement.appendChild(el);
    animSettingsPanel = el;

    el.querySelector('#__fi_anim_close').addEventListener('click', () => {
      el.remove(); animSettingsPanel = null;
    });
    el.querySelector('#__fi_s_enabled').addEventListener('change', function() {
      animSettings.enabled = this.checked;
    });

    for (const key of ['speed', 'tilt']) {
      const input = el.querySelector(`#__fi_s_${key}`);
      const lbl   = el.querySelector(`#__fi_s_${key}_lbl`);
      input.addEventListener('input', function() {
        animSettings[key] = parseFloat(this.value);
        lbl.textContent = this.value;
      });
    }
  }

  function init() {
    tooltip = createTooltip();
    locked = false; lastTarget = null; currentFamily = null;
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeydown, true);
    document.documentElement.addEventListener('mouseleave', onMouseLeave);
    document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
    if (!animRafId) animRafId = requestAnimationFrame(animLoop);
    prefetchCyrillicForPage();
  }

  function destroy() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeydown, true);
    document.documentElement.removeEventListener('mouseleave', onMouseLeave);
    document.documentElement.style.removeProperty('cursor');
    clearHighlight();
    clearInterval(spinnerInterval);
    clearTransitionTimers();
    contentEmpty = false; pendingHtml = null; pendingSize = null;
    if (animRafId) { cancelAnimationFrame(animRafId); animRafId = null; }
    animTilt.x = 0; animTilt.z = 0;
    pageFontsCache = null; currentFamily = null; lastTooltipKey = null;
    if (tooltip) { tooltip.style.display = 'none'; tooltip.style.transform = ''; }
    // Log panel stays visible even when inspector is off
  }

  window.__fontInspectorInit = init;
  window.__fontInspectorDestroy = destroy;
  init();
})();
