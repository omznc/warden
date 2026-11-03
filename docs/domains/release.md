# Release

## Cut a release

1. Make sure CI passes on master.
2. Write the upgrade note, if the release needs one (see "Version rules").
3. Make the tag on master: `git tag vX.Y.Z`.
4. Push the tag: `git push origin vX.Y.Z`.

The project has no VERSION file. The tag is the only version source.
A tag must match `v*.*.*`. Never move or delete a tag after the push.

## What the workflow does

The workflow `.github/workflows/release.yml` runs on a tag push only.

1. It runs the same checks as `ci.yml`. A failed check stops the release.
2. It builds two images for linux/amd64: `warden-runner` and `warden-ui`.
   The tester service uses the `warden-runner` image.
3. It pushes the images to `ghcr.io/<owner>/<name>` with three tags:
   `X.Y.Z`, `X.Y` and `latest`.
4. It creates the GitHub release with generated notes.

The workflow builds for amd64 only. Add arm64 later if a user needs it.
The QEMU build time is not measured.

## Upgrade

Pull the new images and restart:

```sh
docker compose pull && docker compose up -d
```

To use a fixed version, set `WARDEN_VERSION=X.Y.Z` in `.env`.
The default is `latest`. To use a fork, set `WARDEN_IMAGE_OWNER`.

To build the images from source, run `docker compose build` and then
`docker compose up -d`.

## Version rules

The project uses semantic versioning.

The first release is v1.0.0.

- A breaking change is a major release (X.0.0). These changes are breaking:
  - a change to the state layout;
  - a change to a settings key;
  - a change to an environment variable name;
  - a change to a compose volume.
- A new feature that does not break a user is a minor release (1.X.0).
- A bug fix is a patch release (1.0.X).
- A release with a state or settings change must have an upgrade note in
  the release text. The note says what the user must change.
