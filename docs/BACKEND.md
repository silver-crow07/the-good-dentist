# The Good Dentist — Backend (Phase 2)

Secure appointment booking backend built on Next.js Route Handlers
(`app/api/`), PostgreSQL, and Prisma. There is **no separate Express server** —
the API lives inside the existing Next.js app, and the marketing site is
unchanged.

> **Status:** implemented and tested locally against a real PostgreSQL
> database (see [Testing](#testing)). Not yet deployed; several values are
> provisional and flagged below. This is not a production-readiness claim.

---

## Contents

- [Quick start (local)](#quick-start-local)
- [Environment variables](#environment-variables)
- [Database schema](#database-schema)
- [Double-booking prevention](#double-booking-prevention)
- [Timestamp timezone integrity](#timestamp-timezone-integrity)
- [API reference](#api-reference)
- [Staff authentication](#staff-authentication)
- [Rate limiting](#rate-limiting)
- [WhatsApp booking](#whatsapp-booking)
- [Provisional values](#provisional-values)
- [Future: private file storage (X-rays, records)](#future-private-file-storage-x-rays-records)
- [Testing](#testing)
- [Known limitations](#known-limitations)
- [Prisma 7 notes](#prisma-7-notes)

---

## Quick start (local)

The repo ships with an **embedded PostgreSQL** for local development (real
PostgreSQL binaries installed via npm — no Docker, no system install).

```bash
npm install

# 1. Start the local database (keep this terminal open, or run in background)
npm run db:up
#    → PostgreSQL listening on localhost:55432, db the_good_dentist
#    → data stored in .pgdata-local/ (git-ignored; delete to reset)

# 2. Create your .env (NEVER commit it; never overwrite an existing one)
#    Copy .env.example to .env and set:
#      DATABASE_URL="postgres://postgres:postgres@localhost:55432/the_good_dentist?sslmode=disable"
#      SESSION_SECRET="<random 32+ chars — e.g. openssl rand -base64 48>"

# 3. Apply migrations and seed the clinic configuration
npx prisma migrate deploy
npm run db:seed

# 4. Create the first staff account (offline only — no public registration)
STAFF_EMAIL="admin@yourclinic.com" STAFF_PASSWORD="<min 12 chars>" npm run staff:create

# 5. Run the app
npm run dev        # development
npm run build && npm run start   # production-like
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run db:up` | Start the embedded local PostgreSQL |
| `npx prisma migrate deploy` | Apply pending migrations |
| `npm run db:seed` | Idempotent seed (clinic config, hours, doctor, services) |
| `npm run db:generate` | Regenerate the Prisma client after schema changes |
| `npm run db:studio` | Prisma Studio (browse data) |
| `npm run staff:create` | Create/rotate a staff account (offline) |
| `npm test` | Unit tests (no database needed) |
| `npm run test:integration` | Integration tests (needs a migrated + seeded DB) |

---

## Environment variables

`.env.example` documents every variable with placeholders. `.env` is
git-ignored; **never commit real credentials and never overwrite an existing
`.env` blindly.**

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes (for booking) | PostgreSQL connection string |
| `SESSION_SECRET` | Yes (for staff login) | HMAC key signing session cookies (min 32 chars in production) |
| `SESSION_COOKIE_NAME` | No | Session cookie name (default `tgd_session`) |
| `NEXT_PUBLIC_SITE_URL` | No | Canonical site URL for SEO |

Missing/invalid configuration **degrades safely**: without `DATABASE_URL`,
marketing pages still render and booking endpoints return `503` with a
friendly message (the UI never fakes a successful booking). Without a valid
`SESSION_SECRET`, auth endpoints return `503`. No secret is hardcoded anywhere
as a fallback.

---

## Database schema

Defined in `prisma/schema.prisma`; migration in
`prisma/migrations/0_init/migration.sql`.

- **ClinicConfig** (singleton) — clinic name, `Asia/Kolkata` timezone,
  contact details, `slotIntervalMinutes` (provisional 30), and
  `bookingPolicy` (`MANUAL_APPROVAL` default; `AUTO_CONFIRM` reserved).
- **ClinicHour** — per-weekday hours (0 = Sunday … 6 = Saturday) with an
  optional lunch break, as minutes-from-midnight. Schedule is **data**, not
  hardcoded logic.
- **Patient** — minimal PII (`fullName`, `phone`, optional `email`). Phone is
  **not** unique and identity is **never** matched on phone alone.
- **Doctor** — Dr. Nidhi Paliwal only (seeded). Public-safe `slug`, never the
  database id.
- **Service** — treatments with `durationMinutes` and
  `durationIsProvisional = true` (durations not yet clinic-approved).
- **Appointment** — `publicId` (`apt_` + 16 random hex, non-sequential,
  public-safe), UTC `startsAt`/`endsAt` (`timestamptz`), `status`
  (`PENDING`/`CONFIRMED`/`CANCELLED`/`COMPLETED`/`NO_SHOW`), `source`
  (`WEBSITE`/`WHATSAPP`/`STAFF`), non-clinical `patientNotes`.
- **Staff / StaffSession / AuditLog** — staff auth and an audit trail
  (staff actions logged **without patient PII**).

Times are stored as UTC instants; all schedule rules are evaluated in the
clinic timezone by `lib/server/schedule.ts`.

---

## Double-booking prevention

Prevented **in depth**, per doctor:

1. **Application transaction** (`lib/server/appointments.ts`): a per-doctor
   Postgres advisory lock (`pg_advisory_xact_lock`) serialises concurrent
   bookings, then the overlap is re-checked inside the transaction before
   inserting — the authoritative check.
2. **Database exclusion constraint** (migration SQL): a GiST exclusion
   constraint (`Appointment_noDoctorOverlap`) forbids two overlapping
   `PENDING`/`CONFIRMED` appointments for the same doctor, using a half-open
   `tstzrange` so back-to-back bookings (…–10:30, 10:30–…) are allowed. A
   `CHECK` constraint (`Appointment_timeOrder`) enforces `endsAt > startsAt`.
   This backstop also protects races across multiple app instances, where
   in-process locks cannot help.

Conflicts surface as HTTP `409`. Cancellation frees the slot; only `PENDING`
and `CONFIRMED` reserve a slot.

---

## Timestamp timezone integrity

Every appointment instant must be stored as the correct absolute time.
Clinic-local (Asia/Kolkata) conversion happens only in
`lib/server/schedule.ts`; the database stores UTC instants. Two layers
guarantee this:

1. **`withUtcSession()` in `lib/server/db.ts`** appends
   `options=-c timezone=UTC` to `DATABASE_URL` for every pooled connection
   (the seed script included). This is required because
   `@prisma/adapter-pg` serialises `DateTime` values as **naive** strings
   built from the UTC components (`"2026-11-02 03:30:00"` — no offset,
   see its `formatDateTime`), which PostgreSQL parses in the **session**
   time zone. The dev database initialises at `Asia/Calcutta`, so without
   the guard every timestamp was silently stored **5.5 h early** — a bug
   that round-trips through Prisma and is invisible to Prisma-only
   assertions. Note the `pg` driver forwards only a whitelist of startup
   parameters: a `timezone=UTC` query parameter is dropped, but
   `options=-c timezone=UTC` reaches the server. An `options` parameter
   already present in `DATABASE_URL` is respected as-is (if you override
   it, include `-c timezone=UTC` yourself).
2. **A cross-layer regression test** — *"stores the exact UTC instant
   PostgreSQL itself renders"* in `tests/integration/booking.test.ts` —
   asks PostgreSQL to `to_char(startsAt AT TIME ZONE 'UTC')` (text
   rendered inside the database, bypassing all client-side `Date`
   parsing) and compares it with the booked instant and with Prisma's
   read. It was verified to **fail** with the guard disabled (stored
   `2026-11-03 22:00:00` instead of `2026-11-04 03:30:00`) and **pass**
   with it enabled.

Found during Phase-2 verification: a browser booking stored
`2026-11-01 22:00:00 UTC` where `2026-11-02 03:30:00 UTC` (9:00 AM IST)
was expected — raw `pg` disagreed with Prisma while every app-level test
passed. Re-verified after the fix over the wire (API slot vs raw
`to_char`) and through the full browser flow.

---

## API reference

All endpoints return the safe error envelope
`{ error: { code, message, fields? } }`. Raw database errors are never
exposed; unexpected errors are logged server-side and replaced with a generic
message.

### Public

| Method & path | Description |
| --- | --- |
| `GET /api/appointments/availability?date=YYYY-MM-DD&serviceSlug=…` | Slots for one date + treatment. `200` with `{ date, timezone, closed, service, doctor, slots[] }`; `400` invalid query; `429` rate limited; `503` DB unavailable. No patient data involved. |
| `POST /api/appointments` | Booking request. Body `{ patient: { fullName, phone, email? }, serviceSlug, doctorSlug?, startsAt (ISO-8601 **with timezone offset**), patientNotes? }`. `201` with `{ appointment, message }`; `400` invalid input; `409` slot taken; `403` cross-origin; `429`; `503`. |

Booking defaults to **`PENDING`** under the `MANUAL_APPROVAL` policy; the
success message says the *request was received*, never that it is confirmed.
The server re-validates **everything** (rules, availability, conflicts) — the
frontend is never trusted.

### Staff only (session cookie required)

| Method & path | Description |
| --- | --- |
| `GET /api/appointments/[id]` | Full appointment incl. patient contact (staff view). `401` unauthenticated, `404` unknown/invalid id. |
| `PATCH /api/appointments/[id]` | Status transition and/or reschedule. `409` on invalid transitions or overlapping targets. |
| `POST /api/appointments/[id]/cancel` | Cancel (optional `reason`). Frees the slot. `409` if already terminal. |

`[id]` is always the **public-safe** `apt_…` id, never the sequential
database id.

Status transitions (`VALID_TRANSITIONS`):

```
PENDING    → CONFIRMED | CANCELLED
CONFIRMED  → CANCELLED | COMPLETED | NO_SHOW
CANCELLED / COMPLETED / NO_SHOW → terminal (immutable)
```

### Auth

| Method & path | Description |
| --- | --- |
| `POST /api/auth/login` | Staff sign-in. `200` + HttpOnly session cookie; `401` with a **constant** message on any failure (never reveals whether an account exists; timing is equalised). |
| `POST /api/auth/logout` | Ends the session, clears the cookie. Idempotent. |
| `GET /api/auth/me` | Resolves the current session. `200` minimal staff info, else `401`. |

---

## Staff authentication

- **Passwords** hashed with `scrypt` (node:crypto; memory-hard, no native
  build deps), per-user random salt, timing-safe comparison.
- **Sessions** are opaque random tokens. The cookie value is
  `token.HMAC-SHA256(SESSION_SECRET, token)`; the database stores only the
  SHA-256 of the cookie value, so a database leak yields no usable cookies and
  a secret leak yields no database rows.
- Cookie flags: **HttpOnly, SameSite=Lax, Secure (production), Path=/**.
- **CSRF:** `SameSite=Lax` already blocks cross-site cookie sending on
  state-changing requests; an Origin/Referer host check rejects obvious
  cross-origin requests (`403`) as defence-in-depth.
- **No public registration.** Accounts are created offline via
  `npm run staff:create` (plaintext never logged; min 12 chars; re-running
  rotates the password and revokes all sessions).
- Per-endpoint authorisation: staff endpoints resolve identity **only** from
  the verified cookie — client-supplied ids/roles are never trusted.

---

## Rate limiting

In-memory fixed-window limiter (`lib/server/rate-limit.ts`), keyed per IP
(and per account for login). No patient data is part of any key.

| Endpoint | Limit |
| --- | --- |
| `POST /api/appointments` | 6/min burst + 30/day per IP |
| `GET …/availability` | 300/min per IP |
| `POST /api/auth/login` | 5/min per IP + 15 per 15 min per account |

Returns `429` with a `Retry-After` header. **Limitation:** this store is
per Node process — for multi-instance/serverless deployments, swap in a shared
store (Redis or the database) behind the same `check()` interface; the route
handlers need no change.

---

## WhatsApp booking

Unchanged from Phase 1. `WhatsAppButton` builds
`https://wa.me/919180609088` with a pre-filled message
(`lib/whatsapp.ts`). WhatsApp is a **separate contact channel** — using it
does **not** create a database record, and no claim is made that it does.
The WhatsApp Business API is deliberately **out of scope** for this phase.

---

## Provisional values

Awaiting client confirmation (flagged in code and data, not silently baked in):

- **Service durations** (`Service.durationIsProvisional = true`) — e.g.
  General Dentistry 30 min. The UI shows them as provisional.
- **30-minute slot interval** (`ClinicConfig.slotIntervalMinutes`).
- **Clinic hours** are client-confirmed (Mon–Sat 9–13 & 16–21, Sunday closed)
  and stored as data; change them in the DB or seed, not in code.

Confirmed: schedule/hours, Sunday closed, Asia/Kolkata, contact details,
Dr. Nidhi Paliwal's profile. Still pending (do **not** invent): production
domain, socials, dentist photo/bio, privacy/terms text, OG image.

---

## Future: private file storage (X-rays, records)

**No file uploads exist in this phase** (no public upload endpoint, no
`public/` writes). When dental records/X-rays are added, they must go to
**private object storage**, not the repo or `public/`:

- Store objects in private storage (e.g. S3/GCS/R2 with private buckets);
  serve via short-lived, **signed URLs** after an authorisation check — never
  public ACLs, never `public/`.
- Enforce authz per request: a patient sees only their own records; staff see
  only what their role permits. Authorisation is checked server-side on every
  read, not just at upload.
- Validate upload type (allow-listed MIME + magic-byte sniff), size limits,
  and scan for malware before persistence.
- Keep an audit trail (who uploaded/accessed which file, when) — the existing
  `AuditLog` table is the intended home.
- Treat filenames as untrusted; generate storage keys server-side (no
  user-supplied paths).

---

## Testing

| Suite | Command | Needs DB | Covers |
| --- | --- | --- | --- |
| Unit (51) | `npm test` | No | Schedule rules (Mon/Sat/Sun, lunch, closing, past, +05:30 timezone), Zod validation (incl. missing-email regression), rate limiter, scrypt/session crypto, UTC connection-string guard |
| Integration (44) | `npm run test:integration` | Yes | Availability, booking, back-to-back allowed, misaligned overlap rejected, cancel frees slot, **concurrency races (2 and 5 simultaneous → exactly 1 wins)**, transition table, reschedule, patient identity, audit rows, **stored-timestamp integrity (raw PostgreSQL render vs booked instant)**, plus route-level: 201/409/400/403 CSRF/401/429, cookie flags, logout, no-PII-in-public-responses |

Integration tests run against a real PostgreSQL (via the embedded dev DB) and
exercise the full stack: validation → rate limiting → auth/CSRF → domain
service → Prisma → PostgreSQL (including the exclusion constraint).

> **Disposable database required:** integration tests **wipe** the
> `Appointment`, `Patient`, `AuditLog`, `Staff` (and `StaffSession`) tables.
> Point `DATABASE_URL`/`TEST_DATABASE_URL` at a **disposable** database —
> **never at production**.

A manual over-the-wire E2E check (21 assertions) was also run against a
production build (`npm run start`) with the real local DB: availability,
201/PENDING booking, duplicate 409, cross-origin 403, unauth 401, login
failure/success + cookie flags, `/me`, staff GET (PII present), PATCH confirm,
cancel, terminal 409, slot freed, and marketing pages still 200. The booking
UI was additionally walked end-to-end in a browser (4 steps → pending success
screen with reference). Two bugs were found and fixed this way: the browser
omits the blank `email` key, which the server's schema initially rejected —
now covered by a regression test; and stored timestamps were shifted 5.5 h
by a non-UTC session time zone — see
[Timestamp timezone integrity](#timestamp-timezone-integrity). After that
fix, the E2E checks and the browser flow were re-run against the rebuilt
production build, including a raw-`pg` comparison of the stored instant.

---

## Known limitations

- **Rate limiter is per-process** (in-memory) — see [Rate limiting](#rate-limiting).
- **Public self-cancellation is not exposed** (needs OTP verification first);
  cancellation is staff-only for now.
- **Integration tests wipe the Staff table** — run them only against a
  disposable database.
- **`prisma dev`** (Prisma's hosted local proxy) was abandoned as flaky
  (intermittent `ECONNRESET`); the repo uses `embedded-postgres` instead.
- Not deployed; no production domain, monitoring, backups, or email/SMS
  notifications configured yet.

---

## Prisma 7 notes

This project uses **Prisma 7** (`@prisma/client` + `prisma` 7.10.1), which
differs from older Prisma in several ways worth knowing:

- Config file is **`prisma7.config.ts`** (not `prisma.config.ts`); the Prisma
  CLI does **not** auto-load `.env`, so it loads dotenv explicitly.
- The `prisma-client` generator emits to a project-local
  `output = "../generated/prisma"` (git-ignored) — import from
  `@/generated/prisma/client`.
- **`npm run build` = `prisma generate && next build`** — a fresh checkout or
  CI never needs a pre-existing `generated/` folder (it is git-ignored by
  design, and the relative import in `lib/server/db.ts` is intentionally left
  untouched). `prisma generate` takes <1 s, needs **no `DATABASE_URL`** and no
  running database, so it is safe at build time on hosts without `.env`. The
  Prisma CLI sits in `dependencies` (not dev) so it survives pipelines that
  omit devDependencies. There is no `postinstall` hook: generating on every
  install would run in environments (prod-only installs) where the artifact is
  not needed and could fail an install.
- The client requires a **driver adapter**: `new PrismaPg({ connectionString })`
  from `@prisma/adapter-pg` (see `lib/server/db.ts`). The adapter formats
  `DateTime` params as **naive UTC strings** (no offset), so connections are
  forced to `timezone=UTC` via `withUtcSession()` — see
  [Timestamp timezone integrity](#timestamp-timezone-integrity).
- `migrate diff` uses `--to-schema` (not `--to-schema-datamodel`); `db execute`
  reads its URL from the config file (no `--url` flag).
- Exclusion/CHECK constraints cannot be expressed in Prisma PSL, so they live
  as raw SQL appended to the initial migration (with `btree_gist`).
- `pg_advisory_xact_lock` returns `void`, so it must be called with
  `$executeRaw` (not `$queryRaw`, which would fail to deserialize `void`).
