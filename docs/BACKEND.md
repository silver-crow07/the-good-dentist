# The Good Dentist — Backend

Secure appointment booking backend built on Next.js Route Handlers
(`app/api/`), PostgreSQL, and Prisma. There is **no separate Express server** —
the API lives inside the existing Next.js app, and the marketing site is
unchanged. Later phases added the staff admin panel (Phases A–C) and
**Phase D: dental records with private Cloudflare R2 X-ray storage** (see
[Dental records & private X-ray storage](#dental-records--private-x-ray-storage-phase-d)).

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
- [Dental records & private X-ray storage (Phase D)](#dental-records--private-x-ray-storage-phase-d)
  - [Upload / download flow](#upload--download-flow)
  - [Deletion protocol](#deletion-protocol)
  - [Cleanup runbook](#cleanup-runbook)
  - [Verified vs assumed R2 behavior](#verified-vs-assumed-r2-behavior)
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
| `R2_ACCOUNT_ID` | Yes (for X-ray uploads) | Cloudflare account id — **server-side only** |
| `R2_BUCKET` | Yes (for X-ray uploads) | Private R2 bucket name — **server-side only** |
| `R2_ACCESS_KEY_ID` | Yes (for X-ray uploads) | R2 API token access key (bucket-scoped, Object Read & Write) — **server-side only** |
| `R2_SECRET_ACCESS_KEY` | Yes (for X-ray uploads) | R2 API token secret — **server-side only**, never serialized to any response |
| `CRON_SECRET` | Yes (in production) | Bearer secret for `GET /api/cron/dental-storage-cleanup` (min 32 chars in production) |
| `DENTAL_MAX_FILES_PER_RECORD` | No (default 50) | Per-record dental file cap `[F-5]` (clamped to 1..500) — checked under a record-row lock; hitting it returns `409`, never a silent truncation |

Missing/invalid configuration **degrades safely**: without `DATABASE_URL`,
marketing pages still render and booking endpoints return `503` with a
friendly message (the UI never fakes a successful booking). Without a valid
`SESSION_SECRET`, auth endpoints return `503`. Without the complete set of
`R2_*` variables, dental **file** endpoints answer `503` (records themselves
keep working) and cleanup jobs that would touch storage are reported as
`skipped: no_storage` — never as success. Without `CRON_SECRET`, the cron
route always answers `503` (fail-closed, never runs unauthenticated). No
secret is hardcoded anywhere as a fallback.

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

Phase D added (migration
`prisma/migrations/20261103000000_add_dental_records_storage/migration.sql`):

- **DentalRecord** — per-patient record: `treatmentDate` (`@db.Date`),
  `diagnosis`, `treatmentDetails`, optional `clinicalNotes`,
  `createdBy` (staff, `SetNull` on account removal), soft-delete
  `deletedAt`. Indexed on `treatmentDate` and `deletedAt`.
- **DentalFile** — one row per X-ray: server-generated immutable `r2Key`
  (`dental/{patientId}/{recordId}/{fileId}.{ext}`, `@unique`), untrusted
  `originalName` (display only), `contentType`, `byteSize`, `status`
  (`PENDING` → `AVAILABLE` / `REJECTED`, or `DELETING`), `cleanupAfter`
  (no physical delete before this instant), `cleanupAttempts`,
  `uploadedBy`. Cascade-deletes with its record.
- **R2KeyRegistry** — permanent tombstone per issued key (`@unique` on
  `r2Key`): a retired key can never be re-issued, and a PK collision on a
  freshly generated file id triggers the documented retry (`[KK]`).
- **StorageDeletionReceipt** — one row per deletion *event*
  (`r2Key` + `eventNo`, never reused; raw partial unique index
  `onePending … WHERE "completedAt" IS NULL` allows at most one in-flight
  deletion per key), with `evidence` (HEAD output) and `completedAt`
  (the txB gate).
- **StorageScanState** — singleton (`dental_orphan_scan`) holding the
  reconciler's durable LIST cursor + the cleanup run **lease**
  (`leaseOwner`, `leaseExpiresAt`).
- **DentalFileStatus** (enum) — `PENDING`/`AVAILABLE`/`REJECTED`/`DELETING`.

Audit actions added: `dentalrecord.create/update/delete`,
`dentalfile.upload/download/delete/rejected/orphan_already_absent/orphan_row_backed`.

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

### Slot-grid enforcement

The availability API advertises slots derived from the clinic's configured
interval. Booking re-validates the requested instant server-side and rejects
any start that is **not exactly one of those advertised instants** (off-grid
times such as 9:07 AM or 9:00:30 are refused with `VALIDATION_ERROR`, before
the overlap check runs). This closes the bypass where a direct API call could
book times the published schedule never offered — including partial-overlap
attacks that relied on misaligned starts. Covered by integration tests
("rejects off-grid start times", "rejects an aligned booking overlapping a
longer appointment").

### Status transitions

`VALID_TRANSITIONS` is enforced **twice**: fast-fail before the transaction,
then authoritatively *inside* it against a fresh status read taken while
holding the per-doctor advisory lock. Without the in-transaction re-check,
two concurrent staff updates (e.g. CANCEL + CONFIRM) could both validate
against a stale status and resurrect a cancelled appointment. Audit-log rows
record the authoritative `from`/`to` statuses.

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
message. Staff endpoints that return patient contact details (and `/api/auth/me`)
send `Cache-Control: no-store` so PII is never cached by intermediaries.

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

### Dental records (Phase D — ADMIN only, session cookie required)

Every endpoint below answers `401` without a session and **`403` for
`STAFF`** — the whole module is ADMIN-only (enforced server-side per
request, not in the UI). File endpoints additionally answer `503` when R2
is not configured. All responses carry `Cache-Control: no-store`.

| Method & path | Description |
| --- | --- |
| `GET /api/admin/dental-records` | Chronological list, filters `page`, `pageSize` (1–100), `patientId`, `from`/`to` (treatment-date range, inclusive), `q` (search). `400` invalid query. |
| `POST /api/admin/dental-records` | Create `{ patientId, treatmentDate, diagnosis, treatmentDetails, clinicalNotes? }`. `201 { record }`; `400`; `404` unknown patient; audit `dentalrecord.create`. |
| `GET /api/admin/dental-records/[id]` | Detail incl. `clinicalNotes`, full file list, author, timestamps, plus `filesTotal` + `truncated` (the list is capped at 200 rows and **never silently cut** — `truncated: true` says so explicitly). `404` unknown/soft-deleted. |
| `PATCH /api/admin/dental-records/[id]` | Partial update (`treatmentDate`/`diagnosis`/`treatmentDetails`/`clinicalNotes`). `200` with the list shape; audit `dentalrecord.update` records the changed fields only. |
| `DELETE /api/admin/dental-records/[id]` | Soft delete (`deletedAt`), audit `dentalrecord.delete`; existing files are queued for physical deletion (per-file intent audit `dentalfile.delete {trigger: "record_delete"}`). |
| `POST /api/admin/dental-records/[id]/files` | **Upload init.** Body `{ originalName, contentType, byteSize }` (JPEG/PNG, ≤ 10 MB, family must agree; the declared size is re-validated in the service layer). `201 { file: { id, status: PENDING, upload: { method: "PUT", url, headers, expiresAt } } }` — a **presigned PUT** (300 s) with `Content-Type` signed in; server-generated key + `R2KeyRegistry` tombstone written first, under a `FOR UPDATE` lock on the record row that race-safely enforces the per-record file cap (`DENTAL_MAX_FILES_PER_RECORD`, default 50). `400` unsupported/mismatched/oversize, `404` unknown/soft-deleted record, `409` key reservation exhausted **or per-record file limit reached**, `429` rate limited (30/min per staff), `503` storage unconfigured (no row is created). |
| `POST /api/admin/dental-records/files/[fileId]/complete` | **Upload verify.** HEADs the object and checks it is **not oversize** (`oversize:limit=…:actual=…` — the PUT cannot bind size cryptographically, so this is the hard cap), then declared size, then magic bytes (JPEG/PNG). Pass → `AVAILABLE` + `dentalfile.upload` audit; fail → `REJECTED` + `dentalfile.rejected` audit with reason (`object_missing`/`oversize`/`size_mismatch`/`family_mismatch`/`magic_bytes`). Idempotent replay: a completed file re-completes without a second audit; a `REJECTED` file answers `409`. `429` rate limited (60/min per staff). |
| `GET /api/admin/dental-records/files/[fileId]/url` | **Secure download.** `200 { url, expiresAt }` — short-lived presigned GET (300 s) + `dentalfile.download` audit **per call**. `409` unless `AVAILABLE`, `404` unknown. |
| `DELETE /api/admin/dental-records/files/[fileId]` | Queue/immediate delete: `200 { deleted: false, queued: true }` while `cleanupAfter` has not elapsed (or another run holds the lease) — row moves to `DELETING` with an intent audit `dentalfile.delete {trigger:"admin"}`; `{ deleted: true }` runs the full physical protocol immediately. |
| `GET /api/admin/dental-records/cleanup` | **Throttled sweep** (Jobs B→A→C, 10 items / 60 s) — `200 { run }`. |
| `POST /api/admin/dental-records/cleanup` | **Full run** (Jobs B→A→C→D, 100 items / 240 s, `maxDuration = 300`) — `200 { run }`. |
| `GET /api/cron/dental-storage-cleanup` | Cron entry point. `Authorization: Bearer CRON_SECRET` — both sides SHA-256 hashed, then compared with `timingSafeEqual` (fixed-length, no length oracle), still fail-closed. `200 { run }` identical to POST; **`401`** wrong/missing bearer; **`503` fail-closed when `CRON_SECRET` is unset** (never runs unauthenticated). `maxDuration = 300`. |

Both cleanup endpoints answer `409 CONFLICT` while another live run holds
the storage lease, `429` (rate limited: GET + POST share **10/min per
staff**), and `405` (with `Allow`) for unsupported methods. The upload-init
(30/min) and upload-complete (60/min) endpoints are rate limited the same
way — keyed by the authenticated staff id, enforced server-side before any
DB/storage work, so client-side UI limits are never the control (F-4).

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
(and per account for login; per **authenticated staff id** for the dental
endpoints, so a shared NAT IP cannot exhaust a clinic's uploads). No
patient data is part of any key.

| Endpoint | Limit |
| --- | --- |
| `POST /api/appointments` | 6/min burst + 30/day per IP |
| `GET …/availability` | 300/min per IP |
| `POST /api/auth/login` | 5/min per IP + 15 per 15 min per account |
| `POST …/dental-records/[id]/files` (upload init) | 30/min per staff |
| `POST …/dental-records/files/[fileId]/complete` | 60/min per staff |
| `GET` + `POST …/dental-records/cleanup` (shared bucket) | 10/min per staff |

Returns `429` with a `Retry-After` header. The cron route is **not** on
this limiter — it stays protected by its fail-closed bearer auth alone.
**Limitation:** this store is
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

## Dental records & private X-ray storage (Phase D)

Implemented locally and covered by tests; **external R2 setup is still
pending approval** (see [Verified vs assumed R2 behavior](#verified-vs-assumed-r2-behavior)
and `docs/MANUAL_DEPLOYMENT_GUIDE.md` §7). The module is **ADMIN-only** —
`STAFF` gets `403` on every endpoint (server-side, not just hidden in the UI).

UI: `/admin/dental-records` (list, filters, create) and
`/admin/dental-records/[id]` (detail, chronological history, files).
Services live in `lib/server/admin/dental-{records,files,delete,cleanup}.ts`,
storage adapters in `lib/server/storage/`, routes under
`app/api/admin/dental-records/**` + `app/api/cron/dental-storage-cleanup/`.
The schema additions are listed under [Database schema](#database-schema).

### Upload / download flow

1. **Init** — `POST [id]/files` validates the allow-list (JPEG/PNG only,
   extension ↔ MIME family must agree, `byteSize` within `1..MAX_FILE_BYTES`
   (10 MB), no client-supplied key), then in **one transaction** — which
   starts by taking a `FOR UPDATE` lock on the record row — writes the
   `R2KeyRegistry` tombstone and the `PENDING` row with a
   **server-generated key**
   `dental/{patientId}/{recordId}/{fileId}.{ext}`. Under that lock the
   server counts the record's files against `DENTAL_MAX_FILES_PER_RECORD`
   (default 50): at the limit the transaction aborts with **`409 CONFLICT`**
   (race-safe — two concurrent inits serialize on the lock; never a silent
   truncation). A file-id/PK collision rolls the transaction back (no
   half-created row) and retries with a fresh id (`newFileId()`, test hook
   `[KK]`).
2. **Client PUT** — the browser uploads **directly to R2** with the presigned
   PUT (300 s; `Content-Type` is part of the signature, so the declared type
   cannot drift). The Next.js server never buffers image bytes. **Note:**
   `Content-Length`/body are NOT signed — the URL cannot enforce a size
   (see [Upload-size enforcement & prepared lifecycle rule](#upload-size-enforcement--prepared-lifecycle-rule-f3)).
3. **Complete** — `POST files/[fileId]/complete` HEADs the object: it must
   not exceed **10 MB** (`oversize:limit=…:actual=…` → `REJECTED`, checked
   BEFORE the declared-size comparison), declared `byteSize` must match,
   then the **magic bytes** must match the declared
   family (JPEG `FF D8 FF`, PNG signature). Pass → `AVAILABLE` +
   `dentalfile.upload` audit; fail → `REJECTED` +
   `dentalfile.rejected { reason }` (`object_missing` / `oversize` /
   `size_mismatch` / `family_mismatch` / `magic_bytes`). Completion is
   idempotent (replay never duplicates the
   audit); a `REJECTED` file answers `409` and is swept by Job B.
4. **View/download** — `GET files/[fileId]/url` requires `AVAILABLE`, mints a
   **short-lived presigned GET** (300 s) and writes `dentalfile.download`
   **per call**. No public URL exists at any moment: no public ACLs, no
   `public/` writes, no listing endpoint — the bucket must deny anonymous
   access (external setup step).
5. **Credentials** — `R2_*` variables are read server-side only
   (`lib/server/env.ts`), never `NEXT_PUBLIC_*`, and never serialized
   (tests assert no response body contains `secretAccessKey` / `R2_SECRET`).
   Every file response carries `Cache-Control: no-store`.

### Deletion protocol

Every physical delete — admin delete, record delete, sweep claim, orphan —
follows the same two-transaction protocol:

1. **Intent (txA)** — lock the scan-state row (`FOR UPDATE`), take a fresh
   `clock_timestamp()`, `MAX(eventNo) + 1`, insert the `StorageDeletionReceipt`
   as PENDING (raw partial unique index ⇒ at most one pending receipt per
   key; `P2002` ⇒ abort **before** any `DeleteObject`). The intent audit
   (`dentalfile.delete`, `trigger: admin|record_delete|sweep|orphan` — the
   exact values written by the source: `admin` admin delete,
   `record_delete` record delete, `sweep` Job B claim, `orphan` Job D
   reconcile) is written in the **same transaction** as the transition to
   `DELETING`.
2. **URL-TTL guard** — nothing is deleted before `cleanupAfter`
   (= `createdAt` + 300 s URL TTL + 300 s buffer = 600 s), checked against a
   fresh DB clock; claims never modify `cleanupAfter`.
3. **Lease** — one run at a time holds the `StorageScanState` lease (900 s);
   `holdsLease()` is re-checked **immediately before every `DeleteObject`**.
4. **Execute** — HEAD (evidence) → `DeleteObject` → HEAD (confirm missing).
5. **Finalise (txB)** — `UPDATE … WHERE id AND "completedAt" IS NULL` must
   affect exactly 1 row (else rollback) and the completion audit is inserted
   atomically. A crash before txB leaves a PENDING receipt; the next run with
   a free lease takes it over (`takeOverStaleIntent`) — `eventNo` is never
   reused.

**Documented accepted race (`[FENC]`/`[DL]`):** the final
check→request gap cannot be fenced — a lease acquired after the last
`holdsLease()` may overlap an in-flight `DeleteObject`. `DeleteObject` is
idempotent, so the worst case is a redundant delete of an already-absent key;
it can never delete an object "too early" by itself (the grace + row checks
happen before).

**Orphans** (objects with no `DentalFile` row) are deleted only by Job D,
only after a **48 h inclusive grace** measured from `t0` (the DB clock at run
start), and only on a **fresh HEAD** `Last-Modified` — LIST timestamps are
an optimization for skipping clearly-young objects, and a missing timestamp
fails **closed** (never old enough). The row check is **filter-free**: any
object with a row is never orphan-deleted, whatever its status.

### Cleanup runbook

Jobs run in order **B → A → C → D** sharing one item budget:

| Job | What it does | Audits written |
| --- | --- | --- |
| B sweep | Claims due files (`PENDING` past `cleanupAfter`, `REJECTED`, or soft-deleted record) → `DELETING`. Never touches `cleanupAfter`. | `dentalfile.delete {trigger:"sweep"}` per claim (atomic with the claim) |
| A delete | Physically deletes claimed rows whose `cleanupAfter <= now` (HEAD → DeleteObject → HEAD, receipt + txB). | none (intent came with the claim) |
| C purge | Purges soft-deleted records with **zero** file rows remaining. | none |
| D reconcile | LIST `dental/` + orphan handling: 48 h grace, fail-closed timestamps, row-backed protection, durable cursor, ≤ 2000 keys/run. | `dentalfile.delete {trigger:"orphan"}`, `dentalfile.orphan_already_absent`, `dentalfile.orphan_row_backed` |

How to run:

- **Automatic (after an authorized deploy):** Vercel Cron →
  `GET /api/cron/dental-storage-cleanup` with
  `Authorization: Bearer CRON_SECRET` (full run, `maxDuration = 300`).
  Register it through Vercel's officially supported mechanism — a committed
  `vercel.json` `crons` entry for path `/api/cron/dental-storage-cleanup`
  with schedule `0 3 * * *`, or `vercel crons add "/api/cron/dental-storage-cleanup" "0 3 * * *"` —
  then deploy; the Vercel dashboard (Project → *Settings → Cron Jobs*) is
  used only to verify, inspect, or disable the job. The route hashes both
  sides of the bearer and compares them in constant time and
  **fails closed with 503 whenever `CRON_SECRET` is unset**; a wrong secret
  answers 401. Until the cron is registered, use the manual endpoint.
- **Manual (ADMIN session):** `GET …/cleanup` = throttled sweep (Jobs B→A→C,
  10 items / 60 s — safe to poll) or `POST …/cleanup` = full run
  (Jobs B→A→C→D, 100 items / 240 s soft deadline).
- **Reading the result:** `stoppedBy: "complete"` (drained), `"budget"` /
  `"deadline"` (partial — call again). If another live run holds the lease,
  the endpoints answer **409 CONFLICT**; a run that *loses* its lease
  mid-flight stops with `stoppedBy: "lease_busy"` instead of continuing.
  `skipped: "no_storage"` means `R2_*` is not configured — jobs never fake
  success.
- **Crash recovery:** pending receipts are taken over by the next run; the
  durable cursor resumes the orphan scan across runs and resets when a cycle
  completes.
- **Cost/scale guardrails:** shared budgets (10/100 items), 2000 keys per
  run, 48 h grace before any orphan delete, `Cache-Control: no-store`
  everywhere.

### Upload-size enforcement & prepared lifecycle rule (F-3)

**What the presigned PUT cryptographically enforces:** `Content-Type` only —
it is part of the SigV4 signature (`SignedHeaders` contains `content-type`),
so R2 rejects a PUT whose Content-Type differs from the declared one.

**What it does NOT enforce (stated honestly):** `Content-Length` and the
request body are **not signed** in `storage/r2.ts → presignPut`. R2
therefore accepts any body size up to its own service limits — a claim that
"Content-Length validation is a security guarantee" would only be true if
Content-Length were included in the signature **and** verified against R2
in a smoke test. We deliberately do NOT add it (or a `Tagging` header):
passing unverified signed parameters risks signature rejections that break
uploads, without any security we could currently prove.

Size is enforced **server-side after the PUT** instead:

1. **Init** — the route's zod schema and a second service-level guard both
   require `byteSize` ∈ `[1, MAX_FILE_BYTES]` (10 MB) before any row or key
   is reserved.
2. **Complete** — `HEAD` size > `MAX_FILE_BYTES` → `REJECTED`
   (`oversize:limit=…:actual=…`) **before** the declared-size comparison, so
   an oversize object can never become `AVAILABLE`; and since download
   requires `AVAILABLE`, it is never served.
3. **Cleanup** — the `REJECTED` row is claimable by Job B, which physically
   removes the object after its `cleanupAfter` window.

**Residual exposure (cannot be eliminated without real R2):** a
temporarily-oversize object may exist in the bucket between PUT and
complete. Reachable only by an authenticated ADMIN, bounded by the 30
inits/min rate limit; row + object are cleaned by Job B once rejected.

**Prepared bucket lifecycle rule — NOT configured (no Cloudflare access in
this task).** Recommended backstop for *abandoned* or *rejected* uploads if
the application cleanup ever stops running for an extended period
(Cloudflare dashboard → R2 bucket → Settings → Lifecycle rules) once the
bucket exists:

| Field | Value |
| --- | --- |
| Rule name | `dental-abandoned-uploads-backstop` |
| Action | Delete objects |
| Filter | Prefix `dental/` **AND** size > 10 485 760 bytes (10 MB) **AND** age > 1 day (last modification) |

Why this shape (and what to avoid):

- **Never age-only on the shared prefix.** An age rule on `dental/` alone
  would silently delete healthy X-rays of active records — exactly the F-1
  class of bug, but at the bucket level and outside application control.
  Row-backed objects' lifecycle belongs to the application (Job B claims
  only due PENDING/REJECTED uploads or files of soft-deleted records).
- **The size filter makes it a pure backstop:** every *valid* object is
  ≤ 10 MB (init + complete enforce this), so a correctly-behaving upload
  never matches the rule even after age 1 day; only objects that violated
  the cap (e.g. a PENDING row whose PUT exceeded it and was never completed)
  are caught.
- **Tag-based alternative (`state=abandoned`) is a candidate, not a
  default:** it would be more precise, but requires adding a signed
  `Tagging` header to the presigned PUT — unverified for R2 and potentially
  upload-breaking. Revisit during the approved real-R2 smoke test.
- **Verify the filter syntax** (combined prefix + size + age) against the
  real Cloudflare dashboard before creating the rule; Cloudflare lifecycle
  filter capabilities must be confirmed empirically. This section PREPARES
  the rule only — nothing was configured.

### Verified vs assumed R2 behavior

All automated tests use the **in-memory storage adapter**
(`lib/server/storage/memory.ts`, injected via `setStorageForTests`) — real
R2 is **never** touched by tests, and no real credentials exist locally.
What the tests *verify* is the protocol logic (ordering, grace, receipts,
audits, idempotency) against the adapter's documented semantics. What
remains **assumed until an approved real-R2 smoke test**:

| Behavior | Used by | Status |
| --- | --- | --- |
| Presigned PUT with `Content-Type` in the signature (300 s) | upload init | **Assumed** — standard AWS SigV4; R2 documents S3-compatible presigned URLs |
| Presigned GET (300 s) for a private object | download | **Assumed** — same |
| HEAD returns size + `Last-Modified`; missing object ⇒ `found: false` without throwing | complete verify, Job A/D evidence, orphan grace | **Assumed** (S3-standard; must confirm R2's exact error shape for absent keys) |
| LIST with prefix + start-after + `maxKeys`, per-key `LastModified` | Job D | **Assumed** — R2 supports S3 ListObjectsV2; the start-after parameter needs confirmation |
| `DeleteObject` on an already-absent key succeeds (idempotent) | every deletion path | **Assumed** — critical: a non-idempotent error would surface as `failed_confirm`; smoke test must confirm |
| `forcePathStyle: true`, `region: "auto"` endpoint config | adapter (`storage/r2.ts`) | **Assumed** per Cloudflare docs |
| Anonymous/public access denied at the bucket | whole design | **Assumed** until the bucket policy is set (external step: private bucket, no public URLs) |
| Grace/age decisions come from OUR clock (`t0`) + HEAD timestamp | Job D | **Verified logic** (unit + integration); the timestamp's origin is the assumption |
| Cron bearer auth (503 unset / 401 wrong / 200 right), mode routing, lease 409 | cron + cleanup routes | **Verified** (integration tests) |

The smoke test plan (steps, expected outputs, failure handling) is in
`docs/MANUAL_DEPLOYMENT_GUIDE.md` §7 — it stays **pending explicit
approval**; no Cloudflare account, bucket, token, or billing has been
created.

---

## Testing

| Suite | Command | Needs DB | Covers |
| --- | --- | --- | --- |
| Unit (149 tests: 16 files) | `npm test` | No | Schedule rules (Mon/Sat/Sun, lunch, closing, past, +05:30 timezone), Zod validation (incl. missing-email regression), rate limiter, scrypt/session crypto, UTC connection-string guard, **integration-test DB wipe guard**, **route-error logging contract `[F-8]` (stack for Errors, no PHI/secrets/cookies/signed URLs, generic 500)**, **doc/source accuracy guards `[F-6]`/`[F-7]` (exact audit trigger tokens, cron-registration docs)**, plus all Phase D pure logic: key/id generation, magic-byte + family matching, TTL/grace math, presign/input schemas, R2 env resolution, cleanup decision helpers |
| Integration (165 tests: 8 files) | `npm run test:integration` | Yes | Availability, booking, back-to-back allowed, **off-grid starts rejected (slot-bypass protection)**, **aligned cross-duration overlap rejected**, cancel frees slot, **concurrency races (2 and 5 simultaneous → exactly 1 wins)**, transition table, reschedule, patient identity, audit rows, **stored-timestamp integrity (raw PostgreSQL render vs booked instant)**, plus route-level: 201/409/400/403 CSRF/401/429, cookie flags, logout, no-PII-in-public-responses — **and Phase D** (`dental-records.test.ts` 17, `dental-files.test.ts` 22, `dental-cleanup.test.ts` 28): ADMIN-only authz (401/403/405), record CRUD + filters + audits, upload init/complete verification, presigned URL issuance, delete protocol ordering + receipts + lease, Jobs A–D, **sweep claim guard `[F-1]` (healthy AVAILABLE files never claimed)**, **per-item failure isolation `[F-2]` (`failed_error`, no false receipts, lease released)**, **per-record file cap `[F-5]` (409, race-safe concurrent inits, `filesTotal`/`truncated` — no silent truncation)**, **upload size guards `[F-3]` (service byteSize guard, oversize REJECTED at complete before size equality)**, **endpoint rate limits `[F-4]` (429 + Retry-After, auth before limiter, shared cleanup bucket)**, **hashed wrong-length cron bearer rejection `[F-9]`**, cron fail-closed auth, LIST/HEAD race handling, collision retry `[KK]`, no-credentials-leak assertions |

Integration tests run against a real PostgreSQL (via the embedded dev DB) and
exercise the full stack: validation → rate limiting → auth/CSRF → domain
service → Prisma → PostgreSQL (including the exclusion constraint). **Every
storage-touching test injects the in-memory adapter
(`setStorageForTests(new MemoryStorage())`)** — no test ever performs a
network request or needs R2 credentials.

> **Disposable database required — enforced.** Integration tests **wipe** the
> `Appointment`, `Patient`, `AuditLog`, `Staff` (and `StaffSession`) tables —
> and the Phase D suites additionally wipe `DentalRecord`, `DentalFile`,
> `R2KeyRegistry`, `StorageDeletionReceipt`, `StorageScanState` (clinic
> config, doctors and services are never touched). Before any query
> runs, `tests/integration/db-guard.ts` **refuses** to start unless the
> connection is clearly disposable: `NODE_ENV=production` always refuses;
> unparseable/non-postgres/empty-db URLs refuse; a remote host is allowed only
> when the database name ends in `_test` (e.g. `the_good_dentist_test`);
> loopback (`localhost`/`127.0.0.1`/`::1`) is allowed as the documented local
> test bed. The refusal message names only host + database — never
> credentials. The predicate itself is unit-tested.

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
- **Integration tests wipe the Staff table** — only against disposable
  databases; the wipe guard (`tests/integration/db-guard.ts`) enforces this
  automatically (see [Testing](#testing)).
- **Public self-cancellation is not exposed** (needs OTP verification first);
  cancellation is staff-only for now.
- **R2 behavior is assumed, not smoke-tested** — all storage tests use the
  in-memory adapter; the presign/HEAD/LIST/DELETE assumptions for real R2 are
  listed in [Verified vs assumed R2 behavior](#verified-vs-assumed-r2-behavior)
  and wait for an approved smoke test (no Cloudflare account/bucket/token
  exists yet).
- **No malware scanning** — uploads get type allow-listing + magic-byte
  validation (JPEG/PNG, ≤ 10 MB), not AV scanning; add a scanner before
  treating uploads as virus-free.
- **Cron not yet registered** — until an authorized deploy adds the Vercel
  cron, cleanup is manual (`GET/POST /api/admin/dental-records/cleanup`);
  abandoned `PENDING`/`REJECTED` rows and orphans therefore only drain when
  someone (or the cron) runs a job.
- **Unfenceable check→request race accepted** — the final lease check and
  `DeleteObject` cannot be fenced; documented and tested
  ([Deletion protocol](#deletion-protocol)); worst case is an idempotent
  re-delete.
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
