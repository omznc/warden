# Coolify integration

Warden reads Coolify with the GET method only. It never changes anything on Coolify.

## Setup

1. In Coolify, open Keys & Tokens, API tokens. Create a token with `read` and `read:sensitive`. Give it no other ability.
2. In Warden, open Settings, Integrations, Coolify. Add the instance: a name, an https URL with no path, and the token.
3. Open the settings of a project. Link the apps of the instance in the card "Coolify apps". Add the scout `coolify`.

## Where the data goes

- `settings.json` holds `coolify: [{name, url}]`. Each change asks for the Warden password.
- The token is the secret `COOLIFY_TOKEN_<NAME>` (the name in upper case, `_` for `-`). The runner holds it. The browser and the agent never get it.
- `inbox.sh` checks a new token. A token can be `ok`, `warn` (it can write), or `invalid`.
- `inbox.sh` records the URL that it checked in `coolify-urls.json` in the secrets directory. `coolify_get` refuses another URL. A new URL needs the token again.
- A token set in the compose environment (not in the UI) is not bound to a URL. `coolify_get` sends it to the URL in the settings, so protect the settings file.
- `projects.json` holds `coolify: [{instance, app_uuid}]` for each project (at most 10).
- `discover.sh` lists the apps of each instance in `discovery.json`: name, uuid, repository, domain, status.
- The scout `coolify` gets `coolify.json` and `coolify-logs/` in its state directory. The runner keeps the digest in `<project>/coolify.seen.json`.
  The runner writes the digest only after a run that handled all findings. A finding that a dry run only logged, a blocked finding, or a finding that a cap or the mode skipped, leaves the digest unchanged. The next run then reads the same data again.

## API facts (Coolify 4.5.3)

The facts come from the instance (`GET /api/v1/version`, 4.5.3), from `openapi.json` at the tag v4.5.3 in coollabsio/coolify, and from the pages https://coolify.io/docs/api/authorization and https://coolify.io/docs/api/permissions.

- `GET /api/v1/applications` lists the applications. Each has `git_repository`, `fqdn`, `status` (`<state>:<health>`, for example `running:healthy`), `build_pack`, `restart_count`, the health check fields (`health_check_*`), the limits (`limits_*`) and `custom_docker_run_options`.
  The list also has secret fields: `manual_webhook_secret_*`, `docker_compose_raw`, `custom_labels`, `http_basic_auth_password`. Warden keeps an allowlist of fields.
- `GET /api/v1/deployments/applications/{uuid}?skip=&take=` lists the deployments: `status`, `commit`, `commit_message`, `created_at`, `finished_at`. Each also has the build log in `logs`. Warden drops it.
- `GET /api/v1/applications/{uuid}/logs?lines=N` gives `{"logs": "..."}`. `lines` is at most 10000. It answers 400 when the application is not running. It needs `read:sensitive` or `root`.
- `GET /api/v1/servers`, `/services` and `/databases` exist. Warden does not use them yet.
- Abilities: `read` (no sensitive values), `read:sensitive` (secrets, logs, env values, Compose content), `write`, `deploy`, `root`. The API has no call that lists the abilities of a token. A 401 means a bad token. A 403 means that the ability is missing.
  The token check is a probe: webhook secrets in the application list mean `write`, and a 403 on the log request means no `read:sensitive`. A token with only `deploy` is not detected.
