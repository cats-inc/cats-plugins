# SPEC-002: `linux-stt` feature pack producer

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft; D1–D3 resolved under the owner's delegation, 2026-11-16; FR-B5 amended after PLAN-002 Phase 0, 2026-11-17 |
| **Owner** | Cats Plugins maintainers |
| **Reviewer** | Product owner |
| **Decision** | [ADR-002](../decisions/002-produce-native-feature-packs-beside-plugin-content.md) |
| **Contract** | [Platform SPEC-145](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-145-feature-packs-and-linux-dictation.md) §A, FR-D6 and FR-D7, with the setting from [SPEC-146](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-146-dictation-language-for-desktop-voice-input.md) |

## Summary

This repository produces `linux-stt`, the first feature pack: a whisper.cpp
dictation helper and its model, for Linux x64 and arm64. Cats Desktop
downloads it on demand.

Platform SPEC-145 owns the contract:

- the `.catspack` archive and its manifest;
- the lock entry;
- helper protocol 1;
- the helper's observable behavior and language handling.

This SPEC adds only what the producer owns:

- the recipe and source lock;
- the helper's internals;
- the build;
- the binary and protocol checks;
- the artifacts that a release would publish.

It follows ADR-002 and its resolved D1–D5.

## Goals

- **Built from pinned inputs.** Only pinned upstream inputs go in, and a
  rebuild from the retained sources works with every upstream unreachable.
- **Portable.** One helper per architecture runs on any glibc 2.35+ system with
  a PulseAudio client library.
- **Checked before anything leaves CI.** Binary checks and protocol tests run
  on each target architecture.
- **Ready for Desktop.** Desktop gets a lock fragment it can copy into its own
  reviewed lock.

## Non-Goals

- **Platform and Bot code.** Desktop host, renderer or Bot code, and the
  Plugin pipeline of ADR-001, which stays unchanged.
- **Other packs and platforms.** macOS or Windows helpers, other packs, and
  other architectures.
- **Changing the helper's behavior.**
  - New helper arguments or events: protocol changes belong to Platform.
  - Script conversion, prompt hints and system-locale fallback, which the owner
    ruled out (SPEC-145 FR-D7).
  - Streaming transcripts.
- **Publication itself.** This SPEC lists release contents and checks only. A
  release needs the owner's authorization, the license review and a release
  SOP.

## Requirements

### A. Recipe and sources

**FR-A1 — Layout.**

- `packs/linux-stt/` holds:
  - `recipe.json`;
  - `source-lock.json`;
  - `bridge/`: the Cats-owned helper source and its CMake project;
  - `fixtures/`: test audio, with a provenance record;
  - the notices.
- The Node tooling lives in `src/packs/`. Packs never enter developer skill
  discovery (ADR-002 §1).

**FR-A2 — Recipe.** `recipe.json` records:

- `id: "linux-stt"`, the pack `version`, and the recommended
  `minUsableVersion`. Desktop's lock decides the final value (SPEC-145 FR-A1).
- `helperProtocol: 1` and `minGlibc: "2.35"`.
- The model candidates in ADR-002 D3's order, and the selected candidate.
- The thread count the helper uses, set from measurement (FR-E2).
- The CPU baseline per architecture (D1).
- The language mapping (FR-B5).
- The build image digest and the dated package-archive snapshot (FR-C1).

**FR-A3 — Source lock.**

- For whisper.cpp, the lock records:
  - the repository URL;
  - the full commit;
  - a content hash of the source tree the build uses.
- For each model candidate, it records its URL (pinned to a revision), size and
  SHA-256.
- CI fetches the commit with Git and each model over HTTPS, and verifies every
  hash before the build starts. There is no fallback to a branch or "latest"
  (ADR-002 §2).
- An update is a lock-changing PR that carries the upstream compare range,
  license and notice changes, and test evidence ([sourcing](../sourcing.md)).

**FR-A4 — Retained sources.** Each build writes a deterministic source archive.
It contains the exact whisper.cpp tree, the bridge source, the recipe and the
lock. A rebuild from it and the selected model needs no network (AC-06).

### B. Helper internals

