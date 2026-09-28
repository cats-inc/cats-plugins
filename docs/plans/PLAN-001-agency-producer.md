# PLAN-001: Agency producer bootstrap and validation

## Metadata

Status: Completed (producer MVP only). Owner: Cats Plugins maintainers.
Related spec: [SPEC-001](../specs/SPEC-001-agency-producer.md).

## Implementation phases

- [x] Initialize with project-bootstrap minimal preset at the recorded commit.
- [x] Retain exact Agency sources/license and source lock; select two roles.
- [x] Reuse converter and implement metadata, artifact and integrity verification.
- [x] Add isolated regressions and cross-platform CI.
- [x] Complete local tests, artifact verification and independent review.
- [x] Push main and verify repository delivery.
- [x] Confirm remote CI including cross-platform artifact reproducibility.

## Technical decisions and risks

See [ADR-001](../decisions/001-pinned-upstream-producer.md). Converter execution is
trusted build code, not a generic Plugin sandbox. Producer success cannot satisfy
Desktop/Runtime lifecycle acceptance. Existing outputs are immutable; incomplete
builds require a fresh directory instead of guessed recovery.

## Testing strategy

Exercise real conversion in isolated temporary directories, byte-for-byte body
preservation under upstream normalization, license/source retention, malicious
path/ZIP cases and source/metadata tampering. Test output preservation and failed
build receipts. CI compares all three OS artifact digests.

## Progress log

2026-09-28: Windows Node.js 24.21.0 build, verification and all 11 final tests
passed. Independent review found metadata override, Git replacement-object
provenance, incomplete receipts and linked output ancestors; all four fixes and
regressions were independently rechecked with no remaining blockers.
Implementation commit `6944a36` is on main. All three OS jobs and the cross-platform
digest comparison passed in [CI run 36407755254](https://github.com/cats-inc/cats-plugins/actions/runs/36407755254).
See PROGRESS.md for the artifact digest and remaining host scope.

## Follow-up boundaries

Platform/Runtime installation, selection, lifecycle/re-entry, model-quality tests
and signed/retained release channels are separate work. cats-one workspace member
registration is also separate: its current contract requires four members, so
adding a mandatory fifth must account for existing developer workspaces.
