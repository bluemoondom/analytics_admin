# Vendored front-end libraries

Served from `/static/vendor/` so the app works without internet access and the
Content Security Policy only needs `'self'` for scripts.

| File | Library | Version | License | Source |
|------|---------|---------|---------|--------|
| `chart.umd.min.js` | Chart.js | 4.4.3 | MIT | npm `chart.js@4.4.3`, `dist/chart.umd.js` |
| `jspdf.umd.min.js` | jsPDF | 2.5.1 | MIT | npm `jspdf@2.5.1`, `dist/jspdf.umd.min.js` |

To upgrade, download the new version from npm (`npm pack chart.js@<version>`),
replace the file and update this table.