The helper's observable behavior is SPEC-145 FR-A4, FR-D6 and FR-D7. This
section fixes how it is built inside.

**FR-B1 — Arguments.** The helper accepts exactly SPEC-145 FR-A4's arguments:

- `--session-id <id>`;
- an optional `--locale <subtag>`;
- the test-only `--input <wav>`, only with `CATS_STT_ENABLE_FIXTURE_INPUT=1`.

Anything else exits with a usage message on stderr. No other flag ships.

**FR-B2 — Start order.**

1. The helper validates its arguments. An unsupported `--locale` emits
   `error: language_not_supported` and `end`.
2. It checks the CPU baseline (D1). Below it, it emits
   `error: engine_unavailable` and `end`, before any whisper.cpp code runs.
3. It opens the audio source: the default PulseAudio source, or the fixture.
   Failure emits `mic_unavailable`.
4. It loads the model from beside the executable, resolved through
   `/proc/self/exe`. Failure emits `engine_unavailable`.
5. It emits `ready` with `mode: "on-device"`, and `locale` set to the subtag or
   `"auto"`.

**FR-B3 — Audio capture.** This carries over SPEC-087 Req 4 and its
Reliability requirement.

- Capture is 16 kHz mono S16LE through PulseAudio's asynchronous API under
  `pa_threaded_mainloop`.
- The audio thread owns the context and the stream for their whole lifetime.
- The stdin command thread only sets an atomic stop or cancel flag and wakes
  the audio thread. It never closes or frees a PulseAudio object.
- On `stop`, the audio thread closes the stream first, which releases the
  microphone, then runs recognition.

**FR-B4 — Fixture input.**

- `--input` reads a 16 kHz mono 16-bit PCM WAV, faster than real time, in
  place of the microphone. Any other format emits `engine_unavailable`.
- End of file does not stop the session; the helper still waits for `stop`.
- The 31-second overrun counts buffered audio, so a longer fixture triggers
  `error: aborted` (SPEC-145 FR-D6).

**FR-B5 — Language.**

- `languages` in the manifest is generated at build time from the pinned
  whisper.cpp language table, never written by hand.
- It lists only the table entries the pinned model knows: those whose id is
  below the model's language count, which whisper.cpp derives from the model's
  vocabulary size. The base and tiny models know 99, without `yue`.
- Where whisper.cpp's code is not a valid BCP 47 primary subtag, the recipe's
  language mapping translates it. The helper maps it back.
  - A code that is unregistered or deprecated in the IANA registry maps to its
    `Preferred-Value`. At the pinned commit that is `jw` ↔ `jv`.
- The helper rejects a `--locale` outside `languages` with
  `language_not_supported`, before whisper.cpp sees it. whisper.cpp does not
  check the id against the model.
- Without `--locale`, the helper detects the language, choosing only among the
  model's languages, and passes the result to whisper.cpp explicitly.
- There is no prompt hint, no script conversion and no system-locale fallback.

**FR-B6 — Linking.**

- whisper.cpp is linked statically into the helper.
- The C++ runtime is linked statically (D2).
- Dynamic dependencies are limited to glibc's own libraries and the PulseAudio
  client library.
- No OpenMP, BLAS or GPU runtime is linked.
- The build never targets the build machine's CPU; it targets the recipe's
  baseline (D1).

**FR-B7 — No network.**

- The helper's own code calls no socket API. A check of the helper's undefined
  dynamic symbols proves it (FR-D1).
- The PulseAudio client's connection to the local sound server is outside this
  rule, since it belongs to the user's audio setup.

### C. Build

**FR-C1 — Environment.**

- Each architecture builds inside an `ubuntu:22.04` image pinned by digest
  (ADR-002 D1).
- Packages come from a dated Ubuntu archive snapshot recorded in the recipe.
- The build runs on a runner of the same architecture (ADR-002 D2).
- The receipt records the image digest, the snapshot, the compiler, CMake and
  flags.

**FR-C2 — CI placement.**

