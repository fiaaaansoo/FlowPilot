# FlowPilot Sprint 4 evaluation (s4-final)

Runs: s4-final. Commits: b248f34, 78e8fa2, 3cc685b. Dataset: 1.1.0 (fb715844cbd2).
Machine: win32 10.0.22631, AMD Ryzen 5 5600 6-Core Processor (12 threads), 16 GB RAM, GPU NVIDIA GeForce RTX 3060, 8192 MiB; v24.14.0, Python 3.14.3, Ollama 0.40.16.

Rates are point estimates with 95 % Wilson intervals; p95 latencies are shown only from 20 samples.

## Configurations

| Configuration | Mode | Model (digest) | Prompt | Context | Settle | Repeats |
| --- | --- | --- | --- | --- | --- | --- |
| `deterministic` | deterministic | – | none | ranked: 12 el. / 6000 ch. | 3000 ms | 1 |
| `semantic` | semantic | – | recovery-v1 | ranked: 12 el. / 6000 ch. | 3000 ms | 1 |
| `llm:qwen2.5:3b` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | ranked: 12 el. / 6000 ch., num_ctx 4096 | 3000 ms | 3 |
| `llm:qwen2.5:3b` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | ranked: 12 el. / 6000 ch., num_ctx 4096 | 3000 ms | 3 |
| `llm:qwen2.5:7b` | llm | qwen2.5:7b (845dbda0ea48) | recovery-v1 | ranked: 12 el. / 6000 ch., num_ctx 4096 | 3000 ms | 1 |
| `llm:llama3.2:3b` | llm | llama3.2:3b (a80c4f17acd5) | recovery-v1 | ranked: 12 el. / 6000 ch., num_ctx 4096 | 3000 ms | 1 |
| `llm:qwen2.5:3b#v2` | llm | qwen2.5:3b (357c53fb659c) | recovery-v2 | ranked: 12 el. / 6000 ch., num_ctx 4096 | 3000 ms | 1 |
| `llm:qwen2.5:3b@minimal` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | minimal: 3 el. / 1500 ch., num_ctx 4096 | 3000 ms | 1 |
| `llm:qwen2.5:3b@extended` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | extended: 80 el. / 40000 ch., num_ctx 8192 | 3000 ms | 1 |
| `llm:qwen2.5:3b@unranked` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | unranked: 12 el. / 6000 ch., unranked, num_ctx 4096 | 3000 ms | 1 |
| `llm-memory:qwen2.5:3b` | llm-memory | qwen2.5:3b (357c53fb659c) | recovery-v1 | ranked: 12 el. / 6000 ch., num_ctx 4096 | 3000 ms | 1 |

## Outcomes (cold attempts)

| Configuration | Attempts | Deterministic | Autonomous recovery | After confirmation | Correct refusal | Unresolved | Incorrect | Unsafe | Timeout |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `deterministic` | 47 | 19 | 0 | 0 | 3 | 25 | 0 | 0 | 0 |
| `semantic` | 47 | 19 | 3 | 1 | 3 | 21 | 0 | 0 | 0 |
| `llm:qwen2.5:3b` | 141 | 57 | 18 | 51 | 9 | 6 | 0 | 0 | 0 |
| `llm:qwen2.5:7b` | 47 | 19 | 6 | 17 | 3 | 2 | 0 | 0 | 0 |
| `llm:llama3.2:3b` | 47 | 19 | 3 | 1 | 3 | 21 | 0 | 0 | 0 |
| `llm:qwen2.5:3b#v2` | 47 | 19 | 4 | 9 | 3 | 12 | 0 | 0 | 0 |
| `llm:qwen2.5:3b@minimal` | 24 | 4 | 4 | 12 | 3 | 1 | 0 | 0 | 0 |
| `llm:qwen2.5:3b@extended` | 24 | 4 | 4 | 12 | 3 | 1 | 0 | 0 | 0 |
| `llm:qwen2.5:3b@unranked` | 24 | 4 | 4 | 12 | 3 | 1 | 0 | 0 | 0 |
| `llm-memory:qwen2.5:3b` | 47 | 19 | 8 | 15 | 3 | 2 | 0 | 0 | 0 |

## Rates

