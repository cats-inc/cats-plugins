# Security boundaries

Retained third-party code is still executable build code. Hashes identify reviewed
inputs; they do not make arbitrary upstream scripts trustworthy. Review converter
and dependency changes before running them. A temporary directory is file
isolation, not an OS security sandbox. Build on a controlled CI machine.

The builder invokes only the pinned converter; never upstream install.sh. No
credentials, global agent profiles, Runtime sessions, local production state,
network listeners or publisher keys are used. The artifact carries instructions,
not executable hooks. Role persona/memory claims do not grant real memory/tools.

The verifier accepts only this checkout's approved canonical payload, bounded
stored ZIP entries and exact hashes. It never extracts files. SHA-256 sidecars
are not signatures. A production installer still needs publisher trust, managed
storage ownership, permissions, transactional lifecycle/recovery and session
admission/re-entry checks; see platform SPEC-121.

Repository input/output link checks prevent accidental redirected paths, but the
developer checkout and concurrent filesystem mutation are trusted. This CLI is
not a hostile multi-user installer. Do not present it as one.