- `npm test` stays platform-neutral, and the existing three-OS `producer` job
  keeps its check names.
  - The pure-JavaScript pack tooling tests run there: recipe, lock, manifest,
    archive and lock fragment.
  - Native build and protocol tests run only in new Linux jobs, one per
    architecture, through a separate npm script.
- The new jobs follow the workflow's existing docs-only and already-tested
  skip plan. `tests/ci.test.mjs` covers them.
- Making them required checks is a branch-protection change for the owner.

**FR-C3 — Archive.**

- A new streaming writer produces `linux-stt-<version>-linux-<arch>.catspack`
  to SPEC-145 FR-A2:
  - a stored ZIP;
  - paths in sorted order, a fixed timestamp, and one fixed file mode;
  - `feature-pack.json` at the root.
- The writer and a streaming verifier share `safePath` and the hashing helpers
  with ADR-001's tooling. ADR-001's in-memory `pack` and `verifyArchive` have
  1 MiB and 8 MiB limits, so they are not reused for packs.

**FR-C4 — Manifest.**

- The build writes `feature-pack.json` to SPEC-145 FR-A3:
  - `files` with sizes and SHA-256;
  - `entry: "cats-stt-linux"`;
  - `upstream`, `model` and `licenses`;
  - `minGlibc` and the generated `languages`.
- `prerequisites` is derived from the helper's real `NEEDED` entries, minus
  glibc's own libraries, which `minGlibc` covers.

**FR-C5 — Outputs.** Each architecture writes these under `dist/linux-stt/`:

- the `.catspack` file;
- its `.sha256`;
- the build receipt;
- the source archive;
- `lock-entry-<arch>.json`: the SPEC-145 FR-A1 fields Desktop copies:
  - `id`, `version`, `minUsableVersion`, `os`, `arch`;
  - the planned release `url`;
  - `size`, `sha256`, `unpackedSize`;
  - `helperProtocol`, `minGlibc`, `prerequisites`, `licenses`.

CI uploads these as workflow artifacts. They are test outputs, not releases.

### D. Checks before upload

**FR-D1 — Binary checks.**

- The ELF machine type matches the archive's architecture.
- `NEEDED` entries stay within FR-B6's allowlist.
- No required glibc symbol version is newer than 2.35.
- The helper's undefined dynamic symbols include no socket API (FR-B7).
- Fixture binaries that break each rule are rejected.

**FR-D2 — Protocol tests.** These run on each architecture, in a container
with networking disabled:

- English and Mandarin fixtures with `stop` give `ready`, one non-empty
  `final` and `end`.
- `cancel` gives `error: cancelled` and `end`.
- A fixture longer than 31 seconds gives `error: aborted` and `end`.
- Without `--input` or a sound server, the helper gives `mic_unavailable` and
  `end`.
- Every subtag in `languages` is accepted as `--locale`. An unlisted subtag
  gives `language_not_supported`.
- Without `--locale`, `ready.locale` is `"auto"`.
- An unknown argument exits non-zero with a usage message.

**FR-D3 — Archive and manifest checks.**

- The streaming verifier re-reads each archive and enforces SPEC-145 FR-A2 and
  FR-A3: paths, the file set, sizes, hashes, the `entry` and `languages`.
- It also checks that the lock fragment matches the archive.

### E. Model choice and measurement

**FR-E1 — Candidate builds.**

- Each model candidate can be built as a pack on request. CI builds the
  selected candidate on every run.
- Candidate packs reach the reference board as CI workflow artifacts, never as
  releases.

**FR-E2 — Measurement.**

- **The harness.** A script runs a candidate's helper five times per fixture
  on the reference board (ADR-154 D4). It records the median and the worst:
  - `ready` time;
  - transcription time for a 30-second fixture after `stop`.
- **What fixture `ready` time covers.** Process start, argument checks and
  model load. It skips the microphone.
- **Live ready time.** It is measured separately in an installed Desktop that
  points `CATS_VOICE_CAPTURE_HELPER` at the unpacked candidate (SPEC-145
  FR-D2), using the host log's spawn and `ready` timestamps.
- **Thread count.** The recipe's thread count is chosen during this
  measurement.
- **Recording.** Results go to the Platform PLAN. They set the model choice
  and SPEC-145 FR-D4's timeouts.

