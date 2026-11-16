# `linux-stt` Phase 0 lookups

PLAN-002 Phase 0, done on 2026-11-16 after the owner authorized it. This note
holds the evidence behind the plan's findings record: the whisper.cpp
source-lock review, build options, language table, model candidates, runners
and the package snapshot service.

Each finding says how it was established:

- **Bytes:** downloaded and hashed, or read from the file itself.
- **Source:** read in the pinned whisper.cpp tree, without building it.
- **Docs:** taken from the provider's documentation.
- **Probe:** an HTTP request against the live service.

Nothing here was configured or compiled. The CMake options below are read from
source and have not been run.

## 1. whisper.cpp source-lock review

**Selection: `v1.9.5`, commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`.**

- **Repository.** `https://github.com/ggml-org/whisper.cpp`, the project's
  canonical repository (Source, Probe).
  - It is not a fork, not archived, and its default branch is `master`.
  - The former `ggerganov/whisper.cpp` URL serves the same `HEAD`.
- **Tag and release.**
  - `v1.9.5` is an annotated tag pointing at that commit.
  - Its GitHub release was published on 2026-10-06 and is neither a draft nor
    a prerelease (Docs, via the GitHub API).
- **Commit provenance.**
  - The commit is "whisper : bump version to 1.9.5 (#4102)", dated
    2026-10-06, committed through GitHub.
  - GitHub reports its signature as verified.
  - It is an ancestor of `master`, which was 335 commits ahead on the review
    date (Probe, via the GitHub compare API).
- **Tree.** The Git tree object is `6fe2755682242a5c01aba65a22b3c0305d747841`.
  The source lock's content-hash scheme is a Phase 1 decision (FR-A3), so this
  is only the Git identity of the reviewed tree.
- **Why a release, not `master`.** A release tag is a point upstream chose to
  publish. The 335 newer commits are in no release. Moving to a later commit is
  a lock-changing PR with its compare range (sourcing).
- **License.**
  - `LICENSE` is MIT, "Copyright (c) 2023-2026 The ggml authors" (Source).
  - `ggml/` has no license file of its own; the root license covers it.
- **Third-party code in the build closure** (`src/`, `include/`, `ggml/`, with
  the CPU backend only):
  - `ggml/src/ggml-cpu/ops.cpp` carries an MIT notice for a YaRN snippet
    ("Copyright (c) 2023 Jeffrey Quesnelle and Bowen Peng"). The pack's notices
    must include it.
  - `ggml/src/ggml-cpu/llamafile/sgemm.cpp` (Mozilla Foundation) compiles only
    with `GGML_LLAMAFILE`, which stays off.
  - KleidiAI is fetched only with `GGML_CPU_KLEIDIAI`, which stays off.
  - Every SPDX identifier in the closure is `MIT`.
- **No network or hidden inputs at build time** (Source).
  - There is no `.gitmodules`.
  - The only downloads in the build files sit behind `GGML_OPENMP_FETCH`
    (a Windows LLVM installer) and `GGML_CPU_KLEIDIAI`. Both stay off.
  - `WHISPER_CURL` is off by default.
  - The closure has no binary files and no symbolic links.

## 2. Build options

All read from `CMakeLists.txt`, `ggml/CMakeLists.txt`, `ggml/src/CMakeLists.txt`
and `ggml/src/ggml-cpu/CMakeLists.txt` at the pinned commit (Source). The root
`CMakeLists.txt` presets no ggml default; it forwards only the sanitizer and
warning settings, so the defaults below are ggml's own.

- **Static library.** `BUILD_SHARED_LIBS=OFF`. Its default is `ON` on Linux.
  - Keep `GGML_STATIC=OFF`. It adds `-static` to every link, which would link
    glibc statically and contradict FR-B6.
  - The static C++ runtime (SPEC-002 D2) belongs on the helper's own link line
    (`-static-libstdc++ -static-libgcc`), not in whisper.cpp's options.
- **Not the build machine's CPU.** `GGML_NATIVE=OFF`.
  - Its default is `ON`, unless the build is cross-compiling or
    `SOURCE_DATE_EPOCH` is set.
  - With `GGML_NATIVE=ON`, x86 adds `-march=native` and ARM probes `-mcpu=native`.
