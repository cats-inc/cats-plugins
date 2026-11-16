# PLAN-002: `linux-stt` feature pack producer

## Metadata

| Field | Value |
| --- | --- |
| Status | In progress; Phase 0 authorized by the owner, 2026-11-16, its owner items open. Phase 1 authorized 2026-11-17 and done. On 2026-11-17 the owner asked for the rest to be done straight through, short of the owner items, the license review and any release |
| Owner | Cats Plugins maintainers |
| Spec | [SPEC-002](../specs/SPEC-002-linux-stt-pack-producer.md) |
| Decision | [ADR-002](../decisions/002-produce-native-feature-packs-beside-plugin-content.md) |
| Consumer plan | [Platform PLAN-138](https://github.com/cats-inc/cats-platform/blob/main/docs/plans/PLAN-138-feature-packs-linux-dictation-and-dictation-language.md) |

This plan does not authorize implementation, a runner or secret change, a tag or
a release. Each phase starts only after the owner authorizes it.

## Boundaries

- **Existing contracts stay unchanged:**
  - ADR-001's Agency pipeline;
  - `src/cli.mjs`, which accepts only `build` and `verify`;
  - `npm run check`;
  - the three-OS `producer` job and its check names.
- **New entry points for packs:** `src/packs/cli.mjs` and npm scripts for packs,
  such as `npm run pack -- build linux-stt --arch x64`.
- **Test placement.**
  - Platform-neutral pack tests live in `tests/`, so `npm test` runs them on all
    three OSes.
  - Native tests use a file name and folder that `node --test` does not
    discover. Only the Linux jobs run them, through an explicit script.
- **Facts left open in SPEC-002 are Phase 0 lookup tasks.** They are not
  settled here: whisper.cpp's build options and language table, the model files
  and URLs, the runner labels and the snapshot service. Choosing the whisper.cpp
  commit is a source-lock review (FR-A3), not a planning detail.

## Phase 0 — Lookups and owner prerequisites

- [x] Choose the whisper.cpp commit through a source-lock review, and record the
  review. `v1.9.5`, commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`; the
  review is in the [Phase 0 lookups](../research/2026-11-16-linux-stt-phase-0-lookups.md).
- [x] Look up whisper.cpp's build options for:
  - a static library;
  - no targeting of the build machine's CPU;
  - no OpenMP, BLAS or GPU;
  - the x86-64-v3 and ARMv8.2-A (dot product, FP16) baselines (SPEC-002 D1).

  Read from source and not yet configured. `GGML_OPENMP` and `GGML_NATIVE`
  default to on and must be turned off, and `GGML_STATIC` must stay off,
  since it links glibc statically.
- [x] Find whisper.cpp's language table, and list the codes that are not valid
  BCP 47 primary subtags. Those codes form the recipe's mapping (FR-B5).
  - None of the 100 codes is unregistered; `jw` is deprecated, with preferred
    value `jv`.
  - The candidate models know 99 of them, without `yue`. SPEC-002 FR-B5 was
    amended on 2026-11-17 to cover the model's count, the mapping rule, the
    `--locale` check and detection.
- [x] For each model candidate (ADR-002 D3), record the file name, a
  revision-pinned URL, the size and the SHA-256.
  - D3 leaves the quantized variant open. Under the owner's delegation,
    2026-11-17, `q5_1` is the quantized candidate: it is the smaller file.
    `q8_0` is recorded only and is not measured.
  - The `v1.9.5` pin was confirmed under the same delegation.
- [x] Look up the GitHub-hosted arm64 Linux runner label for this public
  repository, and the dated Ubuntu archive snapshot service.
  - Whether the pinned image can use the HTTPS-only snapshot is a Phase 4
    question.
- [ ] **Owner:** record the speech fixtures (SPEC-002 D3) with written
  permission, and a provenance file covering speaker, date, language and
  permission:
  - English and Mandarin;
  - a short clip and a 30-second clip of each.

  The format and overrun fixtures can be generated audio, with no speaker.
- [ ] **Owner:** start the license review. It covers whisper.cpp, the model, the
  statically linked C++ runtime and the fixtures (FR-F2).

### Findings record

| Item | Finding | Source | Date |
| --- | --- | --- | --- |
| whisper.cpp | `https://github.com/ggml-org/whisper.cpp`, tag `v1.9.5`, commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`, tree `6fe2755682242a5c01aba65a22b3c0305d747841`; MIT; no submodules or build-time downloads with the options below | Pinned tree; GitHub API | 2026-11-16 |
| Build options | `BUILD_SHARED_LIBS=OFF`, `GGML_STATIC=OFF`, `GGML_NATIVE=OFF`, `GGML_OPENMP=OFF`, `GGML_BLAS=OFF`, `GGML_LLAMAFILE=OFF`, GPU backends `OFF`, `GGML_BACKEND_DL=OFF`; x64 `GGML_SSE42`, `GGML_AVX`, `GGML_AVX2`, `GGML_FMA`, `GGML_F16C`, `GGML_BMI2` on, AVX-512, AVX-VNNI and AMX off; arm64 `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16` | CMake files at the pinned commit (not configured) | 2026-11-16 |
| Language mapping | 100 table codes; 0 unregistered; `jw` deprecated → `jv`. Candidates know 99 (ids 0–98, no `yue`) | `src/whisper.cpp`; IANA registry 2026-09-17; model headers | 2026-11-16 |
| Model revision | `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/<file>` | Upstream download script; Hugging Face API | 2026-11-16 |
| `ggml-base.bin` | 147,951,465 bytes, SHA-256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` | Downloaded and hashed | 2026-11-16 |
| `ggml-base-q5_1.bin` (D3's quantized candidate) | 59,707,625 bytes, SHA-256 `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898` | Downloaded and hashed | 2026-11-16 |
| `ggml-base-q8_0.bin` (not a candidate) | 81,768,585 bytes, SHA-256 `c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9` | Hugging Face metadata only | 2026-11-16 |
| `ggml-tiny.bin` | 77,691,713 bytes, SHA-256 `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21` | Downloaded and hashed | 2026-11-16 |
| Runners | arm64 `ubuntu-22.04-arm` / `ubuntu-24.04-arm`, x64 `ubuntu-22.04` / `ubuntu-24.04`; 4 CPU, 16 GB, free for public repositories | GitHub runner reference | 2026-11-16 |
| Package snapshot | `https://snapshot.ubuntu.com/ubuntu/<YYYYMMDDTHHMMSSZ>`, HTTPS only; serves `jammy` amd64 and arm64 (arm64 undocumented, probed at one id); `ubuntu-ports` is not public; retention at least 2 years | snapshot.ubuntu.com; HTTP probes | 2026-11-16 |

The evidence, and the open questions for later phases, are in the [Phase 0 lookups](../research/2026-11-16-linux-stt-phase-0-lookups.md).

## Phase 1 — Recipe, source lock, retained sources (FR-A1–FR-A4)

- [x] **Layout and schemas (FR-A1, FR-A2).** Create the `packs/linux-stt/` layout
  and the `recipe.json` and `source-lock.json` schemas, with validators.
  - Both files take exactly their listed keys.
  - Values set by later phases stay `null`: the selected model and thread count
    (measurement), the build image digest and package snapshot (Phase 4).
  - `bridge/`, `fixtures/` and the notices arrive with Phases 3, 0 (owner) and
    the license review.
- [x] **Fetch and verify (FR-A3).**
  - whisper.cpp is fetched by exact commit, and its tree content hash is
    checked.
  - Each model is fetched and its size and SHA-256 are checked.
  - There is no fallback to a branch or "latest".
  - The lock covers the whole tree: 2,039 files. The content hash is the
    SHA-256 of one line per file, `<git mode> <sha256> <size> <path>`, in UTF-8
    byte order of the path. Two separate computations agree on
    `7880c133ac9d1b46a9f24a83f0c60c2d28d1203624a6c0913047951fabc03b7c`.
  - Git runs with an empty configuration and checks nothing out; files are
    read from Git objects. Symbolic links and submodules stop the fetch.
  - A real fetch from GitHub and Hugging Face (`ggml-base-q5_1.bin`) passed on
    2026-11-17.
- [x] **Retained source archive (FR-A4).** It is deterministic and contains the
  tree, the bridge, the recipe and the lock.
  - Uncompressed ustar, `linux-stt-<version>-sources.tar`. GNU tar extracts the
    real archive to a tree with the locked content hash.
  - The bridge is empty until Phase 3.
- [x] **The pack command entry point** (`src/packs/cli.mjs`), plus its npm
  scripts. `npm run pack -- check | fetch | verify-sources linux-stt`.
- [x] **Tests.** Local Git fixtures, with no network, cover each tampering case.

**Covers:** AC-01.

## Phase 2 — Archive, manifest, lock fragment (FR-C3–FR-C5, FR-D3)

- [ ] **Streaming `.catspack` writer.** A stored ZIP, with paths in sorted order,
  a fixed timestamp, one mode and `feature-pack.json` at the root.
- [ ] **Streaming verifier.** It shares `safePath` and the hashing helpers, and
  enforces Platform SPEC-145 FR-A2 and FR-A3. ADR-001's in-memory `pack` and
  `verifyArchive` are left alone.
- [ ] **Manifest generation (FR-C4).**
  - `prerequisites` is derived from `NEEDED`, minus glibc's libraries.
  - `languages` comes from the build (FR-B5).
- [ ] **Lock fragment per architecture (FR-C5)**, and the check that it matches
  the archive (FR-D3).
- [ ] **Tests**, platform-neutral: byte-identical output from identical inputs,
  and rejection of tampered archives and fragments.

**Covers:** AC-05 and the archive part of AC-02.

## Phase 3 — Helper (FR-B1–FR-B7)

- [ ] **Arguments (FR-B1).** Exactly Platform SPEC-145 FR-A4. Anything else exits
  with usage.
- [ ] **Start order (FR-B2):** arguments, CPU check, audio source, model,
  `ready`.
- [ ] **CPU check.**
  - It is compiled in a translation unit without baseline instruction flags, so
    it runs safely on older CPUs. It runs before any whisper.cpp code.
  - It is tested two ways:
    - a unit test with injected CPU feature sets;
    - an end-to-end run under user-mode emulation with a CPU model below the
      baseline, if Phase 0 finds one.
  - If neither path can run, record the check as unverified.
- [ ] **Capture (FR-B3).** PulseAudio's asynchronous API with
  `pa_threaded_mainloop`, following SPEC-087 Req 4's thread rules.
- [ ] **Fixture input (FR-B4).** A 16 kHz mono 16-bit WAV, read faster than real
  time. End of file is not a stop. The overrun counts buffered audio.
- [ ] **Language (FR-B5).** The mapping is applied both ways. Without
  `--locale`, whisper.cpp detects the language and `ready.locale` is `"auto"`.
  There is no prompt hint, no conversion and no system-locale fallback.
- [ ] **Linking (FR-B6).** whisper.cpp is static, and so is the C++ runtime,
  pending the license review. Baseline flags only.
- [ ] **No network (FR-B7).** The helper's own code calls no socket API.

## Phase 4 — Build and binary checks (FR-C1, FR-D1)

- [ ] **Build environment.** The build runs in a pinned `ubuntu:22.04` image
  with the dated snapshot. The build script writes the receipt: image, snapshot,
  compiler, CMake and flags.
- [ ] **Binary checks.**
  - The ELF machine type matches the architecture.
  - `NEEDED` entries stay within the allowlist.
  - No required glibc symbol version is newer than 2.35.
  - There is no socket API among the undefined symbols.
- [ ] **Rule-breaking fixture binaries.** Each one violates one check and is
  rejected.

**Covers:** AC-02 and AC-03.

## Phase 5 — CI, protocol tests, offline rebuild (FR-C2, FR-D2)

- [ ] **New Linux-only jobs, x64 and arm64.** They follow the existing
  docs-only and already-tested skip plan, and `tests/ci.test.mjs` covers them.
  The `producer` job is unchanged (AC-08).
- [ ] **Protocol tests (FR-D2).** They run in a container with networking
  disabled, on both architectures (AC-04).
- [ ] **Offline rebuild job.** It rebuilds from the source archive and the model,
  with networking disabled, and passes AC-03 and AC-04 (AC-06).
- [ ] **Upload artifacts.** Upload the `dist/linux-stt/` outputs as workflow
  artifacts. They are test outputs, not releases (FR-C5).
- [ ] **ADR-002 D5.** In the change that first produces a working pack, describe
  the repository in README and in the AGENTS purpose line as the producer of
  Plugins and feature packs.
- [ ] **Owner:** add the new jobs as required checks, which is a branch
  protection change.
- [ ] **Owner:** authorize the matching description change in cats-one's
  workspace template separately.

## Phase 6 — Candidates and measurement (FR-E1, FR-E2; shared gate with Platform PLAN-138 Phase 6)

- [ ] **Build candidates on request (FR-E1).** Each model candidate can be built
  on request, for example through a manual workflow input. CI builds the
  selected candidate on every run.
- [ ] **Measurement harness (FR-E2).**
  - Five runs per fixture, reporting the median and the worst of `ready` and of
    transcription.
  - The fixture `ready` time covers process start, argument checks and model
    load. It skips the microphone.
- [ ] **Owner or assigned operator:** run the harness on the reference board.
  Also measure the live `ready` time in an installed Desktop pointed at the
  candidate through `CATS_VOICE_CAPTURE_HELPER`. Record the results in Platform
  PLAN-138's measurement record (AC-07).
- [ ] **Choose the model and thread count**, then update the recipe.
- [ ] **First contact.** Platform's verifier and pack manager accept the real
  candidate archives (Platform PLAN-138 Phase 6) before any release.

## Phase 7 — Release (FR-F1, FR-F2; owner-authorized only)

- [ ] **Owner:** complete the license review (gate).
- [ ] **Release mechanics.** Write the release SOP and the release workflow for
  `linux-stt-v<version>` tags, following the cats-one release guide.
  - Assets per FR-F1.
  - No asset replacement and no tag recreation.
- [ ] **Owner:** authorize the release. Then publish, and verify the workflow and
  the public assets.
- [ ] Hand the lock fragments to Platform PLAN-138 Phase 7.

## Files to create or modify

| File | Action | Purpose |
| --- | --- | --- |
| `packs/linux-stt/recipe.json`, `source-lock.json` | Create | Recipe and pins (FR-A2, FR-A3) |
| `packs/linux-stt/bridge/**` | Create | Helper source and CMake project (FR-B*) |
| `packs/linux-stt/fixtures/**` | Create | Audio with provenance (D3) |
| `src/packs/**` | Create | Fetch, verify, build orchestration, archive, manifest, lock fragment, binary checks, CLI |
| `tests/*.test.mjs` | Create | Platform-neutral pack tests |
| Native test scripts, outside `node --test` discovery | Create | Protocol and binary tests run by the Linux jobs |
| `.github/workflows/ci.yml`, `tests/ci.test.mjs` | Modify | Linux-only jobs and their coverage |
| `package.json` | Modify | Pack scripts; `check` unchanged |
| `README.md`, `AGENTS.md` | Modify | ADR-002 D5, with the first working pack |

## Testing strategy

- **Every OS:** platform-neutral JavaScript tests for recipe, lock, archive,
  manifest and fragment run in `npm test`.
- **Linux jobs:** native build, binary checks, protocol tests and the offline
  rebuild.
- **Manual:** measurement and live dictation on the reference board.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| The CPU check cannot be exercised below the baseline | Medium | Unit test with injected features; emulation if available; otherwise recorded as unverified |
| The license review rejects static C++ runtime linking | Medium | SPEC-002 D2 fallback: dynamic linking, listed in `prerequisites` |
| Native builds are not bit-reproducible | Low | Digest and receipt are the trust anchor (ADR-002 §3) |
| A host-generated source archive changes bytes | Low | Pins use commit and content hashes, not archive bytes |

## Progress log

| Date | Update |
| --- | --- |
| 2026-11-16 | Plan drafted; no phase started. |
| 2026-11-16 | The owner authorized Phase 0. Its five lookups are done and recorded; the fixtures and the license review stay with the owner. The candidate models know 99 languages, which FR-B5 does not yet account for. |
| 2026-11-17 | Under the owner's delegation: SPEC-002 FR-B5 amended for the model's language count; `q5_1` chosen as D3's quantized candidate; the `v1.9.5` pin confirmed. Phase 1 is not authorized. |
| 2026-11-17 | The owner authorized Phase 1. Recipe, source lock with the whole-tree content hash, verified fetch, retained source archive and `npm run pack` are done; AC-01 is covered by tests. Phase 2 is not authorized. |

---

*Created: 2026-11-16*
