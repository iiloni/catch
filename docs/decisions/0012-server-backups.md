# 0012: Server backups and restore

Status: accepted (2026-10-01)

## Context

A Catch server's state is a Postgres database and a directory of attachment files. Operators
were told to back both up themselves, and to remember to before each update, because
migrations run at startup and cannot be undone by going back to an older image. Production
runs published images from a directory with only a Compose file (ADR 0009), so nothing in
the update path can depend on a checkout. Clients hold a synced copy of their notes and a
queue of unsent writes (ADR 0007), and Electric follows the database through logical
replication, so replacing the database under a running server has to be something both
survive.

## Decisions

**One archive, readable without Catch.** A backup is a zip of `database.dump` (`pg_dump`
custom format), `attachments/<id>` (originals only; previews are regenerated) and a
`manifest.json` written last, with the format version, creating release, newest applied
migration, counts, and a SHA-256 of every file. Entries are stored, not deflated: the dump is
already compressed and media does not shrink. The writer and reader are our own
(`apps/server/src/backups/zip.ts`), streaming and ZIP64-capable, because a backup can exceed
memory and 4 GiB, and the format is small enough not to warrant a dependency. An archive is
only trusted after every member matches its checksum and the members are exactly the
manifest's.

**`pg_dump` and `pg_restore` do the database.** The app image carries the Postgres client
tools at the server's major version (`POSTGRES_MAJOR` in the Dockerfile follows the postgres
image in the Compose file). A dump is one consistent snapshot taken while the server runs.
Nothing in the backup code names a table beyond counting users, notes and attachments for
display, so new tables are covered without touching it.

**Sessions are left out.** A backup is a file that gets downloaded and copied, and a
session is a way into an account, so the dump carries the session table without its rows.
A restore skips them in backups made before this too, and therefore signs everyone out
except the admin who started it. This is the one table the backup code names for a reason
other than display.

**An uploaded dump runs without the server's powers.** A dump is SQL, and the server's
database role is usually the cluster's superuser, which can run programs on the database
host. When it is, a restore makes a role for itself that owns the scratch database and
nothing else, and that role loads the dump, migrates it and reads the rows back out. The
server's own role only creates and drops the two and loads the resulting rows.

**Restore replaces rows, not tables.** The dump is restored into a scratch database, migrated
to the current schema there, and its data is then loaded into the live database in a single
transaction that first truncates every table. Dropping and recreating the live tables would
lose their publication membership and replica identity and leave Electric following tables
that no longer exist. Truncation travels through replication: Electric drops its shapes,
clients get `must-refetch` and sync again, without anything being restarted. A failure
before the transaction commits leaves the server as it was. Because rows go into the tables
that exist, a restore is refused when the live database is ahead of the running code (an
older image started after a newer one migrated); going back a version means starting the
older image on an empty database and restoring there.

**The server refuses requests while it restores.** Every `/api` route except the health check
answers `503` with `Retry-After` during a restore, so no write lands in tables about to be
truncated and no shape is snapshotted halfway. The outbox treats that like any other outage
and retries. The database of a moment before is kept as a `pre-restore` backup, attachment
files are only ever added, and the session of the admin who started the restore is put back
so the result can be shown to them.

**Admin API and one page.** Backups follow ADR 0011: the page is Settings > Admin > Backups,
and the routes are under `/api/admin/backups`, inside the admin routes and behind their
guard. Backups and the schedule are server state rather than synced collections: they are
plain requests, polled while something runs. The one exception to the shared guard is the
download: a browser streams a large file from a plain link, which cannot carry the bearer
token, so the link holds a short-lived signed ticket issued behind the guard, as attachments
do (ADR 0010). That route is mounted ahead of the guard and checks the ticket's user against
the database on each request. Uploads stream to disk and are verified before they are listed.
A backup made by a newer Catch is listed but cannot be restored.

**Retention is per kind, and kind is in the file name.** `manual`, `scheduled`, `update`,
`pre-restore` and `upload` are pruned independently, so automatic backups cannot evict one an
admin made. Names sort by time (UTC) and can be listed and pruned without opening the files.

**Settings live beside the backups, not in the database.** The daily schedule is
`schedule.json` in the backups directory. A restore therefore does not bring back the
schedule of the day the backup was made, and the feature needs no migration. The schedule
stores a local time and an IANA zone and compares calendar dates, which also catches up
after downtime.

**The server backs itself up before it migrates.** `db/migrate` runs first on every start. When
migrations are pending, or the release differs from the one that ran last, it writes a
database-only `update` backup before migrating, and refuses to migrate if that fails
(`UPDATE_BACKUPS=false` opts out). This makes the safe path the default for every way of
updating, including ones we do not control. `scripts/update.sh` additionally takes that
backup with the old version still running, so a failure stops the update before the image
changes; the startup check sees the fresh backup and does not repeat it.

**Host scripts wrap the same CLI.** `dist/backups/cli.mjs` ships in the image.
`scripts/backup.sh` and `scripts/update.sh` find the Compose file beside them and work from a
checkout or from a deployment directory they were copied into. `backup.sh restore` stops the
app and restores from a one-off container, which is the way back when the server cannot
start.

## Consequences

- The production image grows by the Postgres client. Moving to a new Postgres major means
  bumping `POSTGRES_MAJOR` with it; a mismatch fails backups loudly rather than silently.
- Backups default to a volume on the same disk as the data. That covers bad updates and
  mistakes; surviving the disk needs `CATCH_BACKUPS_MOUNT` elsewhere or downloaded copies.
  The page says which case it is in.
- Backups are not encrypted and include password hashes. Access is admin-only, files are
  written owner-only, and encryption is left to where they are copied.
- A restore needs free space for a scratch copy of the database and briefly makes the whole
  server unavailable. Writes a device queued before the restore are sent after it and apply
  to the restored data.
- A restore rolls back every user. Per-user export and import remain separate, future work.
- One backup or restore runs at a time, tracked in the server process. Running more than one
  app process against the same backups directory is not supported.
- See [Server backups](../backups.md) for operating instructions.