### F. Release contents

**FR-F1 — Assets.**

- A `linux-stt-v<version>` release would carry, per architecture:
  - the `.catspack` and its `.sha256`;
  - the manifest copy and the build receipt;
  - the source archive;
  - the notices.
- It would carry the lock fragments once.

**FR-F2 — Gates.**

- Publication needs all of:
  - the owner's authorization;
  - a completed license review covering whisper.cpp, the model, the statically
    linked C++ runtime and the fixtures;
  - a release SOP written with that first release.
- Published assets are never replaced, and tags are never recreated
  (ADR-002 §5).

## Non-Functional Requirements

- **Determinism.**
  - Archives and source archives are byte-stable for identical inputs.
  - Binaries need not be: the trust anchor is the published digest and the
    receipt (ADR-002 §3).
- **Fixture rights.** Every fixture has recorded provenance and permission to
  redistribute it in this public repository (D3).

## Acceptance Criteria

- **AC-01 — Source lock.** A wrong commit, content hash, model size or model
  hash stops the build before compilation.
- **AC-02 — Builds.** x64 and arm64 builds pass in the pinned image. Packaging
  the same files twice gives identical archive bytes.
- **AC-03 — Binary checks.** Real binaries pass FR-D1, and the rule-breaking
  fixtures fail.
- **AC-04 — Protocol.** FR-D2 passes on both architectures with networking
  disabled.
- **AC-05 — Archive.** FR-D3 passes, and tampered archives fail.
- **AC-06 — Offline rebuild.** A rebuild from the source archive and the model,
  with networking disabled, builds and passes AC-03 and AC-04.
- **AC-07 — Measurement (manual).** FR-E2 runs on the reference board, and the
  results are recorded in the Platform PLAN.
- **AC-08 — CI.** The three-OS `producer` job and its check names are
  unchanged, and `tests/ci.test.mjs` covers the new Linux jobs.

## Resolved Decisions

The owner delegated D1–D3 on 2026-11-16.

- **D1 — CPU baseline: one per architecture, failing closed below it.**
  - **arm64:** ARMv8.2-A with dot product and FP16. This is the Cortex-A76
    class that ADR-154 D4 sets as dictation's floor.
  - **x64:** x86-64-v3, which has AVX2 and FMA.
  - **Below the baseline:** the helper emits `engine_unavailable` (FR-B2)
    instead of crashing on an illegal instruction.
  - **Accepted cost:** x64 machines without AVX2 get no dictation.
  - **Rejected:** several CPU variants chosen at run time, which would mean a
    larger pack, more build complexity, and libraries loaded at run time, for a
    pilot.
- **D2 — C++ runtime: linked statically, subject to the license review.**
  - This keeps libstdc++ out of `prerequisites`, and avoids requiring a newer
    runtime than glibc 2.35 systems ship.
  - If the review rejects static linking, the fallback is dynamic linking:
    the runtime joins the allowlist and `prerequisites`.
- **D3 — Fixture audio: recorded by the team.**
  - The fixtures are short recordings with the speakers' written permission to
    publish them in this repository.
  - A provenance file names the speaker, date, language and permission for
    each fixture.
  - Public dataset clips were not chosen, because their rights would need a
    clip-by-clip review.

## References

- [ADR-001](../decisions/001-pinned-upstream-producer.md), [ADR-002](../decisions/002-produce-native-feature-packs-beside-plugin-content.md), [SPEC-001](SPEC-001-agency-producer.md), [sourcing](../sourcing.md), [deployment](../deployment.md)
- [Platform SPEC-145](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-145-feature-packs-and-linux-dictation.md), [SPEC-146](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-146-dictation-language-for-desktop-voice-input.md), [SPEC-087](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-087-linux-composer-voice-input-via-bundled-whisper-cpp.md), [ADR-154](https://github.com/cats-inc/cats-platform/blob/main/docs/decisions/154-deliver-optional-native-dependencies-as-host-managed-feature-packs.md)

---

*Created: 2026-11-16*
*Related Plan: [PLAN-002](../plans/PLAN-002-linux-stt-pack-producer.md)*
