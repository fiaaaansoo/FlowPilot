# FlowPilot context-rot study (s4f-rot)

Runs: s4f-rot. Commits: 78e8fa2. Dataset: 1.1.0 (fb715844cbd2).
Machine: win32 10.0.22631, AMD Ryzen 5 5600 6-Core Processor (12 threads), 16 GB RAM, GPU NVIDIA GeForce RTX 3060, 8192 MiB; v24.14.0, Python 3.14.3, Ollama 0.40.16.

Rates are point estimates with 95 % Wilson intervals; p95 latencies are shown only from 20 samples.

## Configurations

| Configuration | Mode | Model (digest) | Prompt | Context | Settle | Repeats |
| --- | --- | --- | --- | --- | --- | --- |
| `llm:qwen2.5:3b@minimal` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | minimal: 3 el. / 1500 ch., num_ctx 4096 | 3000 ms | 1 |
| `llm:qwen2.5:3b` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | ranked: 12 el. / 6000 ch., num_ctx 4096 | 3000 ms | 1 |
| `llm:qwen2.5:3b@extended` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | extended: 80 el. / 40000 ch., num_ctx 8192 | 3000 ms | 1 |
| `llm:qwen2.5:3b@unranked` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | unranked: 12 el. / 6000 ch., unranked, num_ctx 4096 | 3000 ms | 1 |
| `llm:qwen2.5:3b@minimal` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | minimal: 3 el. / 1500 ch., num_ctx 4096 | 3000 ms | 1 |
| `llm:qwen2.5:3b` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | ranked: 12 el. / 6000 ch., num_ctx 4096 | 3000 ms | 1 |
| `llm:qwen2.5:3b@extended` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | extended: 80 el. / 40000 ch., num_ctx 8192 | 3000 ms | 1 |
| `llm:qwen2.5:3b@unranked` | llm | qwen2.5:3b (357c53fb659c) | recovery-v1 | unranked: 12 el. / 6000 ch., unranked, num_ctx 4096 | 3000 ms | 1 |

## Outcomes (cold attempts)

| Configuration | Attempts | Deterministic | Autonomous recovery | After confirmation | Correct refusal | Unresolved | Incorrect | Unsafe | Timeout |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `llm:qwen2.5:3b@minimal` | 40 | 4 | 0 | 33 | 0 | 3 | 0 | 0 | 0 |
| `llm:qwen2.5:3b` | 40 | 4 | 0 | 36 | 0 | 0 | 0 | 0 | 0 |
| `llm:qwen2.5:3b@extended` | 40 | 4 | 0 | 35 | 0 | 1 | 0 | 0 | 0 |
| `llm:qwen2.5:3b@unranked` | 40 | 4 | 0 | 30 | 0 | 6 | 0 | 0 | 0 |

## Rates

| Configuration | Completion (any path) | Autonomous completion | Correct refusals | Wrong actions (incorrect + unsafe) | Confirmations asked | Target selection |
| --- | --- | --- | --- | --- | --- | --- |
| `llm:qwen2.5:3b@minimal` | 93 % [80–97] (n=40) | 10 % [4–23] (n=40) | n/a (n=0) | 0 % [0–9] (n=40) | 100 % [91–100] (n=40) | 83 % [68–91] (n=40) |
| `llm:qwen2.5:3b` | 100 % [91–100] (n=40) | 10 % [4–23] (n=40) | n/a (n=0) | 0 % [0–9] (n=40) | 100 % [91–100] (n=40) | 90 % [77–96] (n=40) |
| `llm:qwen2.5:3b@extended` | 98 % [87–100] (n=40) | 10 % [4–23] (n=40) | n/a (n=0) | 0 % [0–9] (n=40) | 100 % [91–100] (n=40) | 88 % [74–95] (n=40) |
| `llm:qwen2.5:3b@unranked` | 85 % [71–93] (n=40) | 10 % [4–23] (n=40) | n/a (n=0) | 0 % [0–9] (n=40) | 100 % [91–100] (n=40) | 75 % [60–86] (n=40) |

## Cost and latency

| Configuration | Model calls | Tokens in / out | Cost (USD) | Memory reuses | Inference (service) latency | End-to-end replay |
| --- | --- | --- | --- | --- | --- | --- |
| `llm:qwen2.5:3b@minimal` | 36 | 27,471 / 1,758 | 0.0000 | 0 | median 1,056 ms, mean 1,065 ms, p95 1,230 ms (n=36) | median 5,645 ms, mean 5,243 ms, p95 6,209 ms (n=40) |
| `llm:qwen2.5:3b` | 36 | 42,781 / 1,855 | 0.0000 | 0 | median 1,191 ms, mean 1,226 ms, p95 1,546 ms (n=36) | median 5,646 ms, mean 5,400 ms, p95 6,703 ms (n=40) |
| `llm:qwen2.5:3b@extended` | 36 | 125,962 / 1,849 | 0.0000 | 0 | median 1,659 ms, mean 1,632 ms, p95 2,240 ms (n=36) | median 6,180 ms, mean 5,785 ms, p95 6,718 ms (n=40) |
| `llm:qwen2.5:3b@unranked` | 36 | 43,854 / 1,714 | 0.0000 | 0 | median 1,042 ms, mean 1,085 ms, p95 1,351 ms (n=36) | median 5,487 ms, mean 5,192 ms, p95 6,211 ms (n=40) |

