# 0015: Servers reachable from the internet

Status: accepted (2026-10-03)

## Decision

A Catch server is usually one household's, but it is reachable by anyone who has its
address. These defaults assume that.

**Sign-up closes after the first account.** The first account is the admin's and can always
be made. Every later one needs an invite, unless `REGISTRATION=open` lets anyone in. The
refusal comes from Better Auth's own sign-up response, so the sign-in page shows it with no
new endpoint. Development stacks run open: seeding and the E2E tests make accounts.

**Admins invite people with a link.** Settings > Admin > Users makes an invite: a link to
the sign-in page with a random token in its fragment, good for one account and seven days.
The page sends the token with sign-up in an `X-Catch-Invite` header, and the server uses the
invite up in the same statement that checks it, so a link cannot make two accounts. A token
that is sent must be good even when registration is open. The server keeps only the token's
hash, shows the link once, and lists each invite with the account it made; removing one
revokes it. Invites are admin server state like the user directory (ADR 0011): plain
requests under `/api/admin/invites`, not a synced collection. An invite is not tied to an
email address, since the server sends no mail to check one against.

**Requests are bounded.** JSON bodies are read into memory whole, so `/api` refuses one over
16 MiB with `413`; attachment and backup uploads stream to disk under their own limits.
Each account's attachments are capped in total (ADR 0010). The outbox treats `413` like any
other refusal: the change is reported as unsaved rather than retried.

**The sign-in rate limit goes by the connection.** Better Auth would take a client's address
from `X-Forwarded-For` as the client sent it, which lets each request choose its own bucket.
The server instead passes it the socket's peer address in a header of its own. Behind a
reverse proxy that address is the proxy's, so `TRUSTED_PROXIES` lists the proxies whose
`X-Forwarded-For` is believed, read from the right up to the first hop that is not one.
Without it every visitor behind the proxy shares one bucket, which limits them together
rather than not at all.

**Bearer tokens are the signed ones.** Sign-in returns a token signed with
`BETTER_AUTH_SECRET`, and only that is accepted. The bare token in the session table, which
a database dump or an older backup holds, signs nobody in.

**Pages carry a content security policy.** The app keeps its session token in `localStorage`
so the web and Android apps share one code path, which makes an injected script the way to
take an account. Pages allow scripts from the server's own files and the inline ones in
`index.html` by hash, computed from the built file at startup; styles may be inline, as the
editor needs. API responses get a policy that allows nothing, and attachments keep their
stricter sandbox. Every response also forbids framing and content sniffing.

**Synced rows are private to caches.** Electric answers for a CDN in front of it. The shape
proxy rewrites `Cache-Control` to `private`, and forwards only the parameters a client needs
to resume and follow its shape, not the ones that choose rows.

## Compatibility

No existing request, response, shape or outbox format changes; the API protocol stays at 1.
Invites add admin routes and one optional sign-up header: an older server ignores the header
and an older client simply has no page for them. Clients
already send the signed token and none uses Electric's subset parameters. A `413` reaches
old clients as an ordinary refused write. Anything else that used the bare session token as
a bearer token has to use the `set-auth-token` value instead.

## Consequences

- Loading a script, frame or connection from another origin in the web app needs an entry in
  `lib/securityHeaders.ts`. The Vite dev server sends no policy, so check a production build.
- Zod probes for `new Function` when it loads. The policy refuses it, Zod falls back to its
  interpreter, and the browser logs one violation for `script-src eval` on each page load.
- The first account is still whoever gets there first: make it before publishing the address.
- Notes have no total quota; the body limit bounds one request, not an account.
