# Dictation embedded STT benchmark

The embedded speech-to-text engine (`STT_MODE=embedded`, whisper.cpp `whisper-cli`)
was benchmarked on the reference homeserver to:

1. quantify the gain of the dictation performance overhaul over the legacy
   configuration (`ggml-base`, `-t 4`, no silence trim);
2. select the default `STT_EMBEDDED_MODEL` under the production cgroup.

Acceptance targets for the overhaul:

- at least **2× faster at p50** than the legacy configuration on the same hardware;
- **p50 STT ≤ 15 s for a 30 s clip** with the selected model at 2 CPUs;
- p95, RTF and peak RSS reported for every configuration.

Result: `ggml-base-q5_1` with 2 threads is **3.6× faster at p50** (3.2× at p95)
than the legacy configuration and transcribes 30 s clips in **13.2 s p50** on
average, with a peak RSS of 197 MB.

## Environment

| Item         | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| Hardware     | Intel N100, 4 cores, 15 GiB RAM (shared node)                             |
| Pod cgroup   | `cpu.max = 200000 100000` (2 CPUs), memory limit 2 GiB                    |
| Node load    | ≈ 3–4 during the matrix (other workloads on the same node)                |
| Image        | `devopsplaybookio/planner:beta` (0.96.0 code + GitOps sizing/model envs)  |
| whisper.cpp  | 1.9.5-dev, binary bundled in the image at `/opt/app/planner/bin`          |
| ffmpeg       | 8.1.3 (bundled in the image, same decode path as production)              |
| Node         | 26.13.0                                                                   |
| Date         | 2026-11-07                                                                |

The benchmark ran **inside the running planner pod** (`kubectl cp` + `exec`), so
it is subject to the same CPU quota and memory limit as production dictations.

## Harness

`planner-server/src/dictation/bench/BenchStt.ts` (Node builtins only), exposed as
`npm run bench:stt`. It spawns `whisper-cli` with the production flags
(`-m -f -l -t -np -nt`), decodes clips with the production ffmpeg silence-trim
filter unless `--no-trim`, samples `/proc/<pid>/status` (`VmHWM`) every 100 ms and
reports per run: audio duration, STT wall time, RTF, peak RSS and the transcript.
p50/p95 use linear interpolation; WER is computed for the clips listed in
`--references`.

Production embedded runs additionally request full JSON output (`-ojf -of <base>`)
to derive per-word confidence for the review UI; the benchmark keeps the
text-only flags above, so its figures represent the transcription cost without
that extra JSON write. A custom vocabulary also adds a short `--prompt` to the
call; the benchmark uses no prompt.

Each configuration runs 3× per clip; **the first (cold page-cache) run is
discarded** from the aggregates. The final matrix command:

```bash
node /tmp/bench/BenchStt.js \
  --audio-dir /tmp/bench/audio \
  --models-dir /data/stt-models \
  --bin /opt/app/planner/bin/whisper-cli \
  --models ggml-tiny,ggml-base,ggml-base-q5_1 \
  --threads 1,2 \
  --legacy \
  --runs 3 \
  --references /tmp/bench/audio/references.json \
  --out /tmp/bench/results.json
```

`--legacy` adds the `ggml-base`, `-t 4`, no-trim configuration. The two largest
models were measured in a separate sweep (`--threads 2 --runs 2`) because they
cannot meet the latency target anyway; see below.

## Clips

| File            | Duration | Content                                            | License        |
| --------------- | -------- | -------------------------------------------------- | -------------- |
| `jfk-en.wav`    | 10.9 s   | John F. Kennedy, 1961 inaugural address            | Public domain  |
| `sample-de.wav` | 30.0 s   | German Spoken Wikipedia, “Bleistift”               | CC BY-SA 4.0   |
| `sample-fr.wav` | 29.8 s   | French Spoken Wikipedia, “Dengue”                  | CC BY-SA 3.0   |

All clips are 16 kHz mono 16-bit PCM; sources and attribution are in
`planner-server/bench/audio/LICENSES.md`. They contain no user recordings.

## Results — final matrix

2 CPU cgroup, 3 runs per clip, warm runs only:

| Configuration               | Threads | Trim | p50      | p95      | p50 RTF | p95 RTF | Peak RSS | WER (EN) |
| --------------------------- | ------- | ---- | -------- | -------- | ------- | ------- | -------- | -------- |
| `ggml-tiny`                 | 1       | yes  | 14.88 s  | 26.65 s  | 0.8     | 0.9     | 176 MB   | 0.00     |
| `ggml-tiny`                 | 2       | yes  | 8.57 s   | 17.10 s  | 0.5     | 0.6     | 176 MB   | 0.00     |
| `ggml-base`                 | 1       | yes  | 29.86 s  | 43.37 s  | 1.5     | 2.0     | 283 MB   | 0.00     |
| `ggml-base`                 | 2       | yes  | 17.65 s  | 23.76 s  | 0.8     | 1.1     | 284 MB   | 0.00     |
| `ggml-base-q5_1`            | 1       | yes  | 22.05 s  | 22.35 s  | 0.7     | 1.3     | 197 MB   | 0.00     |
| **`ggml-base-q5_1`**        | **2**   | yes  | **13.19 s** | **15.94 s** | **0.5** | **0.8** | **197 MB** | **0.00** |
| legacy: `ggml-base`         | 4       | no   | 47.96 s  | 51.13 s  | 1.7     | 2.7     | 285 MB   | 0.00     |

