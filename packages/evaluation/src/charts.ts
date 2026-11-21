/**
 * Static SVG charts for reports, generated from measured values only. No library; every chart
 * carries a title, axis labels and a text alternative, and works in light and dark viewers.
 */

const PALETTE = ['#3d6fb6', '#1f7a5a', '#c9a227', '#6b4fa3', '#c2571a', '#7a8699', '#b00020', '#444444'];
const esc = (s: string) => s.replace(/[<&>"]/g, (c) => `&#${String(c.charCodeAt(0))};`);

function frame(width: number, height: number, title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}" width="${String(width)}" height="${String(height)}" role="img" aria-label="${esc(title)}" font-family="system-ui, sans-serif" font-size="12">
<style>text{fill:#333}.grid{stroke:#ccc;stroke-width:1}@media (prefers-color-scheme: dark){text{fill:#ddd}.grid{stroke:#555}}</style>
<title>${esc(title)}</title>
<text x="8" y="18" font-size="14" font-weight="600">${esc(title)}</text>
${body}
</svg>
`;
}

export interface StackedRow {
  label: string;
  segments: { name: string; value: number }[];
}

/** Horizontal 100 % stacked bars (e.g. verdict mix per configuration). Counts are printed in each segment. */
export function stackedBars(title: string, rows: StackedRow[], legend: string[], colours: Record<string, string> = {}): string {
  const left = 230;
  const width = 820;
  const barWidth = width - left - 20;
  const rowHeight = 26;
  const top = 50;
  const colour = (name: string) => colours[name] ?? PALETTE[legend.indexOf(name) % PALETTE.length] ?? '#888';
  // Legend entries spaced by their label length (about 7 px per character at 12 px).
  let cursor = 8;
  const entries: string[] = [];
  for (const name of legend) {
    entries.push(`<rect x="${String(cursor)}" y="28" width="10" height="10" fill="${colour(name)}"/><text x="${String(cursor + 14)}" y="37">${esc(name)}</text>`);
    cursor += 28 + name.length * 7;
  }
  let body = entries.join('');
  rows.forEach((row, r) => {
    const y = top + r * rowHeight;
    const total = row.segments.reduce((s, x) => s + x.value, 0);
    body += `<text x="8" y="${String(y + 14)}">${esc(row.label)}</text>`;
    let x = left;
    for (const segment of row.segments) {
      if (!segment.value || !total) continue;
      const w = (segment.value / total) * barWidth;
      body += `<rect x="${x.toFixed(1)}" y="${String(y)}" width="${w.toFixed(1)}" height="18" fill="${colour(segment.name)}"><title>${esc(`${row.label}: ${segment.name} ${String(segment.value)}`)}</title></rect>`;
      if (w > 18) body += `<text x="${(x + w / 2).toFixed(1)}" y="${String(y + 13)}" text-anchor="middle" style="fill:#fff">${String(segment.value)}</text>`;
      x += w;
    }
  });
  return frame(Math.max(width, cursor + 8), top + rows.length * rowHeight + 10, title, body);
}

export interface Series {
  name: string;
  points: { x: number; y: number }[];
}

/** Line chart with points (e.g. correct proposals versus distractor count). Y is a share in [0, 1]. */
export function lineChart(title: string, xLabel: string, yLabel: string, series: Series[]): string {
  const width = 640;
  const height = 340;
  const left = 60;
  const right = 170;
  const top = 40;
  const bottom = 50;
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const xPos = (x: number) => left + (xs.length > 1 ? (xs.indexOf(x) / (xs.length - 1)) * plotW : plotW / 2);
  const yPos = (y: number) => top + (1 - y) * plotH;
  let body = '';
  for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
    body += `\n<line class="grid" x1="${String(left)}" x2="${String(left + plotW)}" y1="${yPos(tick).toFixed(1)}" y2="${yPos(tick).toFixed(1)}"/><text x="${String(left - 6)}" y="${(yPos(tick) + 4).toFixed(1)}" text-anchor="end">${String(Math.round(tick * 100))} %</text>`;
  }
  for (const x of xs) body += `\n<text x="${xPos(x).toFixed(1)}" y="${String(top + plotH + 18)}" text-anchor="middle">${String(x)}</text>`;
  body += `\n<text x="${String(left + plotW / 2)}" y="${String(height - 10)}" text-anchor="middle">${esc(xLabel)}</text>`;
  body += `\n<text transform="translate(14 ${String(top + plotH / 2)}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  series.forEach((s, i) => {
    const colour = PALETTE[i % PALETTE.length] ?? '#888';
    const points = [...s.points].sort((a, b) => a.x - b.x);
    body += `\n<polyline fill="none" stroke="${colour}" stroke-width="2" points="${points.map((p) => `${xPos(p.x).toFixed(1)},${yPos(p.y).toFixed(1)}`).join(' ')}"/>`;
    for (const p of points) body += `<circle cx="${xPos(p.x).toFixed(1)}" cy="${yPos(p.y).toFixed(1)}" r="3.5" fill="${colour}"><title>${esc(`${s.name}, ${String(p.x)}: ${String(Math.round(p.y * 100))} %`)}</title></circle>`;
    body += `\n<rect x="${String(width - right + 12)}" y="${String(top + i * 20)}" width="10" height="10" fill="${colour}"/><text x="${String(width - right + 26)}" y="${String(top + 9 + i * 20)}">${esc(s.name)}</text>`;
  });
  return frame(width, height, title, body);
}

export interface BarItem {
  label: string;
  value: number;
  note?: string;
}

/** Horizontal bars with the measured value printed (e.g. median replay time by settle window). */
export function barChart(title: string, unit: string, items: BarItem[]): string {
  const left = 230;
  const barMax = 360;
  const longestText = Math.max(...items.map((i) => (i.note?.length ?? 0) + unit.length + 14), 0);
  const width = left + barMax + 12 + longestText * 7;
  const max = Math.max(...items.map((i) => i.value), 1);
  let body = '';
  items.forEach((item, i) => {
    const y = 40 + i * 30;
    const w = (item.value / max) * barMax;
    body += `\n<text x="8" y="${String(y + 14)}">${esc(item.label)}</text><rect x="${String(left)}" y="${String(y)}" width="${w.toFixed(1)}" height="20" fill="${PALETTE[0] ?? '#3d6fb6'}"/>`;
    body += `<text x="${(left + w + 6).toFixed(1)}" y="${String(y + 14)}">${esc(`${Math.round(item.value).toLocaleString('en-US')} ${unit}${item.note ? ` · ${item.note}` : ''}`)}</text>`;
  });
  return frame(width, 50 + items.length * 30, title, body);
}
