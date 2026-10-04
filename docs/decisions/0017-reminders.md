# 0017: Reminders and notifications

Status: accepted (2026-10-03)

## Context

Google Keep let a note carry a reminder: a date and time, optionally repeating, that raised
a notification on every device. Catch has three kinds of client to notify (a browser tab, an
installed web app on Android or iOS, and the native Android app), an offline-first data
model, and a server that is one household's and has no vendor push account.

## Decisions

**One reminder per note, keyed by the note.** `reminders.note_id` is the primary key, so two
devices that set a reminder for one note offline converge on one row (last write wins)
instead of colliding. A reminder is saved whole with `PUT /api/reminders/:noteId` and removed
with `DELETE`; both are safe to replay, and both go through `write()` and the outbox like
every other change. A save that changes nothing leaves the reminder's times alone, so a
queued write sent again after the reminder rang does not ring it a second time. Deleting a
note deletes its reminder; a note in the trash keeps its reminder untouched and does not
ring. Restored within a day of the time it was due, it rings then.

**It is its own table and synced collection, not columns on `notes`**, as a note's tags are
(`note_tags`). The scheduler rewrites a reminder every time it rings; on the note's row that
would be a server write to the row the user is typing into, resent to every device with the
note, and would give `notes` server-only columns (`fire_at`) to keep out of its shape.
Setting a reminder is also not an edit of the note, so it does not touch `updated_at`. The
cost is one more shape per client. Over HTTP/1.1 a browser has six connections per origin,
which live shapes would use up; development stacks poll instead (ADR 0007, `shapeFetch`),
and production is served over HTTP/2.

**Times are wall clock times, not instants.** `starts_at` and `next_at` are
`YYYY-MM-DDTHH:MM` with no zone. A *floating* reminder (the default) is read in the zone the
user is in when it comes due: 9:00 is 9:00 wherever they are. A *fixed* one is read in the
zone it was made in, for calls and deadlines. Devices report their zone to
`PUT /api/reminders/time-zone` once, and again when it changes; a first report never moves a
user whose other device has travelled. The server keeps the instant it is waiting for in
`fire_at`, which is derived, indexed and never synced.

**Recurrence is a small structured schema**, not an RRULE string: a frequency (daily,
weekly, monthly, yearly), an interval, weekdays for weekly, an optional "nth weekday of the
month" (first to fourth, or last), and an end by date or count. `nextOccurrence` in
`packages/shared/src/reminders.ts` is the one implementation, used by the server, the web
app's optimistic state and, later, the Android scheduler. The awkward cases are decided
there and tested:

- A monthly reminder on the 29th to 31st falls on the last day of shorter months.
- There is no "fifth" weekday; "last" covers it.
- A time the clocks skip rings the same distance after the change (02:30 becomes 03:30); a
  time they show twice rings once, the first time.
- Occurrences missed while nothing could ring are skipped, not rung one after another.

**The server rings reminders.** An in-process scheduler (`reminders/scheduler.ts`) looks for
due reminders every few seconds, moves each on to its next occurrence, and then sends the
notification. Moving on first means a crash loses one ring rather than repeating it. A
recurring reminder advances when it rings, whether or not anyone acknowledges it. One that
came due while the server was off still rings at start-up if it is under a day late.

**Browsers and installed web apps get Web Push.** No browser can schedule a notification
locally, so the server sends each one through the browser's push service. The server
implements the protocol itself (`push/webPush.ts`: RFC 8291 encryption and a VAPID token,
about a hundred lines on `node:crypto`) rather than taking a dependency that would make its
own HTTP requests. Payloads are encrypted to the subscribing browser, so the push service
relays note text it cannot read. The VAPID key pair is made on first use and kept in the
database (`push_keys`), so a restored backup still reaches the browsers subscribed under it.

**A subscription's endpoint is an allowlisted push service.** The endpoint is a URL from the
client that the server then posts to, the same risk `safeFetch` guards for link previews.
`isPushEndpoint` accepts only HTTPS to Google, Mozilla, Apple and Microsoft push hosts, on
saving a subscription and again on sending.

**It is set in the note's dock.** The bell in the open note's dock grows a panel out of it,
like the palette and the tags, rather than a sheet over the note. The panel keeps the common choices one tap
away: a row of days (today, tomorrow, custom) and a row of times under plain labels, the
repeat as a single row saying what it is set to, and whether the time follows the user or
stays in a chosen zone. Anything with more to it is a page of its own that slides in over
the panel and back: a calendar for a custom day, a clock face for a custom time, and the
repeat's settings (interval, weekdays, end). The calendar and the clock are ours
(`DatePicker`, `TimePicker`) rather than the system's, so they look and move like the rest
of the app and need no keyboard; numbers are stepped, not typed. The panel may grow to the
top of the screen before it scrolls. A pending
reminder opens on its next time rather than its first, and a counted repeat on the times it
has left, so editing one carries on the count instead of starting it again. To make room
for the bell, pinning moved to the note's header beside archive and trash. On a card the
same panel opens in a popover from the card's toolbar.

**Quick times belong to the user.** The times Morning, Afternoon and Evening stand for are
kept with the user's zone in `reminder_settings` and read and saved with plain requests
(`GET /api/reminders/settings`, `PUT /api/reminders/settings/times`), not a shape: they
change rarely and are small. A device caches them, so the choices are there offline; a
change made offline is sent at the next launch or return to the app, and the last one sent
wins.

**Each device opts in.** Settings > Notifications turns notifications on for the browser it
is open in, and every subscribed device rings. Dismissing on one does not dismiss on the
others. Signing out removes the device's subscription while the session still stands.

**Protocol 3.** A client with reminders needs the reminders shape and routes, which an older
server cannot supply, so `API_PROTOCOL_VERSION` is 3 and the server supports 2 to 3 (ADR
0013's "added required capability" case). Protocol 2 clients keep working against a new
server and simply have no reminders. A protocol 3 Android app pauses sync against an older
server until the server is updated: **update the server first.**

## Limits

- **Web Push needs the server to reach the internet** (outbound HTTPS to the push services)
  and the app to be served over HTTPS. A reminder cannot ring in a browser while the server
  is down.
- **iOS** delivers Web Push only to a web app added to the Home Screen (iOS 16.4 or later),
  asks permission only from a tap, and shows no action buttons. It can drop a subscription;
  the app re-registers it on launch.
- **The native Android app does not ring yet.** A WebView has no Web Push, and FCM would need
  a Firebase project compiled into the APK with matching credentials on every self-hosted
  server. The plan is local alarms scheduled from the synced reminders (which also ring
  offline), with a periodic background sync so reminders set on another device are picked
  up; until then Settings says so.
- **Backups hold the push keys and subscriptions.** Someone with a backup could send
  notifications to those browsers until they re-subscribe. They could not read notes with
  it, and sessions are still left out of backups.
- **The dev server has no service worker**, so push cannot be tried in development; a
  production build is needed.

## Not doing (for now)

**Location reminders.** Browsers have no geofencing or background location, so they could
only ever work in the native Android app, and well only with Google Play Services (the
platform fallback is less reliable and costs more battery). They need background location
set to "Allow all the time", lag by minutes, are unreliable under about 100 m, are wiped on
reboot, and need a place picker Catch has no self-hosted source for. `reminders.kind` is
`time` today so a `place` kind can be added without reshaping the table.

Notification actions (Done, Snooze) and dismissing across devices are also left for later;
snoozing is in the app.
