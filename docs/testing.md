# Testing

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run verify
```

`npm run check` combines tests/build/verify. Tests use temporary directories and
run the hash-checked upstream converter. They cover two-role body preservation,
license/provenance, repeatability, tampered sources, extra files, mutable refs,
metadata identity, path/link rejection, ZIP tampering/limits, CLI non-overwrite
and incomplete receipts. No CLI account, model, user config or Cats state is used.

Feature pack commands are separate from the Plugin build:

```sh
npm run pack -- check linux-stt
npm run pack -- fetch linux-stt --out NEW_DIR [--model FILE|all]
npm run pack -- verify-sources linux-stt NEW_DIR/linux-stt-0.1.0-sources.tar
```

`fetch` needs the network. It fetches the locked whisper.cpp commit by hash
(never a branch or tag), checks its tree id, file count and content hash, and
downloads each chosen model, keeping it only when its size and SHA-256 match.
Only then does it write the retained source archive (uncompressed ustar) and
the models. `tests/packs.test.mjs` needs no network. It uses Git fixture
repositories built from plumbing, an injected model transport and a golden
archive digest, and covers each tamper case of SPEC-002 AC-01.

Unless a change is documentation only or already passed (below), CI runs this
suite on Node.js 24 across Ubuntu, Windows and macOS, retains the three preview
artifacts for 14 days, then compares their SHA-256 sidecars. Documentation is root `docs/` plus the root
agent instructions (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `GEMINI.md`) when they
are added or modified. Deleting, renaming or changing the file type of one of
those four, or changing a nested `AGENTS.md`, counts as code. Tests, scripts and application sources must
not read their content; checking that one exists is allowed.

Like the other Cats repositories, a `changes` job detects documentation-only
updates: PRs compare the test merge to its first parent; pushes compare the
entire pushed range. Renames include both paths. Unknown bases and empty diffs
never count as documentation only, and failed detection and manual dispatches
run the full suite.

Confirmed documentation-only updates preserve the required `producer (...)`
check names with lightweight Ubuntu acknowledgements and skip dependency
installation, tests, packaging and artifact upload. `reproducibility` still
requires successful producer checks, then acknowledges that no artifacts need
comparison. Mixed changes retain the complete matrix and hash comparison. No
Windows/macOS runner is allocated for skipped work. Tests exercise the
workflow's actual detection and final job gate and keep executable inputs
independent of repo documentation.

Code that already passed is acknowledged the same way. The `changes` job
fingerprints the mode, blob and path of every tracked file outside `docs/`; the
four root agent files keep their mode, path and presence but not their content.
After every producer passes and the hashes match, `reproducibility` saves a
`ci-green-v1-<fingerprint>` cache marker. A later run with the same fingerprint,
such as a rebase that only brings in documentation, finds the marker and skips.
Manual dispatches never look one up. A pull request's markers are visible only
to that request, so a push to `main` also checks its merged pull request.

A push to `main` is acknowledged the same way when its merged pull request already
passed on the same tree. `main` requires up-to-date branches, so a squash merge
usually lands exactly what the pull request's CI tested. The `changes` job reuses
that run only when all of these hold:

- the push adds one commit on the previous `main`;
- the GitHub API names that commit as a pull request's merge;
- the request's final head, fetched from `refs/pull/<n>/head`, contains the
  previous `main` and has the pushed commit's tree;
- CI passed on that head as a `pull_request` run.

A skipped run uploads no preview artifacts; an earlier run of the same code built
and compared them. No other workflow or release downloads artifacts from a
specific CI run. Any other push, or any failed lookup, runs the full matrix.
`tests/ci.test.mjs` runs these steps against local repositories, a local origin
and a stubbed `gh`.

A CI artifact is not a published release. For stale local output, select a new
directory instead of replacing a mismatch.

Unverified here: Runtime managed registration, Desktop install/remove UI,
session revocation/re-entry, resume/fork provenance and actual model quality.
Those belong to the host integration acceptance plan.
