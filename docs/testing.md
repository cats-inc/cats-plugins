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

For changes outside root `docs/`, CI runs this suite on Node.js 24 across Ubuntu, Windows and macOS, retains the
three preview artifacts for 14 days, then compares their SHA-256 sidecars.
Like the other Cats repositories, a `changes` job detects docs-only updates: PRs
compare the test merge to its first parent; pushes compare the entire pushed
range. Renames include both paths. Unknown bases, empty diffs, failed detection
and manual dispatches run the full suite.

Confirmed docs-only updates preserve the required `producer (...)` check names
with lightweight Ubuntu acknowledgements and skip dependency installation,
tests, packaging and artifact upload. `reproducibility` still requires successful
producer checks, then acknowledges that no artifacts need comparison. Mixed
changes retain the complete matrix and hash comparison. No Windows/macOS runner
is allocated for docs-only work. Tests exercise the workflow's actual detection
and final job gate and keep executable inputs independent of repo documentation.

A push to `main` is acknowledged the same way when its merged pull request already
passed on the same tree. `main` requires up-to-date branches, so a squash merge
usually lands exactly what the pull request's CI tested. The `changes` job reuses
that run only when all of these hold:

- the push adds one commit on the previous `main`;
- the GitHub API names that commit as a pull request's merge;
- the request's final head, fetched from `refs/pull/<n>/head`, contains the
  previous `main` and has the pushed commit's tree;
- CI passed on that head as a `pull_request` run.

The pull request's run then holds the preview artifacts and their hash comparison.
Any other push, or any failed lookup, runs the full matrix. `tests/ci.test.mjs`
runs this step against a local origin with a stubbed `gh`.

A CI artifact is not a published release. For stale local output, select a new
directory instead of replacing a mismatch.

Unverified here: Runtime managed registration, Desktop install/remove UI,
session revocation/re-entry, resume/fork provenance and actual model quality.
Those belong to the host integration acceptance plan.