- **No OpenMP, BLAS or GPU.**
  - `GGML_OPENMP=OFF`. Its default is `ON`, so it must be set.
  - `GGML_BLAS` defaults to `OFF` outside Apple. `GGML_LLAMAFILE` defaults to
    `OFF`.
  - The other backends default to `OFF`: `GGML_CUDA`, `GGML_HIP`,
    `GGML_MUSA`, `GGML_VULKAN`, `GGML_OPENCL`, `GGML_SYCL`, `GGML_WEBGPU`,
    `GGML_ZDNN`, `GGML_OPENVINO`, `GGML_HEXAGON`, `GGML_ZENDNN`, `GGML_ET`,
    `GGML_VIRTGPU` and `GGML_RPC`. `GGML_METAL` is on only for Apple.
  - Pass them as `OFF` explicitly anyway, so the receipt states them.
- **No dynamic backends.** `GGML_BACKEND_DL=OFF` and
  `GGML_CPU_ALL_VARIANTS=OFF` (both default).
- **Not built.** Tests, examples and the server default to on only when
  whisper.cpp is the top-level project. Set `WHISPER_BUILD_TESTS`,
  `WHISPER_BUILD_EXAMPLES` and `WHISPER_BUILD_SERVER` to `OFF`.
- **x64 baseline, x86-64-v3 (D1).** With `GGML_NATIVE=OFF`, each option adds
  its own flag:
  - `GGML_SSE42=ON` (`-msse4.2`), `GGML_AVX=ON` (`-mavx`), `GGML_AVX2=ON`
    (`-mavx2`), `GGML_FMA=ON` (`-mfma`), `GGML_F16C=ON` (`-mf16c`) and
    `GGML_BMI2=ON` (`-mbmi2`).
  - `GGML_AVX512*`, `GGML_AVX_VNNI` and `GGML_AMX_*` stay `OFF`.
  - These defaults depend on `GGML_NATIVE` and `SOURCE_DATE_EPOCH`, so set
    every one explicitly.
  - This is a subset of x86-64-v3; the compiler never emits instructions
    beyond it.
- **arm64 baseline, ARMv8.2-A with dot product and FP16 (D1).**
  `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16` adds
  `-march=armv8.2-a+dotprod+fp16` when `GGML_NATIVE=OFF`.
  - KleidiAI, SVE and SME stay off; none is in the baseline.
- **Toolchain floor.** `ggml/` needs CMake 3.14 or later, with C11 and C++17
  (Source). Ubuntu 22.04's `cmake` is 3.22.1: `3.22.1-1ubuntu1` in `jammy` and
  `3.22.1-1ubuntu1.22.04.2` in `jammy-updates` (Bytes: the package indexes at
  snapshot `20261101T000000Z`).

## 3. Language table

- **Where.** `g_lang` in `src/whisper.cpp`, with 100 entries, ids 0–99 (Source).
- **Against BCP 47.** Each code was checked against the IANA Language Subtag
  Registry, File-Date 2026-09-17 (Bytes).
  - 0 codes are unregistered.
  - 1 code is deprecated: `jw` (Javanese), deprecated 2001-08-13, with
    `Preferred-Value: jv`.
  - The rest are current primary language subtags. Some are macrolanguages,
    such as `zh`, `ar` and `no`, which are still valid primary subtags.
- **Proposed rule for the mapping (FR-B5).** A whisper.cpp code that is
  unregistered or deprecated maps to its registry `Preferred-Value`. This rule
  is a proposal for Phase 1, not a SPEC-002 requirement.
  - Today that is one entry: `jw` ↔ `jv`.
- **The candidates know 99 languages, not 100.** This is a gap in FR-B5's
  wording, raised here rather than edited into SPEC-002.
  - Every candidate's header has `n_vocab` 51865 (Bytes; read from bytes 4–7
    of each file).
  - whisper.cpp derives a multilingual model's language count as
    `n_vocab - 51765 - 1`, which is 99, so ids 0–98 (Source).
  - Only `large-v3` vocabularies (51866) know id 99, `yue` (Cantonese).
  - A manifest generated from the whole table would therefore list `yue`,
    which these models cannot dictate.
  - Upstream does not guard it. `whisper_full` turns a language into
    `token_sot + 1 + id` without checking the model's count, so `yue` on these
    models becomes the translate token. Language detection also scores `yue`
    from that token's logit (Source).
  - **For Phase 1 and Phase 3:**
    - `languages` should be the table entries whose id is below the selected
      model's count;
    - the helper should reject a `--locale` outside them;
    - the helper should pick the detected language among them only.

## 4. Model candidates (ADR-002 D3)

- **Repository.** `https://huggingface.co/ggerganov/whisper.cpp`, the URL
  `models/download-ggml-model.sh` uses at the pinned commit (Source).
  - That script fetches from `main`; the lock pins a revision instead.
  - **Revision:** `5359861c739e955e79d9a303bcbc70fb988958b1`, last modified
    2024-10-29 (Docs, via the Hugging Face API).
  - **URL form:**
    `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/<file>`.
