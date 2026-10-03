# Server backups

A server backup is one `.zip` holding everything a Catch server keeps: every account, note
and setting in Postgres, and the attachment files. Admins make, download and restore them in
the app; the same backups can be made and restored from the host, and the server makes one by
itself before each update. The design is recorded in
[ADR 0012](decisions/0012-server-backups.md).

## What is in a backup

| File | Contents |
| --- | --- |
| `database.dump` | The whole database, as a `pg_dump` custom-format archive |
| `attachments/<id>` | Each attachment's original file (left out of database-only backups) |
| `manifest.json` | When and by which release it was made, what it holds, and a SHA-256 of every file |

Image previews and video posters are not included; the server makes them again when they are
asked for. Files are stored uncompressed, so a backup is about as large as the attachments
plus the database dump, and any unzip tool can open one. `pg_restore` reads `database.dump`
on its own if you ever need the data without Catch.

A backup is **not encrypted** and holds everyone's notes and password hashes. Treat a
downloaded one like the server's disk.

Backups are named `catch-backup-<UTC date>_<time>-<kind>.zip`. The kind says where it came
from, and each kind is pruned on its own, so an automatic backup never pushes out one you made:

| Kind | Made | Kept |
| --- | --- | --- |
| `manual` | By an admin in the app, or `backup.sh create` | Until deleted |
| `scheduled` | By the daily schedule | The number set in the app (7 by default) |
| `update` | Before a new version touches the database (database only) | `UPDATE_BACKUPS_KEPT` (10) |
| `pre-restore` | Before a restore replaces the database (database only) | 3 |
| `upload` | Brought from elsewhere | Until deleted |

## Where backups are kept

In the `backup_data` Docker volume, mounted at `/data/backups`. That volume is on the same
disk as the database and the attachments, which protects against a bad update or a mistake,
not against losing the disk. For that, either download the backups that matter, or point
`CATCH_BACKUPS_MOUNT` in `.env` at a directory on another disk or a network mount, writable by
the container's `node` user (UID 1000):

```dotenv
CATCH_BACKUPS_MOUNT=/mnt/backups/catch
```

The admin page says when backups share a disk with the data, and warns when `/data/backups`
is not a volume at all (the backups would be deleted with the container).

A deployment whose `compose.yaml` predates backups needs the mount added to the `app` service
and the volume declared, as in the repository's `docker-compose.yml`:

```yaml
services:
  app:
    environment:
      BACKUPS_DIR: /data/backups
    volumes:
      - ${CATCH_BACKUPS_MOUNT:-backup_data}:/data/backups

volumes:
  backup_data:
```

## In the app

Settings > Admin > Backups is there for admins only (the first account is the admin, and
admins can promote others under Admin > Users). The server refuses these requests from
anyone else.

- **Back up** makes a full backup while the server keeps running.
- Each backup's menu has **Download**, **Restore** and **Delete**.
- **Add a backup file** uploads a backup kept elsewhere. The server checks every file in it
  against the manifest before listing it.
- **Automatic backups** runs one every day at a time you pick, and keeps the newest few.
  A server that was off at that time backs up when it next starts.

### What a restore does

A restore puts the whole server back to the backup, for every user: notes, accounts and
passwords. Changes made since the backup are lost. Sessions are not part of a backup, so a
copy of one signs nobody in, and a restore leaves people to sign in again.

1. The backup is checked against its checksums. Nothing changes if it is damaged, was made
   by a newer Catch than the one running, or if the server's database has itself been
   migrated by a newer Catch.
2. The database as it is now is saved as a `pre-restore` backup. Restore that one to undo.
3. Attachment files in the backup that the server lacks are added. Files are never removed.
4. The database is replaced in one transaction. Until it commits, the server answers every
   request with `503` and clients wait and retry.
5. Every device syncs again on its own. The admin who started the restore stays signed in
   (if their account is in the backup); everyone else signs in again.

