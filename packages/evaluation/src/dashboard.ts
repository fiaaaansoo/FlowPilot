import { escapeMarkup } from './charts.js';
import type { DashboardData } from './report.js';

/**
 * Self-contained, offline HTML dashboard. `clientScript` is the content of
 * `dashboard-client.js` (passed in so this module stays free of file access).
 * The data is embedded as JSON with "<" escaped, so stored page labels cannot
 * close the script element.
 */
export function renderDashboard(data: DashboardData, clientScript: string): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const title = escapeMarkup(data.title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { --bg:#f6f7f9; --panel:#fff; --ink:#1b1f24; --muted:#5b6472; --line:#d8dde3;
  --det:#7a8699; --auto:#1f7a5a; --conf:#3d6fb6; --ref:#6b4fa3; --unres:#c9a227; --inc:#c2571a; --unsafe:#b00020; --time:#444; }
@media (prefers-color-scheme: dark) { :root { --bg:#14171b; --panel:#1d2126; --ink:#e7eaee; --muted:#9aa4b1; --line:#323840; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, sans-serif; }
header, main { max-width:1200px; margin:0 auto; padding:16px; }
h1 { font-size:1.4rem; margin:8px 0; } h2 { font-size:1.1rem; margin:24px 0 8px; } h3 { font-size:1rem; margin:0 0 8px; }
.filters { display:flex; flex-wrap:wrap; gap:8px 16px; }
.filters label { display:flex; flex-direction:column; font-size:.8rem; color:var(--muted); }
select { font:inherit; padding:4px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink); max-width:220px; }
.cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:12px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; }
dl { display:grid; grid-template-columns:1fr auto; gap:2px 12px; margin:8px 0 0; font-size:.9rem; }
dt { color:var(--muted); } dd { margin:0; text-align:right; font-variant-numeric:tabular-nums; } .bad { color:var(--unsafe); font-weight:700; }
.v-det { fill:var(--det); } .v-auto { fill:var(--auto); } .v-conf { fill:var(--conf); } .v-ref { fill:var(--ref); }
.v-unres { fill:var(--unres); } .v-inc { fill:var(--inc); } .v-unsafe { fill:var(--unsafe); } .v-time { fill:var(--time); }
.dot { fill:var(--conf); opacity:.8; } .dot.incorrect_action, .dot.unsafe_action { fill:var(--unsafe); } .dot.autonomous_recovery { fill:var(--auto); }
.axis { fill:var(--muted); font-size:12px; }
.attempts { display:grid; grid-template-columns:minmax(0, 2fr) minmax(0, 1fr); gap:12px; }
@media (max-width: 800px) { .attempts { grid-template-columns:1fr; } }
.scroll { overflow:auto; max-height:520px; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
table { border-collapse:collapse; width:100%; font-size:.85rem; }
th, td { padding:4px 8px; border-bottom:1px solid var(--line); text-align:left; white-space:nowrap; }
th { position:sticky; top:0; background:var(--panel); }
tr[tabindex]:hover, tr[tabindex]:focus { background:color-mix(in srgb, var(--conf) 12%, transparent); outline:none; cursor:pointer; }
tr.incorrect_action td, tr.unsafe_action td { color:var(--unsafe); }
.details { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; }
pre { white-space:pre-wrap; font-size:.8rem; } .meta, .empty { color:var(--muted); }
.legend { display:flex; flex-wrap:wrap; gap:4px 12px; font-size:.8rem; color:var(--muted); }
.legend span::before { content:''; display:inline-block; width:10px; height:10px; margin-right:4px; background:var(--c); }
</style>
</head>
<body>
<header>
<h1>${title}</h1>
<p class="meta">Measured results only: every number below is computed from stored benchmark attempts. Rates with confidence intervals are in the Markdown report.</p>
<div class="legend"><span style="--c:var(--det)">Deterministic</span><span style="--c:var(--auto)">Autonomous recovery</span><span style="--c:var(--conf)">After confirmation</span><span style="--c:var(--ref)">Correct refusal</span><span style="--c:var(--unres)">Unresolved</span><span style="--c:var(--inc)">Incorrect</span><span style="--c:var(--unsafe)">Unsafe</span><span style="--c:var(--time)">Timeout</span></div>
<div id="filters"></div>
</header>
<main id="app"></main>
<script type="application/json" id="data">${json}</script>
<script>${clientScript}</script>
</body>
</html>
`;
}
