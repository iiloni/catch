# Deploying Catch

This guide is for whoever runs a Catch server. It takes you from nothing to a running
server, then covers settings, backups and updates.

## What you need

- A machine with [Docker](https://docs.docker.com/engine/install/) and Docker Compose.
- A web address for the server, served over HTTPS by a reverse proxy (Caddy, Traefik, nginx
  or similar). The Android app only connects over HTTPS.

## Install

```bash
git clone https://github.com/iiloni/catch.git
cd catch
cp .env.example .env
```

Open `.env` and set these four values:

| Setting | Value |
| --- | --- |
| `BETTER_AUTH_URL` | The address people will open, such as `https://notes.example.com`. |
| `BETTER_AUTH_SECRET` | A random secret. Generate one with `openssl rand -hex 32`. |
| `POSTGRES_PASSWORD` | Another random secret, generated the same way. |
| `ELECTRIC_SECRET` | A third one. Do not reuse the others. |

Then start Catch:

```bash
docker compose up -d --build
```

The server listens on port 3000. Point your reverse proxy at it, with HTTP/2 enabled so sync
streams share connections with page loads and writes.

The first start builds Catch from source, which takes a few minutes. To run a published
image instead, without a checkout on the server, see
[Running a published release](#running-a-published-release).

## First sign-in and inviting people

Open the server's address and create an account. The first account becomes the admin, and
sign-up then closes.

To add someone, go to Settings > Admin > Users and create an invite. It gives you a link to
send them. Set `REGISTRATION=open` to let anyone with the address sign up instead.

People using Android install the app from the
[releases page](https://github.com/iiloni/catch/releases) and enter the server's address on
first launch.

## Settings

All settings go in `.env`, and `.env.example` describes each one. Run
`docker compose up -d` after changing them.

| Setting | Default | What it does |
| --- | --- | --- |
| `CATCH_PORT` | `3000` | The port Catch listens on. |
| `CATCH_BIND_ADDRESS` | `0.0.0.0` | The address it listens on. `127.0.0.1` accepts connections from the same machine only. |
| `REGISTRATION` | `closed` | `open` lets anyone sign up without an invite. |
| `TRUSTED_PROXIES` | none | Your reverse proxy's address. Without it, the sign-in rate limit counts every visitor as the proxy. |
| `ATTACHMENT_QUOTA_MB` | `10240` | Attachment storage per account, in megabytes. `0` removes the limit. |
| `LINK_PREVIEWS` | `true` | The server fetches pages that notes link to, for previews. `false` turns that off. |
| `PUSH_CONTACT` | from `BETTER_AUTH_URL` | A `mailto:` or `https:` contact given to browsers' push services for reminder notifications. Set it when the server is reached over plain HTTP. |
| `CATCH_ATTACHMENTS_MOUNT` | Docker volume | A host directory for attachments. |
| `CATCH_BACKUPS_MOUNT` | Docker volume | A host directory for backups. |
| `UPDATE_BACKUPS` | `true` | Back up the database before a new version changes it. |
| `UPDATE_BACKUPS_KEPT` | `10` | How many of those backups to keep. |

## Where your data lives

Notes are in the Postgres database, in the `postgres_data` Docker volume.

Attachments are in the `attachment_data` volume. To keep them in a directory of your choice,
set `CATCH_ATTACHMENTS_MOUNT` to it and make it writable by UID 1000, the user Catch runs
as. A file can be up to 100 MiB, and each account can hold 10 GiB unless you change
`ATTACHMENT_QUOTA_MB`.

## Backups

Admins back up and restore the whole server, database and attachments, in Settings > Admin >
Backups. A daily backup can be scheduled there too.

Backups go to the `backup_data` volume, on the same disk as everything else. Set
`CATCH_BACKUPS_MOUNT` to a directory on another disk so they survive losing this one.

Backups also work from the command line, including when Catch cannot start:

```bash
./scripts/backup.sh create           # a full backup
./scripts/backup.sh list
./scripts/backup.sh restore <backup>
```

[Server backups](docs/backups.md) explains what a backup holds, how a restore works, and how
to move to another server.

## Updating

```bash
./scripts/update.sh
```

This backs up the database, fetches the new version, restarts Catch and waits until it is
healthy. The server also backs up its database by itself before a new version changes it.

Release notes are on the [releases page](https://github.com/iiloni/catch/releases). When a
release needs the server updated before the Android app, or the other way round, its notes
say so. If an update goes wrong, see
[Going back after a bad update](docs/backups.md#going-back-after-a-bad-update).

## Running a published release

Every release is published as a Docker image at `ghcr.io/iiloni/catch`, so a server does not
need the source code or a build. The `stable` tag follows stable releases, `preview` follows
previews, and each version has an exact tag such as `0.3.2`.

[Releasing and deployment](docs/releases.md#production-configuration-outside-the-repository)
shows the setup: a directory holding only a Compose file and `.env`, an example for Traefik,
and the update commands.

## Troubleshooting the first build

Catch's sync service, Electric, normally comes as a prebuilt image from Docker Hub. If
Docker Hub cannot supply it, Compose builds the same version from source. That first build
takes longer and needs access to GitHub.