A backup from an older Catch is migrated to the current schema as it is restored. One made
before sessions were left out restores without them.
After restoring a database-only backup, notes can list attachments whose files are not on the
server; the result says how many.

## Before an update

When a new version starts, it backs up the database **before** running its migrations, into
an `update` backup. This happens inside the server, so it covers `docker compose pull`, an
automatic updater and `update.sh` alike. If the backup cannot be made, the server does not
migrate and does not start; the log says why. `UPDATE_BACKUPS=false` turns this off.

A migration cannot be reverted by going back to the older image alone. The `update` backup
is the way back (see [Going back after a bad update](#going-back-after-a-bad-update)).

## From the host

`scripts/backup.sh` and `scripts/update.sh` run on the host, next to the Compose file. In a
checkout they work where they are. For a deployment directory with only `compose.yaml` and
`.env` (see [Releasing and deployment](releases.md)), copy both files into it:

```bash
cd ~/services/catch
curl -fsSLO https://raw.githubusercontent.com/OWNER/REPOSITORY/main/scripts/backup.sh
curl -fsSLO https://raw.githubusercontent.com/OWNER/REPOSITORY/main/scripts/update.sh
chmod +x backup.sh update.sh
```

```bash
./backup.sh create                    # full backup, while Catch runs
./backup.sh create --no-attachments   # database only
./backup.sh list
./backup.sh inspect <backup>          # check every file against its checksum
./backup.sh export <backup> [file]    # copy one out of the volume, to send off the server
./backup.sh import <file>             # add one made elsewhere
./backup.sh restore <backup|file>     # stop Catch, restore, start it again
./backup.sh prune --kind manual --keep 5
```

`restore` stops the app, restores with nothing else writing to the database, and starts it
again. It also works when Catch cannot start at all, which the in-app restore cannot help with.

For copies off the server on a schedule, turn on automatic backups in the app, set
`CATCH_BACKUPS_MOUNT` to a host directory, and sync that directory elsewhere with the tool
you already use (rsync, restic, a cloud client). Finished backups never change, and files
still being written are in `.tmp/`, which a sync can skip.

### Updating

```bash
./update.sh                 # back up the database, pull, restart, wait until healthy
./update.sh --skip-backup
```

`update.sh` makes the `update` backup with the version that is still running, so a failed
backup stops the update before anything changes. It then pulls the image (or, in a checkout,
runs `git pull` and rebuilds) and starts Catch. The server sees the fresh backup at startup
and does not make a second one.

### Going back after a bad update

Often the simplest fix is to stay on the new version and restore the `update` backup it made
on the way in: the backup's data is migrated forward again as it is restored.

To return to the previous version instead, its database has to go back too. An older Catch
does not restore into a database a newer one has migrated (the tables are no longer the
ones it knows), so give it an empty one. The backups are in their own volume and are not
touched:

```bash
docker compose down
docker volume ls -q | grep -E '_(postgres|electric)_data$'   # check these are this deployment's
docker volume rm catch_postgres_data catch_electric_data
# In .env, set CATCH_IMAGE back to the previous exact version, then:
docker compose up -d --wait
./backup.sh list                       # find the update backup made before the migration
./backup.sh restore catch-backup-2026-10-01_03-04-05-update.zip
```

Volume names start with the Compose project name, `catch` unless you changed it. An `update`
backup holds the database only; the attachment files stay where they are. The older version
refuses backups made after a migration it does not know, so pick the `update` backup from
before the update.

### Moving to another server

1. On the old server: `./backup.sh create`, then `./backup.sh export <backup>`.
2. Set up the new server with the same `BETTER_AUTH_SECRET`, at the same or a newer version,
   and start it once.
3. Copy the file over and run `./backup.sh restore <file>`.

## Development

`./scripts/dev.sh backup <command>` runs the same tool against the worktree's stack
(`./scripts/dev.sh backup help`). Restore tests create and drop databases of their own, so
they need `pg_dump` and a Postgres server and are skipped without them.
