# Sprint 4 evaluation results

The full analysis is the [research report](../research/sprint-4-report.md). Generated
outputs, all from stored results:
- [`s4-final-report.md`](../research/s4-final-report.md): main run, 10 configurations, 542 attempts;
- [`s4f-rot-report.md`](../research/s4f-rot-report.md): context-rot study, 160 attempts;
- [`dashboard.html`](../research/dashboard.html): offline dashboard;
- [`numbers.json`](../research/numbers.json) and the raw JSONL in [`data/`](../research/data/).

Summary (cold attempts, dataset 1.1.0):

| Configuration | Completed | Autonomous | Wrong actions | Model calls | Median inference |
| --- | --- | --- | --- | --- | --- |
| deterministic | 43 % (19/44) | 43 % | 0 | 0 | – |
| semantic | 52 % | 50 % | 0 | 0 | – |
| qwen2.5:3b (×3) | 95 % | 57 % | 0 | 69 | 1.2 s |
| qwen2.5:7b | 95 % | 57 % | 0 | 34 | 2.1 s |
| llama3.2:3b | 52 % | 50 % | 0 | 23 | 1.3 s |
| qwen2.5:3b with memory | 95 % | 61 % | 0 | 20 | 1.3 s |

Regenerate:

```bash
npm run eval:report -- s4-final
npm run eval:figures -- --main s4-final --rot s4f-rot --settle 0=s4f-settle0,1500=s4f-settle1500,3000=s4f-settle3000 --out docs/research
```

(`s4f-settle3000` is the dynamic and semantic subset of `s4-final`, first repetition, deterministic and
qwen2.5:3b.) Runs named `s4`, `s4-rot` and `s4-settle*` in older notes predate the review fixes and are
not used.
