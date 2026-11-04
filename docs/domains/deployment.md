# Deployment

Warden runs as three containers from `compose.yaml`. Use `podman compose` (or `docker compose`).

## Services

| Service | Image | Job |
|---|---|---|
| `runner` | `warden` (`Containerfile`) | The loop: `bin/run-all.sh`. It runs the scouts, the inbox, the discovery, the submit step, the GitHub sync and the weekly summary. It runs as the user `runner`. |
| `tester` | `warden` | `bin/tester.sh`. No network, no secrets, no state. See `tester.md`. |
| `ui` | `warden-ui` (`app/Containerfile`) | The web app on port 8650. It is bound to `127.0.0.1:8650` on the host. |

- The `warden` image is `node:22-slim` with `git`, `gh`, `jq`, `openssl`, `sudo`, `bun` and `claude`. It copies the whole repository to `/app`, owned by root.
- The `jq` in the image is version 1.6. It is older than the `jq` on most hosts. Run the shell tests in the image.
- The UI image builds with `bun` and runs `.output/server/index.mjs` as the user `bun`. The UI and the runner must use the same uid for the shared files. Check this when you change a base image.
- `.dockerignore` keeps `.env`, `.git` and `app` out of the runner image.

## Volumes

| Volume | Mounted in |
|---|---|
| `state` | runner `/state`, ui `/state` |
| `work` | runner `/work` |
| `inbox` | runner `/inbox`, ui `/inbox` |
| `secrets` | runner `/secrets` only |
| `tests-in` | runner `/tests-in`, tester `/tests-in` (read-only) |
| `tests-out` | runner `/tests-out` (read-only), tester `/tests-out`, ui `/tests-out` (read-only) |

- Do not mount `secrets` in the UI or the tester.
- The UI gets only these variables from `.env`: `WARDEN_USER`, `WARDEN_PASSWORD`, `WARDEN_SESSION_SECRET`, `MODE`, `INTERVAL_HOURS`, `MAX_TURNS`, `HERMES_WEBHOOK_URL`, `WARDEN_URL`. It never gets a token.
- Passkeys need `WARDEN_URL` in `.env` with an `https` address, for example `https://warden.example.com`. The UI takes the passkey RP ID and origin from this value only, not from a request header. The "Warden URL" setting in the UI does not change them. Without `WARDEN_URL`, only `http://localhost:8650` works. If the address is not valid, the passkey controls stay hidden.
- Set `WARDEN_SESSION_SECRET`, or keep the `state` volume. Without the secret, the UI keeps a session key in `/state/ui-session-key.json`.
- The runner reads the whole `.env` (`env_file`).
- `/work` and `/state` can come from an older image. `harden_dirs` fixes the modes at the start.

## Start

1. Copy `.env.example` to `.env`. Set the tokens and `WARDEN_PASSWORD`.
2. Optional: copy `projects.example.json` to `projects.json`. The runner uses it as the first list only.
3. Run `podman compose up -d --build`.
4. Run one scout one time: `podman compose run --rm -e ONCE=1 runner bin/run-all.sh <project> <scout>`.
5. Move the mode up one step at a time: `dry`, `issues`, `prs`.

`INTERVAL_HOURS` (default 12) sets the gap between passes. The loop wakes about each minute for the inbox, the submit step and the requests.

## Behind a proxy

- Copy `compose.override.example.yaml` to `compose.override.yaml`. Compose reads it with `compose.yaml`.
- The override joins the UI to an external proxy network, with the container name `warden-ui`. The proxy reaches it at `warden-ui:8650`.
- The override joins the runner to an optional external Hermes network. Remove the Hermes part if you do not use Hermes.
- Set `PROXY_NETWORK` and `HERMES_NETWORK` in `.env` to change the network names. Create the networks first.
- The proxy must forward `Host` and `X-Forwarded-Proto`. A mutation needs an `Origin` host equal to the `Host` header.
- `compose.override.yaml` and `.env` are local. Do not commit them. `projects.json` is in `.gitignore` too.

## Upgrade notes

- Rebuild both images: `podman compose up -d --build`.
- The runner moves old data when needed: it deletes the old `seen.json` of a scout, and reads the old key `auto_submit_prs`.
- An item from an older version may have no `footer` or no `kind`. The code handles both.
- A change in the sudoers file or in the modes needs a new image, not only a restart.
- Check CI after a change: `.github/workflows/ci.yml` builds the image, runs `shellcheck`, the shell tests, the app checks and the build.

## rsync caveats

If you copy the repository to a server with `rsync`, take care:

- Do not copy `.env` or `projects.json` with real data to a place you do not control.
- Use `--exclude` for `.git`, `node_modules` and `.output`.
- Do not use `--delete` on a directory that holds `.env` or `compose.override.yaml`.
- The files in `bin/` must stay executable (`chmod 755` is set in the image build, so the build fixes it).
- Rebuild the image after the copy. The image holds a copy of the code, not a mount.
