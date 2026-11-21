/* global document, Node */
/* FlowPilot evaluation dashboard (client). Plain JavaScript, no dependencies, works offline.
 * Shows only what was measured: counts and medians are computed from the stored attempts; a
 * value that was not collected is shown as "not measured", never estimated. */
(function dashboard(doc) {
  'use strict';
  const data = JSON.parse(doc.getElementById('data').textContent);
  const VERDICTS = [
    ['deterministic_success', 'Deterministic', 'v-det'],
    ['autonomous_recovery', 'Autonomous recovery', 'v-auto'],
    ['confirmed_recovery', 'After confirmation', 'v-conf'],
    ['correct_refusal', 'Correct refusal', 'v-ref'],
    ['unresolved', 'Unresolved', 'v-unres'],
    ['incorrect_action', 'Incorrect action', 'v-inc'],
    ['unsafe_action', 'Unsafe action', 'v-unsafe'],
    ['timeout', 'Timeout', 'v-time'],
  ];
  const FILTERS = [
    ['runId', 'Run'],
    ['configId', 'Configuration'],
    ['mode', 'Mode'],
    ['model', 'Model'],
    ['promptVersion', 'Prompt'],
    ['contextStrategy', 'Context'],
    ['category', 'Category'],
    ['scenarioId', 'Scenario'],
    ['verdict', 'Verdict'],
    ['phase', 'Phase'],
  ];
  const state = {};

  const el = (tag, attrs, ...children) => {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const child of children.flat()) node.append(child instanceof Node ? child : doc.createTextNode(String(child)));
    return node;
  };
  const svg = (tag, attrs) => {
    const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const value = (a, key) => (a[key] === null || a[key] === undefined ? '–' : String(a[key]));
  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const fmtMs = (x) => (x === null ? 'not measured' : `${Math.round(x).toLocaleString('en-US')} ms`);

  function filtered() {
    return data.attempts.filter((a) => FILTERS.every(([key]) => !state[key] || value(a, key) === state[key]));
  }

  function filterBar() {
    const bar = el('form', { class: 'filters', 'aria-label': 'Filters' });
    for (const [key, label] of FILTERS) {
      const options = [...new Set(data.attempts.map((a) => value(a, key)))].sort();
      const select = el(
        'select',
        { id: `f-${key}`, onchange: (e) => { state[key] = e.target.value; render(); } },
        el('option', { value: '' }, 'All'),
        options.map((o) => el('option', { value: o }, o)),
      );
      bar.append(el('label', { for: `f-${key}` }, label, select));
    }
    return bar;
  }

  function verdictBar(list) {
    const width = 360;
    const chart = svg('svg', { viewBox: `0 0 ${width} 18`, width: '100%', height: 18, role: 'img', 'aria-label': 'Verdicts' });
    let x = 0;
    for (const [verdict, label, cls] of VERDICTS) {
      const n = list.filter((a) => a.verdict === verdict).length;
      if (!n) continue;
      const w = (n / list.length) * width;
      const rect = svg('rect', { x, y: 0, width: w, height: 18, class: cls });
      const title = svg('title', {});
      title.textContent = `${label}: ${n}`;
      rect.append(title);
      chart.append(rect);
      x += w;
    }
    return chart;
  }

  function summaryCards(list) {
    const configs = [...new Set(list.map((a) => a.configId))];
    if (!configs.length) return el('p', { class: 'empty' }, 'No attempt matches these filters.');
    return el(
      'div',
      { class: 'cards' },
      configs.map((config) => {
        const rows = list.filter((a) => a.configId === config);
        const count = (v) => rows.filter((a) => a.verdict === v).length;
        const wrong = count('incorrect_action') + count('unsafe_action');
        const calls = rows.filter((a) => a.modelCalls > 0);
        return el(
          'section',
          { class: 'card', 'aria-label': config },
          el('h3', {}, config),
          verdictBar(rows),
          el(
            'dl',
            {},
            el('dt', {}, 'Attempts'), el('dd', {}, rows.length),
            el('dt', {}, 'Autonomous / after confirmation'), el('dd', {}, `${count('deterministic_success') + count('autonomous_recovery')} / ${count('confirmed_recovery')}`),
            el('dt', {}, 'Correct refusals'), el('dd', {}, count('correct_refusal')),
            el('dt', {}, 'Unresolved / timeouts'), el('dd', {}, `${count('unresolved')} / ${count('timeout')}`),
            el('dt', {}, 'Wrong actions'), el('dd', { class: wrong ? 'bad' : '' }, wrong),
            el('dt', {}, 'Model calls / tokens'), el('dd', {}, `${rows.reduce((s, a) => s + a.modelCalls, 0)} / ${rows.reduce((s, a) => s + a.inputTokens + a.outputTokens, 0).toLocaleString('en-US')}`),
            el('dt', {}, 'Median inference latency'), el('dd', {}, fmtMs(median(calls.map((a) => a.serviceMs)))),
            el('dt', {}, 'Median replay time'), el('dd', {}, fmtMs(median(rows.map((a) => a.runMs)))),
            el('dt', {}, 'Memory reuses'), el('dd', {}, rows.filter((a) => a.memoryReused).length),
            el('dt', {}, 'Cost (USD)'), el('dd', {}, rows.reduce((s, a) => s + a.costUsd, 0).toFixed(4)),
          ),
        );
      }),
    );
  }

  function latencyChart(list) {
    const configs = [...new Set(list.filter((a) => a.modelCalls > 0).map((a) => a.configId))];
    if (!configs.length) return el('p', { class: 'empty' }, 'No model call in this selection: inference latency not measured.');
    const values = list.filter((a) => a.modelCalls > 0).map((a) => a.serviceMs);
    const max = Math.max(...values, 1);
    const rowHeight = 28;
    const left = 200;
    const width = 760;
    const chart = svg('svg', { viewBox: `0 0 ${width} ${configs.length * rowHeight + 24}`, width: '100%', role: 'img', 'aria-label': 'Inference latency per configuration' });
    configs.forEach((config, i) => {
      const y = i * rowHeight + 14;
      const label = svg('text', { x: 0, y: y + 4, class: 'axis' });
      label.textContent = config;
      chart.append(label);
      for (const a of list.filter((x) => x.configId === config && x.modelCalls > 0)) {
        const dot = svg('circle', { cx: left + ((width - left - 10) * a.serviceMs) / max, cy: y, r: 4, class: `dot ${a.verdict}` });
        const title = svg('title', {});
        title.textContent = `${a.scenarioId}: ${a.serviceMs} ms (${a.verdict})`;
        dot.append(title);
        chart.append(dot);
      }
    });
    const axis = svg('text', { x: width - 10, y: configs.length * rowHeight + 20, 'text-anchor': 'end', class: 'axis' });
    axis.textContent = `0 – ${Math.round(max).toLocaleString('en-US')} ms`;
    chart.append(axis);
    return chart;
  }

  function attemptsTable(list) {
    const details = el('section', { class: 'details', 'aria-live': 'polite' }, el('p', { class: 'empty' }, 'Select an attempt to inspect the recovery decision.'));
    const body = el('tbody', {});
    list.forEach((a, i) => {
      const row = el(
        'tr',
        { tabindex: '0', class: a.verdict, onclick: () => showDetails(a, details), onkeydown: (e) => { if (e.key === 'Enter') showDetails(a, details); } },
        el('td', {}, a.scenarioId), el('td', {}, a.configId), el('td', {}, a.phase), el('td', {}, a.repeat),
        el('td', {}, a.distractors === undefined ? '–' : a.distractors), el('td', {}, a.verdict),
        el('td', {}, a.strategies.join(', ') || '–'), el('td', {}, a.modelCalls), el('td', {}, a.inputTokens + a.outputTokens),
        el('td', {}, a.serviceMs), el('td', {}, a.runMs),
      );
      row.dataset.index = String(i);
      body.append(row);
    });
    const head = el('thead', {}, el('tr', {}, ['Scenario', 'Configuration', 'Phase', 'Rep.', 'Distr.', 'Verdict', 'Strategies', 'Calls', 'Tokens', 'Service ms', 'Replay ms'].map((h) => el('th', { scope: 'col' }, h))));
    return el('div', { class: 'attempts' }, el('div', { class: 'scroll' }, el('table', {}, head, body)), details);
  }

  function showDetails(a, target) {
    const pre = (x) => el('pre', {}, JSON.stringify(x, null, 2));
    target.replaceChildren(
      el('h3', {}, `${a.scenarioId} · ${a.configId}`),
      el('p', {}, `Verdict: ${a.verdict}. Expected: ${a.expected.outcome}${a.expected.target ? ` « ${a.expected.target} »` : ''}${a.expected.human === 'required' ? ', human required' : ''}.`),
      el('h4', {}, 'Proposals (as shown or executed)'),
      a.proposals.length ? el('ul', {}, a.proposals.map((p) => el('li', {}, p))) : el('p', {}, 'None.'),
      el('h4', {}, 'Observed by the runner'),
      pre(a.observed),
    );
  }

  function render() {
    const list = filtered();
    const root = doc.getElementById('app');
    root.replaceChildren(
      el('p', { class: 'meta' }, `${list.length} of ${data.attempts.length} attempts · generated ${data.generatedAt}`),
      el('h2', {}, 'Configurations'),
      summaryCards(list),
      el('h2', {}, 'Inference latency (service time, per attempt with model calls)'),
      latencyChart(list),
      el('h2', {}, 'Attempts'),
      attemptsTable(list),
    );
  }

  doc.getElementById('filters').replaceChildren(filterBar());
  render();
})(document);
