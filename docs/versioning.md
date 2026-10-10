# Versioning and releases

pxls follows [Semantic Versioning](https://semver.org/). Changes are recorded in [CHANGELOG.md](../CHANGELOG.md).

## Roadmap

| Version | Notes |
|---|---|
| 0.1.0 | First release: the Node app (Next.js UI, API and display engine in one container). |
| 1.0.0 | Cut once the product is verified on real hardware and stable. |

Before 1.0.0, a minor bump (0.x → 0.y) may include breaking changes. Note them in the changelog.

## Before going public

The repository is private. Making it public cannot be undone safely: forks and caches keep the history.

- [ ] Scan the full history for secrets: `gitleaks git --log-opts="--all"`.
- [ ] Run the [device test checklist](protocol.md#device-test-checklist) on a real Pixoo.
- [ ] Restrict who can create `exp/**` branches (see the header of `.github/workflows/exp-images.yml`).
- [ ] Make the repository public in GitHub settings.
- [ ] Make the GHCR package `pxls` public under its package settings. Packages do not follow the repository's visibility, and a public package cannot be made private again.

## Cutting a release

1. Move the `[Unreleased]` section of `CHANGELOG.md` to `[X.Y.Z] - YYYY-MM-DD` and add the compare link.
2. Set the version in `web/package.json` (the images take their version from the git tag, so this keeps the two in step).
3. Commit with a DCO sign-off: `git commit -s`.
4. Tag on `main`: `git tag vX.Y.Z`. For a dry run, use a prerelease tag such as `vX.Y.Z-rc.1`. Tags containing `-` are marked as prereleases and do not move `latest`.
5. Push the tag: `git push origin vX.Y.Z`. This runs `.github/workflows/release.yml`, which publishes the semver and `latest` images and creates the GitHub release.
6. Check the workflow run, then deploy with `PXLS_TAG=X.Y.Z docker compose up -d`.
