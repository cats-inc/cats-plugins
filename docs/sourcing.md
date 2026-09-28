# Pinned upstream sources

The default is a recipe plus source lock, independent of upstream release channels.
Agency is pinned to commit `479193dcce1cf6432ce0f5aa230ab8cc739a8c6b`.
The source lock covers five original Git blobs: two roles, license and both
converter scripts. Retaining this small source closure in Git gives offline
rebuilds and survives deleted/moved upstream refs.

No submodule is required. A future larger recipe may use a submodule or retained
source archive, but it must still bind the complete commit, dependencies and
content hashes. A branch name, latest URL or upstream version label is insufficient.
Never fall back to main when a pinned source is missing. Archive transport hashes
and unpacked content hashes serve different purposes.

## Import and review an update

1. Obtain the expected full commit from the canonical upstream repository in an
   isolated maintainer checkout. Verify repository origin and commit provenance;
   the importer can prove Git object identity, not ownership of an arbitrary clone.
2. Import into a fresh candidate directory:

   ```sh
   node scripts/import-agency.mjs /path/to/reviewed/agency-agents FULL_40_HEX_COMMIT .tmp/agency-candidate
   ```

3. Review candidate source/license/script diffs against the current snapshot before
   executing new scripts. Import reads Git blobs with replace objects disabled,
   does not use dirty checkout files, and refuses links or an occupied destination.
4. Deliberately replace the reviewed snapshot/lock in plugins/agency-agents,
   update recipe/version and notices when appropriate, and preserve source licenses.
   Review source and recipe changes together; never recalculate hashes just to
   silence an unexpected mismatch.
5. Run isolated tests/build/verification, obtain independent review, and commit
   the source lock, snapshot, recipe and evidence together.

The importer is Agency-specific, not a general downloader or automatic updater.
It has no network operation, moving-ref fallback, upstream install or submodule/LFS
resolution. A future source requiring those needs explicit pinned handling.

Plugin version/channel are Cats-owned. No upstream release is needed to build
our internal preview. Publication and promotion remain separate authorized steps.

References: [Git submodules](https://git-scm.com/docs/gitsubmodules),
[GitHub source archives](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives).
