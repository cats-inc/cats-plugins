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

CI runs this suite on Node.js 24 across Ubuntu, Windows and macOS, retains the
three preview artifacts for 14 days, then compares their SHA-256 sidecars.
A CI artifact is not a published release. For stale local output, select a new
directory instead of replacing a mismatch.

Unverified here: Runtime managed registration, Desktop install/remove UI,
session revocation/re-entry, resume/fork provenance and actual model quality.
Those belong to the host integration acceptance plan.