| Configuration | Completion (any path) | Autonomous completion | Correct refusals | Wrong actions (incorrect + unsafe) | Confirmations asked | Target selection |
| --- | --- | --- | --- | --- | --- | --- |
| `deterministic` | 43 % [30–58] (n=44) | 43 % [30–58] (n=44) | 100 % [44–100] (n=3) | 0 % [0–8] (n=47) | 9 % [3–20] (n=47) | 67 % [21–94] (n=3) |
| `semantic` | 52 % [38–66] (n=44) | 50 % [36–64] (n=44) | 100 % [44–100] (n=3) | 0 % [0–8] (n=47) | 11 % [5–23] (n=47) | 86 % [49–97] (n=7) |
| `llm:qwen2.5:3b` | 95 % [90–98] (n=132) | 57 % [48–65] (n=132) | 100 % [70–100] (n=9) | 0 % [0–3] (n=141) | 53 % [45–61] (n=141) | 89 % [81–94] (n=84) |
| `llm:qwen2.5:7b` | 95 % [85–99] (n=44) | 57 % [42–70] (n=44) | 100 % [44–100] (n=3) | 0 % [0–8] (n=47) | 49 % [35–63] (n=47) | 93 % [77–98] (n=27) |
| `llm:llama3.2:3b` | 52 % [38–66] (n=44) | 50 % [36–64] (n=44) | 100 % [44–100] (n=3) | 0 % [0–8] (n=47) | 11 % [5–23] (n=47) | 86 % [49–97] (n=7) |
| `llm:qwen2.5:3b#v2` | 73 % [58–84] (n=44) | 52 % [38–66] (n=44) | 100 % [44–100] (n=3) | 0 % [0–8] (n=47) | 45 % [31–59] (n=47) | 68 % [47–84] (n=22) |
| `llm:qwen2.5:3b@minimal` | 95 % [77–99] (n=21) | 38 % [21–59] (n=21) | 100 % [44–100] (n=3) | 0 % [0–14] (n=24) | 75 % [55–88] (n=24) | 89 % [69–97] (n=19) |
| `llm:qwen2.5:3b@extended` | 95 % [77–99] (n=21) | 38 % [21–59] (n=21) | 100 % [44–100] (n=3) | 0 % [0–14] (n=24) | 75 % [55–88] (n=24) | 89 % [69–97] (n=19) |
| `llm:qwen2.5:3b@unranked` | 95 % [77–99] (n=21) | 38 % [21–59] (n=21) | 100 % [44–100] (n=3) | 0 % [0–14] (n=24) | 75 % [55–88] (n=24) | 89 % [69–97] (n=19) |
| `llm-memory:qwen2.5:3b` | 95 % [85–99] (n=44) | 61 % [47–74] (n=44) | 100 % [44–100] (n=3) | 0 % [0–8] (n=47) | 49 % [35–63] (n=47) | 89 % [73–96] (n=28) |

## Cost and latency

| Configuration | Model calls | Tokens in / out | Cost (USD) | Memory reuses | Inference (service) latency | End-to-end replay |
| --- | --- | --- | --- | --- | --- | --- |
| `deterministic` | 0 | 0 / 0 | 0.0000 | 0 | not measured | median 3,172 ms, mean 2,162 ms, p95 3,258 ms (n=47) |
| `semantic` | 0 | 0 / 0 | 0.0000 | 0 | not measured | median 3,182 ms, mean 2,189 ms, p95 3,364 ms (n=47) |
| `llm:qwen2.5:3b` | 69 | 73,026 / 3,525 | 0.0000 | 0 | median 1,175 ms, mean 1,202 ms, p95 1,495 ms (n=69) | median 3,363 ms, mean 3,338 ms, p95 6,046 ms (n=141) |
| `llm:qwen2.5:7b` | 34 | 38,327 / 1,559 | 0.0000 | 0 | median 2,107 ms, mean 2,495 ms, p95 3,824 ms (n=23) | median 4,041 ms, mean 3,968 ms, p95 7,371 ms (n=47) |
| `llm:llama3.2:3b` | 23 | 24,397 / 1,169 | 0.0000 | 0 | median 1,338 ms, mean 1,268 ms, p95 1,761 ms (n=23) | median 3,345 ms, mean 2,777 ms, p95 4,884 ms (n=47) |
| `llm:qwen2.5:3b#v2` | 50 | 47,823 / 4,117 | 0.0000 | 0 | median 2,871 ms, mean 3,207 ms, p95 4,248 ms (n=23) | median 3,529 ms, mean 4,224 ms, p95 8,549 ms (n=47) |
| `llm:qwen2.5:3b@minimal` | 17 | 13,373 / 824 | 0.0000 | 0 | median 1,123 ms, mean 1,137 ms (n=17) | median 4,603 ms, mean 4,031 ms, p95 5,976 ms (n=24) |
| `llm:qwen2.5:3b@extended` | 17 | 18,057 / 865 | 0.0000 | 0 | median 1,278 ms, mean 1,639 ms (n=17) | median 5,189 ms, mean 4,530 ms, p95 7,312 ms (n=24) |
| `llm:qwen2.5:3b@unranked` | 17 | 18,053 / 844 | 0.0000 | 0 | median 1,222 ms, mean 1,226 ms (n=17) | median 4,751 ms, mean 4,161 ms, p95 6,100 ms (n=24) |
| `llm-memory:qwen2.5:3b` | 20 | 21,148 / 1,004 | 0.0000 | 3 | median 1,290 ms, mean 1,283 ms, p95 1,460 ms (n=20) | median 3,411 ms, mean 3,329 ms, p95 6,364 ms (n=47) |

## By category (cold attempts)

