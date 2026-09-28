# ADR-001: Retain pinned upstream inputs and reuse the Agency converter

## Status

Accepted for the authorized producer MVP, 2026-09-28.

## Context

Cats needs a fourth optional capability category alongside Runtime, Platform
products and Apps. Upstream sources may have no release channel, and the first
Agency candidate consists of instruction roles rather than an independent provider.

## Decision

Keep recipes, exact Git commits, file hashes, selected upstream blobs and licensing
in cats-plugins. Reuse the pinned upstream converter's standard SKILL format, add
Cats metadata and namespaced slugs, and create a deterministic internal preview
ZIP. Retain two roles rather than all upstream roles. Keep producer artifacts
outside developer skill discovery. Do not replace Runtime built-in skills.

Use Node.js 24 ESM with pinned YAML/ZIP libraries and node:test. No server, general
Plugin SDK or host installer is needed for this producer. Zero executable hooks
are declared. The .catsplugin preview format is not a frozen host contract.

## Consequences

Positive: offline rebuilds, explicit license/provenance, small auditable source
closure, independent Cats versions without upstream releases.

Negative: retained upstream snapshots require deliberate review/update; the
converter requires Bash at build time. ZIP storage favors deterministic bounded
verification over compression. Host usability still requires subsequent work.

Compatibility: no host state is written or migrated. Future host formats require
versioned compatibility and tested upgrades. Initial internal version is 0.1.0;
this does not authorize release.

## Alternatives considered

- Submodule: preserves a whole repository relationship, but adds checkout/fetch
  requirements and does not itself retain deleted remote commits. Allowed later
  with lock consistency; unnecessary for five selected blobs.
- Download latest during installation: rejected; mutable inputs and upstream
  availability would determine installed behavior.
- Rewrite all roles/conversion: rejected; upstream content and converter already
  provide the value. Cats owns only the metadata/envelope and validation.
- Immediate Desktop/Runtime implementation: deferred; producer validation must not
  imply session/lifecycle correctness.

## References

[Platform ADR-122](https://github.com/cats-inc/cats-platform/blob/main/docs/decisions/122-adopt-managed-plugins-for-upstream-capabilities.md),
[SPEC-001](../specs/SPEC-001-agency-producer.md), [sourcing](../sourcing.md).
