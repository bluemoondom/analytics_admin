(function () {
  const t = window.I18n ? window.I18n.t : (k, p) => `{${k}}`;

  // A public read-only link (/public/dashboard/<token>) renders this page without signing in;
  // its requests go to the public API, which only serves the stored dashboard.
  const PUBLIC_TOKEN = (document.body && document.body.dataset.publicToken) || '';
  const API = PUBLIC_TOKEN ? '/api/public/dashboards/' + encodeURIComponent(PUBLIC_TOKEN) : '/api/dashboards';

  // Requests a public page may make, mapped to the public API; anything else
  // (saving, deleting, sharing, ...) is not available there.
  function publicPath(method, path) {
    const p = String(path).split('?')[0];
    if (method === 'GET' && /^\/\d+$/.test(p)) return '';
    if (method === 'GET' && /^\/views\/[^/]+\/columns$/.test(p)) return '/columns';
    if (method === 'POST' && (p === '/data' || p === '/chart-data')) return p;
    if (method === 'POST' && /^\/\d+\/kpi$/.test(p)) return '/kpi';
    if (method === 'POST' && /^\/\d+\/export\/excel$/.test(p)) return '/export/excel';
    return null;
  }

  function apiUrl(method, path) {
    if (!PUBLIC_TOKEN) return API + path;
    const mapped = publicPath(method, path);
    if (mapped === null) throw new Error(t('public_read_only_error'));
    return API + mapped;
  }

  const DEFAULT_COLORS = [
    'rgba(37, 99, 235, 0.7)',
    'rgba(220, 38, 38, 0.7)',
    'rgba(16, 185, 129, 0.7)',
    'rgba(245, 158, 11, 0.7)',
    'rgba(139, 92, 246, 0.7)',
    'rgba(6, 182, 212, 0.7)',
    'rgba(236, 72, 153, 0.7)',
    'rgba(99, 102, 241, 0.7)',
  ];

  const CHART_TYPES = [
    { value: 'bar', labelKey: 'chart_type_bar' },
    { value: 'stacked_bar', labelKey: 'chart_type_stacked_bar' },
    { value: 'grouped_bar', labelKey: 'chart_type_grouped_bar' },
    { value: 'percent_bar', labelKey: 'chart_type_percent_bar' },
    { value: 'horizontal_bar', labelKey: 'chart_type_horizontal_bar' },
    { value: 'stacked_horizontal_bar', labelKey: 'chart_type_stacked_horizontal_bar' },
    { value: 'grouped_horizontal_bar', labelKey: 'chart_type_grouped_horizontal_bar' },
    { value: 'percent_horizontal_bar', labelKey: 'chart_type_percent_horizontal_bar' },
    { value: 'line', labelKey: 'chart_type_line' },
    { value: 'area', labelKey: 'chart_type_area' },
    { value: 'stacked_area', labelKey: 'chart_type_stacked_area' },
    { value: 'percent_area', labelKey: 'chart_type_percent_area' },
    { value: 'pie', labelKey: 'chart_type_pie' },
    { value: 'doughnut', labelKey: 'chart_type_doughnut' },
    { value: 'gauge', labelKey: 'chart_type_gauge' },
    { value: 'funnel', labelKey: 'chart_type_funnel' },
    { value: 'scatter', labelKey: 'chart_type_scatter' },
  ];

  const SERIES_AGGREGATION_LABELS = {
    sum: 'series_aggregation_sum',
    count: 'series_aggregation_count',
    avg: 'series_aggregation_avg',
    min: 'series_aggregation_min',
    max: 'series_aggregation_max',
  };

  const SERIES_RENDER_LABELS = {
    bar: 'series_render_bar',
    line: 'series_render_line',
  };

  const COLOR_SCHEMES = {
    default: DEFAULT_COLORS,
    warm: [
      'rgba(185, 28, 28, 0.7)',
      'rgba(217, 119, 6, 0.7)',
      'rgba(250, 204, 21, 0.7)',
      'rgba(124, 45, 18, 0.7)',
      'rgba(159, 18, 57, 0.7)',
      'rgba(220, 38, 38, 0.7)',
      'rgba(245, 158, 11, 0.7)',
      'rgba(252, 211, 77, 0.7)',
    ],
    cool: [
      'rgba(30, 64, 175, 0.7)',
      'rgba(37, 99, 235, 0.7)',
      'rgba(14, 165, 233, 0.7)',
      'rgba(13, 148, 136, 0.7)',
      'rgba(99, 102, 241, 0.7)',
      'rgba(6, 182, 212, 0.7)',
      'rgba(59, 130, 246, 0.7)',
      'rgba(45, 212, 191, 0.7)',
    ],
    pastel: [
      'rgba(244, 63, 94, 0.7)',
      'rgba(219, 39, 119, 0.7)',
      'rgba(168, 85, 247, 0.7)',
      'rgba(99, 102, 241, 0.7)',
      'rgba(59, 130, 246, 0.7)',
      'rgba(6, 182, 212, 0.7)',
      'rgba(16, 185, 129, 0.7)',
      'rgba(234, 179, 8, 0.7)',
    ],
    pastel_sunset: [
      'rgba(255, 99, 112, 0.7)',
      'rgba(255, 184, 89, 0.7)',
      'rgba(247, 162, 140, 0.7)',
      'rgba(255, 107, 69, 0.7)',
      'rgba(255, 149, 66, 0.7)',
      'rgba(255, 184, 77, 0.7)',
      'rgba(255, 130, 122, 0.7)',
      'rgba(255, 171, 145, 0.7)',
    ],
    pastel_candy: [
      'rgba(252, 165, 165, 0.7)',
      'rgba(233, 213, 232, 0.7)',
      'rgba(196, 126, 209, 0.7)',
      'rgba(140, 153, 211, 0.7)',
      'rgba(125, 184, 244, 0.7)',
      'rgba(109, 215, 228, 0.7)',
      'rgba(157, 223, 230, 0.7)',
      'rgba(183, 213, 147, 0.7)',
    ],
    pastel_forest: [
      'rgba(192, 222, 161, 0.7)',
      'rgba(134, 197, 137, 0.7)',
      'rgba(95, 179, 99, 0.7)',
      'rgba(96, 191, 235, 0.7)',
      'rgba(236, 107, 152, 0.7)',
      'rgba(255, 172, 144, 0.7)',
      'rgba(207, 160, 216, 0.7)',
      'rgba(240, 225, 113, 0.7)',
    ],
    pastel_lavender: [
      'rgba(209, 196, 233, 0.7)',
      'rgba(193, 148, 203, 0.7)',
      'rgba(170, 108, 185, 0.7)',
      'rgba(146, 96, 230, 0.7)',
      'rgba(132, 147, 203, 0.7)',
      'rgba(174, 196, 231, 0.7)',
      'rgba(245, 165, 172, 0.7)',
      'rgba(186, 225, 247, 0.7)',
    ],
    pastel_ocean: [
      'rgba(188, 232, 241, 0.7)',
      'rgba(139, 221, 230, 0.7)',
      'rgba(96, 207, 220, 0.7)',
      'rgba(45, 188, 207, 0.7)',
      'rgba(119, 183, 246, 0.7)',
      'rgba(161, 202, 244, 0.7)',
      'rgba(173, 213, 138, 0.7)',
      'rgba(255, 220, 143, 0.7)',
    ],
    pastel_roses: [
      'rgba(255, 212, 230, 0.7)',
      'rgba(250, 172, 183, 0.7)',
      'rgba(243, 141, 181, 0.7)',
      'rgba(233, 102, 150, 0.7)',
      'rgba(255, 153, 148, 0.7)',
      'rgba(255, 196, 144, 0.7)',
      'rgba(252, 240, 153, 0.7)',
      'rgba(189, 120, 198, 0.7)',
    ],
    pastel_berry: [
      'rgba(255, 138, 101, 0.7)',
      'rgba(255, 107, 69, 0.7)',
      'rgba(255, 87, 34, 0.7)',
      'rgba(225, 29, 72, 0.7)',
      'rgba(219, 39, 119, 0.7)',
      'rgba(168, 85, 247, 0.7)',
      'rgba(99, 102, 241, 0.7)',
      'rgba(234, 179, 8, 0.7)',
    ],
    pastel_mint: [
      'rgba(164, 217, 166, 0.7)',
      'rgba(139, 221, 230, 0.7)',
      'rgba(125, 197, 128, 0.7)',
      'rgba(89, 179, 93, 0.7)',
      'rgba(240, 225, 113, 0.7)',
      'rgba(255, 220, 143, 0.7)',
      'rgba(255, 196, 144, 0.7)',
      'rgba(243, 141, 181, 0.7)',
    ],
    neon: [
      'rgba(57, 255, 20, 0.7)',
      'rgba(255, 16, 240, 0.7)',
      'rgba(0, 255, 255, 0.7)',
      'rgba(255, 255, 0, 0.7)',
      'rgba(255, 0, 128, 0.7)',
      'rgba(0, 128, 255, 0.7)',
      'rgba(191, 255, 0, 0.7)',
      'rgba(255, 102, 0, 0.7)',
    ],
    earth: [
      'rgba(139, 94, 60, 0.7)',
      'rgba(160, 124, 90, 0.7)',
      'rgba(107, 142, 35, 0.7)',
      'rgba(85, 107, 47, 0.7)',
      'rgba(210, 180, 140, 0.7)',
      'rgba(205, 133, 63, 0.7)',
      'rgba(244, 164, 96, 0.7)',
      'rgba(34, 139, 34, 0.7)',
    ],
    ocean: [
      'rgba(0, 105, 148, 0.7)',
      'rgba(0, 149, 182, 0.7)',
      'rgba(0, 191, 255, 0.7)',
      'rgba(70, 130, 180, 0.7)',
      'rgba(95, 158, 160, 0.7)',
      'rgba(100, 149, 237, 0.7)',
      'rgba(0, 128, 128, 0.7)',
      'rgba(72, 61, 139, 0.7)',
    ],
    forest: [
      'rgba(34, 139, 34, 0.7)',
      'rgba(85, 107, 47, 0.7)',
      'rgba(107, 142, 35, 0.7)',
      'rgba(154, 205, 50, 0.7)',
      'rgba(124, 252, 0, 0.7)',
      'rgba(173, 255, 47, 0.7)',
      'rgba(0, 128, 0, 0.7)',
      'rgba(60, 179, 113, 0.7)',
    ],
    autumn: [
      'rgba(153, 0, 0, 0.7)',
      'rgba(204, 85, 0, 0.7)',
      'rgba(187, 120, 35, 0.7)',
      'rgba(215, 125, 0, 0.7)',
      'rgba(231, 180, 22, 0.7)',
      'rgba(139, 69, 19, 0.7)',
      'rgba(210, 105, 30, 0.7)',
      'rgba(244, 164, 96, 0.7)',
    ],
    winter: [
      'rgba(176, 196, 222, 0.7)',
      'rgba(70, 130, 180, 0.7)',
      'rgba(123, 104, 238, 0.7)',
      'rgba(0, 191, 255, 0.7)',
      'rgba(119, 136, 153, 0.7)',
      'rgba(72, 61, 139, 0.7)',
      'rgba(47, 79, 79, 0.7)',
      'rgba(176, 224, 230, 0.7)',
    ],
    spring: [
      'rgba(255, 183, 178, 0.7)',
      'rgba(255, 218, 193, 0.7)',
      'rgba(226, 240, 203, 0.7)',
      'rgba(181, 234, 215, 0.7)',
      'rgba(199, 206, 234, 0.7)',
      'rgba(255, 205, 210, 0.7)',
      'rgba(215, 204, 200, 0.7)',
      'rgba(255, 245, 157, 0.7)',
    ],
    summer: [
      'rgba(255, 236, 139, 0.7)',
      'rgba(255, 111, 97, 0.7)',
      'rgba(255, 204, 92, 0.7)',
      'rgba(79, 195, 247, 0.7)',
      'rgba(255, 171, 64, 0.7)',
      'rgba(238, 130, 238, 0.7)',
      'rgba(50, 205, 50, 0.7)',
      'rgba(255, 69, 0, 0.7)',
    ],
    berry: [
      'rgba(128, 0, 128, 0.7)',
      'rgba(186, 85, 211, 0.7)',
      'rgba(221, 160, 221, 0.7)',
      'rgba(199, 21, 133, 0.7)',
      'rgba(255, 20, 147, 0.7)',
      'rgba(218, 112, 214, 0.7)',
      'rgba(75, 0, 130, 0.7)',
      'rgba(147, 112, 219, 0.7)',
    ],
    grayscale: [
      'rgba(31, 41, 55, 0.7)',
      'rgba(75, 85, 99, 0.7)',
      'rgba(107, 114, 128, 0.7)',
      'rgba(156, 163, 175, 0.7)',
      'rgba(209, 213, 219, 0.7)',
      'rgba(55, 65, 81, 0.7)',
      'rgba(99, 102, 241, 0.7)',
      'rgba(17, 24, 39, 0.7)',
    ],
    retro: [
      'rgba(204, 119, 34, 0.7)',
      'rgba(17, 138, 178, 0.7)',
      'rgba(255, 209, 102, 0.7)',
      'rgba(6, 214, 160, 0.7)',
      'rgba(239, 71, 111, 0.7)',
      'rgba(17, 138, 178, 0.7)',
      'rgba(255, 140, 66, 0.7)',
      'rgba(131, 56, 236, 0.7)',
    ],
    midnight: [
      'rgba(25, 25, 112, 0.7)',
      'rgba(72, 61, 139, 0.7)',
      'rgba(106, 90, 205, 0.7)',
      'rgba(123, 104, 238, 0.7)',
      'rgba(0, 0, 139, 0.7)',
      'rgba(65, 105, 225, 0.7)',
      'rgba(100, 149, 237, 0.7)',
      'rgba(70, 130, 180, 0.7)',
    ],
    coral: [
      'rgba(255, 127, 80, 0.7)',
      'rgba(255, 99, 71, 0.7)',
      'rgba(240, 128, 128, 0.7)',
      'rgba(205, 92, 92, 0.7)',
      'rgba(233, 150, 122, 0.7)',
      'rgba(250, 128, 114, 0.7)',
      'rgba(255, 160, 122, 0.7)',
      'rgba(255, 69, 0, 0.7)',
    ],
    tropical: [
      'rgba(255, 105, 180, 0.7)',
      'rgba(255, 20, 147, 0.7)',
      'rgba(0, 206, 209, 0.7)',
      'rgba(255, 165, 0, 0.7)',
      'rgba(50, 205, 50, 0.7)',
      'rgba(255, 215, 0, 0.7)',
      'rgba(30, 144, 255, 0.7)',
      'rgba(221, 160, 221, 0.7)',
    ],
    citrus: [
      'rgba(255, 204, 0, 0.7)',
      'rgba(255, 165, 0, 0.7)',
      'rgba(255, 95, 31, 0.7)',
      'rgba(173, 255, 47, 0.7)',
      'rgba(154, 205, 50, 0.7)',
      'rgba(255, 255, 0, 0.7)',
      'rgba(218, 165, 32, 0.7)',
      'rgba(255, 140, 0, 0.7)',
    ],
    jewel: [
      'rgba(15, 82, 186, 0.7)',
      'rgba(0, 128, 128, 0.7)',
      'rgba(128, 0, 128, 0.7)',
      'rgba(220, 20, 60, 0.7)',
      'rgba(255, 140, 0, 0.7)',
      'rgba(75, 0, 130, 0.7)',
      'rgba(0, 100, 0, 0.7)',
      'rgba(184, 134, 11, 0.7)',
    ],
    sunset: [
      'rgba(132, 0, 50, 0.7)',
      'rgba(220, 20, 60, 0.7)',
      'rgba(255, 69, 0, 0.7)',
      'rgba(255, 140, 0, 0.7)',
      'rgba(255, 215, 0, 0.7)',
      'rgba(255, 105, 180, 0.7)',
      'rgba(128, 0, 128, 0.7)',
      'rgba(75, 0, 130, 0.7)',
    ],
    meadow: [
      'rgba(107, 142, 35, 0.7)',
      'rgba(154, 205, 50, 0.7)',
      'rgba(34, 139, 34, 0.7)',
      'rgba(124, 252, 0, 0.7)',
      'rgba(173, 255, 47, 0.7)',
      'rgba(0, 128, 0, 0.7)',
      'rgba(60, 179, 113, 0.7)',
      'rgba(85, 107, 47, 0.7)',
    ],
    royal: [
      'rgba(65, 105, 225, 0.7)',
      'rgba(75, 0, 130, 0.7)',
      'rgba(138, 43, 226, 0.7)',
      'rgba(147, 112, 219, 0.7)',
      'rgba(106, 90, 205, 0.7)',
      'rgba(123, 104, 238, 0.7)',
      'rgba(0, 0, 139, 0.7)',
      'rgba(72, 61, 139, 0.7)',
    ],
    coffee: [
      'rgba(111, 78, 55, 0.7)',
      'rgba(141, 110, 99, 0.7)',
      'rgba(169, 133, 99, 0.7)',
      'rgba(205, 133, 63, 0.7)',
      'rgba(210, 180, 140, 0.7)',
      'rgba(139, 69, 19, 0.7)',
      'rgba(160, 82, 45, 0.7)',
      'rgba(128, 70, 27, 0.7)',
    ],
    nordic: [
      'rgba(94, 129, 172, 0.7)',
      'rgba(129, 161, 193, 0.7)',
      'rgba(176, 190, 201, 0.7)',
      'rgba(143, 188, 187, 0.7)',
      'rgba(136, 192, 208, 0.7)',
      'rgba(163, 190, 140, 0.7)',
      'rgba(180, 142, 173, 0.7)',
      'rgba(208, 135, 112, 0.7)',
    ],
    cyberpunk: [
      'rgba(255, 0, 255, 0.7)',
      'rgba(0, 255, 255, 0.7)',
      'rgba(255, 255, 0, 0.7)',
      'rgba(255, 0, 128, 0.7)',
      'rgba(57, 255, 20, 0.7)',
      'rgba(191, 0, 255, 0.7)',
      'rgba(0, 191, 255, 0.7)',
      'rgba(255, 69, 0, 0.7)',
    ],
  };

  // ------------------------------------------------------------------
  // Colour strength ("sytost"): CIELAB chroma weighted by depth (100 - L*).
  // Saturated, deep colours score high; pale and yellow tones score low, so a
  // chart's first series is always clearly visible on a white background.
  // ------------------------------------------------------------------
  function parseRgb(color) {
    const str = String(color || '').trim();
    const hex = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].split('').map(ch => ch + ch).join('') : hex[1];
      return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16));
    }
    const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    return m ? m.slice(1, 4).map(Number) : [0, 0, 0];
  }

  function colorLab(color) {
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const [r, g, b] = parseRgb(color).map(lin);
    const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function colorStrength(color) {
    const [L, a, b] = colorLab(color);
    return Math.hypot(a, b) * (100 - L) / 100;
  }

  function averageStrength(colors) {
    return colors.length ? colors.reduce((acc, c) => acc + colorStrength(c), 0) / colors.length : 0;
  }

  // Order a palette by strength while keeping neighbouring series apart: the
  // strongest colour goes first, each next one is the strongest colour that is
  // also perceptually distant (CIE76 distance, full weight from 45 up) from all
  // colours already picked. Pure strength order would put e.g. two blues next
  // to each other as series 1 and 2.
  function orderByStrength(colors) {
    const rest = colors.map(c => ({ c, s: colorStrength(c), lab: colorLab(c) }))
      .sort((x, y) => y.s - x.s);
    const picked = rest.length ? [rest.shift()] : [];
    while (rest.length) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      rest.forEach((item, idx) => {
        const nearest = Math.min(...picked.map(p => Math.hypot(
          item.lab[0] - p.lab[0], item.lab[1] - p.lab[1], item.lab[2] - p.lab[2])));
        const score = item.s * Math.min(1, nearest / 45);
        if (score > bestScore) { bestScore = score; bestIdx = idx; }
      });
      picked.push(rest.splice(bestIdx, 1)[0]);
    }
    return picked.map(item => item.c);
  }

  // Strongest colour first in every chart scheme (DEFAULT_COLORS is reordered
  // too, being the same array as COLOR_SCHEMES.default).
  Object.values(COLOR_SCHEMES).forEach(colors => {
    const ordered = orderByStrength(colors);
    colors.splice(0, colors.length, ...ordered);
  });

  let state = {
    dashboards: [],
    views: [],
    currentDashboard: null,
    columns: [],
    data: { columns: [], rows: [], column_types: {} },
    chartInstances: {},
    aliasColumn: null,
    // Server-side chart data: request key -> { rows, truncated, error, generation }.
    chartCache: new Map(),
    chartGeneration: 0,
    chartRequests: new Set(),
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function parseBool(value, defaultValue) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return defaultValue;
    return [1, '1', true, 'true', 'TRUE', 'yes', 'YES'].includes(value);
  }

  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (method !== 'GET' && method !== 'HEAD') {
      const token = csrfToken();
      if (token) opts.headers['X-CSRF-Token'] = token;
    }
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(apiUrl(method, path), opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function apiRaw(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (method !== 'GET' && method !== 'HEAD') {
      const token = csrfToken();
      if (token) opts.headers['X-CSRF-Token'] = token;
    }
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(apiUrl(method, path), opts);
    if (!res.ok) throw new Error(await res.text());
    return { blob: await res.blob(), filename: extractFilename(res.headers.get('content-disposition')) };
  }

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function extractFilename(header) {
    if (!header) return 'download';
    // RFC 5987 name (UTF-8, e.g. with diacritics) first, then the plain one.
    const utf = header.match(/filename\*\s*=\s*UTF-8''([^;\n]+)/i);
    if (utf) {
      try { return decodeURIComponent(utf[1].trim()); } catch (e) { /* use the plain name */ }
    }
    const m = header.match(/filename\s*=\s*((['"]).*?\2|[^;\n]*)/);
    return m ? m[1].replace(/['"]/g, '') : 'download';
  }

  // Read-only page of a public link: open the dashboard, nothing else.
  async function initPublic() {
    bindEvents();
    try {
      await openDashboard(0);
    } catch (err) {
      $('#empty-state').classList.remove('hidden');
      $('#empty-state').innerHTML = `<p>${esc(t('public_link_invalid_text'))}</p>`;
      $('#builder').classList.add('hidden');
      return;
    }
    const dash = state.currentDashboard;
    document.title = dash.name || document.title;
    const nameInput = $('#dashboard-name');
    nameInput.readOnly = true;
    nameInput.tabIndex = -1;
    const note = $('#public-note');
    const expires = dash.public && dash.public.expires_at;
    note.textContent = expires
      ? t('public_view_note_expires', { date: formatDescriptionDate(expires.replace(' ', 'T') + 'Z') })
      : t('public_view_note');
    note.classList.remove('hidden');
  }

  function init() {
    if (PUBLIC_TOKEN) {
      const start = () => initPublic();
      if (window.I18n && window.I18n.isReady && !window.I18n.isReady()) {
        const unsubscribe = window.I18n.onChange(() => { unsubscribe(); start(); });
      } else {
        start();
      }
      return;
    }
    console.log('app.js init start');
    bindLanguageSwitcher();
    bindUserMenu();
    if (window.ConnectorManager) window.ConnectorManager.init();
    if (window.I18n && window.I18n.isReady && window.I18n.isReady()) {
      loadViews();
      loadDashboards();
    } else if (window.I18n) {
      const unsubscribe = window.I18n.onChange(() => {
        unsubscribe();
        loadViews();
        loadDashboards();
      });
    } else {
      loadViews();
      loadDashboards();
    }
    bindEvents();
    bindMenuSwitch();
    window.addEventListener('analytics:views-changed', reloadViewsQuietly);
    console.log('app.js init end');
  }

  function bindUserMenu() {
    const section = $('#user-section');
    const trigger = $('#user-trigger');
    const logoutButton = $('#logout-button');
    if (!section || !trigger) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = section.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!section.contains(e.target)) {
        section.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    if (logoutButton) {
      logoutButton.addEventListener('click', async () => {
        try {
          const headers = {};
          const token = csrfToken();
          if (token) headers['X-CSRF-Token'] = token;
          const res = await fetch('/auth/logout', { method: 'POST', headers });
          if (res.ok) {
            window.location.href = '/login';
          }
        } catch (err) {
          console.error('Logout failed', err);
        }
      });
    }
  }

  function bindLanguageSwitcher() {
    const container = $('#lang-switcher');
    const trigger = $('#lang-switcher-trigger');
    const options = $('#lang-switcher-options');
    if (!container || !trigger || !options) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      container.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        container.classList.remove('open');
      }
    });
    function chooseLanguage(language) {
      if (window.I18n) window.I18n.setLanguage(language);
      // The open state lives on the container; closing only the list left the
      // menu hanging over the controls below it.
      container.classList.remove('open');
      options.classList.remove('open');
    }
    options.querySelectorAll('.custom-select-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        chooseLanguage(opt.dataset.lang);
      });
      opt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          chooseLanguage(opt.dataset.lang);
        }
      });
    });

    if (window.I18n) {
      window.I18n.onChange(updateLanguageActiveState);
      window.I18n.onChange(() => {
        renderDashboardList();
        if (state.currentDashboard) {
          renderAllFieldPanels();
          renderFilters();
          renderChartControls();
          translateSeriesRowLabels();
          renderCharts();
        }
      });
      updateLanguageActiveState(window.I18n.getLang());
    }
  }

  const LANG_LABELS = {
    cs: { name: 'Čeština', flag: '/static/icons/flag-cs.svg' },
    en: { name: 'English', flag: '/static/icons/flag-en.svg' },
    de: { name: 'Deutsch', flag: '/static/icons/flag-de.svg' },
    fr: { name: 'Français', flag: '/static/icons/flag-fr.svg' },
  };

  function updateLanguageActiveState(language) {
    const trigger = $('#lang-switcher-trigger');
    const options = $('#lang-switcher-options');
    if (!trigger || !options) return;
    const info = LANG_LABELS[language] || LANG_LABELS.en;
    trigger.innerHTML = `
      <img src="${esc(info.flag)}" alt="" class="flag-icon" />
      <span>${esc(info.name)}</span>
    `;
    options.querySelectorAll('.custom-select-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.lang === language);
    });
  }

  function translateSeriesRowLabels() {
    $('#chart-series-list').querySelectorAll('.chart-series-row').forEach(row => {
      row.querySelectorAll('.series-agg').forEach(sel => {
        try {
          const labels = JSON.parse(sel.dataset.i18nOpts || '{}');
          Array.from(sel.options).forEach(opt => {
            const key = labels[opt.value];
            if (key) opt.textContent = t(key);
          });
        } catch (e) { /* ignore parse errors */ }
      });
      row.querySelectorAll('.series-render').forEach(sel => {
        try {
          const labels = JSON.parse(sel.dataset.i18nOpts || '{}');
          Array.from(sel.options).forEach(opt => {
            const key = labels[opt.value];
            if (key) opt.textContent = t(key);
          });
        } catch (e) { /* ignore parse errors */ }
      });
    });
  }

  function bindMenuSwitch() {
    const dashBtn = $('#menu-dashboards');
    const viewBtn = $('#menu-view-modeling');
    const connBtn = $('#menu-connectors');
    if (!dashBtn || !viewBtn) {
      console.error('Menu buttons not found');
      return;
    }

    function onMenuClick(handler) {
      return (e) => {
        e.preventDefault();
        e.stopPropagation();
        handler();
      };
    }

    dashBtn.addEventListener('click', onMenuClick(() => {
      console.log('Dashboard menu clicked');
      hideConnectorSection();
      showDashboardSection();
    }));
    viewBtn.addEventListener('click', onMenuClick(() => {
      console.log('View modeling menu clicked');
      hideConnectorSection();
      showViewModelingSection();
    }));
    if (connBtn) {
      connBtn.addEventListener('click', onMenuClick(() => {
        console.log('Connectors menu clicked');
        showConnectorSection();
      }));
    }
  }

  function hideConnectorSection() {
    $('#connectors-menu-section')?.classList.add('hidden');
    $('#connectors-page')?.classList.add('hidden');
  }

  function showConnectorSection() {
    closeChartInfo();
    document.querySelectorAll('.top-menu button').forEach((btn) => btn.classList.remove('active', 'primary'));
    $('#menu-connectors')?.classList.add('active', 'primary');
    $('#dashboard-menu-section').classList.add('hidden');
    $('#view-menu-section').classList.add('hidden');
    $('#connectors-menu-section')?.classList.remove('hidden');
    $('#builder').classList.add('hidden');
    $('#view-modeling-page').classList.add('hidden');
    $('#empty-state').classList.add('hidden');
    $('#connectors-page')?.classList.remove('hidden');
    if (window.ConnectorManager) window.ConnectorManager.onShow();
  }

  function showDashboardSection() {
    // Views may have been created, renamed or deleted in View modeling meanwhile.
    reloadViewsQuietly();
    state.viewLineage = new Map();
    const dashBtn = $('#menu-dashboards');
    const viewBtn = $('#menu-view-modeling');
    const connBtn = $('#menu-connectors');
    $('#dashboard-menu-section').classList.remove('hidden');
    $('#view-menu-section').classList.add('hidden');
    $('#view-modeling-page').classList.add('hidden');
    dashBtn.classList.add('active', 'primary');
    viewBtn.classList.remove('active', 'primary');
    if (connBtn) connBtn.classList.remove('active', 'primary');
    if (!state.currentDashboard) {
      $('#builder').classList.add('hidden');
      $('#empty-state').classList.remove('hidden');
    } else {
      $('#builder').classList.remove('hidden');
      $('#empty-state').classList.add('hidden');
    }
  }

  function showViewModelingSection() {
    closeChartInfo();
    const dashBtn = $('#menu-dashboards');
    const viewBtn = $('#menu-view-modeling');
    const connBtn = $('#menu-connectors');
    $('#dashboard-menu-section').classList.add('hidden');
    $('#view-menu-section').classList.remove('hidden');
    $('#builder').classList.add('hidden');
    $('#empty-state').classList.add('hidden');
    $('#view-modeling-page').classList.remove('hidden');
    dashBtn.classList.remove('active', 'primary');
    viewBtn.classList.add('active', 'primary');
    if (connBtn) connBtn.classList.remove('active', 'primary');
  }

  function bindEvents() {
    bindControl('new-dashboard', 'click', newDashboard);
    bindControl('save-dashboard', 'click', async () => { await saveDashboard({ notify: true }); await refreshData(); });
    bindControl('delete-dashboard', 'click', deleteDashboard);
    bindControl('view-select', 'change', () => onViewChange(true));
    bindControl('add-chart', 'click', addChart);
    bindControl('add-series', 'click', () => addSeriesRow());
    bindControl('add-kpi', 'click', addKpi);
    bindTableNav();
    bindControl('kpi-compare', 'change', toggleKpiCompare);
    bindControl('kpi-aggregation', 'change', updateKpiAggregationHint);
    bindBackgroundThemeSelect();
    bindCustomChartTypeSelect();
    bindControl('export-excel', 'click', exportExcel);
    bindControl('export-pdf', 'click', exportPdf);
    bindControl('copy-dashboard', 'click', copyDashboard);
    bindControl('right-panel-open', 'click', openRightPanel);
    bindControl('right-panel-close', 'click', closeRightPanel);
    bindControl('right-panel-handle', 'mousedown', startResize);

    bindControl('alias-cancel', 'click', closeAliasModal);
    bindControl('alias-save', 'click', saveAlias);
    const aliasBackdrop = $('#alias-modal .modal-backdrop');
    if (aliasBackdrop) aliasBackdrop.addEventListener('click', closeAliasModal);
    bindControl('alias-input', 'keydown', (e) => {
      if (e.key === 'Enter') saveAlias();
      if (e.key === 'Escape') closeAliasModal();
    });

    $$('.rp-accordion-header').forEach(header => {
      header.addEventListener('click', () => toggleAccordion(header));
    });

    bindSetting('setting-number-format', 'change', (el) => {
      state.currentDashboard.number_format = el.value;
      refreshData();
    });
    bindSetting('setting-date-time-format', 'change', (el) => {
      state.currentDashboard.date_time_format = el.value;
      refreshData();
    });
    bindColorSchemeSelect();
    bindTableThemeSelect();
    bindSetting('setting-row-limit', 'change', (el) => {
      const v = parseInt(el.value, 10);
      state.currentDashboard.row_limit = Number.isNaN(v) ? 1000 : Math.max(0, v);
      refreshData();
    });
    bindSetting('setting-charts-per-row', 'change', (el) => {
      state.currentDashboard.charts_per_row = parseInt(el.value) || 3;
      updateChartsPerRowStyle();
    });
    bindSetting('setting-chart-height', 'change', (el) => {
      state.currentDashboard.chart_card_height = parseInt(el.value) || 360;
      updateChartsPerRowStyle();
    });
    bindSetting('setting-show-grid', 'change', (el) => {
      state.currentDashboard.show_grid = el.checked;
      renderCharts();
    });
    bindSetting('setting-replace-null', 'change', (el) => {
      state.currentDashboard.replace_null_with_empty = el.checked;
      refreshData();
    });
    bindSetting('setting-color-numeric-sign', 'change', (el) => {
      state.currentDashboard.color_numeric_sign = el.checked;
      refreshData();
    });
  }

  function bindControl(id, event, handler) {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener(event, handler);
  }

  function bindSetting(id, event, handler) {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener(event, () => handler(el));
  }

  function bindColorSchemeSelect() {
    const hidden = $('#setting-color-scheme');
    const container = $('#color-scheme-select');
    const trigger = $('#color-scheme-trigger');
    const optionsEl = $('#color-scheme-options');
    if (!hidden || !container || !trigger || !optionsEl) return;
    // Schemes from the strongest colours to the palest ones; "default" stays first.
    sortSelectOptions(hidden, v => averageStrength(COLOR_SCHEMES[v] || DEFAULT_COLORS));

    function renderOptions() {
      optionsEl.innerHTML = '';
      hidden.querySelectorAll('option').forEach(opt => {
        const value = opt.value;
        const label = t(opt.dataset.i18n) || opt.textContent;
        const scheme = COLOR_SCHEMES[value] || DEFAULT_COLORS;
        const option = document.createElement('div');
        option.className = 'custom-select-option' + (value === hidden.value ? ' selected' : '');
        option.dataset.value = value;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(value === hidden.value));
        const palette = scheme.slice(0, 6).map(c => `<span class="palette-swatch" style="background:${esc(c)}"></span>`).join('');
        option.innerHTML = `<span class="palette-swatch-list">${palette}</span><span class="option-label">${esc(label)}</span>`;
        option.addEventListener('click', (e) => {
          // The list sits inside a <label>: without preventDefault the browser
          // forwards the click to the trigger button and reopens the list.
          e.preventDefault();
          e.stopPropagation();
          hidden.value = value;
          state.currentDashboard.color_scheme = value;
          updateTrigger();
          optionsEl.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
          container.classList.remove('open');
          renderCharts();
        });
        optionsEl.appendChild(option);
      });
    }

    function updateTrigger() {
      const selected = hidden.querySelector(`option[value="${CSS.escape(hidden.value)}"]`) || hidden.options[0];
      const label = t(selected.dataset.i18n) || selected.textContent;
      const scheme = COLOR_SCHEMES[hidden.value] || DEFAULT_COLORS;
      const palette = scheme.slice(0, 6).map(c => `<span class="palette-swatch" style="background:${esc(c)}"></span>`).join('');
      trigger.querySelector('.selected-text').textContent = label;
      trigger.querySelector('.selected-palette').innerHTML = palette;
      optionsEl.querySelectorAll('.custom-select-option').forEach(opt => {
        const active = opt.dataset.value === hidden.value;
        opt.classList.toggle('selected', active);
        opt.setAttribute('aria-selected', String(active));
      });
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      renderOptions();
      const isOpen = optionsEl.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(isOpen));
      container.classList.toggle('open', isOpen);
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        optionsEl.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        container.classList.remove('open');
      }
    });

    hidden.addEventListener('change', () => {
      updateTrigger();
    });

    // Labels are built with t(); refresh them once translations load or change.
    if (window.I18n) window.I18n.onChange(() => updateTrigger());
    updateTrigger();
  }

  function syncColorSchemeAndRender() {
    const hidden = $('#setting-color-scheme');
    if (hidden) {
      hidden.value = state.currentDashboard.color_scheme || 'default';
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }
    renderCharts();
  }

  const BACKGROUND_THEMES = {
    default: { labelKey: 'background_theme_default', bg: '#ffffff', text: '#374151' },
    pastel_blue: { labelKey: 'background_theme_pastel_blue', bg: '#dbeafe', text: '#1e3a8a' },
    pastel_green: { labelKey: 'background_theme_pastel_green', bg: '#dcfce7', text: '#14532d' },
    pastel_pink: { labelKey: 'background_theme_pastel_pink', bg: '#fce7f3', text: '#831843' },
    pastel_yellow: { labelKey: 'background_theme_pastel_yellow', bg: '#fef9c3', text: '#713f12' },
    pastel_purple: { labelKey: 'background_theme_pastel_purple', bg: '#f3e8ff', text: '#581c87' },
    muted_blue: { labelKey: 'background_theme_muted_blue', bg: '#bfdbfe', text: '#1e40af' },
    muted_green: { labelKey: 'background_theme_muted_green', bg: '#bbf7d0', text: '#166534' },
    muted_gray: { labelKey: 'background_theme_muted_gray', bg: '#e5e7eb', text: '#374151' },
    muted_beige: { labelKey: 'background_theme_muted_beige', bg: '#f5f5dc', text: '#4b5563' },
    muted_sage: { labelKey: 'background_theme_muted_sage', bg: '#d1d5db', text: '#374151' },
    black: { labelKey: 'background_theme_black', bg: '#111827', text: '#f3f4f6' },
  };

  function applyBackgroundTheme() {
    const dash = state.currentDashboard;
    const theme = (dash ? dash.background_theme : 'default') || 'default';
    const body = document.body;
    if (!body) return;
    body.className = body.className.replace(/\btheme-bg-\S+/g, '').trim();
    body.classList.add('theme-bg-' + theme);
  }

  function bindBackgroundThemeSelect() {
    const trigger = $('#background-theme-trigger');
    const optionsEl = $('#background-theme-options');
    const container = $('#background-theme-switcher');
    if (!trigger || !optionsEl || !container) return;

    function currentTheme() {
      return (state.currentDashboard && state.currentDashboard.background_theme) || 'default';
    }

    function renderOptions() {
      optionsEl.innerHTML = '';
      const selected = currentTheme();
      Object.entries(BACKGROUND_THEMES).forEach(([value, theme]) => {
        const option = document.createElement('div');
        option.className = 'background-theme-option' + (value === selected ? ' selected' : '');
        option.dataset.value = value;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(value === selected));
        option.innerHTML = `<span class="theme-swatch" style="background:${esc(theme.bg)}"></span><span>${esc(t(theme.labelKey))}</span>`;
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!state.currentDashboard) {
            state.currentDashboard = { background_theme: value };
          } else {
            state.currentDashboard.background_theme = value;
          }
          updateTrigger();
          closeDropdown();
          applyBackgroundTheme();
          if (state.currentDashboard.id) saveDashboard();
        });
        optionsEl.appendChild(option);
      });
    }

    function updateTrigger() {
      const selected = currentTheme();
      const theme = BACKGROUND_THEMES[selected] || BACKGROUND_THEMES.default;
      trigger.querySelector('.theme-swatch').style.background = theme.bg;
      trigger.querySelector('.selected-text').textContent = t(theme.labelKey);
    }

    function openDropdown() {
      renderOptions();
      optionsEl.classList.remove('hidden');
      optionsEl.setAttribute('aria-hidden', 'false');
      container.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }

    function closeDropdown() {
      optionsEl.classList.add('hidden');
      optionsEl.setAttribute('aria-hidden', 'true');
      container.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentlyHidden = optionsEl.classList.contains('hidden');
      if (currentlyHidden) {
        openDropdown();
      } else {
        closeDropdown();
      }
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        closeDropdown();
      }
    });

    // Labels are built with t(); refresh them once translations load or change.
    if (window.I18n) window.I18n.onChange(() => updateTrigger());
    updateTrigger();
  }

  function sortSelectOptions(select, score, groupOf = () => 0) {
    // Keep the first option ("default") on top; order the rest by group, then by score.
    const opts = [...select.querySelectorAll('option')];
    if (opts.length < 3) return;
    const [first, ...rest] = opts;
    rest.sort((a, b) => (groupOf(a.value) - groupOf(b.value)) || (score(b.value) - score(a.value)));
    select.appendChild(first);
    rest.forEach(o => select.appendChild(o));
  }

  function bindTableThemeSelect() {
    const hidden = $('#setting-table-theme');
    const container = $('#table-theme-select');
    const trigger = $('#table-theme-trigger');
    const optionsEl = $('#table-theme-options');
    if (!hidden || !container || !trigger || !optionsEl) return;

    const swatches = {
      default: '#f3f4f6',
      navy: '#1e3a5f',
      olive: '#4a5d23',
      auburn: '#6e2c1e',
      plum: '#4a1e3b',
      charcoal: '#2d3748',
      accent_navy: '#1e3a5f',
      accent_olive: '#4a5d23',
      accent_auburn: '#6e2c1e',
      accent_plum: '#4a1e3b',
      accent_charcoal: '#2d3748',
    };
    // Full-table themes first, then the "header and column" accents; strongest colour first.
    sortSelectOptions(hidden, v => colorStrength(swatches[v] || '#f3f4f6'), v => (v.startsWith('accent_') ? 1 : 0));

    function renderOptions() {
      optionsEl.innerHTML = '';
      hidden.querySelectorAll('option').forEach(opt => {
        const value = opt.value;
        const label = t(opt.dataset.i18n) || opt.textContent;
        const option = document.createElement('div');
        option.className = 'custom-select-option' + (value === hidden.value ? ' selected' : '');
        option.dataset.value = value;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(value === hidden.value));
        const swatch = `<span class="theme-swatch" style="background:${esc(swatches[value] || '#f3f4f6')}"></span>`;
        option.innerHTML = `${swatch}<span class="option-label">${esc(label)}</span>`;
        option.addEventListener('click', (e) => {
          // The list sits inside a <label>: without preventDefault the browser
          // forwards the click to the trigger button and reopens the list.
          e.preventDefault();
          e.stopPropagation();
          hidden.value = value;
          state.currentDashboard.table_theme = value;
          updateTrigger();
          optionsEl.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
          container.classList.remove('open');
          applyTableTheme();
        });
        optionsEl.appendChild(option);
      });
    }

    function updateTrigger() {
      const selected = hidden.querySelector(`option[value="${CSS.escape(hidden.value)}"]`) || hidden.options[0];
      const label = t(selected.dataset.i18n) || selected.textContent;
      trigger.querySelector('.selected-text').textContent = label;
      trigger.querySelector('.selected-swatch').style.background = swatches[hidden.value] || '#f3f4f6';
      optionsEl.querySelectorAll('.custom-select-option').forEach(opt => {
        const active = opt.dataset.value === hidden.value;
        opt.classList.toggle('selected', active);
        opt.setAttribute('aria-selected', String(active));
      });
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      renderOptions();
      const isOpen = optionsEl.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(isOpen));
      container.classList.toggle('open', isOpen);
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        optionsEl.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        container.classList.remove('open');
      }
    });

    hidden.addEventListener('change', () => {
      updateTrigger();
      applyTableTheme();
    });

    // Labels are built with t(); refresh them once translations load or change.
    if (window.I18n) window.I18n.onChange(() => updateTrigger());
    updateTrigger();
  }

  // ------------------------------------------------------------------
  // Wide tables: a navigation strip above the table (column arrows and a
  // scrollbar), arrow keys that move by whole columns and a frozen first
  // column. Moving sideways never scrolls vertically, so the row being read
  // stays where it is.
  // ------------------------------------------------------------------
  let tableNavFrame = 0;
  let tableNavSyncing = false;

  function scheduleTableNavUpdate() {
    if (tableNavFrame) return;
    tableNavFrame = requestAnimationFrame(() => {
      tableNavFrame = 0;
      updateTableNav();
    });
  }

  // Column edges in the scroll coordinates of the table box. (offsetLeft is
  // relative to another ancestor and not usable with sticky cells.)
  function tableColumnEdges() {
    const wrap = $('#table-wrap');
    const row = document.querySelector('#data-table thead tr');
    if (!wrap || !row) return [];
    const origin = wrap.getBoundingClientRect().left + wrap.clientLeft - wrap.scrollLeft;
    const cells = [...row.children];
    return cells.map((th, i) => {
      // The frozen first header cell sticks to the left edge; it always starts at 0.
      const left = i === 0 ? 0 : th.getBoundingClientRect().left - origin;
      return { left, right: left + th.getBoundingClientRect().width };
    });
  }

  // Width covered by the frozen first column: where the second column starts
  // (includes the table's left border, so column steps land exactly).
  function frozenColumnWidth() {
    const table = $('#data-table');
    if (!table || !table.classList.contains('freeze-first')) return 0;
    const edges = tableColumnEdges();
    return edges[1] ? edges[1].left : 0;
  }

  function scrollTableColumns(step) {
    const wrap = $('#table-wrap');
    if (!wrap) return;
    const max = wrap.scrollWidth - wrap.clientWidth;
    const frozen = frozenColumnWidth();
    const edges = tableColumnEdges().slice(frozen ? 1 : 0);
    const viewStart = wrap.scrollLeft + frozen;
    let target;
    if (step === 'start') target = 0;
    else if (step === 'end') target = max;
    else if (step > 0) {
      const next = edges.find(e => e.left > viewStart + 2);
      target = next ? next.left - frozen : max;
    } else {
      const prev = [...edges].reverse().find(e => e.left < viewStart - 2);
      target = prev ? prev.left - frozen : 0;
    }
    wrap.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: 'smooth' });
  }

  function updateTableNav() {
    const wrap = $('#table-wrap');
    const nav = $('#table-nav');
    const table = $('#data-table');
    if (!wrap || !nav || !table) return;
    const overflow = wrap.scrollWidth > wrap.clientWidth + 1;
    const first = table.querySelector('thead th');
    // Freeze the first column only when it helps and leaves room for the rest.
    table.classList.toggle('freeze-first', overflow && !!first && first.offsetWidth < wrap.clientWidth * 0.45);
    nav.classList.toggle('hidden', !overflow);
    if (!overflow) return;
    const prev = $('#table-nav-prev');
    const next = $('#table-nav-next');
    const track = $('#table-nav-track');
    const max = wrap.scrollWidth - wrap.clientWidth;
    prev.disabled = wrap.scrollLeft <= 1;
    next.disabled = wrap.scrollLeft >= max - 1;
    prev.title = t('table_nav_prev');
    next.title = t('table_nav_next');
    prev.setAttribute('aria-label', t('table_nav_prev'));
    next.setAttribute('aria-label', t('table_nav_next'));
    track.setAttribute('aria-label', t('table_nav_scrollbar'));
    // The top scrollbar mirrors the table's horizontal scroll proportionally.
    track.firstElementChild.style.width = Math.round(track.clientWidth * wrap.scrollWidth / wrap.clientWidth) + 'px';
    const trackMax = track.scrollWidth - track.clientWidth;
    tableNavSyncing = true;
    track.scrollLeft = max > 0 ? wrap.scrollLeft * trackMax / max : 0;
    requestAnimationFrame(() => { tableNavSyncing = false; });
    // Which columns are in view (the frozen one is always visible).
    const frozen = frozenColumnWidth();
    const edges = tableColumnEdges();
    const viewStart = wrap.scrollLeft + frozen;
    const viewEnd = wrap.scrollLeft + wrap.clientWidth;
    const startIdx = frozen ? 1 : 0;
    let from = edges.findIndex((e, i) => i >= startIdx && e.right > viewStart + 2);
    let to = -1;
    edges.forEach((e, i) => { if (i >= startIdx && e.left < viewEnd - 2) to = i; });
    if (from < 0) from = startIdx;
    if (to < from) to = from;
    $('#table-nav-info').textContent = t('table_nav_info', { from: from + 1, to: to + 1, total: edges.length });
  }

  function bindTableNav() {
    const wrap = $('#table-wrap');
    const track = $('#table-nav-track');
    if (!wrap || !track) return;
    wrap.addEventListener('scroll', scheduleTableNavUpdate, { passive: true });
    track.addEventListener('scroll', () => {
      if (tableNavSyncing) return;
      const max = wrap.scrollWidth - wrap.clientWidth;
      const trackMax = track.scrollWidth - track.clientWidth;
      if (trackMax > 0) wrap.scrollLeft = track.scrollLeft * max / trackMax;
    }, { passive: true });
    $('#table-nav-prev').addEventListener('click', () => scrollTableColumns(-1));
    $('#table-nav-next').addEventListener('click', () => scrollTableColumns(1));
    wrap.addEventListener('keydown', (e) => {
      if (e.target.closest('input, select, textarea, button') || e.altKey || e.ctrlKey || e.metaKey) return;
      const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'start', End: 'end' };
      if (!(e.key in keys) || wrap.scrollWidth <= wrap.clientWidth + 1) return;
      e.preventDefault();
      scrollTableColumns(keys[e.key]);
    });
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(scheduleTableNavUpdate);
      observer.observe(wrap);
      observer.observe($('#data-table'));
    }
    window.addEventListener('resize', scheduleTableNavUpdate);
    if (window.I18n) window.I18n.onChange(() => scheduleTableNavUpdate());
  }

  function applyTableTheme() {
    const dash = state.currentDashboard;
    const theme = dash ? (dash.table_theme || 'default') : 'default';
    const table = $('#data-table');
    if (!table) return;
    table.classList.remove('theme-default', 'theme-gray', 'theme-dark', 'theme-navy', 'theme-olive', 'theme-auburn', 'theme-plum', 'theme-charcoal', 'theme-accent-navy', 'theme-accent-olive', 'theme-accent-auburn', 'theme-accent-plum', 'theme-accent-charcoal');
    table.classList.add(`theme-${theme.replace(/_/g, '-')}`);
  }

  // ------------------------------------------------------------------
  // Right panel: open/close/resize
  // ------------------------------------------------------------------
  function openRightPanel() {
    $('#right-panel').classList.remove('collapsed');
  }

  function closeRightPanel() {
    $('#right-panel').classList.add('collapsed');
  }

  function startResize(e) {
    e.preventDefault();
    const panel = $('#right-panel');
    const handle = $('#right-panel-handle');
    handle.classList.add('resizing');
    const startX = e.clientX;
    const startWidth = panel.offsetWidth;

    function onMove(ev) {
      const delta = startX - ev.clientX;
      const newWidth = Math.max(280, Math.min(window.innerWidth * 0.8, startWidth + delta));
      panel.style.width = newWidth + 'px';
    }

    function onUp() {
      handle.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function toggleAccordion(header) {
    const section = header.dataset.section;
    const body = $('#rp-section-' + section);
    const willOpen = !body.classList.contains('open');
    // Close all accordions first so only one section is open at a time.
    $$('.rp-accordion-body').forEach(b => b.classList.remove('open'));
    $$('.rp-accordion-header').forEach(h => h.classList.remove('active'));
    if (willOpen) {
      header.classList.add('active');
      body.classList.add('open');
    }
  }

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  // An open dashboard reads its data through its own connector (the one it was
  // created or accepted with); new dashboards use the active connector.
  function dashboardConnectorId() {
    return (state.currentDashboard && state.currentDashboard.connector_id) || null;
  }

  function connectorQuery() {
    const id = dashboardConnectorId();
    return id ? `?connector_id=${encodeURIComponent(id)}` : '';
  }

  async function loadViews() {
    const connectorId = dashboardConnectorId();
    const views = await api('GET', '/views' + connectorQuery());
    state.viewsConnectorId = connectorId;
    state.views = views;
    const sel = $('#view-select');
    // Read the selection after the fetch so a dashboard opened meanwhile keeps its view.
    const current = sel.value;
    const options = views.map(v => `<option value="${esc(v.system_name)}">${esc(v.display_name)}</option>`);
    if (current && !views.some(v => v.system_name === current)) {
      // The open dashboard's view is no longer listed; keep it selectable instead of clearing it.
      options.push(`<option value="${esc(current)}">${esc(current)}</option>`);
    }
    sel.innerHTML = '<option value="">' + esc(t('view_select_placeholder')) + '</option>' + options.join('');
    sel.value = current;
  }

  function reloadViewsQuietly() {
    loadViews().catch(err => console.error('Failed to reload views', err));
  }

  async function loadDashboards() {
    state.dashboards = await api('GET', '/');
    renderDashboardList();
  }

  function renderDashboardList() {
    const list = $('#dashboard-list');
    list.innerHTML = state.dashboards.map(d => {
      const active = state.currentDashboard && state.currentDashboard.id === d.id ? 'active' : '';
      // Copies of dashboards shared by someone else show who shared them.
      const shared = d.shared_by
        ? `${d.update_available ? `<span class="share-tag update">${esc(t('update_tag'))}</span> ` : ''}${esc(t('dashboard_shared_by', { email: d.shared_by }))} · `
        : '';
      return `<li class="${active}${d.shared_by ? ' is-shared-copy' : ''}" data-id="${d.id}">
        <div>
          <div>${esc(d.name)}</div>
          <div class="meta">${shared}${esc(d.view_name)}</div>
        </div>
      </li>`;
    }).join('');
    list.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => openDashboard(parseInt(li.dataset.id)));
    });
  }

  function newDashboard() {
    closeChartInfo();
    showDashboardSection();
    state.currentDashboard = {
      id: null,
      name: t('default_dashboard_name'),
      view_name: '',
      view_display_name: '',
      visible_columns: [],
      filters: [],
      sort_by: '',
      sort_desc: false,
      sort: [],
      group_by: [],
      aggregations: {},
      column_aliases: {},
      charts: [],
      kpi_cards: [],
      number_format: '#,##0.00',
      date_time_format: 'dd.MM.yyyy HH:mm',
      color_scheme: 'default',
      table_theme: 'default',
      background_theme: 'default',
      charts_per_row: 3,
      chart_card_height: 360,
      show_grid: true,
      replace_null_with_empty: true,
      color_numeric_sign: false,
      row_limit: 1000,
      dimension_columns: [],
      drill_down_sort_desc: false,
      expanded_chart: null,
    };
    state.columns = [];
    state.chartInstances = {};
    state.chartCache = new Map();
    state.kpiValues = {};
    $('#empty-state').classList.add('hidden');
    $('#builder').classList.remove('hidden');
    $('#delete-dashboard').classList.add('hidden');
    $('#dashboard-name').value = state.currentDashboard.name;
    $('#view-select').value = '';
    $('#kpi-panel').classList.add('hidden');
    $('#charts-panel').classList.add('hidden');
    closeRightPanel();
    clearTable();
    clearKpiCards();
    clearCharts();
    renderSourcePanel();
    renderDimensionPanel();
    renderMeasurePanel();
    $('#workspace').scrollTop = 0;
    // A new dashboard uses the active connector: list its views.
    if (state.viewsConnectorId) loadViews().catch(err => console.error('Failed to load views', err));
  }

  async function openDashboard(id) {
    closeChartInfo();
    const dash = await api('GET', '/' + id);
    state.currentDashboard = dash;
    if ((dash.connector_id || null) !== (state.viewsConnectorId || null)) {
      // The view picker lists the views of the dashboard's own connector.
      try { await loadViews(); } catch (err) { console.error('Failed to load views', err); }
    }
    state.chartInstances = {};
    state.chartCache = new Map();
    state.kpiValues = {};
    $('#empty-state').classList.add('hidden');
    $('#builder').classList.remove('hidden');
    $('#delete-dashboard').classList.remove('hidden');
    $('#dashboard-name').value = dash.name;
    const viewSelect = $('#view-select');
    if (dash.view_name && ![...viewSelect.options].some(o => o.value === dash.view_name)) {
      // The view list may still be loading (or no longer lists the view): keep the
      // dashboard's view instead of treating it as a switch to "no view", which
      // would drop its filters and charts.
      const opt = document.createElement('option');
      opt.value = dash.view_name;
      opt.textContent = dash.view_display_name || dash.view_name;
      viewSelect.appendChild(opt);
    }
    viewSelect.value = dash.view_name;
    migrateLegacyDrillDown();
    await onViewChange(false);
    applyStoredFilters(dash.filters);
    state.currentDashboard.show_grid = parseBool(dash.show_grid, true);
    state.currentDashboard.replace_null_with_empty = parseBool(dash.replace_null_with_empty, true);
    state.currentDashboard.date_time_format = dash.date_time_format || 'dd.MM.yyyy HH:mm';
    state.currentDashboard.table_theme = dash.table_theme || 'default';
    state.currentDashboard.background_theme = dash.background_theme || 'default';
    state.currentDashboard.color_numeric_sign = parseBool(dash.color_numeric_sign, false);
    const rl = parseInt(dash.row_limit, 10);
    state.currentDashboard.row_limit = Number.isNaN(rl) ? 1000 : Math.max(0, rl);
    applyBackgroundTheme();
    clearTable();
    clearKpiCards();
    clearCharts();
    await refreshData();
    renderDashboardList();
    $('#workspace').scrollTop = 0;
    window.dispatchEvent(new CustomEvent('analytics:dashboard-opened', { detail: { id: dash.id } }));
  }

  function migrateLegacyDrillDown() {
    const dash = state.currentDashboard;
    // Legacy single drill_down_column is appended to dimension_columns.
    if (dash.drill_down_column && typeof dash.drill_down_column === 'string') {
      if (!dash.dimension_columns) dash.dimension_columns = [];
      if (!dash.dimension_columns.includes(dash.drill_down_column)) {
        dash.dimension_columns.push(dash.drill_down_column);
      }
      delete dash.drill_down_column;
    }
  }


  function drillDownColumns(dash) {
    // Drill-down = all dimensions except the first one.
    const dims = dash.dimension_columns || [];
    return dims.slice(1);
  }

  async function onViewChange(refresh = true) {
    const viewName = $('#view-select').value;
    const dash = state.currentDashboard;
    const previousView = dash.view_name;
    dash.view_name = viewName;
    const match = state.views.find(v => v.system_name === viewName);
    dash.view_display_name = match ? match.display_name : viewName;

    // Clear previous data/charts when switching to a different view.
    if (previousView && previousView !== viewName) {
      clearTable();
      clearCharts();
      dash.charts = [];
      dash.aggregations = {};
      dash.column_aliases = {};
      dash.filters = [];
      dash.group_by = [];
      dash.dimension_columns = [];
      dash.sort_by = '';
      dash.sort_desc = false;
      dash.sort = [];
    }

    if (!viewName) {
      $('#charts-panel').classList.add('hidden');
      clearTable();
      return;
    }
    const info = await api('GET', '/views/' + encodeURIComponent(viewName) + '/columns' + connectorQuery());
    state.columns = info.columns;

    if (!dash.aggregations) dash.aggregations = {};
    if (!dash.column_aliases) dash.column_aliases = {};
    if (!dash.dimension_columns) dash.dimension_columns = [];
    migrateLegacyDrillDown();
    const storedVisible = new Set(dash.visible_columns || []);
    const storedAggs = { ...(dash.aggregations || {}) };
    dash.visible_columns = state.columns.map(c => c.name);
    dash.aggregations = {};
    state.columns.forEach(c => {
      dash.aggregations[c.name] = storedAggs[c.name] || '';
    });
    if (storedVisible.size > 0) {
      // Keep the user-defined column order; drop columns that no longer exist in the view.
      const existing = new Set(state.columns.map(c => c.name));
      dash.visible_columns = [...storedVisible].filter(name => existing.has(name));
    }
    // Ensure active dimensions are visible.
    (dash.dimension_columns || []).forEach(col => {
      if (col && !dash.visible_columns.includes(col)) dash.visible_columns.push(col);
    });

    renderSourcePanel();
    renderDimensionPanel();
    renderMeasurePanel();
    renderFilters();
    renderChartControls();
    renderKpiControls();
    $('#kpi-panel').classList.remove('hidden');
    $('#charts-panel').classList.remove('hidden');
    renderMoreSettings();
    $('#chart-series-list').innerHTML = '';
    addSeriesRow();
    if (refresh) await refreshData();
  }

  // ------------------------------------------------------------------
  // Field panel (Source / Dimensions / Measures)
  // ------------------------------------------------------------------
  function renderAllFieldPanels() {
    renderSourcePanel();
    renderDimensionPanel();
    renderMeasurePanel();
    renderChartControls();
  }

  function renderSourcePanel() {
    const dash = state.currentDashboard;
    const visibleSet = new Set(dash.visible_columns || []);
    const sourceCols = state.columns.map(c => enrichColumn(c));
    // Visible columns follow dash.visible_columns, which is the column order of the table.
    const byName = new Map(sourceCols.map(c => [c.name, c]));
    const visibleCols = (dash.visible_columns || []).map(name => byName.get(name)).filter(Boolean);
    const hiddenCols = sourceCols.filter(c => !visibleSet.has(c.name));

    const sourceContainer = $('#source-list');
    sourceContainer.innerHTML = visibleCols.map((c, idx) => renderSourceItem(c, idx, visibleCols.length)).join('') || '<p class="empty-hint">' + esc(t('all_columns_hidden_hint')) + '</p>';
    bindSourceItemEvents(sourceContainer);
    setupSourceReorderDrop(sourceContainer);

    const hiddenContainer = $('#hidden-list');
    if (hiddenContainer) {
      hiddenContainer.innerHTML = hiddenCols.map((c, idx) => renderSourceItem(c, idx, hiddenCols.length, false)).join('') || '<p class="empty-hint">' + esc(t('no_hidden_columns_hint')) + '</p>';
      bindSourceItemEvents(hiddenContainer);
      setupSourceReorderDrop(hiddenContainer);
    }
  }

  function renderDimensionPanel() {
    const dash = state.currentDashboard;
    const dims = (dash.dimension_columns || [])
      .map(name => state.columns.find(c => c.name === name))
      .filter(Boolean)
      .map(c => enrichColumn(c));
    const container = $('#dimension-list');
    container.innerHTML = dims.map((c, idx) => renderOrderedItem(c, idx, dims.length, 'dimension')).join('') ||
      '<p class="empty-hint">' + esc(t('dimension_drop_hint')) + '</p>';
    bindOrderedItemEvents(container, 'dimension_columns');
    setupReorderDrop(container, 'dimension_columns');
  }

  function renderMeasurePanel() {
    const dash = state.currentDashboard;
    const measures = Object.entries(dash.aggregations || {})
      .filter(([name, agg]) => agg)
      .map(([name]) => state.columns.find(c => c.name === name))
      .filter(Boolean)
      .map(c => enrichColumn(c));
    const container = $('#measure-list');
    container.innerHTML = measures.map(renderMeasureItem).join('') ||
      '<p class="empty-hint">' + esc(t('measure_drop_hint')) + '</p>';
    bindMeasureItemEvents(container);
    setupDropZone(container, 'measure');
  }

  function enrichColumn(c) {
    const dash = state.currentDashboard;
    return {
      ...c,
      visible: dash.visible_columns.includes(c.name),
      agg: dash.aggregations[c.name] || '',
      alias: dash.column_aliases[c.name] || '',
      isDimension: (dash.dimension_columns || []).includes(c.name),
      isDrillDown: (dash.dimension_columns || []).slice(1).includes(c.name),
      isMeasure: !!(dash.aggregations || {})[c.name],
    };
  }

  function typeLabel(col) {
    // Always show the raw database type (INT, NUMERIC, NVARCHAR, DATETIME, ...)
    // instead of a translated UI label.
    return col.raw_type || col.type || '';
  }

  function renderSourceItem(c, idx, total, reorderable = true) {
    const display = c.alias || c.name;
    const reorderButtons = reorderable
      ? `<button type="button" class="reorder-btn up" title="${esc(t('move_up_tooltip'))}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="reorder-btn down" title="${esc(t('move_down_tooltip'))}" ${idx === total - 1 ? 'disabled' : ''}>▼</button>`
      : '';
    return `
      <div class="field-item ${c.visible ? '' : 'disabled'}" data-col="${esc(c.name)}" data-index="${idx}">
        <span class="field-visibility" title="${esc(c.visible ? t('hide_in_table_tooltip') : t('show_in_table_tooltip'))}">${c.visible ? '&#9670;' : '&#9671;'}</span>
        <span class="field-type" title="${esc(c.raw_type || c.type)}">${esc(typeLabel(c))}</span>
        <span class="field-name" title="${esc(c.name)}">${esc(display)}</span>
        <button type="button" class="field-action dim" title="${esc(t('move_to_dimension_tooltip'))}">${esc(t('move_to_dimension_button'))}</button>
        <button type="button" class="field-action measure" title="${esc(t('move_to_measure_tooltip'))}">${esc(t('move_to_measure_button'))}</button>
        <button type="button" class="field-alias" title="${esc(t('rename_for_display_tooltip'))}">✎</button>
        ${reorderButtons}
        <span class="drag-handle" draggable="true" title="${esc(t('drag_to_reorder_tooltip'))}">☰</span>
      </div>`;
  }

  function renderOrderedItem(c, idx, total, kind) {
    const display = c.alias || c.name;
    return `
      <div class="field-item" data-col="${esc(c.name)}" data-index="${idx}">
        <span class="field-type" title="${esc(c.raw_type || c.type)}">${esc(typeLabel(c))}</span>
        <span class="field-name alias-trigger" title="${esc(t('ordered_item_rename_tooltip', { column: c.name }))}">${esc(display)}</span>
        <button type="button" class="reorder-btn up" title="${esc(t('move_up_tooltip'))}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="reorder-btn down" title="${esc(t('move_down_tooltip'))}" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" class="remove-btn" title="${esc(t('remove_tooltip'))}">×</button>
        <span class="drag-handle" draggable="true" title="${esc(t('drag_to_reorder_tooltip'))}">☰</span>
      </div>`;
  }

  function renderMeasureItem(c) {
    const display = c.alias || c.name;
    const aggOptions = Object.entries(SERIES_AGGREGATION_LABELS)
      .map(([value, labelKey]) => `<option value="${esc(value)}" ${c.agg === value ? 'selected' : ''}>${esc(t(labelKey))}</option>`)
      .join('');
    return `
      <div class="field-item ${c.visible ? '' : 'disabled'}" data-col="${esc(c.name)}">
        <span class="field-visibility" title="${esc(c.visible ? t('hide_in_table_tooltip') : t('show_in_table_tooltip'))}">${c.visible ? '&#9670;' : '&#9671;'}</span>
        <span class="field-type" title="${esc(c.raw_type || c.type)}">${esc(typeLabel(c))}</span>
        <span class="field-name alias-trigger" title="${esc(t('ordered_item_rename_tooltip', { column: c.name }))}">${esc(display)}</span>
        <select class="field-agg" title="${esc(t('series_aggregation_sum'))}">${aggOptions}</select>
        <button type="button" class="remove-btn" title="${esc(t('remove_tooltip'))}">×</button>
        <span class="drag-handle" draggable="true" title="${esc(t('drag_to_reorder_tooltip'))}">☰</span>
      </div>`;
  }

  function bindSourceItemEvents(container) {
    container.querySelectorAll('.field-visibility').forEach(icon => {
      icon.addEventListener('click', (e) => {
        e.stopPropagation();
        const col = icon.closest('.field-item').dataset.col;
        toggleVisible(col);
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.field-action.dim').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        moveToDimension(btn.closest('.field-item').dataset.col);
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.field-action.measure').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        moveToMeasure(btn.closest('.field-item').dataset.col);
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.field-alias').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAliasModal(btn.closest('.field-item').dataset.col);
      });
    });

    const isHidden = container.id === 'hidden-list';
    container.querySelectorAll('.drag-handle').forEach(handle => {
      const item = handle.closest('.field-item');
      handle.addEventListener('dragstart', (e) => {
        state.dragItem = item;
        e.dataTransfer.setData('text/plain', JSON.stringify({ col: item.dataset.col, source: isHidden ? 'hidden' : 'source', index: parseInt(item.dataset.index) }));
        item.classList.add('dragging');
      });
      handle.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        state.dragItem = null;
      });
    });

    container.querySelectorAll('.reorder-btn.up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        reorderVisible(btn.closest('.field-item').dataset.col, -1);
      });
    });
    container.querySelectorAll('.reorder-btn.down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        reorderVisible(btn.closest('.field-item').dataset.col, 1);
      });
    });
  }

  function reorderVisible(col, delta) {
    const dash = state.currentDashboard;
    const order = [...(dash.visible_columns || [])];
    const idx = order.indexOf(col);
    if (idx < 0) return;
    const newIdx = Math.max(0, Math.min(order.length - 1, idx + delta));
    if (newIdx === idx) return;
    order.splice(idx, 1);
    order.splice(newIdx, 0, col);
    dash.visible_columns = order;
    renderAllFieldPanels();
    refreshData();
  }

  function bindOrderedItemEvents(container, listProp) {
    const dash = state.currentDashboard;
    container.querySelectorAll('.field-item').forEach(item => {
      const col = item.dataset.col;
      item.querySelector('.up').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        reorderArray(dash[listProp], col, -1);
        renderAllFieldPanels();
        refreshData();
      });
      item.querySelector('.down').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        reorderArray(dash[listProp], col, 1);
        renderAllFieldPanels();
        refreshData();
      });
      item.querySelector('.remove-btn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dash[listProp] = dash[listProp].filter(name => name !== col);
        renderAllFieldPanels();
        refreshData();
      });
      item.querySelector('.alias-trigger').addEventListener('click', (e) => {
        e.stopPropagation();
        openAliasModal(col);
      });
      const handle = item.querySelector('.drag-handle');
      if (!handle) return;
      handle.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ col, source: listProp, index: parseInt(item.dataset.index) }));
        item.classList.add('dragging');
      });
      handle.addEventListener('dragend', () => item.classList.remove('dragging'));
    });
  }

  function bindMeasureItemEvents(container) {
    const dash = state.currentDashboard;
    container.querySelectorAll('.field-agg').forEach(sel => {
      sel.addEventListener('change', () => {
        const col = sel.closest('.field-item').dataset.col;
        dash.aggregations[col] = sel.value;
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.field-visibility').forEach(icon => {
      icon.addEventListener('click', () => {
        const col = icon.closest('.field-item').dataset.col;
        toggleVisible(col);
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const col = btn.closest('.field-item').dataset.col;
        dash.aggregations[col] = '';
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.alias-trigger').forEach(el => {
      el.addEventListener('click', () => openAliasModal(el.closest('.field-item').dataset.col));
    });

    container.querySelectorAll('.drag-handle').forEach(handle => {
      const item = handle.closest('.field-item');
      handle.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ col: item.dataset.col, source: 'measure' }));
        item.classList.add('dragging');
      });
      handle.addEventListener('dragend', () => item.classList.remove('dragging'));
    });
  }

  function setupDropZone(container, kind) {
    container.addEventListener('dragover', (e) => e.preventDefault());
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      let data;
      try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        data = { col: e.dataTransfer.getData('text/plain') };
      }
      const col = data.col;
      if (!col) return;
      if (kind === 'dimension') moveToDimension(col);
      else if (kind === 'measure') moveToMeasure(col);
      renderAllFieldPanels();
      refreshData();
    });
  }



  function setupSourceReorderDrop(container) {
    const isHidden = container.id === 'hidden-list';
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = state.dragItem;
      if (!dragging) return;
      const srcList = dragging.closest('.field-list');
      if (srcList !== container && !isHidden) return;
      const after = getDragAfterElement(container, e.clientY);
      if (after) {
        container.insertBefore(dragging, after);
      } else {
        container.appendChild(dragging);
      }
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      let data;
      try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        data = { col: e.dataTransfer.getData('text/plain') };
      }
      const col = data.col;
      if (!col) return;
      const dash = state.currentDashboard;
      if (data.source !== (isHidden ? 'hidden' : 'source')) {
        removeFromActiveRoles(col);
      }
      if (isHidden) {
        dash.visible_columns = (dash.visible_columns || []).filter(name => name !== col);
      } else {
        const visible = [...container.querySelectorAll('.field-item')].map(el => el.dataset.col);
        if (!visible.includes(col)) {
          // Item came from another list and was not moved into this DOM during dragover.
          const after = getDragAfterElement(container, e.clientY);
          const pos = after ? visible.indexOf(after.dataset.col) : -1;
          visible.splice(pos >= 0 ? pos : visible.length, 0, col);
        }
        dash.visible_columns = visible;
      }
      const payload = { ...dash, filters: collectFilters(), charts: collectCharts() };
      api(dash.id ? 'PUT' : 'POST', dash.id ? '/' + dash.id : '/', payload)
        .then(saved => {
          state.currentDashboard.id = saved.id;
          state.currentDashboard.updated_at = saved.updated_at;
        })
        .catch(err => console.error('Failed to save column order:', err));
      renderAllFieldPanels();
      renderTable();
      renderCharts();
      refreshData();
    });
  }

  function setupReorderDrop(container, listProp) {
    container.addEventListener('dragover', (e) => e.preventDefault());
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      let data;
      try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        data = { col: e.dataTransfer.getData('text/plain') };
      }
      const col = data.col;
      if (!col) return;
      const list = state.currentDashboard[listProp];
      // If coming from another list, move it into this list at the end.
      if (data.source !== listProp) {
        removeFromActiveRoles(col);
        list.push(col);
        if (!state.currentDashboard.visible_columns.includes(col)) {
          state.currentDashboard.visible_columns.push(col);
        }
      }
      // Determine target index from drop position.
      const after = getDragAfterElement(container, e.clientY);
      const currentIndex = list.indexOf(col);
      let targetIndex = after ? list.indexOf(after.dataset.col) : list.length;
      if (currentIndex >= 0 && targetIndex > currentIndex) targetIndex--;
      if (currentIndex >= 0) list.splice(currentIndex, 1);
      list.splice(targetIndex, 0, col);
      renderAllFieldPanels();
      refreshData();
    });
  }

  function getDragAfterElement(container, y) {
    const items = [...container.querySelectorAll('.field-item:not(.dragging)')];
    return items.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function toggleVisible(col) {
    const dash = state.currentDashboard;
    if (dash.visible_columns.includes(col)) {
      dash.visible_columns = dash.visible_columns.filter(name => name !== col);
    } else {
      dash.visible_columns.push(col);
    }
  }

  function moveToDimension(col) {
    const dash = state.currentDashboard;
    if (dash.dimension_columns.includes(col)) return;
    removeFromActiveRoles(col);
    // When moving the first explicit dimension, preserve all visible non-aggregated
    // columns as dimensions so the table keeps showing them in the right order.
    if (!dash.dimension_columns.length) {
      const newDims = dash.visible_columns
        .filter(name => name !== col && !dash.aggregations[name]);
      dash.dimension_columns = newDims;
    }
    if (!dash.dimension_columns.includes(col)) dash.dimension_columns.push(col);
    if (!dash.visible_columns.includes(col)) dash.visible_columns.push(col);
  }

  function moveToMeasure(col) {
    const dash = state.currentDashboard;
    removeFromActiveRoles(col);
    const colInfo = state.columns.find(c => c.name === col);
    dash.aggregations[col] = colInfo && colInfo.type === 'number' ? 'sum' : 'count';
    if (!dash.visible_columns.includes(col)) dash.visible_columns.push(col);
  }

  function removeFromActiveRoles(col) {
    const dash = state.currentDashboard;
    dash.dimension_columns = (dash.dimension_columns || []).filter(name => name !== col);
    dash.aggregations[col] = '';
  }

  function reorderArray(arr, item, direction) {
    const idx = arr.indexOf(item);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= arr.length) return;
    arr.splice(newIdx, 0, arr.splice(idx, 1)[0]);
  }

  function isDrillDownColumn(col) {
    return (state.currentDashboard.dimension_columns || []).slice(1).includes(col);
  }

  // ------------------------------------------------------------------
  // Column aliases
  // ------------------------------------------------------------------
  function openAliasModal(col) {
    state.aliasColumn = col;
    const dash = state.currentDashboard;
    $('#alias-original').textContent = t('alias_original_label', { column: col });
    $('#alias-input').value = dash.column_aliases[col] || '';
    $('#alias-modal').classList.remove('hidden');
    $('#alias-input').focus();
  }

  function closeAliasModal() {
    $('#alias-modal').classList.add('hidden');
    state.aliasColumn = null;
  }

  function saveAlias() {
    if (!state.aliasColumn) return;
    const value = $('#alias-input').value.trim();
    const dash = state.currentDashboard;
    if (value && value !== state.aliasColumn) {
      dash.column_aliases[state.aliasColumn] = value;
    } else {
      delete dash.column_aliases[state.aliasColumn];
    }
    closeAliasModal();
    renderAllFieldPanels();
    renderFilters();
    renderChartControls();
    renderTable();
    renderCharts();
  }

  function displayName(col) {
    const dash = state.currentDashboard;
    return (dash.column_aliases || {})[col] || col;
  }

  // ------------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------------
  function renderFilters() {
    const container = $('#filter-bar');
    container.innerHTML = state.columns.map(c => {
      const colId = esc(c.name);
      const label = esc(displayName(c.name));
      if (c.type === 'number') {
        return `<div class="filter-group" data-col="${colId}">
          <label>${label}</label>
          <div class="filter-range">
            <input type="number" data-col="${colId}" data-type="number" data-role="min" placeholder="${esc(t('number_min_placeholder'))}">
            <input type="number" data-col="${colId}" data-type="number" data-role="max" placeholder="${esc(t('number_max_placeholder'))}">
          </div>
        </div>`;
      }
      if (c.type === 'date') {
        return `<div class="filter-group" data-col="${colId}">
          <label>${label}</label>
          <div class="filter-range">
            <input type="date" data-col="${colId}" data-type="date" data-role="from" placeholder="${esc(t('date_from_placeholder'))}">
            <input type="date" data-col="${colId}" data-type="date" data-role="to" placeholder="${esc(t('date_to_placeholder'))}">
          </div>
        </div>`;
      }
      return `<div class="filter-group" data-col="${colId}">
        <label>${label}</label>
        <div class="text-filter-rows" data-col="${colId}"></div>
        <button type="button" class="btn small btn-add add-text-filter" data-col="${colId}">${ICONS.plusTile}<span>${esc(t('text_filter_add_button'))}</span></button>
      </div>`;
    }).join('');
    container.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', debounce(refreshData, 300));
    });
    container.querySelectorAll('.add-text-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        // A new condition starts with the operator of the previous one ("contains" by default).
        const rows = $$(`#filter-bar .text-filter-rows[data-col="${esc(btn.dataset.col)}"] .text-filter-op`);
        const last = rows[rows.length - 1];
        const row = addTextFilterRow(btn.dataset.col, { operator: last ? last.value : 'contains' });
        if (row) row.querySelector('.text-filter-value').focus();
      });
    });
    state.columns.filter(c => c.type === 'text').forEach(c => addTextFilterRow(c.name, { operator: 'contains' }));
  }

  function addTextFilterRow(col, initial = {}) {
    const rowsContainer = $(`#filter-bar .text-filter-rows[data-col="${esc(col)}"]`);
    if (!rowsContainer) return;
    const row = document.createElement('div');
    row.className = 'text-filter-row';
    row.innerHTML = `
      <select class="text-filter-op" data-col="${esc(col)}">
        <option value="=" ${initial.operator === '=' ? 'selected' : ''}>${esc(t('text_filter_operator_equals'))}</option>
        <option value="contains" ${initial.operator === 'contains' ? 'selected' : ''}>${esc(t('text_filter_operator_contains'))}</option>
        <option value="not_contains" ${initial.operator === 'not_contains' ? 'selected' : ''}>${esc(t('text_filter_operator_not_contains'))}</option>
      </select>
      <input type="text" class="text-filter-value" data-col="${esc(col)}" value="${esc(initial.value || '')}" placeholder="${esc(t('text_filter_value_placeholder'))}">
      <button type="button" class="card-icon-btn danger small remove-filter-row" title="${esc(t('text_filter_remove_title'))}" aria-label="${esc(t('text_filter_remove_title'))}">${ICONS.remove}</button>
    `;
    row.querySelector('.remove-filter-row').addEventListener('click', () => {
      row.remove();
      refreshData();
    });
    row.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', debounce(refreshData, 300));
    });
    rowsContainer.appendChild(row);
    return row;
  }

  function applyStoredFilters(filters) {
    filters = filters || [];
    $$('#filter-bar .text-filter-rows').forEach(el => { el.innerHTML = ''; });
    filters.forEach(f => {
      if (f.type === 'number') {
        const min = $(`#filter-bar input[data-col="${esc(f.column)}"][data-role="min"]`);
        const max = $(`#filter-bar input[data-col="${esc(f.column)}"][data-role="max"]`);
        if (min) min.value = f.min_value || '';
        if (max) max.value = f.max_value || '';
      } else if (f.type === 'date') {
        const from = $(`#filter-bar input[data-col="${esc(f.column)}"][data-role="from"]`);
        const to = $(`#filter-bar input[data-col="${esc(f.column)}"][data-role="to"]`);
        if (from) from.value = f.from_value || '';
        if (to) to.value = f.to_value || '';
      } else {
        // Every stored condition gets its own row; conditions of one column are joined with OR.
        addTextFilterRow(f.column, { operator: f.operator || '=', value: f.value || '' });
      }
    });
    // Text columns without a stored condition keep one empty row, as on a new dashboard.
    $$('#filter-bar .text-filter-rows').forEach(el => {
      if (!el.children.length) addTextFilterRow(el.dataset.col, { operator: 'contains' });
    });
  }

  function collectFilters() {
    const filters = [];
    function findOrCreate(col, type) {
      let entry = filters.find(f => f.column === col && f.type === type);
      if (!entry) {
        entry = { column: col, type: type };
        filters.push(entry);
      }
      return entry;
    }
    $('#filter-bar').querySelectorAll('input[data-role]').forEach(inp => {
      const col = inp.dataset.col;
      const type = inp.dataset.type;
      if (!inp.value) return;
      const entry = findOrCreate(col, type);
      entry[inp.dataset.role + '_value'] = inp.value;
    });
    $('#filter-bar').querySelectorAll('.text-filter-row').forEach(row => {
      const op = row.querySelector('.text-filter-op').value;
      const val = row.querySelector('.text-filter-value').value.trim();
      const col = row.querySelector('.text-filter-value').dataset.col;
      if (!val) return;
      filters.push({ column: col, type: 'text', operator: op, value: val });
    });
    return filters;
  }

  // ------------------------------------------------------------------
  // Data table
  // ------------------------------------------------------------------
  async function refreshData() {
    const dash = state.currentDashboard;
    if (!dash.view_name) return;
    state.chartGeneration += 1;
    if (!dash.visible_columns.length) {
      clearTable();
      $('#row-count').textContent = t('select_at_least_one_column');
      return;
    }
    const payload = {
      view_name: dash.view_name,
      visible_columns: dash.visible_columns,
      filters: collectFilters(),
      sort_by: dash.sort_by,
      sort_desc: dash.sort_desc,
      sort: dash.sort || [],
      group_by: dash.group_by,
      aggregations: dash.aggregations,
      number_format: dash.number_format || '#,##0.00',
      dimension_columns: dash.dimension_columns || [],
      // First dimension is the main grouping; the rest are nested drill-down levels.
      drill_down_columns: (dash.dimension_columns || []).slice(1),
      drill_down_sort_desc: dash.drill_down_sort_desc || false,
      replace_null_with_empty: dash.replace_null_with_empty !== false,
      row_limit: dash.row_limit,
    };
    try {
      state.data = await api('POST', '/data' + connectorQuery(), payload);
      if (state.data.error) {
        clearTable();
        $('#row-count').textContent = state.data.error;
        renderKpiCards();
        renderCharts();
        return;
      }
      renderTable();
      await loadKpiValues();
      renderKpiCards();
      renderCharts();
    } catch (err) {
      clearTable();
      $('#row-count').textContent = t('data_load_error', { error: err.message });
      console.error(err);
    }
  }

  function renderTable() {
    // Keep the horizontal position when the table is redrawn (sorting, filters).
    const wrap = $('#table-wrap');
    const keepLeft = wrap ? wrap.scrollLeft : 0;
    const restoreLeft = () => { if (wrap && keepLeft) wrap.scrollLeft = keepLeft; };
    const thead = $('#data-table thead');
    const tbody = $('#data-table tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';
    const dash = state.currentDashboard;
    const rawCols = state.data.columns || [];
    if (!rawCols.length) {
      $('#row-count').textContent = t('no_data_hint');
      return;
    }
    // Dimensions are explicit only. If none are set, the table is a simple detail grid.
    const explicitDimCols = state.data.dimension_columns || dash.dimension_columns || [];
    const measureCols = rawCols.filter(c => dash.aggregations[c]);
    const dimCols = explicitDimCols.filter(c => rawCols.includes(c));
    const drillCols = dimCols.slice(1);
    const rows = state.data.rows || [];
    // The first two rows as displayed (after sorting and grouping), used by
    // KPI cards showing the "last value" from the top of the table.
    state.tableTopRows = rows.slice(0, 2);

    // Detail-group mode: dimensions without measures => show raw rows grouped by the first dimension.
    if (dimCols.length && !measureCols.length) {
      renderGroupedDetailTable(thead, tbody, rawCols, dimCols[0], rows);
      renderRowCount(rows.length, drillCols.length);
      restoreLeft();
      scheduleTableNavUpdate();
      return;
    }

    // Pivot mode: dimensions + measures + optional attribute columns shown at the leaf level.
    const attrCols = rawCols.filter(c =>
      !dimCols.includes(c) && !measureCols.includes(c)
    );
    const mainHeaderCols = dimCols.length
      ? [...dimCols, ...measureCols, ...attrCols].filter((c, i, arr) => arr.indexOf(c) === i)
      : [...rawCols];

    // Header
    const tr = document.createElement('tr');
    mainHeaderCols.forEach(col => {
      const th = document.createElement('th');
      const agg = dash.aggregations[col];
      let headerHtml = `<span class="col-header-name" data-col="${esc(col)}" title="${esc(t('column_header_rename_tooltip'))}">${esc(displayName(col))}</span>` +
        (agg ? `<span class="col-header-agg">${esc(agg.toUpperCase())}</span>` : '');
      headerHtml += ` <span class="sort-hint" title="${esc(t('sort_click_hint'))}">↕</span>`;
      th.innerHTML = headerHtml;
      const sortEntry = (dash.sort || []).find(s => s.column === col);
      if (sortEntry) {
        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = (sortEntry.desc ? ' ▼' : ' ▲') + ((dash.sort || []).indexOf(sortEntry) + 1);
        th.appendChild(indicator);
      }
      th.addEventListener('click', () => sortBy(col));
      th.querySelector('.col-header-name').addEventListener('click', (e) => {
        e.stopPropagation();
        openAliasModal(col);
      });
      tr.appendChild(th);
    });
    thead.appendChild(tr);

    if (dimCols.length >= 1) {
      const mainDim = dimCols[0];
      const groups = groupByKeys(rows, [mainDim]);
      state.tableTopRows = [];
      groups.forEach(({ keyValues, rows: groupRows }) => {
        const mainRow = buildSummaryRow(groupRows, mainHeaderCols, [mainDim], drillCols, undefined, dimCols);
        if (state.tableTopRows.length < 2) state.tableTopRows.push(mainRow);
        const groupKey = keyValues.join('|');
        const expandable = dimCols.length > 1 || attrCols.length > 0;
        const r = createTableRow(mainHeaderCols, mainRow, 'group-row', expandable, groupKey, groupRows.length, drillCols);
        tbody.appendChild(r);
        if (expandable) {
          const detailContainer = document.createElement('tbody');
          detailContainer.className = 'drill-down-rows hidden';
          detailContainer.dataset.groupKey = groupKey;
          renderDrillLevel(groupRows, 1, dimCols, detailContainer, '', attrCols);
          r.after(detailContainer);
        }
      });
    } else {
      rows.forEach((row, idx) => tbody.appendChild(createTableRow(mainHeaderCols, row, idx % 2 === 1 ? 'data-row' : '')));
    }

    renderRowCount(rows.length, drillCols.length);
    restoreLeft();
    scheduleTableNavUpdate();
  }

  function renderGroupedDetailTable(thead, tbody, cols, mainDim, rows) {
    const dash = state.currentDashboard;
    // Header with all visible columns.
    const tr = document.createElement('tr');
    cols.forEach(col => {
      const th = document.createElement('th');
      let headerHtml = `<span class="col-header-name" data-col="${esc(col)}" title="${esc(t('column_header_rename_tooltip'))}">${esc(displayName(col))}</span>` +
        ` <span class="sort-hint" title="${esc(t('sort_click_hint'))}">↕</span>`;
      th.innerHTML = headerHtml;
      const sortEntry = (dash.sort || []).find(s => s.column === col);
      if (sortEntry) {
        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = (sortEntry.desc ? ' ▼' : ' ▲') + ((dash.sort || []).indexOf(sortEntry) + 1);
        th.appendChild(indicator);
      }
      th.addEventListener('click', () => sortBy(col));
      th.querySelector('.col-header-name').addEventListener('click', (e) => {
        e.stopPropagation();
        openAliasModal(col);
      });
      tr.appendChild(th);
    });
    thead.appendChild(tr);

    // Group header rows followed by raw detail rows for each group.
    const groups = groupByKeys(rows, [mainDim]);
    state.tableTopRows = groups.flatMap(g => g.rows).slice(0, 2);
    groups.forEach(({ keyValues, rows: groupRows }) => {
      const groupTr = document.createElement('tr');
      groupTr.className = 'group-header-row';
      const groupTd = document.createElement('td');
      groupTd.colSpan = cols.length;
      groupTd.innerHTML = `<strong>${esc(displayName(mainDim))}: ${esc(formatTableValue(keyValues[0], mainDim))}</strong> <span class="drill-count">(${groupRows.length})</span>`;
      groupTr.appendChild(groupTd);
      tbody.appendChild(groupTr);

      groupRows.forEach((row, idx) => {
        tbody.appendChild(createTableRow(cols, row, idx % 2 === 1 ? 'data-row' : ''));
      });
    });
  }

  function renderRowCount(count, hasDrill) {
    const dash = state.currentDashboard;
    const rowCount = $('#row-count');
    rowCount.innerHTML = '';
    rowCount.appendChild(document.createTextNode(t('rows_shown_label', { count })));
    if (hasDrill) {
      const sortBtn = document.createElement('button');
      sortBtn.type = 'button';
      sortBtn.className = 'btn small drill-sort-btn';
      sortBtn.style.marginLeft = '0.75rem';
      sortBtn.title = t('drill_down_sort_title');
      sortBtn.textContent = dash.drill_down_sort_desc ? t('drill_down_sort_desc') : t('drill_down_sort_asc');
      sortBtn.addEventListener('click', sortByDrillDown);
      rowCount.appendChild(sortBtn);
    }
  }

  function groupByKeys(rows, keys) {
    const map = new Map();
    rows.forEach(row => {
      const keyValues = keys.map(k => row[k]);
      const key = keyValues.map(v => (v === null || v === undefined ? '\x00' : String(v))).join('\x01');
      if (!map.has(key)) map.set(key, { keyValues: keyValues.slice(), rows: [] });
      map.get(key).rows.push(row);
    });
    return [...map.values()];
  }

  function renderDrillLevel(rowsAtThisLevel, level, dimCols, parentElement, parentKeyValues, leafAttrCols) {
    const dash = state.currentDashboard;
    const currentDim = dimCols[level];
    const remainingDims = dimCols.slice(level + 1);
    const groups = groupByKeys(rowsAtThisLevel, currentDim ? [currentDim] : []);
    const measureCols = Object.keys(dash.aggregations).filter(c => dash.aggregations[c]);
    const isLeaf = !remainingDims.length;
    // Attribute columns are shown only at the leaf level, after dimensions and measures.
    const attrCols = isLeaf ? (leafAttrCols || []) : [];
    // Each nested level shows only the current dimension and deeper dimensions plus measures.
    // Higher-level dimensions (e.g. Nazev) are already known from the parent row and are hidden here.
    const headerCols = [currentDim, ...remainingDims, ...measureCols, ...attrCols]
      .filter((c, i, arr) => c && arr.indexOf(c) === i);

    // Add a header row for every nested block so each drill-down level has its own column titles.
    parentElement.appendChild(createDrillHeaderRow(headerCols));

    // Sort groups according to the active multi-column sort rules.
    const sortRules = (state.currentDashboard.sort || []).filter(s => headerCols.includes(s.column));
    if (sortRules.length) {
      groups.sort((a, b) => compareRows(a.rows[0], b.rows[0], sortRules));
    }

    groups.forEach(({ keyValues, rows }) => {
      const value = keyValues[0];
      const groupKey = (parentKeyValues ? parentKeyValues + '|' : '') + String(value);
      const summary = buildSummaryRow(rows, headerCols, dimCols.slice(0, level + 1), remainingDims.concat(attrCols), undefined, dimCols);
      summary[currentDim] = value;
      const rowClass = `drill-summary-row drill-level-${level}`;
      // A leaf group with a single row has nothing more to expand; show all values inline.
      const expandable = !isLeaf || (attrCols.length > 0 && rows.length > 1);
      const rowEl = createTableRow(headerCols, summary, rowClass, expandable, groupKey, rows.length, remainingDims.concat(attrCols));
      parentElement.appendChild(rowEl);

      if (!isLeaf) {
        const nextLevelContainer = document.createElement('tbody');
        nextLevelContainer.className = 'drill-down-rows hidden';
        nextLevelContainer.dataset.groupKey = groupKey;
        rowEl.after(nextLevelContainer);
        renderDrillLevel(rows, level + 1, dimCols, nextLevelContainer, groupKey, leafAttrCols);
      } else if (attrCols.length > 0) {
        // At the leaf level, show raw detail rows with the attribute columns if there is more
        // than one underlying row. When there is exactly one row the summary already contains
        // the attribute values.
        const detailRows = rows;
        if (detailRows.length > 1) {
          const nextLevelContainer = document.createElement('tbody');
          nextLevelContainer.className = 'drill-down-rows hidden';
          nextLevelContainer.dataset.groupKey = groupKey;
          rowEl.after(nextLevelContainer);
          detailRows.forEach((row, idx) => {
            const attrOnlyRow = {};
            attrCols.forEach(c => { attrOnlyRow[c] = row[c]; });
            const tr = createTableRow(attrCols, attrOnlyRow, idx % 2 === 1 ? 'data-row' : '', false, '', 0, []);
            // Indent the attribute row by adding an empty cell for each parent dimension.
            for (let i = 0; i < level + 1; i++) {
              const emptyTd = document.createElement('td');
              emptyTd.innerHTML = '<span class="indent-spacer"></span>';
              tr.insertBefore(emptyTd, tr.firstChild);
            }
            nextLevelContainer.appendChild(tr);
          });
        }
      }
    });
  }

  function createDrillHeaderRow(cols) {
    const dash = state.currentDashboard;
    const r = document.createElement('tr');
    r.className = 'drill-header-row';
    cols.forEach(col => {
      const td = document.createElement('td');
      const agg = dash.aggregations[col];
      const sortEntry = (dash.sort || []).find(s => s.column === col);
      let html = `${esc(displayName(col))}${agg ? ` <span class="col-header-agg">${esc(agg.toUpperCase())}</span>` : ''}`;
      if (sortEntry) {
        html += ` <span class="sort-indicator" title="${esc(t('drill_sort_change_title'))}">${sortEntry.desc ? '▼' : '▲'}${(dash.sort || []).indexOf(sortEntry) + 1}</span>`;
      } else {
        html += ` <span class="sort-hint" title="${esc(t('sort_click_hint'))}">↕</span>`;
      }
      td.innerHTML = html;
      td.addEventListener('click', () => sortBy(col));
      r.appendChild(td);
    });
    return r;
  }

  function compareRows(a, b, rules) {
    for (const rule of rules) {
      const col = rule.column;
      const va = a[col] ?? '';
      const vb = b[col] ?? '';
      const na = parseFloat(va), nb = parseFloat(vb);
      let cmp = 0;
      if (!isNaN(na) && !isNaN(nb)) {
        cmp = na - nb;
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      if (cmp !== 0) return rule.desc ? -cmp : cmp;
    }
    return 0;
  }

  function buildSummaryRow(rows, cols, dimCols, drillCols, seriesAggs, allDimCols) {
    const replaceNull = state.currentDashboard.replace_null_with_empty !== false;
    const dimSet = allDimCols || dimCols;
    const summary = { ...rows[0] };
    cols.forEach(col => {
      if (dimCols.includes(col)) {
        const v = rows[0][col];
        summary[col] = replaceNull && (v === null || v === undefined) ? '' : v;
        return;
      }
      if (dimSet.includes(col) && drillCols.includes(col)) {
        // Deeper dimensions are not known at this summary level.
        summary[col] = replaceNull ? '' : null;
        return;
      }
      const agg = seriesAggs ? seriesAggs[col] : state.currentDashboard.aggregations[col];
      if (!agg) {
        // Attribute column (not dimension, not measure): keep a representative value.
        const v = rows[0][col];
        summary[col] = replaceNull && (v === null || v === undefined) ? '' : v;
        return;
      }
      const colInfo = state.columns.find(c => c.name === col);
      const isDate = colInfo && colInfo.type === 'date';
      if (isDate) {
        const dates = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(v => new Date(v)).filter(d => !Number.isNaN(d.getTime()));
        switch (agg) {
          case 'min': summary[col] = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : (replaceNull ? '' : null); break;
          case 'max': summary[col] = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : (replaceNull ? '' : null); break;
          case 'count': summary[col] = rows.length; break;
          default: summary[col] = replaceNull ? '' : null;
        }
        return;
      }
      const values = rows.map(r => parseFloat(r[col]) || 0);
      switch (agg) {
        case 'sum': summary[col] = values.reduce((a, b) => a + b, 0); break;
        case 'count': summary[col] = rows.length; break;
        case 'avg': summary[col] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; break;
        case 'min': summary[col] = values.length ? Math.min(...values) : 0; break;
        case 'max': summary[col] = values.length ? Math.max(...values) : 0; break;
      }
    });
    return summary;
  }

  function createTableRow(cols, row, rowClass = '', expandable = false, groupKey = '', childCount = 0, drillCols = []) {
    const r = document.createElement('tr');
    if (rowClass) r.className = rowClass;
    cols.forEach((col, idx) => {
      const td = document.createElement('td');
      const isDim = !state.currentDashboard.aggregations[col];
      if (expandable && isDim && idx === 0) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'drill-toggle';
        toggle.textContent = '▸';
        toggle.title = t('expand_collapse_title');
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleDrillDown(toggle, groupKey);
        });
        td.appendChild(toggle);
      }
      const val = row[col];
      const valSpan = document.createElement('span');
      const replaceNull = state.currentDashboard.replace_null_with_empty !== false;
      if (val === null || val === undefined) {
        if (replaceNull) {
          valSpan.textContent = '';
        } else {
          valSpan.className = 'null';
          valSpan.textContent = t('table_null_value');
        }
      } else {
        valSpan.textContent = formatTableValue(val, col);
        if (state.currentDashboard.color_numeric_sign) {
          const colInfo = state.columns.find(c => c.name === col);
          if (colInfo && colInfo.type === 'number') {
            const num = parseFloat(val);
            if (!Number.isNaN(num)) {
              if (num > 0) valSpan.classList.add('numeric-positive');
              else if (num < 0) valSpan.classList.add('numeric-negative');
            }
          }
        }
      }
      td.appendChild(valSpan);
      td.addEventListener('click', (e) => {
        e.stopPropagation();
        copyCellValue(td);
      });
      r.appendChild(td);
    });
    if (expandable) {
      const countTd = document.createElement('td');
      countTd.className = 'drill-count';
      countTd.textContent = `(${childCount})`;
      r.appendChild(countTd);
    }
    return r;
  }

  function sortByDrillDown() {
    const dash = state.currentDashboard;
    dash.drill_down_sort_desc = !dash.drill_down_sort_desc;
    refreshData();
  }

  function toggleDrillDown(btn, groupKey) {
    const row = btn.closest('tr');
    if (!row) return;
    // Find the immediate next tbody sibling that is a drill-down container for this key.
    const allDetails = [...document.querySelectorAll('tbody.drill-down-rows')];
    const detail = allDetails.find(tb => tb.dataset.groupKey === String(groupKey) && tb.previousElementSibling === row);
    if (!detail) return;
    const hidden = detail.classList.toggle('hidden');
    btn.textContent = hidden ? '▸' : '▼';
  }

  // Clicking a table cell copies the shown value; it no longer adds a filter.
  let copyToastTimer = null;
  function copyCellValue(td) {
    const selection = window.getSelection && window.getSelection();
    // Selecting text with the mouse keeps the browser's own copy behaviour.
    if (selection && !selection.isCollapsed && td.contains(selection.anchorNode)) return;
    const text = (td.innerText || td.textContent || '').trim();
    if (!text) return;
    writeClipboard(text).then(ok => showCopyToast(td, ok ? t('cell_copied_toast', { value: text }) : t('cell_copy_failed_toast')), () => showCopyToast(td, t('cell_copy_failed_toast')));
  }

  function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    area.remove();
    return ok;
  }

  function showCopyToast(td, message) {
    let toast = $('#copy-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'copy-toast';
      toast.className = 'copy-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    const rect = td.getBoundingClientRect();
    toast.classList.add('show');
    const width = toast.offsetWidth;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2));
    const top = rect.top - toast.offsetHeight - 8 > 8 ? rect.top - toast.offsetHeight - 8 : rect.bottom + 8;
    toast.style.left = `${left}px`;
    toast.style.top = `${top}px`;
    td.classList.remove('cell-copied');
    void td.offsetWidth; // restart the flash animation
    td.classList.add('cell-copied');
    clearTimeout(copyToastTimer);
    copyToastTimer = setTimeout(() => {
      toast.classList.remove('show');
      td.classList.remove('cell-copied');
    }, 1600);
  }

  function clearTable() {
    state.tableTopRows = [];
    $('#data-table thead').innerHTML = '';
    $('#data-table tbody').innerHTML = '';
    $('#row-count').textContent = '';
    scheduleTableNavUpdate();
  }

  function toggleKpiCompare() {
    const checked = $('#kpi-compare').checked;
    $('#kpi-compare-row').classList.toggle('hidden', !checked);
  }

  async function addKpi() {
    const dash = state.currentDashboard;
    const column = $('#kpi-column').value;
    if (!column) {
      alert(t('kpi_no_column_error'));
      return;
    }
    ensureVisible(column);
    const kpi = {
      title: $('#kpi-title').value.trim() || t('new_kpi_default_title'),
      column,
      aggregation: $('#kpi-aggregation').value,
      prefix: $('#kpi-prefix').value.trim(),
      suffix: $('#kpi-suffix').value.trim(),
      decimals: parseInt($('#kpi-decimals').value, 10) || 0,
      compare_with_previous: $('#kpi-compare').checked,
      previous_column: $('#kpi-compare').checked ? ($('#kpi-previous-column').value || column) : '',
      // "Last value" compared with the same column takes the second table row
      // (e.g. this month vs. last month); another column is read from the top row.
      previous_aggregation: $('#kpi-aggregation').value === 'first'
        ? (($('#kpi-previous-column').value || column) === column ? 'second' : 'first')
        : $('#kpi-aggregation').value,
      color: $('#kpi-color').value || '#818cf8',
      thresholds: [],
    };
    dash.kpi_cards.push(kpi);
    $('#kpi-title').value = '';
    $('#kpi-prefix').value = '';
    $('#kpi-suffix').value = '';
    $('#kpi-decimals').value = '0';
    $('#kpi-color').value = '#818cf8';
    $('#kpi-compare').checked = false;
    toggleKpiCompare();
    await saveDashboard();
    await refreshData();
  }

  async function removeKpi(idx) {
    const kpi = (state.currentDashboard.kpi_cards || [])[idx];
    if (!kpi) return;
    const confirmed = await confirmDialog({
      title: t('confirm_delete_kpi_title'),
      message: t('confirm_delete_kpi_message', { name: kpi.title || kpi.column || t('confirm_untitled') }),
    });
    if (!confirmed) return;
    state.currentDashboard.kpi_cards.splice(idx, 1);
    await saveDashboard();
    await refreshData();
  }

  function computeKpiValue(kpi) {
    const rows = state.data.rows || [];
    if (!rows.length || !kpi.column) return null;
    return _aggregateRows(rows, kpi.column, kpi.aggregation);
  }

  async function loadKpiValues() {
    const dash = state.currentDashboard;
    if (!dash || !dash.kpi_cards || !dash.kpi_cards.length) return;
    if (!dash.id) {
      // New dashboard: compute KPIs from the current table data directly.
      state.kpiValues = {};
      dash.kpi_cards.forEach((kpi, idx) => {
        state.kpiValues[idx] = { value: computeKpiValue(kpi) };
      });
      applyTableKpiValues();
      return;
    }
    try {
      const rows = await api('POST', '/' + dash.id + '/kpi') || [];
      state.kpiValues = Object.fromEntries(rows.map(r => [r.id, r]));
    } catch (err) {
      console.error('KPI load failed', err);
      state.kpiValues = {};
    }
    applyTableKpiValues();
  }

  const KPI_TABLE_ROW = { first: 0, second: 1 };

  function tableRowValue(rowIdx, column) {
    const row = (state.tableTopRows || [])[rowIdx];
    if (!row || !Object.prototype.hasOwnProperty.call(row, column)) return null;
    const value = row[column];
    return value === '' || value === undefined ? null : value;
  }

  // "Last value" KPIs: the value shown in the first row of the table, with the
  // table's current (possibly multi-column) sorting and grouping.
  function applyTableKpiValues() {
    const dash = state.currentDashboard;
    (dash.kpi_cards || []).forEach((kpi, idx) => {
      if (!(String(kpi.aggregation || '').toLowerCase() in KPI_TABLE_ROW)) return;
      const lookupId = kpi.id === null || kpi.id === undefined ? idx : kpi.id;
      const value = tableRowValue(KPI_TABLE_ROW[kpi.aggregation.toLowerCase()], kpi.column);
      let previous = null;
      let change = null;
      if (kpi.compare_with_previous) {
        const prevAgg = String(kpi.previous_aggregation || 'second').toLowerCase();
        previous = tableRowValue(prevAgg in KPI_TABLE_ROW ? KPI_TABLE_ROW[prevAgg] : 1, kpi.previous_column || kpi.column);
        const cur = parseFloat(value);
        const prev = parseFloat(previous);
        if (Number.isFinite(cur) && Number.isFinite(prev) && prev !== 0) change = ((cur - prev) / prev) * 100;
      }
      state.kpiValues[lookupId] = { value, previous_value: previous, change_pct: change, from_table: true };
    });
  }

  function updateKpiAggregationHint() {
    const agg = $('#kpi-aggregation');
    const hint = $('#kpi-first-hint');
    if (agg && hint) hint.classList.toggle('hidden', agg.value !== 'first');
  }

  function formatKpiValue(value, decimals) {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    const num = parseFloat(value);
    if (Number.isNaN(num)) return value;
    const formatted = num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    // Use narrow non-breaking space as thousands separator fallback for some locales.
    return formatted;
  }

  function formatKpiDisplay(kpi, value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    const num = parseFloat(value);
    if (Number.isNaN(num)) return value;
    const formatted = num.toLocaleString(undefined, { minimumFractionDigits: kpi.decimals || 0, maximumFractionDigits: kpi.decimals || 0 });
    const prefix = (kpi.prefix || '').trim();
    const suffix = (kpi.suffix || '').trim();
    const parts = [];
    if (prefix) parts.push(esc(prefix));
    parts.push(`<span class="kpi-number">${esc(formatted)}</span>`);
    if (suffix) parts.push(esc(suffix));
    return parts.join(' ');
  }

  function evaluateKpiThresholds(kpi, value) {
    if (!kpi.thresholds || !kpi.thresholds.length) return '';
    for (const rule of kpi.thresholds) {
      const threshold = parseFloat(rule.value);
      if (Number.isNaN(threshold)) continue;
      let matches = false;
      switch (rule.comparison) {
        case '>': matches = value > threshold; break;
        case '>=': matches = value >= threshold; break;
        case '<': matches = value < threshold; break;
        case '<=': matches = value <= threshold; break;
        case '==': matches = value === threshold; break;
      }
      if (matches) return rule.color || 'green';
    }
    return '';
  }

  function renderKpiCards() {
    const list = $('#kpi-list');
    if (!list) return;
    list.innerHTML = '';
    const dash = state.currentDashboard;
    const cards = dash.kpi_cards || [];
    if (!cards.length) {
      $('#kpi-panel').classList.add('hidden');
      return;
    }
    $('#kpi-panel').classList.remove('hidden');
    cards.forEach((kpi, idx) => {
      const lookupId = kpi.id === null || kpi.id === undefined ? idx : kpi.id;
      const computed = state.kpiValues[lookupId] || {};
      const value = computed.value ?? null;
      const previous = computed.previous_value ?? null;
      const change = computed.change_pct;
      const thresholdColor = evaluateKpiThresholds(kpi, value);
      const customColor = kpi.color || '';
      const card = document.createElement('div');
      card.className = 'kpi-card' + (thresholdColor ? ' kpi-' + thresholdColor : '');
      if (customColor) {
        card.style.borderColor = customColor;
        card.style.borderLeftWidth = '4px';
        card.style.borderLeftColor = customColor;
      }
      card.innerHTML = `
        <div class="kpi-header">
          <span class="kpi-title">${esc(kpi.title)}</span>
          <button data-idx="${idx}" class="card-icon-btn danger small remove-kpi" type="button" title="${esc(t('kpi_remove_title'))}" aria-label="${esc(t('kpi_remove_title'))}">${ICONS.remove}</button>
        </div>
        <div class="kpi-body">
          <span class="kpi-value"${computed.from_table ? ` title="${esc(t('kpi_first_value_title'))}"` : ''}>${formatKpiDisplay(kpi, value)}</span>
          ${change !== null && change !== undefined ? `<span class="kpi-change ${change > 0 ? 'positive' : (change < 0 ? 'negative' : 'neutral')}">${change > 0 ? '↑' : (change < 0 ? '↓' : '→')} ${formatKpiValue(Math.abs(change), 1)}%</span>` : ''}
        </div>
      `;
      list.appendChild(card);
    });
    list.querySelectorAll('.remove-kpi').forEach(btn => {
      btn.addEventListener('click', () => removeKpi(parseInt(btn.dataset.idx)));
    });
  }

  function sortBy(col) {
    const dash = state.currentDashboard;
    let list = dash.sort || [];
    const idx = list.findIndex(s => s.column === col);
    if (idx >= 0) {
      if (list[idx].desc) {
        // Third click removes the sort rule.
        list = list.filter((_, i) => i !== idx);
      } else {
        list[idx].desc = true;
      }
    } else {
      list.push({ column: col, desc: false });
    }
    dash.sort = list;
    refreshData();
  }

  // ------------------------------------------------------------------
  // Dashboard persistence
  // ------------------------------------------------------------------
  // Small notice in the middle of the page, in the dashboard's background colours.
  const SAVE_TOAST_MIN_MS = 2000;
  let saveToastTimer = null;

  function showSaveToast(status, detail = '') {
    const toast = $('#save-toast');
    if (!toast) return;
    const dash = state.currentDashboard;
    const theme = BACKGROUND_THEMES[(dash && dash.background_theme) || 'default'] || BACKGROUND_THEMES.default;
    toast.style.setProperty('--toast-bg', theme.bg);
    toast.style.setProperty('--toast-fg', theme.text);
    toast.classList.remove('saving', 'saved', 'failed');
    toast.classList.add(status, 'show');
    const text = { saving: 'dashboard_saving', saved: 'dashboard_saved', failed: 'dashboard_save_failed' }[status];
    toast.querySelector('.save-toast-text').textContent = t(text);
    toast.querySelector('.save-toast-detail').textContent = detail;
    clearTimeout(saveToastTimer);
  }

  // Readable reason from an api() error (FastAPI answers with {"detail": ...}).
  function errorDetail(err) {
    const text = (err && err.message) || String(err || '');
    try {
      const detail = JSON.parse(text).detail;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail) && detail.length) return detail.map(d => (d && d.msg) || '').filter(Boolean).join('; ');
    } catch (e) { /* not JSON */ }
    return text.length > 200 ? text.slice(0, 200) + '…' : text;
  }

  function hideSaveToast(delay) {
    const toast = $('#save-toast');
    if (!toast) return;
    clearTimeout(saveToastTimer);
    saveToastTimer = setTimeout(() => toast.classList.remove('show'), Math.max(0, delay));
  }

  async function saveDashboard(options = {}) {
    const notify = !!options.notify;
    const startedAt = Date.now();
    if (notify) showSaveToast('saving');
    const dash = state.currentDashboard;
    dash.name = $('#dashboard-name').value.trim() || t('dashboard_unnamed_fallback');
    dash.filters = collectFilters();
    dash.charts = collectCharts();
    dash.kpi_cards = collectKpiCards();
    dash.number_format = valueOr('#setting-number-format', dash.number_format || '#,##0.00');
    dash.date_time_format = valueOr('#setting-date-time-format', dash.date_time_format || 'dd.MM.yyyy HH:mm');
    dash.color_scheme = valueOr('#setting-color-scheme', dash.color_scheme || 'default');
    dash.table_theme = valueOr('#setting-table-theme', dash.table_theme || 'default');
    const rowLimitVal = parseInt(valueOr('#setting-row-limit', String(dash.row_limit !== null && dash.row_limit !== undefined ? dash.row_limit : 1000)), 10);
    dash.row_limit = Number.isNaN(rowLimitVal) ? 1000 : Math.max(0, rowLimitVal);
    dash.charts_per_row = parseInt(valueOr('#setting-charts-per-row', '3')) || 3;
    dash.chart_card_height = parseInt(valueOr('#setting-chart-height', '360')) || 360;
    const gridEl = $('#setting-show-grid');
    dash.show_grid = gridEl ? gridEl.checked : dash.show_grid;
    const nullEl = $('#setting-replace-null');
    dash.replace_null_with_empty = nullEl ? nullEl.checked : dash.replace_null_with_empty;
    const colorSignEl = $('#setting-color-numeric-sign');
    dash.color_numeric_sign = colorSignEl ? colorSignEl.checked : dash.color_numeric_sign;
    dash.group_by = dash.dimension_columns || [];
    try {
      const saved = dash.id
        ? await api('PUT', '/' + dash.id, dash)
        : await api('POST', '/', dash);
      state.currentDashboard = saved;
      applyBackgroundTheme();
      await loadDashboards();
      $('#delete-dashboard').classList.remove('hidden');
      renderDashboardList();
      await loadKpiValues();
      renderKpiCards();
      renderCharts();
      if (notify) {
        showSaveToast('saved');
        // Visible for two seconds in total, and at least a moment after the check mark appears.
        hideSaveToast(Math.max(SAVE_TOAST_MIN_MS - (Date.now() - startedAt), 700));
      }
      return true;
    } catch (err) {
      console.error(err);
      if (notify) {
        showSaveToast('failed', errorDetail(err));
        hideSaveToast(4000);
      } else {
        alert(t('dashboard_save_error', { error: err.message }));
      }
      return false;
    }
  }

  async function deleteDashboard() {
    if (!state.currentDashboard || !state.currentDashboard.id) return;
    if (!confirm(t('dashboard_delete_confirm'))) return;
    await api('DELETE', '/' + state.currentDashboard.id);
    state.currentDashboard = null;
    $('#builder').classList.add('hidden');
    $('#empty-state').classList.remove('hidden');
    clearCharts();
    await loadDashboards();
  }

  async function copyDashboard() {
    const dash = state.currentDashboard;
    if (!dash || !dash.id) {
      alert(t('save_dashboard_first_generic'));
      return;
    }
    try {
      const copied = await api('POST', '/' + dash.id + '/copy');
      await loadDashboards();
      await openDashboard(copied.id);
      renderDashboardList();
    } catch (err) {
      alert(t('dashboard_copy_error', { error: err.message }));
      console.error(err);
    }
  }

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------
  async function exportExcel() {
    if (!state.currentDashboard || !state.currentDashboard.id) {
      alert(t('save_dashboard_first_generic'));
      return;
    }
    try {
      const { blob, filename } = await apiRaw('POST', '/' + state.currentDashboard.id + '/export/excel');
      downloadBlob(blob, filename);
    } catch (err) {
      alert(t('excel_export_error', { error: err.message }));
    }
  }

  // Text for the PDF is drawn on a canvas and placed as an image: jsPDF's
  // built-in fonts cannot render Czech (or other non-Latin-1) characters.
  const PDF_PX_PER_MM = 8;
  function pdfTextImage(blocks, widthMm, { fontPt = 8.5, bold = false, color = '#374151', maxLines = 14 } = {}) {
    const fontPx = fontPt * 0.3528 * PDF_PX_PER_MM;
    const lineH = fontPx * 1.38;
    const widthPx = Math.round(widthMm * PDF_PX_PER_MM);
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    const measure = document.createElement('canvas').getContext('2d');
    const font = `${bold ? '600 ' : ''}${fontPx}px ${family}`;
    measure.font = font;
    const lines = [];
    blocks.forEach(block => {
      const indent = block.bullet ? fontPx * 1.3 : 0;
      const words = String(block.text).split(/\s+/).filter(Boolean);
      let line = '';
      let first = true;
      const push = (text) => { lines.push({ text, indent, bullet: first ? block.bullet : '' }); first = false; };
      words.forEach(word => {
        const next = line ? line + ' ' + word : word;
        if (measure.measureText(next).width > widthPx - indent && line) { push(line); line = word; } else { line = next; }
      });
      if (line) push(line);
    });
    let shown = lines;
    if (lines.length > maxLines) {
      shown = lines.slice(0, maxLines);
      shown[maxLines - 1] = { ...shown[maxLines - 1], text: shown[maxLines - 1].text.replace(/\s*\S*$/, '') + ' …' };
    }
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = Math.max(1, Math.ceil(shown.length * lineH + fontPx * 0.4));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    shown.forEach((line, i) => {
      const y = i * lineH + fontPx * 0.15;
      if (line.bullet) ctx.fillText(line.bullet, 0, y);
      ctx.fillText(line.text, line.indent, y);
    });
    return { data: canvas.toDataURL('image/png'), heightMm: canvas.height / PDF_PX_PER_MM, widthMm };
  }

  async function exportPdf() {
    if (!state.currentDashboard || !state.currentDashboard.charts.length) {
      alert(t('pdf_export_no_charts'));
      return;
    }
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const gap = 10;
      const cols = 2;
      const cardWidth = (pageWidth - margin * 2 - gap * (cols - 1)) / cols;
      const chartHeight = 80;

      // One block per chart: title, chart image and (if written) its description.
      const blocks = [];
      state.currentDashboard.charts.forEach((chart, idx) => {
        const canvas = document.getElementById('chart-canvas-' + idx);
        if (!canvas) return;
        const title = pdfTextImage([{ text: chart.title || t('chart_fallback_title') }], cardWidth, { fontPt: 10.5, bold: true, color: '#111827', maxLines: 2 });
        const descBlocks = chartHasDescription(chart) ? descriptionBlocks(chart.description) : [];
        const desc = descBlocks.length ? pdfTextImage(descBlocks, cardWidth, { fontPt: 8, color: '#4b5563' }) : null;
        blocks.push({
          title,
          image: canvas.toDataURL('image/png'),
          desc,
          height: title.heightMm + 1.5 + chartHeight + (desc ? 3 + desc.heightMm : 0),
        });
      });

      let y = margin;
      for (let i = 0; i < blocks.length; i += cols) {
        const row = blocks.slice(i, i + cols);
        const rowHeight = Math.max(...row.map(b => b.height));
        if (y > margin && y + rowHeight > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
        row.forEach((b, c) => {
          const x = margin + c * (cardWidth + gap);
          let by = y;
          pdf.addImage(b.title.data, 'PNG', x, by, b.title.widthMm, b.title.heightMm);
          by += b.title.heightMm + 1.5;
          pdf.addImage(b.image, 'PNG', x, by, cardWidth, chartHeight);
          by += chartHeight;
          if (b.desc) {
            by += 3;
            pdf.addImage(b.desc.data, 'PNG', x, by, b.desc.widthMm, b.desc.heightMm);
          }
        });
        y += rowHeight + gap;
      }

      const filename = (state.currentDashboard.name || 'dashboard').replace(/\s+/g, '_') + '_grafy.pdf';
      pdf.save(filename);
    } catch (err) {
      alert(t('pdf_export_error', { error: err.message }));
      console.error(err);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ------------------------------------------------------------------
  // Charts
  // ------------------------------------------------------------------
  function bindCustomChartTypeSelect() {
    const trigger = $('#chart-type-trigger');
    const options = $('#chart-type-options');
    const input = $('#chart-type');
    if (!trigger || !options || !input) return;

    function renderOptions() {
      options.innerHTML = CHART_TYPES.map(ct => `
        <div class="custom-select-option" data-value="${esc(ct.value)}" tabindex="0">
          <img src="/static/icons/${esc(ct.value)}.svg" alt="" class="chart-icon" />
          <span>${esc(ct.labelKey.replace(/^chart_type_/, '').replace(/_/g, ' '))}</span>
        </div>`).join('');
      options.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.addEventListener('click', () => {
          input.value = opt.dataset.value;
          updateTrigger();
          options.classList.remove('open');
        });
        opt.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            input.value = opt.dataset.value;
            updateTrigger();
            options.classList.remove('open');
          }
        });
      });
    }

    function updateTrigger() {
      const ct = CHART_TYPES.find(x => x.value === input.value) || CHART_TYPES[0];
      const labelText = ct.labelKey.replace(/^chart_type_/, '').replace(/_/g, ' ');
      trigger.innerHTML = `
        <img src="/static/icons/${esc(ct.value)}.svg" alt="" class="chart-icon" />
        <span id="chart-type-trigger-label">${esc(labelText)}</span>`;
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      options.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!trigger.contains(e.target) && !options.contains(e.target)) {
        options.classList.remove('open');
      }
    });
    renderOptions();
    updateTrigger();
  }

  function renderKpiControls() {
    const kpiColumn = $('#kpi-column');
    const kpiPrevious = $('#kpi-previous-column');
    if (!kpiColumn) return;
    const numberCols = (state.columns || [])
      .filter(c => c.type === 'number')
      .map(c => `<option value="${esc(c.name)}">${esc(displayName(c.name))}</option>`)
      .join('');
    const opts = numberCols || `<option value="">${esc(t('no_numeric_column_option'))}</option>`;
    kpiColumn.innerHTML = opts;
    if (kpiPrevious) kpiPrevious.innerHTML = `<option value="">${esc(t('kpi_same_column_option'))}</option>` + opts;
  }

  function renderChartControls() {
    const dash = state.currentDashboard;
    // Any table column may be used for charting, not just dimensions.
    const allCols = (state.columns || []).map(c => c.name);
    // Use all available columns for chart dimension selection, not just visible ones,
    // so hidden dimensions (e.g. used as split) can still be chosen.
    const chartCols = allCols;
    const xEl = $('#chart-x');
    const splitEl = $('#chart-split');
    const xCol = xEl ? xEl.value : (chartCols[0] || '');
    const options = chartCols
      .map(c => `<option value="${esc(c)}"${c === xCol ? ' selected' : ''}>${esc(displayName(c))}</option>`)
      .join('');
    if (xEl) {
      xEl.innerHTML = options || '<option value="">' + esc(t('chart_x_no_columns')) + '</option>';
      if (!chartCols.includes(xEl.value)) xEl.value = chartCols[0] || '';
    }
    if (splitEl) {
      // Keep both axes independent: all columns are available in both dropdowns.
      const splitOptions = chartCols
        .map(c => `<option value="${esc(c)}">${esc(displayName(c))}</option>`)
        .join('');
      splitEl.innerHTML = '<option value="">' + esc(t('chart_split_none')) + '</option>' + splitOptions;
      splitEl.disabled = !chartCols.length;
    }
  }

  function addSeriesRow(series) {
    const container = $('#chart-series-list');
    const id = 'series-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const yCol = series ? series.y_column : '';
    const agg = series ? series.aggregation : 'sum';
    const label = series ? series.label : '';
    const renderAs = series ? series.render_as || 'bar' : 'bar';
    const dash = state.currentDashboard;
    const dimCols = dash.dimension_columns || [];
    const exclude = new Set(dimCols);
    const measureCols = state.columns
      .filter(c => c.type === 'number' && !exclude.has(c.name))
      .map(c => `<option value="${esc(c.name)}" ${c.name === yCol ? 'selected' : ''}>${esc(displayName(c.name))}</option>`)
      .join('');
    const div = document.createElement('div');
    div.className = 'chart-series-row';
    div.dataset.seriesId = id;
    div.innerHTML = `
      <select class="series-y">${measureCols || '<option value="">' + esc(t('no_numeric_column_option')) + '</option>'}</select>
      <select class="series-agg" data-i18n-opts="${esc(JSON.stringify(SERIES_AGGREGATION_LABELS))}">
        <option value="sum" ${agg === 'sum' ? 'selected' : ''}>${esc(t(SERIES_AGGREGATION_LABELS.sum))}</option>
        <option value="count" ${agg === 'count' ? 'selected' : ''}>${esc(t(SERIES_AGGREGATION_LABELS.count))}</option>
        <option value="avg" ${agg === 'avg' ? 'selected' : ''}>${esc(t(SERIES_AGGREGATION_LABELS.avg))}</option>
        <option value="min" ${agg === 'min' ? 'selected' : ''}>${esc(t(SERIES_AGGREGATION_LABELS.min))}</option>
        <option value="max" ${agg === 'max' ? 'selected' : ''}>${esc(t(SERIES_AGGREGATION_LABELS.max))}</option>
      </select>
      <select class="series-render" data-i18n-opts="${esc(JSON.stringify(SERIES_RENDER_LABELS))}">
        <option value="bar" ${renderAs === 'bar' ? 'selected' : ''}>${esc(t(SERIES_RENDER_LABELS.bar))}</option>
        <option value="line" ${renderAs === 'line' ? 'selected' : ''}>${esc(t(SERIES_RENDER_LABELS.line))}</option>
      </select>
      <input type="text" class="series-label" placeholder="${esc(t('series_label_placeholder'))}" value="${esc(label)}">
      <button class="card-icon-btn danger remove-series" type="button" title="${esc(t('series_remove_title'))}" aria-label="${esc(t('series_remove_title'))}">${ICONS.remove}</button>
    `;
    div.querySelector('.remove-series').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  function collectCharts() {
    return (state.currentDashboard.charts || []).map(c => ({ ...c }));
  }

  function collectKpiCards() {
    return (state.currentDashboard.kpi_cards || []).map(k => ({ ...k }));
  }

  function renderMoreSettings() {
    const dash = state.currentDashboard;
    setValue('#setting-number-format', dash.number_format || '#,##0.00');
    setValue('#setting-date-time-format', dash.date_time_format || 'dd.MM.yyyy HH:mm');
    setValue('#setting-color-scheme', dash.color_scheme || 'default');
    const hiddenScheme = $('#setting-color-scheme');
    if (hiddenScheme) hiddenScheme.dispatchEvent(new Event('change', { bubbles: true }));
    setValue('#setting-table-theme', dash.table_theme || 'default');
    const hiddenTheme = $('#setting-table-theme');
    if (hiddenTheme) hiddenTheme.dispatchEvent(new Event('change', { bubbles: true }));
    applyTableTheme();
    setValue('#setting-row-limit', String(dash.row_limit !== null && dash.row_limit !== undefined ? dash.row_limit : 1000));
    setValue('#setting-charts-per-row', String(dash.charts_per_row || 3));
    setValue('#setting-chart-height', String(dash.chart_card_height || 360));
    const gridEl = $('#setting-show-grid');
    if (gridEl) gridEl.checked = parseBool(dash.show_grid, true);
    const nullEl = $('#setting-replace-null');
    if (nullEl) nullEl.checked = parseBool(dash.replace_null_with_empty, true);
    const colorSignEl = $('#setting-color-numeric-sign');
    if (colorSignEl) colorSignEl.checked = parseBool(dash.color_numeric_sign, false);
    updateChartsPerRowStyle();
  }

  function setValue(sel, value) {
    const el = $(sel);
    if (el) el.value = value;
  }

  function updateChartsPerRowStyle() {
    const perRowEl = $('#setting-charts-per-row');
    const heightEl = $('#setting-chart-height');
    const perRow = perRowEl ? parseInt(perRowEl.value) || 3 : 3;
    const height = heightEl ? parseInt(heightEl.value) || 360 : 360;
    const list = $('#chart-list');
    if (list) {
      // The setting is the maximum per row; narrow screens fit fewer (responsive.css).
      list.style.removeProperty('grid-template-columns');
      list.style.setProperty('--charts-per-row', String(perRow));
      list.style.setProperty('--card-height', height + 'px');
      list.querySelectorAll('.chart-card').forEach(card => {
        card.style.height = height + 'px';
      });
    }
  }

  function addChart() {
    const xColumn = $('#chart-x').value;
    const splitColumn = $('#chart-split').value;
    const title = $('#chart-title').value.trim() || t('new_chart_default_title');
    const type = $('#chart-type').value;
    const xLabel = $('#chart-x-label').value.trim();
    const yLabel = $('#chart-y-label').value.trim();
    const series = [];
    $('#chart-series-list').querySelectorAll('.chart-series-row').forEach(row => {
      const y = row.querySelector('.series-y').value;
      if (!y) return;
      series.push({
        y_column: y,
        aggregation: row.querySelector('.series-agg').value,
        render_as: row.querySelector('.series-render').value || 'bar',
        label: row.querySelector('.series-label').value.trim() || y,
      });
    });
    if (!series.length) {
      alert(t('add_chart_no_series_error'));
      return;
    }

    const dash = state.currentDashboard;
    ensureVisible(xColumn);
    if (splitColumn) ensureVisible(splitColumn);
    series.forEach(s => ensureVisible(s.y_column));

    const chart = {
      chart_type: type,
      x_column: xColumn,
      split_by_column: splitColumn,
      title: title,
      series: series,
      x_label: xLabel,
      y_label: yLabel,
    };
    state.currentDashboard.charts.push(chart);
    saveDashboard();
  }

  // The enlarged chart belongs to the dashboard: switching dashboards shows each
  // one with its own layout, and the choice is stored with the dashboard.
  function expandedChartIndex() {
    const dash = state.currentDashboard;
    if (!dash) return null;
    const idx = dash.expanded_chart;
    return Number.isInteger(idx) && idx >= 0 && idx < (dash.charts || []).length ? idx : null;
  }

  function setExpandedChart(idx) {
    const dash = state.currentDashboard;
    if (!dash) return;
    dash.expanded_chart = idx;
    renderCharts();
    // Saved on its own so that other unsaved edits are not stored along with it;
    // an unsaved dashboard keeps the choice until its first save.
    if (dash.id && !PUBLIC_TOKEN) {
      api('PUT', '/' + dash.id + '/expanded-chart', { expanded_chart: idx })
        .catch(err => console.error('Could not store the enlarged chart', err));
    }
  }

  const ICONS = {
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10h-6V4M4 14h6v6M14 10l6.5-6.5M10 14l-6.5 6.5"/></svg>',
    remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    plusTile: '<span class="btn-add-plus" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.6v.01"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
    database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    bullets: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
    numbers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10M4 5h1v4M4 9h2M4 15.5c.5-.7 2-.7 2 .3 0 .8-2 1.5-2 2.2h2"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    highlight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l-4 4h5l1.5-1.5M9 15l6-9 4 3-6 9-4-3z"/></svg>',
    column: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h9M4 18h6M17 14v7M13.5 17.5h7"/></svg>',
  };

  // Styled replacement for window.confirm(); resolves to true when confirmed.
  function confirmDialog({ title, message, confirmLabel }) {
    const modal = $('#confirm-modal');
    if (!modal) return Promise.resolve(window.confirm(message || title));
    $('#confirm-title').textContent = title || '';
    $('#confirm-message').textContent = message || '';
    const ok = $('#confirm-ok');
    const cancel = $('#confirm-cancel');
    ok.textContent = confirmLabel || t('confirm_delete_button');
    cancel.textContent = t('confirm_cancel_button');
    const previousFocus = document.activeElement;
    modal.classList.remove('hidden');
    cancel.focus();
    return new Promise(resolve => {
      const backdrop = modal.querySelector('.modal-backdrop');
      function close(result) {
        modal.classList.add('hidden');
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey, true);
        if (previousFocus && previousFocus.focus && document.contains(previousFocus)) previousFocus.focus();
        resolve(result);
      }
      function onOk() { close(true); }
      function onCancel() { close(false); }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
        else if (e.key === 'Tab') {
          // Keep focus inside the dialog.
          e.preventDefault();
          (document.activeElement === ok ? cancel : ok).focus();
        }
      }
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey, true);
    });
  }

  // ------------------------------------------------------------------
  // Chart description ("O grafu"): a rich-text note written by people plus
  // an automatic "where the data comes from" section built from the chart
  // settings and the view definition, so it never goes stale.
  // ------------------------------------------------------------------
  const DESCRIPTION_TAGS = {
    P: [], DIV: [], BR: [], B: [], STRONG: [], I: [], EM: [], U: [], MARK: [],
    UL: [], OL: [], LI: [], A: ['href'], SPAN: ['class', 'data-col'],
  };
  const DESCRIPTION_DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'SVG', 'MATH', 'TEXTAREA', 'SELECT']);

  // Client-side mirror of the server allowlist (services/html_sanitizer.py);
  // the server sanitizes on save, this guards what is put into the page.
  function sanitizeDescriptionHtml(html) {
    const src = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html').body.firstElementChild;
    const out = document.createElement('div');
    function copy(node, target) {
      node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          target.appendChild(document.createTextNode(child.textContent));
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE || DESCRIPTION_DROP.has(child.tagName)) return;
        const allowed = DESCRIPTION_TAGS[child.tagName];
        if (!allowed) { copy(child, target); return; }
        if (child.tagName === 'SPAN') {
          if (child.getAttribute('class') !== 'col-ref' || !child.dataset.col) { copy(child, target); return; }
          const chip = document.createElement('span');
          chip.className = 'col-ref';
          chip.dataset.col = child.dataset.col;
          chip.textContent = child.textContent;
          target.appendChild(chip);
          return;
        }
        if (child.tagName === 'A') {
          const href = (child.getAttribute('href') || '').trim();
          if (!/^(https?:|mailto:)/i.test(href.replace(/[\x00-\x20]/g, ''))) { copy(child, target); return; }
          const a = document.createElement('a');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          copy(child, a);
          target.appendChild(a);
          return;
        }
        const el = document.createElement(child.tagName.toLowerCase());
        copy(child, el);
        target.appendChild(el);
      });
    }
    copy(src, out);
    return out;
  }

  // Column chips always show the current column name (aliases can change).
  function refreshColumnRefs(root) {
    root.querySelectorAll('span.col-ref').forEach(chip => {
      chip.textContent = displayName(chip.dataset.col);
      chip.title = chip.dataset.col;
    });
    return root;
  }

  function descriptionIsEmpty(html) {
    if (!html) return true;
    const root = sanitizeDescriptionHtml(html);
    return !root.textContent.trim() && !root.querySelector('span.col-ref');
  }

  // Plain-text blocks (paragraphs and list items) of a description.
  function descriptionBlocks(html) {
    const root = refreshColumnRefs(sanitizeDescriptionHtml(html));
    const blocks = [];
    let inline = '';
    const flush = () => { if (inline.trim()) blocks.push({ text: inline.replace(/\s+/g, ' ').trim() }); inline = ''; };
    root.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) { inline += node.textContent; return; }
      const tag = node.tagName;
      if (tag === 'BR') { flush(); return; }
      if (tag === 'UL' || tag === 'OL') {
        flush();
        [...node.children].forEach((li, i) => {
          const text = li.textContent.replace(/\s+/g, ' ').trim();
          if (text) blocks.push({ text, bullet: tag === 'OL' ? `${i + 1}.` : '•' });
        });
        return;
      }
      if (tag === 'P' || tag === 'DIV') { flush(); inline = node.textContent; flush(); return; }
      inline += node.textContent;
    });
    flush();
    return blocks;
  }

  function descriptionCaption(html) {
    const first = descriptionBlocks(html)[0];
    return first ? first.text : '';
  }

  function chartHasDescription(chart) {
    return !descriptionIsEmpty(chart && chart.description);
  }

  function currentUserEmail() {
    const el = document.querySelector('.user-email');
    return el ? el.textContent.trim() : '';
  }

  function formatDescriptionDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const lang = (window.I18n && window.I18n.getLang && window.I18n.getLang()) || document.documentElement.lang || undefined;
    try { return d.toLocaleDateString(lang, { day: 'numeric', month: 'numeric', year: 'numeric' }); } catch (e) { return d.toLocaleDateString(); }
  }

  // --- View lineage -------------------------------------------------------
  async function getJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  function viewWhereSql(sql) {
    // Best effort: the WHERE part of the view's top-level SELECT.
    const m = String(sql || '').match(/\bWHERE\b([\s\S]*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bHAVING\b|$)/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  }

  async function loadViewLineage(viewName) {
    if (PUBLIC_TOKEN) return { found: false };
    const list = await getJson('/api/views/saved');
    const match = (list || []).find(v => (v.NazevSys || v.Nazev) === viewName);
    if (!match) return { found: false };
    const id = match.ID || match.id;
    const view = await getJson('/api/views/saved/' + encodeURIComponent(id));
    const aggs = view.aggregations || {};
    const columns = {};
    (view.selected_columns || []).forEach(c => {
      const table = c.table || view.primary_table || '';
      const agg = aggs[`${table}.${c.name}`] || aggs[c.name] || '';
      columns[c.alias || c.name] = { kind: 'column', table, name: c.name, agg: String(agg).toUpperCase() };
    });
    (view.custom_columns || []).forEach(c => {
      if (c.alias) columns[c.alias] = { kind: 'custom', definition: c.definition || '' };
    });
    return {
      found: true,
      id,
      access: view.access || match.access || 'owner',
      description: view.description || '',
      columns,
      where: viewWhereSql(view.raw_sql),
      grouped: (view.group_by || []).length > 0,
    };
  }

  function viewLineage(viewName) {
    if (!state.viewLineage) state.viewLineage = new Map();
    if (!state.viewLineage.has(viewName)) {
      state.viewLineage.set(viewName, loadViewLineage(viewName).catch(err => {
        console.warn('View lineage unavailable', err);
        state.viewLineage.delete(viewName);
        return { found: false, error: true };
      }));
    }
    return state.viewLineage.get(viewName);
  }

  function aggregationWord(agg, chartType) {
    if (chartType === 'scatter') return t('lineage_agg_values');
    const key = { sum: 'lineage_agg_sum', avg: 'lineage_agg_avg', count: 'lineage_agg_count', min: 'lineage_agg_min', max: 'lineage_agg_max' }[String(agg || 'sum').toLowerCase()];
    return key ? t(key) : String(agg);
  }

  function lineageSourceHtml(col, lineage) {
    const info = lineage && lineage.found ? lineage.columns[col] : null;
    if (!info) return '';
    if (info.kind === 'custom') {
      return `<code class="cip-code">${esc(info.definition)}</code><span class="cip-muted">${esc(t('lineage_custom_column'))}</span>`;
    }
    const source = info.agg
      ? t('lineage_view_aggregated', { agg: info.agg, table: info.table, column: info.name })
      : t('lineage_table_column', { table: info.table, column: info.name });
    return `<span class="cip-muted cip-source">${esc(source)}</span>`;
  }

  function filterText(f) {
    const name = displayName(f.column);
    if (f.type === 'text') return `${name} ${f.operator || '='} "${f.value}"`;
    const lo = f.min_value ?? f.from_value;
    const hi = f.max_value ?? f.to_value;
    if (lo && hi) return `${name}: ${lo} – ${hi}`;
    if (lo) return `${name} ≥ ${lo}`;
    if (hi) return `${name} ≤ ${hi}`;
    return name;
  }

  function lineageHtml(chart, lineage) {
    const dash = state.currentDashboard;
    const viewMeta = (state.views || []).find(v => v.system_name === dash.view_name);
    const viewLabel = (viewMeta && viewMeta.display_name) || dash.view_display_name || dash.view_name;
    const rows = [];
    const row = (label, html) => rows.push(`<dt>${esc(label)}</dt><dd>${html}</dd>`);
    row(t('lineage_view'), `${esc(viewLabel)}${viewLabel !== dash.view_name ? ` <span class="cip-muted">· ${esc(dash.view_name)}</span>` : ''}`
      + (lineage && lineage.description ? `<span class="cip-muted cip-source">${esc(lineage.description)}</span>` : ''));
    if (chart.x_column) row(t('lineage_x_axis'), esc(displayName(chart.x_column)) + lineageSourceHtml(chart.x_column, lineage));
    if (chart.split_by_column) row(t('lineage_split'), esc(displayName(chart.split_by_column)) + lineageSourceHtml(chart.split_by_column, lineage));
    chartSeries(chart).forEach(s => {
      const label = s.label || displayName(s.y_column);
      const how = t('lineage_series_value', { agg: aggregationWord(s.aggregation, chart.chart_type), column: displayName(s.y_column) });
      row(t('lineage_series'), `${esc(label)} = ${esc(how)}${lineageSourceHtml(s.y_column, lineage)}`);
    });
    const filters = collectFilters();
    row(t('lineage_filters'), filters.length
      ? filters.map(f => esc(filterText(f))).join('<br>') + ` <span class="cip-muted">· ${esc(t('lineage_dashboard_filters'))}</span>`
      : `<span class="cip-muted">${esc(t('lineage_no_filters'))}</span>`);
    if (lineage && lineage.found && lineage.where) {
      row(t('lineage_view_conditions'), `<code class="cip-code">${esc(lineage.where.length > 400 ? lineage.where.slice(0, 400) + '…' : lineage.where)}</code>`);
    }
    if (lineage && lineage.found && lineage.grouped) {
      row(t('lineage_view_grouping'), `<span class="cip-muted">${esc(t('lineage_view_grouped'))}</span>`);
    }
    let footer = '';
    if (lineage && lineage.found) {
      footer = `<button type="button" class="cip-link" data-view-id="${esc(lineage.id)}" data-access="${esc(lineage.access)}">${ICONS.external}<span>${esc(t('lineage_open_view'))}</span></button>`;
    } else if (lineage && !lineage.error) {
      footer = `<p class="cip-muted cip-note">${esc(t('lineage_view_not_modeled'))}</p>`;
    }
    return `<dl class="cip-grid">${rows.join('')}</dl>${footer}`;
  }

  // --- Popover --------------------------------------------------------------
  let chartInfo = null; // { idx, pop, button, editing, dirty, cleanup }

  function closeChartInfo() {
    if (!chartInfo) return;
    chartInfo.cleanup.forEach(fn => fn());
    chartInfo.pop.remove();
    if (chartInfo.button && document.contains(chartInfo.button)) {
      chartInfo.button.classList.remove('active');
      chartInfo.button.setAttribute('aria-expanded', 'false');
    }
    chartInfo = null;
  }

  function positionChartInfo() {
    if (!chartInfo) return;
    const { pop, button } = chartInfo;
    if (!document.contains(button)) { closeChartInfo(); return; }
    const r = button.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(480, vw - 24);
    pop.style.width = width + 'px';
    const left = Math.max(12, Math.min(r.right + 10 - width, vw - width - 12));
    pop.style.left = left + 'px';
    pop.style.setProperty('--arrow-left', Math.max(16, Math.min(width - 24, r.left + r.width / 2 - left - 6)) + 'px');
    const below = vh - r.bottom - 22;
    const above = r.top - 22;
    const natural = pop.scrollHeight;
    const placeBelow = below >= Math.min(natural, 320) || below >= above;
    pop.classList.toggle('above', !placeBelow);
    const maxH = Math.max(180, placeBelow ? below : above);
    pop.style.maxHeight = maxH + 'px';
    const height = Math.min(natural, maxH);
    pop.style.top = (placeBelow ? r.bottom + 10 : r.top - 10 - height) + 'px';
  }

  async function openChartInfo(idx, button, startEditing = false) {
    if (chartInfo && chartInfo.idx === idx && !startEditing) { closeChartInfo(); return; }
    closeChartInfo();
    const pop = document.createElement('div');
    pop.className = 'chart-info-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    document.body.appendChild(pop);
    button.classList.add('active');
    button.setAttribute('aria-expanded', 'true');
    chartInfo = { idx, pop, button, editing: false, dirty: false, cleanup: [] };
    const onDown = (e) => {
      if (!chartInfo || chartInfo.editing) return;
      if (pop.contains(e.target) || button.contains(e.target)) return;
      if (e.target.closest && e.target.closest('#confirm-modal')) return;
      closeChartInfo();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape' || !chartInfo || document.querySelector('#confirm-modal:not(.hidden)')) return;
      e.preventDefault();
      if (chartInfo.editing) cancelChartDescriptionEdit();
      else { const b = chartInfo.button; closeChartInfo(); b.focus(); }
    };
    const onMove = () => positionChartInfo();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
    chartInfo.cleanup.push(
      () => document.removeEventListener('mousedown', onDown, true),
      () => document.removeEventListener('keydown', onKey),
      () => window.removeEventListener('resize', onMove),
      () => document.removeEventListener('scroll', onMove, true),
    );
    if (startEditing) renderChartDescriptionEditor();
    else renderChartInfoRead();
  }

  function renderChartInfoRead() {
    if (!chartInfo) return;
    const { idx, pop } = chartInfo;
    const chart = state.currentDashboard.charts[idx];
    if (!chart) { closeChartInfo(); return; }
    chartInfo.editing = false;
    const has = chartHasDescription(chart);
    const by = chart.description_updated_by;
    const at = formatDescriptionDate(chart.description_updated_at);
    pop.innerHTML = `
      <div class="cip-head">
        <h5>${esc(chart.title || t('chart_fallback_title'))}</h5>
        ${has ? `<button type="button" class="cip-edit">${ICONS.pencil}<span>${esc(t('chart_description_edit'))}</span></button>` : ''}
        <button type="button" class="card-icon-btn small cip-close" title="${esc(t('chart_description_close'))}" aria-label="${esc(t('chart_description_close'))}">${ICONS.remove}</button>
      </div>
      <div class="cip-body"></div>
      <div class="cip-lineage">
        <h6>${ICONS.database}<span>${esc(t('lineage_heading'))}</span><span class="cip-auto">${esc(t('lineage_auto_badge'))}</span></h6>
        <div class="cip-lineage-content"><p class="cip-muted">${esc(t('chart_loading'))}</p></div>
      </div>
      ${has && (by || at) ? `<div class="cip-foot">${esc(t('chart_description_updated', { who: by || '—', when: at || '—' }))}</div>` : ''}`;
    pop.setAttribute('aria-label', chart.title || t('chart_fallback_title'));
    const body = pop.querySelector('.cip-body');
    if (has) {
      body.appendChild(refreshColumnRefs(sanitizeDescriptionHtml(chart.description)));
    } else {
      body.innerHTML = `<div class="cip-empty"><p>${esc(t('chart_description_empty'))}</p>
        <button type="button" class="btn primary small cip-write">${ICONS.pencil}<span>${esc(t('chart_description_write'))}</span></button></div>`;
    }
    pop.querySelectorAll('.cip-edit, .cip-write').forEach(b => b.addEventListener('click', renderChartDescriptionEditor));
    pop.querySelector('.cip-close').addEventListener('click', () => { const b = chartInfo.button; closeChartInfo(); b.focus(); });
    positionChartInfo();
    const content = pop.querySelector('.cip-lineage-content');
    const viewName = state.currentDashboard.view_name;
    viewLineage(viewName).then(lineage => {
      if (!chartInfo || chartInfo.pop !== pop || chartInfo.editing) return;
      content.innerHTML = lineageHtml(chart, lineage);
      const link = content.querySelector('.cip-link');
      if (link) link.addEventListener('click', () => openViewInModeling(link.dataset.viewId, link.dataset.access));
      positionChartInfo();
    });
  }

  function openViewInModeling(viewId, access) {
    closeChartInfo();
    hideConnectorSection();
    showViewModelingSection();
    if (window.ViewModeling && window.ViewModeling.openView) window.ViewModeling.openView(parseInt(viewId, 10), access);
  }

  // --- Editor ---------------------------------------------------------------
  function renderChartDescriptionEditor() {
    if (!chartInfo) return;
    const { idx, pop } = chartInfo;
    const chart = state.currentDashboard.charts[idx];
    chartInfo.editing = true;
    chartInfo.dirty = false;
    const tool = (cmd, icon, key) => `<button type="button" class="cde-tool" data-cmd="${cmd}" title="${esc(t(key))}" aria-label="${esc(t(key))}">${icon}</button>`;
    pop.innerHTML = `
      <div class="cip-head"><h5>${esc(t('chart_description_heading'))}</h5></div>
      <div class="cde-toolbar" role="toolbar" aria-label="${esc(t('chart_description_heading'))}">
        ${tool('bold', '<b>B</b>', 'editor_bold')}${tool('italic', '<i>I</i>', 'editor_italic')}${tool('underline', '<u>U</u>', 'editor_underline')}
        <span class="cde-sep"></span>
        ${tool('insertUnorderedList', ICONS.bullets, 'editor_bullets')}${tool('insertOrderedList', ICONS.numbers, 'editor_numbers')}
        ${tool('link', ICONS.link, 'editor_link')}${tool('mark', ICONS.highlight, 'editor_highlight')}
        <span class="cde-sep"></span>
        <button type="button" class="cde-tool cde-insert" data-cmd="column" aria-haspopup="listbox">${ICONS.column}<span>${esc(t('editor_insert_column'))}</span></button>
      </div>
      <div class="cde-linkbar hidden">
        <input type="url" class="cde-link-input" placeholder="https://" aria-label="${esc(t('editor_link'))}">
        <button type="button" class="btn small primary cde-link-ok">${esc(t('editor_link_apply'))}</button>
        <button type="button" class="btn small cde-link-remove">${esc(t('editor_link_remove'))}</button>
      </div>
      <div class="cde-columns hidden" role="listbox">
        <input type="search" class="cde-col-search" placeholder="${esc(t('editor_column_search'))}" aria-label="${esc(t('editor_column_search'))}">
        <div class="cde-col-list"></div>
      </div>
      <div class="cde-editor" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true"
        aria-label="${esc(t('chart_description_heading'))}" data-placeholder="${esc(t('chart_description_placeholder'))}"></div>
      <label class="cde-option"><input type="checkbox" class="cde-caption"><span>${esc(t('chart_description_caption_option'))}</span></label>
      <p class="cde-error hidden" role="alert"></p>
      <div class="cde-actions">
        <span class="cde-hint">${esc(t('chart_description_shortcut'))}</span>
        <button type="button" class="btn cde-cancel">${esc(t('confirm_cancel_button'))}</button>
        <button type="button" class="btn primary cde-save">${esc(t('chart_description_save'))}</button>
      </div>`;
    const editor = pop.querySelector('.cde-editor');
    const content = sanitizeDescriptionHtml(chart.description || '');
    refreshColumnRefs(content);
    content.querySelectorAll('span.col-ref').forEach(chip => chip.setAttribute('contenteditable', 'false'));
    editor.append(...content.childNodes);
    updateEmptyState();
    pop.querySelector('.cde-caption').checked = !!chart.show_caption;
    try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* older browsers */ }
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* older browsers */ }

    let savedRange = null;
    const saveRange = () => {
      const sel = window.getSelection();
      if (sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
    };
    const restoreRange = () => {
      editor.focus();
      if (!savedRange) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    };
    const markDirty = () => { chartInfo.dirty = true; updateEmptyState(); };
    function updateEmptyState() {
      editor.classList.toggle('is-empty', !editor.textContent.trim() && !editor.querySelector('span.col-ref, li'));
    }
    // Keep the text in paragraphs: a line typed straight into the editor root
    // becomes a <p> (lists and paragraphs then nest correctly).
    function ensureParagraphs() {
      if (!editor.firstChild) {
        editor.innerHTML = '<p><br></p>';
        const r = document.createRange();
        r.setStart(editor.firstChild, 0);
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
      const loose = [...editor.childNodes].some(n => (n.nodeType === Node.TEXT_NODE && n.textContent.trim())
        || (n.nodeType === Node.ELEMENT_NODE && !['P', 'DIV', 'UL', 'OL'].includes(n.tagName)));
      if (loose) document.execCommand('formatBlock', false, 'p');
    }
    // Insert a node at the caret (Chrome's insertHTML drops classes and
    // contenteditable from spans, so chips and highlights are built here).
    function insertNodeAtCaret(node, trailingSpace = false) {
      restoreRange();
      const sel = window.getSelection();
      if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      let caretAfter = node;
      if (trailingSpace) {
        const space = document.createTextNode('\u00a0');
        node.after(space);
        caretAfter = space;
      }
      const after = document.createRange();
      after.setStartAfter(caretAfter);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      saveRange();
    }
    const updateToolState = () => {
      pop.querySelectorAll('.cde-tool[data-cmd]').forEach(btn => {
        const cmd = btn.dataset.cmd;
        let on = false;
        try {
          if (['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'].includes(cmd)) on = document.queryCommandState(cmd);
        } catch (e) { on = false; }
        if (cmd === 'mark' || cmd === 'link') {
          const sel = window.getSelection();
          const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
          on = !!(node && editor.contains(node) && node.closest(cmd === 'mark' ? 'mark' : 'a'));
        }
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    };
    const onSelection = () => { if (chartInfo && chartInfo.pop === pop) { saveRange(); updateToolState(); } };
    document.addEventListener('selectionchange', onSelection);
    chartInfo.cleanup.push(() => document.removeEventListener('selectionchange', onSelection));

    editor.addEventListener('input', () => { ensureParagraphs(); markDirty(); positionChartInfo(); });
    editor.addEventListener('focus', () => { if (!editor.firstChild) ensureParagraphs(); });
    editor.addEventListener('paste', (e) => {
      // Pasted content arrives as plain text: no foreign styles or markup.
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    editor.addEventListener('drop', (e) => e.preventDefault());
    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openLinkBar(); }
    });
    // Ctrl+Enter saves from anywhere in the editor popover.
    pop.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveDescription(); }
    });
    editor.addEventListener('click', (e) => {
      // Ctrl/Cmd+click opens a link while editing.
      const a = e.target.closest('a');
      if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank', 'noopener');
    });

    const linkBar = pop.querySelector('.cde-linkbar');
    const linkInput = pop.querySelector('.cde-link-input');
    const columnsBox = pop.querySelector('.cde-columns');
    function closeBars() { linkBar.classList.add('hidden'); columnsBox.classList.add('hidden'); positionChartInfo(); }
    function openLinkBar() {
      saveRange();
      columnsBox.classList.add('hidden');
      const sel = window.getSelection();
      const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      const existing = node && editor.contains(node) ? node.closest('a') : null;
      linkInput.value = existing ? existing.getAttribute('href') : '';
      pop.querySelector('.cde-link-remove').classList.toggle('hidden', !existing);
      linkBar.classList.remove('hidden');
      positionChartInfo();
      linkInput.focus();
    }
    function applyLink() {
      let url = linkInput.value.trim();
      if (url && !/^(https?:|mailto:)/i.test(url)) url = (url.includes('@') && !url.includes('/') ? 'mailto:' : 'https://') + url;
      restoreRange();
      const sel = window.getSelection();
      if (url) {
        if (sel.isCollapsed) {
          const a = document.createElement('a');
          a.href = url;
          a.textContent = url;
          insertNodeAtCaret(a, true);
        } else {
          document.execCommand('createLink', false, url);
        }
      }
      markDirty();
      closeBars();
      editor.focus();
    }
    linkInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBars(); restoreRange(); }
    });
    pop.querySelector('.cde-link-ok').addEventListener('click', applyLink);
    pop.querySelector('.cde-link-remove').addEventListener('click', () => {
      restoreRange();
      const sel = window.getSelection();
      const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      const a = node && node.closest('a');
      if (a) { const range = document.createRange(); range.selectNodeContents(a); sel.removeAllRanges(); sel.addRange(range); }
      document.execCommand('unlink');
      markDirty();
      closeBars();
    });

    const colSearch = pop.querySelector('.cde-col-search');
    const colList = pop.querySelector('.cde-col-list');
    function renderColumnList() {
      const q = colSearch.value.trim().toLowerCase();
      const cols = (state.columns || []).map(c => c.name)
        .filter(name => !q || name.toLowerCase().includes(q) || displayName(name).toLowerCase().includes(q));
      colList.innerHTML = cols.length
        ? cols.map((name, i) => `<button type="button" class="cde-col${i === 0 ? ' sel' : ''}" data-col="${esc(name)}" role="option"><span>${esc(displayName(name))}</span>${displayName(name) !== name ? `<small>${esc(name)}</small>` : ''}</button>`).join('')
        : `<p class="cip-muted">${esc(t('editor_column_none'))}</p>`;
      colList.querySelectorAll('.cde-col').forEach(b => b.addEventListener('mousedown', (e) => { e.preventDefault(); insertColumn(b.dataset.col); }));
    }
    function insertColumn(name) {
      const chip = document.createElement('span');
      chip.className = 'col-ref';
      chip.dataset.col = name;
      chip.contentEditable = 'false';
      chip.textContent = displayName(name);
      chip.title = name;
      insertNodeAtCaret(chip, true);
      markDirty();
      closeBars();
      editor.focus();
    }
    colSearch.addEventListener('input', renderColumnList);
    colSearch.addEventListener('keydown', (e) => {
      const items = [...colList.querySelectorAll('.cde-col')];
      const cur = items.findIndex(b => b.classList.contains('sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        const next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((b, i) => b.classList.toggle('sel', i === next));
        items[next].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[cur]) insertColumn(items[cur].dataset.col);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); closeBars(); restoreRange();
      }
    });

    pop.querySelectorAll('.cde-tool').forEach(btn => {
      // Keep the editor selection when a toolbar button is pressed.
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        if (cmd === 'link') { openLinkBar(); return; }
        if (cmd === 'column') {
          saveRange();
          linkBar.classList.add('hidden');
          const open = columnsBox.classList.toggle('hidden') === false;
          if (open) { colSearch.value = ''; renderColumnList(); colSearch.focus(); }
          positionChartInfo();
          return;
        }
        editor.focus();
        if (cmd === 'mark') {
          const sel = window.getSelection();
          const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
          const mark = node && editor.contains(node) ? node.closest('mark') : null;
          if (mark) {
            mark.replaceWith(...mark.childNodes);
          } else if (!sel.isCollapsed && editor.contains(sel.anchorNode)) {
            const range = sel.getRangeAt(0);
            const wrapper = document.createElement('mark');
            wrapper.appendChild(range.extractContents());
            range.insertNode(wrapper);
            sel.removeAllRanges();
            const r = document.createRange();
            r.selectNodeContents(wrapper);
            sel.addRange(r);
          }
        } else {
          document.execCommand(cmd, false, null);
        }
        markDirty();
        updateToolState();
      });
    });
    pop.querySelector('.cde-caption').addEventListener('change', markDirty);
    pop.querySelector('.cde-cancel').addEventListener('click', cancelChartDescriptionEdit);
    pop.querySelector('.cde-save').addEventListener('click', saveDescription);

    async function saveDescription() {
      const clone = editor.cloneNode(true);
      clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
      const root = sanitizeDescriptionHtml(clone.innerHTML);
      // Tidy what the browser produced: lists out of paragraphs, no empty paragraphs.
      root.querySelectorAll('p, div').forEach(block => {
        if (block.querySelector('ul, ol, p, div')) block.replaceWith(...block.childNodes);
      });
      root.querySelectorAll('p, div, li').forEach(block => {
        if (!block.textContent.replace(/\u00a0/g, ' ').trim() && !block.querySelector('span.col-ref')) block.remove();
      });
      root.querySelectorAll('ul, ol').forEach(list => { if (!list.children.length) list.remove(); });
      const html = root.innerHTML;
      const showCaption = pop.querySelector('.cde-caption').checked;
      const saveBtn = pop.querySelector('.cde-save');
      const errorEl = pop.querySelector('.cde-error');
      saveBtn.disabled = true;
      errorEl.classList.add('hidden');
      try {
        await saveChartDescription(idx, descriptionIsEmpty(html) ? '' : html, showCaption);
        chartInfo.dirty = false;
        renderChartInfoRead();
        if (chartInfo) chartInfo.button.focus();
      } catch (err) {
        errorEl.textContent = t('chart_description_save_error', { error: errorDetail(err) });
        errorEl.classList.remove('hidden');
        saveBtn.disabled = false;
        positionChartInfo();
      }
    }

    positionChartInfo();
    editor.focus();
    // Caret at the end of the existing text.
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function cancelChartDescriptionEdit() {
    if (!chartInfo) return;
    if (chartInfo.dirty) {
      const discard = await confirmDialog({
        title: t('chart_description_discard_title'),
        message: t('chart_description_discard_message'),
        confirmLabel: t('chart_description_discard_button'),
      });
      if (!discard || !chartInfo) return;
    }
    renderChartInfoRead();
  }

  async function saveChartDescription(idx, html, showCaption) {
    const dash = state.currentDashboard;
    const chart = dash.charts[idx];
    if (!chart) return;
    if (dash.id && chart.id) {
      const saved = await api('PUT', `/${dash.id}/charts/${chart.id}/description`, { description: html, show_caption: showCaption });
      Object.assign(chart, saved);
    } else {
      // Not saved yet: kept with the dashboard and stored on its next save.
      Object.assign(chart, {
        description: html,
        show_caption: showCaption,
        description_updated_by: currentUserEmail(),
        description_updated_at: new Date().toISOString(),
      });
    }
    updateChartCardDescription(idx);
  }

  // Refresh the title area of one chart card without redrawing the chart.
  function updateChartCardDescription(idx) {
    const card = document.querySelector(`#chart-list .chart-card[data-idx="${idx}"]`);
    const chart = state.currentDashboard.charts[idx];
    if (!card || !chart) return;
    const info = card.querySelector('.chart-info');
    if (info) info.classList.toggle('has-description', chartHasDescription(chart));
    let caption = card.querySelector('.chart-caption');
    const text = chart.show_caption ? descriptionCaption(chart.description) : '';
    if (text) {
      if (!caption) {
        caption = document.createElement('p');
        caption.className = 'chart-caption';
        card.querySelector('h4').after(caption);
      }
      caption.textContent = text;
      caption.title = text;
    } else if (caption) {
      caption.remove();
    }
  }

  async function removeChart(idx) {
    const dash = state.currentDashboard;
    const chart = (dash.charts || [])[idx];
    if (!chart) return;
    const confirmed = await confirmDialog({
      title: t('confirm_delete_chart_title'),
      message: t('confirm_delete_chart_message', { name: chart.title || t('confirm_untitled') }),
    });
    if (!confirmed) return;
    closeChartInfo();
    const expanded = expandedChartIndex();
    dash.charts.splice(idx, 1);
    // Keep the enlarged chart pointing at the same chart after the removal.
    if (expanded === idx) dash.expanded_chart = null;
    else if (expanded !== null && expanded > idx) dash.expanded_chart = expanded - 1;
    saveDashboard();
  }

  function ensureVisible(colName) {
    const dash = state.currentDashboard;
    if (!colName || dash.visible_columns.includes(colName)) return;
    dash.visible_columns.push(colName);
    const colInfo = state.columns.find(c => c.name === colName);
    // Only aggregate if the user is in pivot mode (has other aggregations).
    const hasOtherAggs = Object.values(dash.aggregations).some(Boolean);
    if (colInfo && colInfo.type === 'number' && !dash.aggregations[colName] && hasOtherAggs) {
      dash.aggregations[colName] = 'sum';
    }
  }

  function clearCharts() {
    Object.values(state.chartInstances).forEach(c => c.destroy());
    state.chartInstances = {};
    $('#chart-list').innerHTML = '';
  }

  function clearKpiCards() {
    state.kpiValues = {};
    const list = $('#kpi-list');
    if (list) list.innerHTML = '';
  }

  function renderCharts() {
    clearCharts();
    const list = $('#chart-list');
    list.innerHTML = '';
    updateChartsPerRowStyle();
    if (!state.currentDashboard || !state.currentDashboard.view_name) return;
    requestMissingChartData();
    const expanded = expandedChartIndex();
    if (expanded !== null) {
      list.classList.add('has-expanded');
    } else {
      list.classList.remove('has-expanded');
    }
    (state.currentDashboard.charts || []).forEach((chart, idx) => {
      if (expanded !== null && expanded !== idx) return;
      const card = document.createElement('div');
      card.className = 'chart-card' + (expanded === idx ? ' expanded' : '');
      card.dataset.idx = idx;
      const title = document.createElement('h4');
      const sizeButton = expanded === idx
        ? `<button id="close-expanded-chart" class="card-icon-btn" type="button" title="${esc(t('chart_collapse_title'))}" aria-label="${esc(t('chart_collapse_title'))}">${ICONS.collapse}</button>`
        : `<button data-idx="${idx}" class="card-icon-btn expand-chart" type="button" title="${esc(t('chart_expand_title'))}" aria-label="${esc(t('chart_expand_title'))}">${ICONS.expand}</button>`;
      const hasDescription = chartHasDescription(chart);
      const infoButton = `<button data-idx="${idx}" class="card-icon-btn chart-info${hasDescription ? ' has-description' : ''}" type="button" aria-haspopup="dialog" aria-expanded="false" title="${esc(t('chart_info_title'))}" aria-label="${esc(t('chart_info_title'))}">${ICONS.info}</button>`;
      title.innerHTML = `<span class="chart-title">${esc(chart.title)}</span>
        <span class="card-actions">${infoButton}${sizeButton}<button data-idx="${idx}" class="card-icon-btn danger remove-chart" type="button" title="${esc(t('chart_remove_title'))}" aria-label="${esc(t('chart_remove_title'))}">${ICONS.remove}</button></span>`;
      card.appendChild(title);
      const captionText = chart.show_caption ? descriptionCaption(chart.description) : '';
      if (captionText) {
        const caption = document.createElement('p');
        caption.className = 'chart-caption';
        caption.textContent = captionText;
        caption.title = captionText;
        card.appendChild(caption);
      }
      const chartArea = document.createElement('div');
      chartArea.className = 'chart-area';
      const canvas = document.createElement('canvas');
      canvas.id = 'chart-canvas-' + idx;
      chartArea.appendChild(canvas);
      card.appendChild(chartArea);
      const legendContainer = document.createElement('div');
      legendContainer.className = 'chart-legend';
      legendContainer.id = 'chart-legend-' + idx;
      card.appendChild(legendContainer);
      list.appendChild(card);

      const entry = state.chartCache.get(chartRequestKey(chart));
      if (!entry) {
        chartArea.appendChild(chartMessage(t('chart_loading')));
        return;
      }
      if (entry.error) {
        chartArea.appendChild(chartMessage(t('chart_load_error', { error: entry.error }), true));
        return;
      }
      if (entry.truncated) {
        const note = document.createElement('p');
        note.className = 'chart-note';
        note.textContent = t('chart_truncated_note', { count: entry.rows.length });
        card.appendChild(note);
      }
      // Server rows are already aggregated per X (and split) value; draw them with
      // neutral column names so every chart type reuses its existing drawing code.
      const drawable = serverChart(chart);
      const rows = entry.rows;
      if (chart.chart_type === 'gauge') {
        drawGauge(canvas, drawable, rows);
      } else if (chart.chart_type === 'funnel') {
        drawFunnel(canvas, drawable, rows);
      } else if (chart.chart_type === 'scatter') {
        drawScatter(canvas, drawable, legendContainer, rows);
      } else {
        drawChart(canvas, drawable, legendContainer, rows);
      }
    });

    list.querySelectorAll('.remove-chart').forEach(btn => {
      btn.addEventListener('click', () => removeChart(parseInt(btn.dataset.idx, 10)));
    });
    list.querySelectorAll('.expand-chart').forEach(btn => {
      btn.addEventListener('click', () => setExpandedChart(parseInt(btn.dataset.idx, 10)));
    });
    const closeBtn = $('#close-expanded-chart');
    if (closeBtn) closeBtn.addEventListener('click', () => setExpandedChart(null));
    list.querySelectorAll('.chart-info').forEach(btn => {
      btn.addEventListener('click', () => openChartInfo(parseInt(btn.dataset.idx, 10), btn));
    });
    // Charts are redrawn when data arrives; keep an open description attached
    // to the new card (an editor in progress must not be lost).
    if (chartInfo) {
      const btn = list.querySelector(`.chart-info[data-idx="${chartInfo.idx}"]`);
      if (btn) {
        chartInfo.button = btn;
        btn.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
        positionChartInfo();
      } else if (!chartInfo.editing) {
        closeChartInfo();
      }
    }
  }

  // ------------------------------------------------------------------
  // Server-side chart data
  // ------------------------------------------------------------------
  function chartSeries(chart) {
    if (chart.series && chart.series.length) return chart.series;
    return chart.y_column ? [{ y_column: chart.y_column, aggregation: chart.aggregation || 'sum', label: '' }] : [];
  }

  function chartRequestKey(chart) {
    const dash = state.currentDashboard;
    return JSON.stringify([
      dash.view_name,
      collectFilters(),
      dash.replace_null_with_empty !== false,
      chart.chart_type === 'scatter',
      chart.x_column,
      chart.split_by_column && chart.split_by_column !== chart.x_column ? chart.split_by_column : '',
      chartSeries(chart).map(s => [s.y_column, s.aggregation || 'sum']),
    ]);
  }

  function serverChart(chart) {
    // Map the chart onto the server row layout: x, split, s0, s1, ...
    const hasSplit = chart.split_by_column && chart.split_by_column !== chart.x_column;
    return {
      ...chart,
      x_column: 'x',
      split_by_column: hasSplit ? 'split' : '',
      series: chartSeries(chart).map((s, i) => ({
        ...s,
        y_column: 's' + i,
        aggregation: 'sum', // one row per group: re-aggregating with sum keeps the value
        label: s.label || displayName(s.y_column),
        _source_column: s.y_column,
        _source_aggregation: s.aggregation || 'sum',
      })),
    };
  }

  function chartMessage(text, isError) {
    const el = document.createElement('p');
    el.className = 'chart-message' + (isError ? ' error' : '');
    el.textContent = text;
    return el;
  }

  function requestMissingChartData() {
    const dash = state.currentDashboard;
    const generation = state.chartGeneration;
    const pending = [];
    const seen = new Set();
    (dash.charts || []).forEach(chart => {
      if (!chart.x_column || !chartSeries(chart).length) return;
      const key = chartRequestKey(chart);
      const entry = state.chartCache.get(key);
      const requestId = generation + '|' + key;
      if ((entry && entry.generation >= generation) || state.chartRequests.has(requestId) || seen.has(key)) return;
      seen.add(key);
      pending.push({ chart, key, requestId });
    });
    if (!pending.length) return;
    pending.forEach(p => state.chartRequests.add(p.requestId));
    const viewName = dash.view_name;
    api('POST', '/chart-data' + connectorQuery(), {
      view_name: viewName,
      filters: collectFilters(),
      replace_null_with_empty: dash.replace_null_with_empty !== false,
      charts: pending.map(p => ({
        chart_type: p.chart.chart_type,
        x_column: p.chart.x_column,
        split_by_column: p.chart.split_by_column || '',
        series: chartSeries(p.chart).map(s => ({ y_column: s.y_column, aggregation: s.aggregation || 'sum' })),
      })),
    }).then(res => {
      (res.charts || []).forEach((data, i) => {
        state.chartCache.set(pending[i].key, { ...data, rows: data.rows || [], generation });
      });
    }).catch(err => {
      pending.forEach(p => state.chartCache.set(p.key, { rows: [], error: err.message, generation }));
    }).finally(() => {
      pending.forEach(p => state.chartRequests.delete(p.requestId));
      // Redraw only if the user is still looking at the same view.
      if (state.currentDashboard && state.currentDashboard.view_name === viewName) renderCharts();
    });
  }

  function getChartRows(chart) {
    const dash = state.currentDashboard;
    const rawCols = state.data.columns || [];
    const rows = state.data.rows;
    if (!rows.length) return rows;
    const xCol = chart ? chart.x_column : (rawCols[0] || '');
    if (!xCol || !rawCols.includes(xCol)) return rows;
    const splitCol = chart ? chart.split_by_column : '';
    const measureCols = chart
      ? chart.series.map(s => s.y_column)
      : Object.keys(dash.aggregations).filter(c => dash.aggregations[c]);
    const seriesAggs = chart
      ? Object.fromEntries(chart.series.map(s => [s.y_column, s.aggregation]))
      : null;
    const dimCols = splitCol ? [xCol, splitCol] : [xCol];
    const groups = groupByKeys(rows, dimCols);
    return groups.map(g => buildSummaryRow(g.rows, [...dimCols, ...measureCols], dimCols, [], seriesAggs));
  }

  function drawChart(canvas, chart, legendContainer, rows) {
    if (typeof Chart === 'undefined') return;
    rows = rows || state.data.rows || [];
    const xCol = chart.x_column;
    const splitCol = chart.split_by_column;
    if (splitCol) {
      const seriesAggs = Object.fromEntries(chart.series.map(s => [s.y_column, s.aggregation]));
      rows = groupByKeys(rows, [xCol, splitCol]).map(g => buildSummaryRow(g.rows, [xCol, splitCol, ...chart.series.map(s => s.y_column)], [xCol, splitCol], [], seriesAggs));
    }
    const xValues = [...new Set(rows.map(r => r[xCol]))];
    const rawLabels = xValues.slice().sort((a, b) => {
      const na = parseFloat(a), nb = parseFloat(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    });
    const labels = rawLabels.map(v => String(v));
    const labelLookup = new Map();
    rawLabels.forEach((raw, i) => labelLookup.set(labels[i], raw));

    const dash = state.currentDashboard;
    const scheme = COLOR_SCHEMES[dash.color_scheme || 'default'] || DEFAULT_COLORS;
    const colors = [...scheme];

    function aggregate(relevant, yCol, aggregation) {
      const values = relevant.map(r => parseFloat(r[yCol]) || 0);
      switch (aggregation) {
        case 'count': return relevant.length;
        case 'avg': return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        case 'min': return values.length ? Math.min(...values) : 0;
        case 'max': return values.length ? Math.max(...values) : 0;
        case 'sum': default: return values.reduce((a, b) => a + b, 0);
      }
    }

    const type = chart.chart_type;
    const isHorizontal = type.includes('horizontal');
    const isStacked = type.includes('stacked') || type.includes('percent') || (type === 'bar' && splitCol);
    const isPercent = type.includes('percent');
    const isArea = type.includes('area');
    const isLine = type === 'line' || isArea;
    const baseType = type.startsWith('percent') || type.startsWith('stacked') || type.startsWith('grouped') || type.startsWith('horizontal')
      ? type.split('_').slice(-1)[0]
      : type;
    const chartJsType = isArea ? 'line' : (baseType === 'bar' || baseType === 'horizontal' ? 'bar' : baseType);

    let datasets = [];
    if (splitCol) {
      const splitValues = [...new Set(rows.map(r => r[splitCol]))].sort();
      datasets = chart.series.flatMap((s, si) =>
        splitValues.map((sv, vi) => {
          const data = labels.map(label => {
            const rawLabel = labelLookup.get(label);
            const relevant = rows.filter(r => r[xCol] === rawLabel && r[splitCol] === sv);
            return aggregate(relevant, s.y_column, s.aggregation);
          });
          const colorIndex = (si * splitValues.length + vi) % colors.length;
          return buildDataset(data, s, colorIndex, `${esc(s.label || s.y_column)} / ${esc(sv)}`, isHorizontal, isArea, isLine);
        })
      );
    } else {
      datasets = chart.series.map((s, i) => {
        const data = labels.map(label => {
          const rawLabel = labelLookup.get(label);
          const relevant = rows.filter(r => r[xCol] === rawLabel);
          return aggregate(relevant, s.y_column, s.aggregation);
        });
        const colorIndex = i % colors.length;
        const preferLine = s.render_as === 'line';
        return buildDataset(data, s, colorIndex, s.label || s.y_column, isHorizontal, isArea, isLine || preferLine);
      });
    }

    if (isPercent) {
      // 100 % stacked charts show each dataset's share of the category total.
      labels.forEach((_, li) => {
        const total = datasets.reduce((acc, ds) => acc + (Number(ds.data[li]) || 0), 0);
        datasets.forEach(ds => {
          ds.data[li] = total ? (Number(ds.data[li]) || 0) / total * 100 : 0;
        });
      });
    }

    const isPie = type === 'pie' || type === 'doughnut';
    if (isPie) {
      // One colour per slice; a single dataset colour made every slice identical.
      datasets.forEach(ds => {
        ds.backgroundColor = labels.map((_, li) => colors[li % colors.length]);
        ds.hoverBackgroundColor = labels.map((_, li) => colors[li % colors.length].replace('0.7', '0.9'));
        ds.borderColor = '#ffffff';
        ds.borderWidth = 2;
        ds.borderRadius = 0;
      });
    }

    const showGrid = parseBool(dash.show_grid, true);
    const indexAxis = isHorizontal ? 'y' : 'x';
    const gridOptions = { color: '#e5e7eb', drawBorder: false, tickLength: 8 };
    const scales = (type === 'pie' || type === 'doughnut') ? {} : {
      [indexAxis]: {
        stacked: isStacked,
        title: { display: !!chart.x_label, text: chart.x_label || '', font: { size: 13, weight: '600' } },
        grid: showGrid ? gridOptions : { display: false },
        ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 0 },
      },
      [isHorizontal ? 'x' : 'y']: {
        beginAtZero: true,
        stacked: isStacked,
        title: { display: !!chart.y_label, text: chart.y_label || '', font: { size: 13, weight: '600' } },
        grid: showGrid ? gridOptions : { display: false },
        ticks: { font: { size: 11 } },
        ...(isPercent ? { max: 100, ticks: { callback: v => v + '%' } } : {}),
      },
    };

    const config = {
      type: chartJsType,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis,
        layout: { padding: { top: 8, right: 16, bottom: 4, left: 8 } },
        plugins: {
          title: { display: false },
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(17,24,39,0.92)',
            titleFont: { size: 13 },
            bodyFont: { size: 13 },
            padding: 10,
            cornerRadius: 8,
            mode: 'nearest',
            intersect: false,
            callbacks: isPercent ? { label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed ? ctx.raw.toFixed(2) : ctx.raw}%` } : {},
          },
        },
        scales,
      },
    };
    const instance = new Chart(canvas, config);
    state.chartInstances[canvas.id] = instance;
    if (isPie) {
      renderSliceLegend(legendContainer, instance, labels, datasets[0] ? datasets[0].backgroundColor : []);
    } else {
      renderCustomLegend(legendContainer, instance, datasets);
    }
  }

  function buildDataset(data, series, colorIndex, label, isHorizontal, isArea, forceLine) {
    const dash = state.currentDashboard;
    const scheme = COLOR_SCHEMES[dash.color_scheme || 'default'] || DEFAULT_COLORS;
    const color = scheme[colorIndex % scheme.length];
    const isLine = forceLine || series.render_as === 'line';
    const base = {
      label,
      data,
      backgroundColor: isLine ? color.replace('0.7', '0.2') : color,
      borderColor: color.replace('0.7', '1'),
      borderWidth: 2,
      tension: 0.3,
      fill: isArea,
      borderRadius: isLine ? 0 : 4,
      barPercentage: 0.65,
      categoryPercentage: 0.8,
      pointRadius: isLine ? 4 : 0,
      pointHoverRadius: isLine ? 6 : 0,
    };
    if (isLine) {
      base.type = 'line';
    }
    if (isArea) {
      base.type = 'line';
      base.fill = true;
    }
    return base;
  }

  function drawScatter(canvas, chart, legendContainer, rows) {
    if (typeof Chart === 'undefined') return;
    rows = rows || state.data.rows || [];
    const xCol = chart.x_column;
    const dash = state.currentDashboard;
    const scheme = COLOR_SCHEMES[dash.color_scheme || 'default'] || DEFAULT_COLORS;
    const colors = [...scheme];
    const datasets = chart.series.map((s, i) => ({
      label: s.label || s.y_column,
      data: rows.map(r => ({ x: r[xCol], y: parseFloat(r[s.y_column]) || 0 })),
      backgroundColor: colors[i % colors.length],
      borderColor: colors[i % colors.length].replace('0.7', '1'),
      borderWidth: 2,
    }));
    const showGrid = parseBool(dash.show_grid, true);
    const config = {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: false },
          legend: { display: false },
          tooltip: { mode: 'nearest', intersect: false },
        },
        scales: {
          x: {
            type: 'category',
            title: { display: !!chart.x_label, text: chart.x_label || '' },
            grid: { display: showGrid },
          },
          y: {
            beginAtZero: true,
            title: { display: !!chart.y_label, text: chart.y_label || '' },
            grid: { display: showGrid },
          },
        },
      },
    };
    const instance = new Chart(canvas, config);
    state.chartInstances[canvas.id] = instance;
    renderCustomLegend(legendContainer, instance, datasets);
  }

  function renderCustomLegend(container, chart, datasets) {
    container.innerHTML = '';
    datasets.forEach((ds, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'legend-item';
      item.dataset.datasetIndex = String(i);
      // Lines and areas are drawn with their border colour; their fill is only a faint tint.
      const isLineSeries = ds.type === 'line';
      const color = !isLineSeries && typeof ds.backgroundColor === 'string' ? ds.backgroundColor : ds.borderColor;
      item.innerHTML = `<span class="legend-color" style="background:${esc(color)}"></span>
        <span class="legend-label">${esc(ds.label)}</span>`;
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.datasetIndex);
        chart.setDatasetVisibility(index, !chart.isDatasetVisible(index));
        chart.update();
        item.classList.toggle('hidden', !chart.isDatasetVisible(index));
      });
      container.appendChild(item);
    });
  }

  function renderSliceLegend(container, chart, labels, colors) {
    // Pie / doughnut: one legend item per slice, clicking toggles that slice.
    container.innerHTML = '';
    labels.forEach((label, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-color" style="background:${esc(colors[i] || '')}"></span>
        <span class="legend-label">${esc(label)}</span>`;
      item.addEventListener('click', () => {
        chart.toggleDataVisibility(i);
        chart.update();
        item.classList.toggle('hidden', !chart.getDataVisibility(i));
      });
      container.appendChild(item);
    });
  }

  function drawGauge(canvas, chart, rows) {
    rows = rows || state.data.rows || [];
    if (!rows.length) return;
    const dash = state.currentDashboard;
    const nf = dash.number_format || '#,##0.00';
    const scheme = COLOR_SCHEMES[dash.color_scheme || 'default'] || DEFAULT_COLORS;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 240, height: 160 };
    const width = Math.max(rect.width || 240, 120);
    const height = Math.max(Math.min(width * 0.55, rect.height || 200), 100);
    canvas.width = width;
    canvas.height = height;

    chart.series.forEach((s, si) => {
      const total = rows.reduce((acc, r) => acc + (parseFloat(r[s.y_column]) || 0), 0);
      const cx = width / 2;
      const cy = height * 0.85;
      const radius = Math.min(width, height) * 0.65;
      const startAngle = Math.PI;
      const max = Math.max(total * 1.2, 1);
      const endAngle = startAngle + (total / max) * Math.PI;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, 0);
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = Math.max(12, radius * 0.18);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = scheme[si % scheme.length].replace('0.7', '1');
      ctx.lineWidth = Math.max(12, radius * 0.18);
      ctx.stroke();

      ctx.fillStyle = '#111827';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      const isInt = isIntegerColumn(s._source_column || s.y_column);
      const label = s.label || s.y_column;
      ctx.fillText(formatNumber(total, nf, isInt), cx, cy - radius * 0.25);
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText(esc(label), cx, cy + 12);
    });
  }

  function drawFunnel(canvas, chart, rows) {
    rows = rows || state.data.rows || [];
    if (!rows.length) return;
    const xCol = chart.x_column;
    const s = chart.series[0];
    if (!s) return;
    const agg = s.aggregation || 'sum';
    const items = [...new Set(rows.map(r => r[xCol]))].map(label => {
      const relevant = rows.filter(r => r[xCol] === label);
      const nums = relevant.map(r => parseFloat(r[s.y_column]) || 0);
      let value = nums.reduce((a, b) => a + b, 0);
      if (agg === 'count') value = relevant.length;
      else if (agg === 'avg') value = nums.length ? value / nums.length : 0;
      else if (agg === 'min') value = nums.length ? Math.min(...nums) : 0;
      else if (agg === 'max') value = nums.length ? Math.max(...nums) : 0;
      return { label: String(label ?? ''), value };
    }).sort((a, b) => b.value - a.value); // a funnel narrows from the largest stage

    const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 300, height: 200 };
    const width = Math.max(rect.width || 300, 200);
    const rowHeight = Math.max(34, Math.min(50, ((rect.height || 200) - 20) / items.length));
    const height = items.length * rowHeight + 20;
    // Draw at device resolution so text and edges stay sharp on HiDPI screens.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dash = state.currentDashboard;
    const scheme = COLOR_SCHEMES[dash.color_scheme || 'default'] || DEFAULT_COLORS;
    const colors = [...scheme].map(c => c.replace('0.7', '1'));
    const nf = dash.number_format || '#,##0.00';
    const isInt = (s._source_aggregation || agg) === 'count' || isIntegerColumn(s._source_column || s.y_column);
    const textColor = getComputedStyle(canvas).color || '#111827';
    const font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    ctx.font = font;
    const labelWidth = Math.min(width * 0.35, Math.max(...items.map(it => ctx.measureText(it.label).width)) + 16);
    const barArea = width - labelWidth - 8;
    const max = Math.max(...items.map(it => it.value), 1);

    items.forEach((it, i) => {
      const h = rowHeight - 10;
      const y = i * rowHeight + 10;
      const w = Math.max(2, (it.value / max) * barArea);
      const x = labelWidth + (barArea - w) / 2;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x, y, w, h);

      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = textColor;
      ctx.textAlign = 'right';
      ctx.fillText(it.label, labelWidth - 10, y + h / 2);

      const valueText = formatNumber(it.value, nf, isInt);
      const valueWidth = ctx.measureText(valueText).width;
      ctx.textAlign = 'center';
      if (valueWidth + 12 <= w) {
        // Dark text on light (pastel) bars, white text on dark bars.
        ctx.fillStyle = isLightColor(colors[i % colors.length]) ? '#1f2937' : '#ffffff';
        ctx.fillText(valueText, x + w / 2, y + h / 2);
      } else {
        ctx.textAlign = 'left';
        ctx.fillStyle = textColor;
        ctx.fillText(valueText, x + w + 6, y + h / 2);
      }
    });
  }

  function isLightColor(color) {
    const m = String(color).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return false;
    const [r, g, b] = m.slice(1, 4).map(Number);
    // Relative luminance (sRGB approximation); above 0.6 reads as a light background.
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
  }

  // Fixed formats with thousands separated by a space and a decimal comma
  // (1 000 000,00), the same in every browser language. The separator is a
  // non-breaking space, which Czech Excel also reads as a thousands separator.
  const SPACE_COMMA_FORMATS = { '# ##0,00': 2, '# ##0': 0 };

  function formatSpaceComma(num, decimals) {
    const fixed = Math.abs(num).toFixed(decimals);
    const [intPart, fraction] = fixed.split('.');
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
    const sign = num < 0 && Number(fixed) !== 0 ? '-' : '';
    return sign + grouped + (fraction ? ',' + fraction : '');
  }

  function formatNumber(value, format, isInteger = false) {
    if (value === null || value === undefined || isNaN(value)) return value;
    const floatVal = parseFloat(value);
    if (isNaN(floatVal)) return value;
    if (format in SPACE_COMMA_FORMATS) return formatSpaceComma(floatVal, isInteger ? 0 : SPACE_COMMA_FORMATS[format]);
    if (format === '#,##0' || isInteger) return Math.round(floatVal).toLocaleString();
    if (format === '#,##0.00') return floatVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (format === '#,##0.0000') return floatVal.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    if (format === '0%') return (floatVal * 100).toFixed(0) + '%';
    if (format === '0.00%') return (floatVal * 100).toFixed(2) + '%';
    return isInteger ? Math.round(floatVal).toLocaleString() : floatVal.toLocaleString();
  }

  function isIntegerColumn(col) {
    const colInfo = state.columns.find(c => c.name === col);
    return !!(colInfo && colInfo.is_integer);
  }

  function valueOr(sel, defaultValue) {
    const el = $(sel);
    return el && el.value ? el.value : defaultValue;
  }

  function formatTableValue(value, col) {
    const dash = state.currentDashboard;
    const nf = dash.number_format || '#,##0.00';
    if (value === null || value === undefined) return null;
    const colInfo = state.columns.find(c => c.name === col);
    if (colInfo && colInfo.type === 'number') {
      return formatNumber(value, nf, isIntegerColumn(col));
    }
    if (colInfo && colInfo.type === 'date') {
      return formatDateTime(value, dash.date_time_format || 'dd.MM.yyyy HH:mm');
    }
    return value;
  }

  function formatDateTime(value, pattern) {
    if (!value) return value;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return value;
    }
    let d = value instanceof Date ? value : null;
    let strValue = value;
    if (typeof value === 'string') {
      // SQL Server datetime strings like "2026-07-27 13:23:05.123000".
      // Trim trailing zeros after the decimal point and parse as ISO-like.
      const normalized = value.replace(/(\d{2}):(\d{2}):(\d{2})\.(\d+)/, (_, h, m, s, ms) => {
        return `${h}:${m}:${s}.${ms.slice(0, 3)}`;
      });
      d = new Date(normalized.replace(' ', 'T'));
      strValue = normalized;
    }
    if (!d || Number.isNaN(d.getTime())) {
      // Fallback: try to format the raw SQL string directly without parsing.
      if (typeof strValue === 'string') {
        const m = strValue.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
        if (m) {
          const pad2 = (n) => String(n).padStart(2, '0');
          const map = {
            yyyy: m[1], MM: m[2], dd: m[3], HH: m[4], mm: m[5], ss: m[6],
          };
          return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, key => map[key]);
        }
      }
      return value;
    }
    const pad2 = (n) => String(n).padStart(2, '0');
    const map = {
      yyyy: d.getFullYear(),
      MM: pad2(d.getMonth() + 1),
      dd: pad2(d.getDate()),
      HH: pad2(d.getHours()),
      mm: pad2(d.getMinutes()),
      ss: pad2(d.getSeconds()),
    };
    return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, m => map[m]);
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), ms);
    };
  }

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // Used by dashboard-sharing.js.
  window.DashboardApp = {
    api,
    esc,
    currentDashboard: () => state.currentDashboard,
    // List entry of a dashboard (it says whether it is a copy shared by someone).
    dashboardSummary: (id) => (state.dashboards || []).find(d => d.id === id) || null,
    openDashboard: (id) => openDashboard(id),
    reloadDashboards: () => loadDashboards(),
  };

  init();
})();