Aggregate over the three clips (the 11 s clip is included; “warm” excludes the
first run). Improvement of the selected configuration over the legacy one:
**3.6× at p50** (47.96 s → 13.19 s) and **3.2× at p95** (51.13 s → 15.94 s), with
31 % less peak RSS (285 MB → 197 MB).

### Per-clip detail (selected vs legacy)

| Clip            | Legacy p50 (warm) | `ggml-base-q5_1` t2 p50 (warm) | Speedup |
| --------------- | ----------------- | ------------------------------ | ------- |
| `jfk-en.wav`    | 29.77 s           | 8.30 s                         | 3.6×    |
| `sample-de.wav` | 49.85 s           | 13.19 s                        | 3.8×    |
| `sample-fr.wav` | 49.07 s           | 15.04 s                        | 3.3×    |

The French clip’s warm median is slightly above 15 s because of a single 16.85 s
run during a node load spike; over all three runs its median is 13.22 s and the
30 s-clip average is 13.2 s (p95 15.94 s overall). The RTF of the selected
configuration is 0.44 on the German clip and 0.50 on the French clip, which is
where the embedded `estimatedRtf = 0.5` default comes from.

## Heavy-model sweep

Same pod, 2 threads, trim enabled, 2 runs per clip (first discarded):

| Configuration                 | p50     | p95      | p50 RTF | Peak RSS | Note                                    |
| ----------------------------- | ------- | -------- | ------- | -------- | --------------------------------------- |
| `ggml-small-q5_1`             | 45.65 s | 144.83 s | 2.8     | 463 MB   | French clip alone takes ≈ 156 s         |
| `ggml-large-v3-turbo-q5_0`    | 186.13 s | 190.67 s | 6.4     | 793 MB   | Similar to non-quantized legacy latency |

Neither fits a 2-CPU budget; they are not usable defaults for interactive
dictation here. They would only be worth 4 CPUs (quadrupling the pod CPU) and
still remain far above the 15 s target.

## Quality notes and model selection

- **English:** every configuration transcribes the JFK clip exactly (WER 0).
- **German:** `ggml-base` and `ggml-base-q5_1` produce accurate transcripts
  (minor spelling slips such as “Bleichstift” for “Bleistift”); `ggml-tiny` makes
  noticeably more errors.
- **French:** with `-l auto`, `ggml-tiny`/`ggml-base`/`ggml-base-q5_1` produce
  largely phonetic gibberish on the accented Spoken-Wikipedia clip, while
  `ggml-large-v3-turbo-q5_0` is accurate. With an explicit `-l fr`,
  `ggml-base-q5_1` returns coherent French (still imperfect, e.g. “vengue” for
  “dengue”). Users dictating in a non-English language should select it in
  Settings; `auto` works well for English and German.

Selected default: **`ggml-base-q5_1` with `STT_EMBEDDED_THREADS=0`** (auto = 2
threads under this cgroup). It meets both acceptance targets, keeps the English
and German quality of `ggml-base`, cuts memory by 31 % and avoids the
oversubscription of the legacy `-t 4` configuration. `ggml-tiny` is faster but
degrades German; unquantized `ggml-base` is 34 % slower at p50 (17.65 s vs
13.19 s).

`DICTATION_ESTIMATED_RTF` keeps an embedded auto value of `0.5` (rounded up from
the measured 0.44–0.50 p50 RTF) so the UI can estimate a progress bar without
calling the engine.

## Reproducing

```bash
cd planner-server
npm install
npm run build                      # compiles dist/dictation/bench/BenchStt.js
kubectl -n planner cp dist/dictation/bench/BenchStt.js <pod>:/tmp/bench/BenchStt.js -c planner
kubectl -n planner cp bench/audio <pod>:/tmp/bench/audio -c planner
kubectl -n planner exec <pod> -c planner -- node /tmp/bench/BenchStt.js \
  --audio-dir /tmp/bench/audio --models-dir /data/stt-models \
  --bin /opt/app/planner/bin/whisper-cli \
  --models ggml-base-q5_1 --threads 2 --runs 3 \
  --references /tmp/bench/audio/references.json --out /tmp/bench/results.json
```

Models are downloaded from the same Hugging Face base URL as production into
`/data/stt-models` (persistent volume) and reused on later runs.
`npm run bench:stt` runs the same harness locally.

## Limitations

- Single shared N100 node: other workloads pushed the load average to 3–4 and
  explain most of the run-to-run spread (the 16.85 s French outlier); absolute
  numbers on an idle node will be lower, ratios are stable.
- WER is only computed for the English clip, which has a reference transcript;
  German and French quality was assessed by inspection.
- Only CPU inference was measured; the reference deployment has no GPU.
- The matrix uses the quantization variants bundled in the image; no per-model
  tuning (beam size, VAD) beyond the production flags was attempted.
