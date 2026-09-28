# SPEC-001: Agency Agents producer MVP

## Metadata

Status: Implemented; cross-platform CI confirmation pending. Owner: Cats Plugins maintainers.
Scope: producer only; host lifecycle remains in Platform SPEC-121.

## Summary and goals

Build a reviewable, reproducible artifact from two pinned upstream roles without
rewriting role content or installing anything into a live agent environment.

## Non-goals

Runtime registration, provider adapters, Desktop UI, arbitrary Plugin ingestion,
model quality claims, executable lifecycle hooks, marketplace publication and
migration of previously authored Cats skills.

## Requirements and acceptance

- AC-01: Exact commit plus sizes/SHA-256 cover the two roles, license and converter
  dependency closure. Modified, missing, extra or linked source inputs fail.
- AC-02: Invoke the pinned upstream converter in a temporary directory; keep role
  bodies under its documented normalization, preserving originals separately.
- AC-03: Emit exactly work/agency-code-reviewer and work/agency-ux-researcher with
  valid namespaced metadata, no hooks/permissions and pending host compatibility.
- AC-04: Artifact includes MIT text, originals, recipe, lock, build input hashes
  and per-file integrity. Full artifact digest is recorded separately.
- AC-05: Repeated builds produce identical bytes; compare Windows/Linux/macOS CI.
- AC-06: Verifier rejects tampering, unsafe paths, extras, duplicates, unsupported
  archive encoding and limits; no extraction/execution occurs.
- AC-07: CLI preserves existing mismatched/incomplete output and rejects linked
  write destinations/ancestors. Success requires a complete build receipt.
- AC-08: Imports use exact Git objects with replace refs disabled, never dirty
  files or moving-ref fallbacks, and never execute upstream installers.
- AC-09: No user state, profile, live model, service port or developer skill
  discovery is changed. Product payload is separate from maintenance skills.

## Dependencies and design

Node.js 24, Bash and standard Unix utilities, pinned fflate/YAML. See
[architecture](../architecture.md) and [ADR-001](../decisions/001-pinned-upstream-producer.md).

## Remaining host questions

Managed capability discovery, explicit user selection, publisher trust, installation
storage, clean-context re-entry and lifecycle operation recovery need host work.

Related plan: [PLAN-001](../plans/PLAN-001-agency-producer.md).
