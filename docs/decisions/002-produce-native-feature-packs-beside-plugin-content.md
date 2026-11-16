# ADR-002: Produce native feature packs beside Plugin content

## Status

Proposed — 2026-11-16, at the owner's request. This is the producer half of
[Platform ADR-154](https://github.com/cats-inc/cats-platform/blob/main/docs/decisions/154-deliver-optional-native-dependencies-as-host-managed-feature-packs.md)
(proposed). Documentation only: it authorizes no pack source, CI workflow,
runner, secret, tag or release. [ADR-001](001-pinned-upstream-producer.md) is
unchanged for Plugin content. The owner delegated D1–D5, which are resolved
below.

## Context

ADR-001 produces one recipe of instruction content:

- It retains five upstream Git blobs and runs the pinned upstream converter.
- It emits a deterministic, uncompressed ZIP.
- CI compares the artifact digest from Windows, Linux and macOS
  ([SPEC-001](../specs/SPEC-001-agency-producer.md) AC-05).
- No converter executable is exposed to hosts.
- No release workflow or publishing secret exists ([deployment](../deployment.md)).

Platform ADR-154 proposes feature packs: optional native files that only host
code runs. Each product pins them by SHA-256 in its own lock and either
downloads them on first use or bundles them. ADR-154 recommends this repository
as the producer (its D2) and its GitHub Releases as the host (its D3).

The pilot is Linux dictation for Cats Desktop and Cats Bot, on Linux x64 and
arm64:

- a whisper.cpp helper that speaks the existing voice JSON-lines protocol;
- a multilingual Whisper model, ~140 MB according to
  [Platform ADR-085](https://github.com/cats-inc/cats-platform/blob/main/docs/decisions/085-bundle-whisper-cpp-on-linux-for-composer-voice-input.md).

A pack differs from Plugin content in five ways:

- **Size.** The source is a compiled project, not a few blobs. Retaining the
  whisper.cpp tree in Git would dwarf this repository. [Sourcing](../sourcing.md)
  already allows a retained source archive for a larger recipe, provided the
  commit, dependencies and content hashes are bound.
- **The model may not fit in Git.** The ~140 MB candidate is larger than the
  100 MB per-file limit GitHub enforces. A smaller model would fit, but the
  same pipeline should serve both.
- **Reproducibility.** Compiled binaries are not bit-identical across builds
  by default, so AC-05's cross-host digest match does not carry over.
- **Target machines.** A Linux binary depends on the oldest glibc it must run on
  and on system libraries such as the PulseAudio client. No declared baseline
  was found in Platform or Bot documentation.
- **Bridge code.** Cats owns the bridge between whisper.cpp and the voice
  protocol, including audio capture. ADR-122 §2 places such thin bridges in this
  repository.

## Decision

### 1. A second output kind in its own tree

- `plugins/<id>/` keeps ADR-001's Plugin content. Its pipeline and tests are
  unchanged.
- `packs/<id>/` holds each pack's recipe, source lock, bridge source, build
  scripts and tests.
- The Node tooling for lock verification, hashing, notices and receipts is
  shared. Packs never enter developer skill discovery or user profiles.
- Each build emits one archive per OS and architecture, plus a manifest. A pack
  SPEC fixes the archive format and extension once ADR-154 D1 settles the name.
- The manifest records:
  - pack identifier, version, OS, architecture and entry executable;
  - every file with its SHA-256;
  - the upstream commits and the model's identity and hash;
  - the helper protocol version, once Platform's successor SPEC defines one
    (today's voice contract has none);
  - declared system prerequisites, such as the PulseAudio client library;
  - the minimum glibc version;
  - the licenses.

### 2. Source and data acquisition

- **The source lock.** It binds the upstream repository URL, the full commit,
  and content hashes of the unpacked tree the build uses. It does the same for
  every dependency the build fetches. The lock does not treat a host-generated
  archive's bytes as source identity, since transport and content hashes serve
  different purposes ([sourcing](../sourcing.md)).
- **Fetching in CI.** CI fetches the exact commit with Git and verifies the
  commit and content hashes. It never falls back to a branch, a tag or "latest".
  There is no submodule and no vendored whisper.cpp tree.
- **Data such as the model** is pinned by URL, size and SHA-256 in the lock.
  CI fetches and verifies it, then packs it.
- **Retention.** Every release attaches a deterministic, Cats-generated archive
  of the exact source it built from. A moved or deleted upstream then stops
  neither rebuilding nor auditing (Platform SPEC-121 FR-10). A rebuild from
  that archive and the packed model must work with every upstream unreachable.
- **Updates** follow the sourcing review procedure. Each update is a
  lock-changing PR that carries:
  - the upstream compare range;
  - license and notice changes;
  - test evidence.

  Hashes are never recomputed to silence a mismatch.

### 3. Build

- Each target architecture builds and runs its tests on a runner of that
  architecture (D2).
- Builds run in a pinned environment, identified by image digest, that matches
  the declared Linux baseline (D1). The build receipt records the compiler,
  CMake, flags and image.
- whisper.cpp is linked statically. Dynamic links are limited to an allowlist of
  system libraries, such as glibc and the PulseAudio client.
- Archives are packed deterministically, with sorted paths and fixed timestamps.
  Binaries need not be bit-identical across builds.
  - The trust anchor is the published asset digest that products pin, together
    with the build receipt.
  - Reproducible builds may come later. A mismatch between rebuilds is not a
    release blocker.
  - ADR-001's cross-host digest comparison still applies to Plugin content.

### 4. Verification before publication

- **Binary checks.** Each ELF binary's architecture matches its archive. Its
  `NEEDED` entries stay within the allowlist, and its highest required glibc
  symbol version is no newer than the baseline.
- **Protocol test on each architecture.** The helper runs on fixture audio
  through its test-only input flag:
  - a normal run yields `ready` with `mode: 'on-device'`, then `final`, then
    `end`;
  - `cancel` yields `error: cancelled`, then `end`;
  - an unavailable input yields `mic_unavailable`.

  Protocol tests run without network access. The helper contains no network
  code.
- **Timings.** The receipt records ready time and capped-utterance
  transcription time per architecture. These inform Platform ADR-154 §4, but
  CI timings do not replace measurement on the slowest supported device.
- **Notices and limits.** Notices cover whisper.cpp, the model and every linked
  library. Archive size limits are enforced.

### 5. Publication

- Packs are published as GitHub Releases on this repository, one release per
  pack version, tagged `<pack-id>-v<version>`.
- Each release carries:
  - the per-architecture archives and their `.sha256` sidecars;
  - the manifest and the build receipt;
  - the source archive and the notices.
- Mechanics follow the
  [cats-one release guide](https://github.com/cats-inc/cats-one/blob/main/docs/release-guide.md).
  The per-artifact tag follows the precedent of cats-apps' `usage-vX.Y.Z`. A
  cats-plugins release SOP, written with the first authorized release, fixes
  the workflow, its trigger and its permissions.
- A published version is never rebuilt with changed bytes, and its tag is never
  recreated. Assets referenced by a released product lock are never replaced or
  deleted; a fix ships as a new version. Published releases are not edited, per
  AGENTS.md release completion.
- The first pack release needs the owner's explicit authorization. It also needs
  the deployment prerequisites:
  - compatibility;
  - license and trust review;
  - provenance;
  - retention;
  - upgrade and recovery acceptance.
- Products, not this repository, choose and pin pack versions. This repository
  does not update product locks.

### 6. Versioning and boundaries

- Pack versions are Cats-owned and independent of upstream tags, Plugin
  versions and product versions, under the 0.x policy. A helper protocol change
  that breaks hosts moves to the next minor.
- No install, download, update or removal code ships here; hosts own that
  (Platform ADR-154). Nothing here imports Desktop, Bot or Platform source.
- macOS and Windows packs, signing, and GPL-licensed packs such as FFmpeg are
  out of scope. Each needs a later decision and may justify a separate
  producer repository.

## Consequences

### Positive

- Desktop and Bot consume one artifact. cats-platform needs no submodule or
  whisper.cpp source.
- Source locks, notices and receipts are reused rather than rebuilt in a new
  repository.
- An upstream update becomes a reviewable lock diff.

### Negative

- Native toolchains, per-architecture runners and a baseline image need upkeep.
- The reproducibility guarantee is weaker for packs than for Plugin content.
- Pack builds fetch source and data, unlike ADR-001's offline Plugin builds.
  Only a rebuild from a release's retained source archive is offline.
- This repository takes on its first release workflow and asset retention.
- The repository name says "plugins" while it also produces packs.

### Neutral

- ADR-001's Plugin pipeline, artifact and tests are unchanged.
- Pack downloads rely on GitHub Releases availability. Products may later add a
  mirror without changing the pinned digests.

## Alternatives Considered

### Alternative 1: A separate producer repository

- **Pros**: The name fits, and signing secrets would be isolated from Plugin
  work.
- **Cons**: The source, license, receipt and release governance would be
  duplicated for one pilot.
- **Why rejected**: Premature. Revisit when the first macOS or Windows pack
  needs signing, or a GPL pack adds source-offer duties.

### Alternative 2: Build in each product repository

- **Pros**: No cross-repository release step. Bot already builds its macOS and
  Windows helpers this way (Bot ADR-018).
- **Cons**: Two builds of the same helper diverge, and Desktop and Bot pins
  drift.
- **Why rejected**: Platform ADR-154 wants one shared artifact.

### Alternative 3: A vendored source tree or a submodule

- **Pros**: Offline rebuilds without fetching.
- **Cons**: A vendored tree bloats history. A submodule brings the concerns
  that led Platform to reject ADR-085.
- **Why rejected**: The retained source archive on each release gives the same
  offline audit.

### Alternative 4: Git LFS for the model

- **Pros**: Keeps the model next to the recipe.
- **Cons**: LFS quotas and clone ceremony, and contributors fetch large files
  they rarely need.
- **Why rejected**: Releases already host the binaries.

### Alternative 5: Hosts download the model from upstream

- **Pros**: Cats hosts nothing large.
- **Cons**: A mutable or unavailable upstream would decide installed behavior.
- **Why rejected**: ADR-001 already rejected downloading latest inputs at
  installation.

## Resolved decisions

The owner delegated D1–D5 on 2026-11-16.

- **D1 — Linux baseline: glibc 2.35.**
  - Pack binaries build in an `ubuntu:22.04` image pinned by digest. They may
    require no glibc symbol newer than 2.35.
  - That covers Ubuntu 22.04 and later, Debian 12 and later, and distributions
    built on them.
  - Audio uses the PulseAudio client library. PipeWire systems provide it
    through their PulseAudio compatibility layer. ALSA-only systems remain
    unsupported, as in SPEC-087.
  - A product that needs an older baseline asks for a new pack build. A product
    may require a newer one without any change here.
- **D2 — arm64 build: native.**
  - x64 and arm64 each build and test on GitHub-hosted runners of their own
    architecture, inside the same pinned image. There is no cross-toolchain.
  - If such runners stop being available to this repository, cross-compiling
    needs a new decision.
- **D3 — Model and licenses.**
  - The model comes from the whisper.cpp project's model repository on Hugging
    Face, fetched by a revision-pinned URL and verified by SHA-256.
  - The candidates, in order:
    1. multilingual `ggml-base`, ADR-085's choice;
    2. a quantized multilingual base variant;
    3. multilingual `tiny`.
  - English-only models are excluded, because owners dictate in other
    languages.
  - The chosen model is the first candidate that passes Platform ADR-154 §4's
    measurement on the slowest supported arm64 device. The pack recipe and the
    release notes record it.
  - Every pack ships whisper.cpp's license, the model's license text and notices
    for every linked library. The first release's license review records where
    each came from. No pack is published before that review.
- **D4 — Names: `packs/`, `linux-stt` and `linux-stt-vX.Y.Z`.**
  - The directory and the tag do not depend on the term that Platform ADR-154
    D1 settles. The pack SPEC still fixes the archive extension.
  - The pilot pack identifier is `linux-stt`, matching Desktop's `macos-stt`
    and `windows-stt` helpers. Its executable is `cats-stt-linux`, as SPEC-087
    named it.
- **D5 — Scope description: keep the name; update descriptions with the first pack.**
  - The repository stays `cats-plugins`.
  - README, the AGENTS purpose line and the workspace manifest's description
    (in cats-one's template) change in the same change that adds the first
    pack. They never describe a pack that does not exist yet.

## References

- [ADR-001](001-pinned-upstream-producer.md), [SPEC-001](../specs/SPEC-001-agency-producer.md), [sourcing](../sourcing.md), [deployment](../deployment.md)
- [Platform ADR-154](https://github.com/cats-inc/cats-platform/blob/main/docs/decisions/154-deliver-optional-native-dependencies-as-host-managed-feature-packs.md) (proposed)
- [Platform ADR-122](https://github.com/cats-inc/cats-platform/blob/main/docs/decisions/122-adopt-managed-plugins-for-upstream-capabilities.md) and [SPEC-121](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-121-managed-plugin-capabilities.md)
- [Platform ADR-085](https://github.com/cats-inc/cats-platform/blob/main/docs/decisions/085-bundle-whisper-cpp-on-linux-for-composer-voice-input.md) and [SPEC-087](https://github.com/cats-inc/cats-platform/blob/main/docs/specs/SPEC-087-linux-composer-voice-input-via-bundled-whisper-cpp.md)
- [Bot ADR-018](https://github.com/cats-inc/cats-bot/blob/main/docs/decisions/018-dictate-through-native-speech-helpers.md)

---

*Proposed: 2026-11-16*
*Decision makers: Owner (pending)*