- **Candidates in D3's order.** Sizes are in bytes.
  1. **Multilingual `ggml-base.bin`:** 147,951,465 bytes, SHA-256
     `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`
     (Bytes: downloaded from the pinned URL and hashed).
  2. **A quantized multilingual base.** D3 does not name the variant. Both are
     recorded, and the choice is the owner's.
     - **`ggml-base-q5_1.bin` (proposed):** 59,707,625 bytes, SHA-256
       `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898`
       (Bytes). It is the smaller of the two quantized files; neither has been
       measured yet (FR-E2).
     - **`ggml-base-q8_0.bin`:** 81,768,585 bytes, SHA-256
       `c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9`
       (Docs only: Hugging Face's LFS metadata, not downloaded).
  3. **Multilingual `ggml-tiny.bin`:** 77,691,713 bytes, SHA-256
     `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21`
     (Bytes).
- **Metadata check.** For the three downloaded files, the Hugging Face LFS
  object id equals the SHA-256 of the bytes, and the size matches.
- **Per-file limit.** `ggml-base.bin` is over GitHub's 100 MB Git limit, which
  ADR-002 anticipated. A release asset allows it.
- **License.**
  - The repository card declares `license: mit`.
  - The repository holds no license file at this revision. The license review
    (FR-F2) has to record the model license's source text.

## 5. Runners

From GitHub's runner reference (Docs), for public repositories, free and
unlimited:

- **arm64 Linux:** `ubuntu-22.04-arm`, `ubuntu-24.04-arm` and
  `ubuntu-26.04-arm`, with 4 CPUs, 16 GB RAM and 14 GB SSD. The page marks
  none of them as preview.
- **x64 Linux:** `ubuntu-22.04`, `ubuntu-24.04`, `ubuntu-26.04` and
  `ubuntu-latest`, with the same size.
- **Which to use.** The build runs inside the pinned `ubuntu:22.04` image
  (FR-C1), so the runner's own release matters less than its architecture.
  Pin an explicit label rather than `ubuntu-latest`.

## 6. Package snapshot service

- **Service.** The Ubuntu Snapshot Service, `https://snapshot.ubuntu.com/`
  (Docs).
  - **Snapshot id:** `YYYYMMDDTHHMMSSZ` in UTC.
  - **Coverage:** any time after 2023-03-01.
  - **Retention:** "at least 2 years in the past", which the service may
    extend.
  - **Ubuntu 22.04:** supported from apt 2.4.11, through
    `deb [snapshot=<id>] …` in `sources.list`, or `APT::Snapshot`.
- **URL that serves both architectures:**
  `https://snapshot.ubuntu.com/ubuntu/<id>` (Probe, one snapshot id,
  `20261101T000000Z`).
  - `jammy`, `jammy-updates` and `jammy-security` resolve there, and the
    `Release` file lists `amd64` and `arm64`.
  - An arm64 package downloads from that path:
    `pool/main/p/pulseaudio/libpulse-dev_15.99.1+dfsg1-1ubuntu2.2_arm64.deb`
    returned 200.
  - This is not documented. The documentation shows only the `ubuntu/` path.
- **Paths that do not work.**
  - `https://snapshot.ubuntu.com/ubuntu-ports/<id>` asks for authentication
    (401).
  - `snapshot.ports.ubuntu.com` serves a plain mirror listing, not dated
    snapshots.
  - `http://` requests redirect to `https://`.

### Open questions for Phase 4 (build environment)

These are recorded for Phase 4, not settled here.

- **HTTPS inside the image.** The snapshot is reachable only over HTTPS. It is
  not yet checked whether the pinned `ubuntu:22.04` image has CA certificates,
  and whether its apt is 2.4.11 or later. `jammy-updates` carries apt 2.4.14 at
  snapshot `20261101T000000Z`, but the image's own apt decides the first
  `apt-get update`.
- **Retention risk.** A rebuild more than two years after its snapshot may
  lose its packages, which weakens FR-C1. The retained source archive (FR-A4)
  holds no system packages.
- **arm64 through `ubuntu/`.** It worked at one snapshot id. Phase 4 should
  confirm it at the id the recipe pins.

## Not done in Phase 0

- **Owner items.** The speech fixtures and the license review stay with the
  owner (PLAN-002 Phase 0).
- **No files from later phases.** No `recipe.json`, source lock or build
  scripts (Phase 1 onward). No README or AGENTS wording (ADR-002 D5).