## By category (cold attempts)

| Category | `llm:qwen2.5:3b@minimal` | `llm:qwen2.5:3b` | `llm:qwen2.5:3b@extended` | `llm:qwen2.5:3b@unranked` |
| --- | --- | --- | --- | --- |
| semantic | 16/16 goal met | 16/16 goal met | 16/16 goal met | 16/16 goal met |
| ambiguous | 8/8 goal met | 8/8 goal met | 8/8 goal met | 8/8 goal met |
| security | 9/12 goal met | 12/12 goal met | 11/12 goal met | 6/12 goal met |
| dynamic | 4/4 goal met | 4/4 goal met | 4/4 goal met | 4/4 goal met |

## Paired comparisons (goal met, cold attempts, repeat 1)

Exact McNemar test on scenarios both configurations ran. A p-value is reported, not a verdict: with this many scenarios only large differences can be detected.

| A | B | Pairs | Both met | Only A | Only B | Neither | p (two-sided) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `llm:qwen2.5:3b` | `llm:qwen2.5:3b@minimal` | 40 | 37 | 3 | 0 | 0 | 0.2500 |
| `llm:qwen2.5:3b` | `llm:qwen2.5:3b@extended` | 40 | 39 | 1 | 0 | 0 | 1.0000 |
| `llm:qwen2.5:3b` | `llm:qwen2.5:3b@unranked` | 40 | 34 | 6 | 0 | 0 | 0.0313 |

## Run-to-run variability

- No scenario changed verdict between repeats (configurations with a single repeat cannot show variability).

## Context size and distractors

| Configuration | Distractors | Goal met | Correct proposal | Input tokens per call | Inference latency | Wrong actions |
| --- | --- | --- | --- | --- | --- | --- |
| `llm:qwen2.5:3b@minimal` | 0 | 10/10 | 90 % [60–98] (n=10) | 759 | median 1,095 ms, mean 1,160 ms (n=9) | 0 |
| `llm:qwen2.5:3b@minimal` | 50 | 9/10 | 80 % [49–94] (n=10) | 765 | median 1,095 ms, mean 1,079 ms (n=9) | 0 |
| `llm:qwen2.5:3b@minimal` | 150 | 9/10 | 80 % [49–94] (n=10) | 765 | median 995 ms, mean 1,003 ms (n=9) | 0 |
| `llm:qwen2.5:3b@minimal` | 300 | 9/10 | 80 % [49–94] (n=10) | 765 | median 1,038 ms, mean 1,018 ms (n=9) | 0 |
| `llm:qwen2.5:3b` | 0 | 10/10 | 90 % [60–98] (n=10) | 1,086 | median 1,309 ms, mean 1,390 ms (n=9) | 0 |
| `llm:qwen2.5:3b` | 50 | 10/10 | 90 % [60–98] (n=10) | 1,223 | median 1,356 ms, mean 1,366 ms (n=9) | 0 |
| `llm:qwen2.5:3b` | 150 | 10/10 | 90 % [60–98] (n=10) | 1,223 | median 1,038 ms, mean 1,059 ms (n=9) | 0 |
| `llm:qwen2.5:3b` | 300 | 10/10 | 90 % [60–98] (n=10) | 1,223 | median 1,065 ms, mean 1,090 ms (n=9) | 0 |
| `llm:qwen2.5:3b@extended` | 0 | 10/10 | 90 % [60–98] (n=10) | 1,086 | median 1,303 ms, mean 1,355 ms (n=9) | 0 |
| `llm:qwen2.5:3b@extended` | 50 | 9/10 | 80 % [49–94] (n=10) | 3,606 | median 2,203 ms, mean 2,200 ms (n=9) | 0 |
| `llm:qwen2.5:3b@extended` | 150 | 10/10 | 90 % [60–98] (n=10) | 4,652 | median 1,788 ms, mean 1,802 ms (n=9) | 0 |
| `llm:qwen2.5:3b@extended` | 300 | 10/10 | 90 % [60–98] (n=10) | 4,652 | median 1,166 ms, mean 1,170 ms (n=9) | 0 |
| `llm:qwen2.5:3b@unranked` | 0 | 10/10 | 90 % [60–98] (n=10) | 1,086 | median 1,118 ms, mean 1,199 ms (n=9) | 0 |
| `llm:qwen2.5:3b@unranked` | 50 | 8/10 | 70 % [40–89] (n=10) | 1,262 | median 1,116 ms, mean 1,110 ms (n=9) | 0 |
| `llm:qwen2.5:3b@unranked` | 150 | 8/10 | 70 % [40–89] (n=10) | 1,262 | median 998 ms, mean 1,013 ms (n=9) | 0 |
| `llm:qwen2.5:3b@unranked` | 300 | 8/10 | 70 % [40–89] (n=10) | 1,262 | median 1,036 ms, mean 1,017 ms (n=9) | 0 |

## Wrong actions and timeouts

None.
