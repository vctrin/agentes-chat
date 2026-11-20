# agentes.chat on Dokploy

The app and Postgres with pgvector, as one Dokploy Docker Compose application. Unlike
[`../coolify/`](../coolify/docker-compose.yaml), Dokploy does not generate a domain or any
secret for you: you set `PUBLIC_URL`, `AGENTES_SECRET` and `POSTGRES_PASSWORD` yourself, once,
under the application's Environment tab.

```
docker-compose.yaml   the stack: agentes (built from this repository) + postgres
```

Settings are not duplicated here: every one the app reads is listed, annotated, in the
repository's [`.env.example`](../../.env.example).

Everything the app does, and everything else about self-hosting it, is in
[`SELF_HOSTING.md`](../../SELF_HOSTING.md).

## Requirements

- Dokploy, current release, on a Linux server (a fresh install also works: Dokploy's own
  installer puts Docker and itself on the machine in one step).
- 2 vCPU, 4 GB RAM and 20 GB disk to start (the image is about 2 GB, and the database and the
  files volume grow with use). 8 GB if agents will run commands and a browser on this machine.
  On a 4 GB host set `AGENTES_MEMORY=3g` (below) so the app's cap still protects Postgres.
- A domain you can point at the server, for HTTPS (Dokploy uses Traefik and Let's Encrypt, same
  as Coolify's setup).
- Outbound HTTPS to the model providers your organizations use.
- **Oracle Cloud specifically:** the host firewall (`iptables`/`firewalld`, on by default on
  Oracle Linux images) and the instance's Security List or Network Security Group both block
  inbound traffic until you open them. Allow `80/tcp` and `443/tcp` in both places, not just one
  — Dokploy's Traefik answers on those ports.

## 1. Create the application

1. **Create Project → Application**, type **Docker Compose**, source: this Git repository (your
   fork, if you deploy from one).
2. **Compose Path: `deploy/dokploy/docker-compose.yaml`**. Without it Dokploy looks for a
   `docker-compose.yml` at the repository root, which expects the interactive setup and its own
   `.env` — not this flow.
3. Branch: the one you deploy from. Leave auto-deploy on only if you want a push to redeploy.
4. The `build:` context in this file (`../..`) is relative to the compose file itself, so it
   resolves to the repository root, where the `Dockerfile` is — Dokploy builds it there.

## 2. The variables you set

Under this application's **Environment** tab, add:

| Variable | What it is |
| --- | --- |
| `PUBLIC_URL` | The exact address people open, once you've chosen it in step 4 below (scheme, host, no port, no trailing slash): `https://chat.example.com`. Sign-in, the only browser origin allowed to change anything, and every link the app sends come from it. |
| `AGENTES_SECRET` | Signs sessions and encrypts every key an organization stores (model providers, connectors, mailboxes, databases). Generate with `openssl rand -hex 32`. Never change it on a running instance. |
| `POSTGRES_PASSWORD` | The database password, used only inside `DATABASE_URL`. Generate with `openssl rand -hex 24`. |

Optional, with defaults already in the compose file:

| Variable | Default | What it is |
| --- | --- | --- |
| `AGENTES_IMAGE` | `agentes-chat:dokploy` | The local tag the build produces. Change it only if you drop `build:` to run a prebuilt image instead. |
| `AGENTES_MEMORY` | `8g` | The cap on the app's memory, swap included. |

You don't yet have a domain to put in `PUBLIC_URL` the first time through — use a placeholder
(`https://pending.example.com`) and come back to fix it after step 4; the app refuses sign-in
with the wrong one, but it still boots.

## 3. First deploy

Deploy. The first boot runs the database migrations: the healthcheck reports `starting` and the
app answers 503 for a minute or two on a fresh volume, then `healthy`.

## 4. Attach your domain

1. Point the domain's DNS record (an `A` record) at the server. Wait for it to resolve.
2. On the `agentes` service, **Domains → Add Domain**: your domain, container port `3000`,
   HTTPS on (Let's Encrypt). Use **Preview Compose** first if you want to see the file Dokploy
   will actually run, labels included.
3. Set `PUBLIC_URL` under Environment to that same address, exactly as people will type it:
   `https://chat.example.com`, no trailing slash, no port.
4. **Redeploy.** Until `PUBLIC_URL` matches the domain, sign-in fails with "Invalid origin" and
   saving fails with `bad_origin`.

Confirm what the app sees:

```sh
docker exec $(docker ps --format '{{.Names}}' | grep agentes | head -1) printenv PUBLIC_URL
```

## 5. The first account owns the instance

Sign-up is closed by default (`ALLOW_SIGNUP=false`), with one exception: while no account
exists, the first one to sign up becomes the owner. Open your domain and create it now; after
that, people join by invitation from **Settings → Members and invitations**.

If the instance will be reachable before you can get to it, or you want to be the only one who
can claim it, set `OWNER_CLAIM_SHA256` before the first deploy (same recipe as Coolify's
[`README`](../coolify/README.md#5-the-first-account-owns-the-instance)) — add its own
`environment:` line for it in `docker-compose.yaml`, the same way `PUBLIC_URL` is wired, then
set the variable and redeploy.

Model keys are not here: each organization adds its own under **Settings → AI and usage**.

## 6. Verify

- `curl -fsS https://chat.example.com/api/health` answers `{"status":"ok"}`.
- Sign in, and a second message in a channel arrives without reloading (WebSockets).
- Send a small file in a chat and open **Drive**: uploaded files land on the `files` volume.
- Create an agent with the organization's model key; it answers in a channel.
- Both containers are healthy: `docker ps` shows `postgres` and `agentes` as `healthy`.

## 7. Configure

Every setting the app reads is in the repository's [`.env.example`](../../.env.example): what it
does, its default, and how to turn it on. Unlike Coolify, adding a value under Dokploy's
Environment tab alone is not confirmed to reach the container — add its own `environment:` line
in `docker-compose.yaml` the same way `PUBLIC_URL` and `AGENTES_SECRET` are wired, e.g.:

```yaml
    environment:
      SMTP_URL: "${SMTP_URL:-}"
```

then set `SMTP_URL` under Environment and redeploy. The ones most instances add this way:
`SMTP_URL` or `MILLIONSEND_API_KEY` (invitations, password resets and budget alerts; without
them those emails go to the container log instead), `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID`
(sign-in), `SOURCE_URL` (where the About screen points for this instance's source, AGPL-3.0 §13
— set it if you run a modified version), `S3_*` (files in a bucket instead of the volume),
`LOG_LEVEL`.

Two defaults send data to the project that makes agentes.chat:

- `TELEMETRY=on` posts one anonymous usage report a day to `https://telemetry.agentes.chat`
  (counts, sizes, tokens used; never messages, files, names or sites).
- `FEEDBACK_RELAY=true` sends what someone types into the feedback form, when they press send.

Wire both (`TELEMETRY`, `FEEDBACK_RELAY`) the same way to turn them off.

## 8. Upgrade

Redeploy: Dokploy pulls the branch at its latest commit and rebuilds the image from
`Dockerfile`. Migrations run on boot; no separate step. Pin a version instead of tracking a
branch by deploying a tag or a specific commit from Dokploy's source settings.

Keep a note of the commit or tag you're on before upgrading — migrations do not reverse, so
rolling back means redeploying that same commit, not a generic "previous image" button.

After an upgrade, `bun run docs:env` (run from a checkout) regenerates `.env.example`: read it
again for the settings a new version adds.

## 9. Backup and restore

Everything lives in three places, and a backup of one alone is not a backup:

```sh
# 1. the database
docker exec $(docker ps --format '{{.Names}}' | grep postgres | head -1) \
  pg_dump -U agentes -d agentes -Fc > agentes-$(date +%F).dump

# 2. the uploaded files (find the volume with: docker volume ls | grep files)
docker run --rm -v <project>_files:/data -v "$PWD":/backup alpine \
  tar czf /backup/files-$(date +%F).tgz -C /data .

# 3. AGENTES_SECRET, from this application's Environment tab in Dokploy, in a password manager
```

Without `AGENTES_SECRET`, a restored database has every organization's stored keys unreadable.
Restore with the app stopped: `pg_restore -U agentes -d agentes --clean --if-exists`, unpack the
files volume, set the same `AGENTES_SECRET`, deploy. Run the `pg_dump` command above from a
Dokploy Scheduled Task for an automated backup.

## 10. Troubleshooting

| What you see | What happened | What to do |
| --- | --- | --- |
| Sign-in: "Invalid origin"; saving: `bad_origin` | `PUBLIC_URL` is not the address you opened. | `printenv PUBLIC_URL` in the app container; fix the Environment tab, redeploy. |
| 502 or 503 from the proxy | First boot is migrating, or the app crashed at boot on a config value. | Wait two minutes; then this application's **Logs**. A config error names the variable. |
| Migration fails: `type "vector" does not exist` | `DATABASE_URL` points at a Postgres without pgvector (e.g. a Dokploy-managed "Database" resource instead of this file's `postgres` service). | Use the `postgres` service of this compose file. Moving data means a dump and a restore. |
| Domain never gets a certificate | DNS hasn't propagated yet, or two applications claim the same domain. | Wait for DNS; one domain per application. |
| A setting you added under Environment has no effect | Dokploy's Environment tab isn't confirmed to inject vars into the container by itself (§7). | Add it as its own `environment:` line in `docker-compose.yaml`, redeploy. |
| Invitations or password resets never arrive | No `SMTP_URL` or `MILLIONSEND_API_KEY` wired (§7). | Wire one, set it, redeploy; until then the email is in the log, on purpose. |
| Container restarts under load | `AGENTES_MEMORY` is at or above the host's RAM. | Lower it (`3g` on a 4 GB host). |
| Reachable on `http://`, refused on the domain | Oracle Cloud's Security List/NSG or the host firewall still blocks 80/443. | Open both ports in both places (Requirements, above). |
| WebSockets drop every minute | A proxy in front is timing out idle sockets. | Dokploy's own Traefik doesn't by default; check nothing else sits in front of it. The app pings every 30 s. |

## 11. Optional services

The repository's root [`docker-compose.yml`](../../docker-compose.yml) also carries a local
speech server, local embeddings and an S3 backup service, each behind a compose profile. To add
one here, copy that service and its network from there into this file and set what its comments
name (`LOCAL_SPEECH_URL`, `EMBEDDINGS_PROVIDER`/`EMBEDDINGS_URL`, `S3_*`). None of them is
required to run the app.

## 12. What needs a public URL

The instance is meant to be reachable on the internet at your domain. A few things call it from
outside and do not work otherwise: routines started by GitHub, Sentry or their own webhooks
(`/api/webhooks/…`, `/api/hooks/…`), a GitHub App's events (`/api/github-app/webhook`),
Composio's events, and AI apps that call `/mcp` from their own servers (claude.ai, ChatGPT).
Claude Code, Cursor and VS Code call from your computer, so they also work on a private instance.