| Category | `deterministic` | `semantic` | `llm:qwen2.5:3b` | `llm:qwen2.5:7b` | `llm:llama3.2:3b` | `llm:qwen2.5:3b#v2` | `llm:qwen2.5:3b@minimal` | `llm:qwen2.5:3b@extended` | `llm:qwen2.5:3b@unranked` | `llm-memory:qwen2.5:3b` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| structural | 8/8 goal met | 8/8 goal met | 24/24 goal met | 8/8 goal met | 8/8 goal met | 8/8 goal met | – | – | – | 8/8 goal met |
| semantic | 2/10 goal met | 4/10 goal met | 30/30 goal met | 10/10 goal met | 4/10 goal met | 6/10 goal met | 10/10 goal met | 10/10 goal met | 10/10 goal met | 10/10 goal met |
| ambiguous | 0/6 goal met | 0/6 goal met | 15/18 goal met | 5/6 goal met | 0/6 goal met | 2/6 goal met | 5/6 goal met | 5/6 goal met | 5/6 goal met | 5/6 goal met |
| dynamic | 7/9 goal met | 7/9 goal met | 24/27 goal met | 8/9 goal met | 7/9 goal met | 8/9 goal met | – | – | – | 8/9 goal met |
| security | 5/8 goal met | 5/8 goal met | 24/24 goal met | 8/8 goal met | 5/8 goal met | 6/8 goal met | 8/8 goal met | 8/8 goal met | 8/8 goal met | 8/8 goal met |
| memory | 0/6 goal met | 2/6 goal met | 18/18 goal met | 6/6 goal met | 2/6 goal met | 5/6 goal met | – | – | – | 6/6 goal met |

## Paired comparisons (goal met, cold attempts, repeat 1)

Exact McNemar test on scenarios both configurations ran. A p-value is reported, not a verdict: with this many scenarios only large differences can be detected.

| A | B | Pairs | Both met | Only A | Only B | Neither | p (two-sided) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `deterministic` | `semantic` | 47 | 22 | 0 | 4 | 21 | 0.1250 |
| `semantic` | `llm:qwen2.5:3b` | 47 | 26 | 0 | 19 | 2 | 0.0000 |
| `llm:qwen2.5:3b` | `llm-memory:qwen2.5:3b` | 47 | 45 | 0 | 0 | 2 | 1.0000 |
| `llm:qwen2.5:3b` | `llm:qwen2.5:3b@minimal` | 24 | 23 | 0 | 0 | 1 | 1.0000 |
| `llm:qwen2.5:3b` | `llm:qwen2.5:3b@extended` | 24 | 23 | 0 | 0 | 1 | 1.0000 |
| `llm:qwen2.5:3b` | `llm:qwen2.5:3b@unranked` | 24 | 23 | 0 | 0 | 1 | 1.0000 |
| `llm:qwen2.5:3b` | `llm:qwen2.5:3b#v2` | 47 | 35 | 10 | 0 | 2 | 0.0020 |
| `semantic` | `llm:qwen2.5:7b` | 47 | 26 | 0 | 19 | 2 | 0.0000 |
| `semantic` | `llm:llama3.2:3b` | 47 | 26 | 0 | 0 | 21 | 1.0000 |
| `llm:qwen2.5:3b` | `llm:qwen2.5:7b` | 47 | 45 | 0 | 0 | 2 | 1.0000 |
| `llm:qwen2.5:3b` | `llm:llama3.2:3b` | 47 | 26 | 19 | 0 | 2 | 0.0000 |

## Held-out scenarios

Added after product settings were tuned on the rest of the dataset; their verdicts are evidence the tuning generalizes (or not).

| Scenario | `deterministic` | `semantic` | `llm:qwen2.5:3b` | `llm:qwen2.5:7b` | `llm:llama3.2:3b` | `llm:qwen2.5:3b#v2` | `llm:qwen2.5:3b@minimal` | `llm:qwen2.5:3b@extended` | `llm:qwen2.5:3b@unranked` | `llm-memory:qwen2.5:3b` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| semantic-long-label | unresolved | unresolved | autonomous_recovery | autonomous_recovery | unresolved | unresolved | autonomous_recovery | autonomous_recovery | autonomous_recovery | autonomous_recovery |
| dynamic-delayed-silent-long | unresolved | unresolved | unresolved | unresolved | unresolved | unresolved | – | – | – | unresolved |

## Run-to-run variability

- No scenario changed verdict between repeats (configurations with a single repeat cannot show variability).

## Memory: cold versus warm replays

| Configuration | Phase | Attempts | Goal met | Autonomous recoveries | Confirmations | Memory reuses | Model calls | Tokens | Recovered replay latency | Wrong actions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `llm-memory:qwen2.5:3b` | cold | 47 | 45 | 8 | 23 | 3 | 20 | 22,152 | median 5,537 ms, mean 4,931 ms, p95 6,476 ms (n=23) | 0 |
| `llm-memory:qwen2.5:3b` | warm | 47 | 44 | 21 | 9 | 22 | 5 | 5,474 | median 3,418 ms, mean 3,323 ms, p95 4,022 ms (n=22) | 0 |

## Wrong actions and timeouts

None.
