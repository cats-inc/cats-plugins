# Deployment and releases

There is no deployed service or install command. package.json is private to block
accidental npm publication. CI builds internal preview artifacts only.

The initial repository is authorized for direct commit/push to main. A release,
tag, catalog channel promotion, npm publication or Desktop integration needs its
own explicit scope. No publishing secrets or release workflow are configured.

Retain reviewed source snapshots and matching producer commits. Before a future
release, define Platform/Runtime compatibility, license/trust review, provenance,
artifact retention and upgrade/recovery acceptance. Within a 0.x minor line,
preserve public CLI/config/data contracts; breaking contracts require the next
minor. Stable 1.x breaking contracts require a major. Versioning does not replace
tested migration for persisted host state.
