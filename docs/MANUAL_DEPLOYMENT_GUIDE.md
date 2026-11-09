# The Good Dentist — Manual Action & Human Assistance Checklist

> **Purpose:** document *every* task that requires a human — the project owner,
> the clinic (Dr. Nidhi Paliwal), or an external service — before The Good
> Dentist can be deployed and operated in production.
>
> **Audit date:** 31 October 2026. All facts below were verified against the
> actual repository state and live provider pricing pages on that date.
> **Nothing in this guide has been deployed, purchased, or committed** — it is
> a plan, not an action log.

---

## 0. Executive summary (read this first)

### Totals

| Category | Count |
| --- | --- |
| **A — Manual tasks for you (owner)** | **18** (M1–M18) |
| **B — Tasks the AI agent can perform** | **10** (A1–A10) |
| **C — Tasks needing client (clinic) input/approval** | **10** (C1–C10) |
| **Paid services potentially required** | **3** — Vercel Pro, PostgreSQL hosting, one domain |
| **External accounts needed** | **4 required** (GitHub ✔ existing, Vercel, Neon, domain registrar) + **2 optional** (Upstash, Sentry) |

### Estimated steady-state cost (all figures verified from provider pages unless marked *estimate*)

| Scenario | Vercel | Database | Domain | Total |
| --- | --- | --- | --- | --- |
| **Lean** (Hobby + Neon Free) | $0 | $0 | ~$10–15/yr | **~$0/mo** — with caveats, see §3.5 |
| **Recommended middle** (Pro + Neon Launch, scale-to-zero on) | $20/mo | ~$2–6/mo *estimate* + snapshots | ~$10–15/yr | **~$23–27/mo** |
| **Maximum reliability** (Pro + Neon Launch always-on + instant restore) | $20/mo | ~$20/mo *estimate* + $0.20/GB-mo history | ~$10–15/yr | **~$41/mo** |

Vercel's own FAQ states the **Hobby plan is for personal, non-commercial use**;
a clinic's customer-facing website is a commercial use, so **Pro ($20/mo) is
the plan we recommend for launch**. This is a decision you approve (M7), not
an assumption.

### Tasks blocking production deployment (must finish before announcing the site)

- **A1** commit+push the 9 uncommitted review-fix files → then **M1–M6** (Vercel + Neon accounts, secret, env vars), **M8** (first successful deploy), **M11–M14** (migrations, constraint check, seed, staff account), **M18** (verification checklist).
- **M9/M10/M13** (domain + DNS + canonical URL) block a *public marketing* launch, not a soft launch on `*.vercel.app`.

### Tasks that can wait until after launch

Agent tasks **A3–A5** (health endpoint, shared rate limiting, error reporting) and client tasks **C5, C6, C8** (photos, dentist bio, privacy-policy wording review) — the booking system works without them. See §11 for the full dependency map.

### Working agreement (how I will help)

1. I will guide **one logical group of tasks at a time** — never a wall of ten unrelated steps.
2. **Never paste passwords, `SESSION_SECRET` values, API keys, or full database connection strings into chat.** Set them directly in the Neon/Vercel dashboards or your password manager. If I need to confirm a value exists, say only "set" — not what it is.
3. When you finish a group, tell me what you saw (or attach a screenshot) and I will interpret the dashboard and give you the next group.
4. Every manual step below lists what **success looks like** so you can confirm you did it right without me ever seeing your secrets.

---

## 1. Repository audit findings (verified today)

| Item | State | Notes |
| --- | --- | --- |
| Git | 5 commits on `main`, **in sync with `origin/main`** (github.com/silver-crow07/the-good-dentist) | Nothing unpushed except working-tree changes |
| Uncommitted work | **9 paths** — 7 modified + 2 new (`tests/integration/db-guard.ts`, `tests/unit/db-guard.test.ts`) | These are the security-review fixes. Vercel deploys **only what is pushed**, so this is task **A1** |
| Build | `package.json` → `"build": "prisma generate && next build"` | Deployment-proof: the git-ignored Prisma client is regenerated on every build |
| Prisma | 7.10.1; generator `prisma-client` → `../generated/prisma` (git-ignored); `@prisma/adapter-pg` driver adapter; `prisma` CLI in `dependencies` | Works on Vercel with no extra configuration |
| Migrations | `prisma/migrations/0_init/migration.sql` — includes the `Appointment_noDoctorOverlap` GiST exclusion constraint and `Appointment_timeOrder` CHECK | Applied via `prisma migrate deploy` (§6) |
| Seed | `prisma/seed.ts` — idempotent upserts (clinic config, Mon–Sat 9–13 & 16–21, Sunday closed, 30-min interval, MANUAL_APPROVAL, 8 services with **provisional** durations flagged, Dr. Nidhi Paliwal) | Safe to re-run after client confirmations |
| Staff creation | `scripts/create-staff.ts` — offline only, ADMIN role, min 12-char password, re-running rotates the password and revokes sessions | No public registration endpoint exists |
| Auth | scrypt hashing, HMAC-signed opaque session cookies (HttpOnly/SameSite=Lax/Secure-in-prod), Origin/CSRF checks, login limits 5/min per IP + 15/15min per account | Reviewed and hardened in the security pass |
| Env validation | `lib/server/env.ts` — no fallback secrets; missing `SESSION_SECRET` → auth returns 503; <32 chars in production → refused | Variables actually used: `DATABASE_URL`, `SESSION_SECRET`, `SESSION_COOKIE_NAME` (optional), `NEXT_PUBLIC_SITE_URL` (optional), `STAFF_EMAIL`/`STAFF_PASSWORD` (offline script only) |
| Vercel config | **None exists yet** — no `vercel.json`, no CI workflow, no Dockerfile | Vercel's Next.js auto-detection is sufficient; the only `vercel.json` ever added is the optional cron entry in §7.1 step 8 |
| Node | Developed on Node 22.21.1; no `engines` field or `.nvmrc` | Optional hardening: task **A2** |
| Tests | 59 unit + 45 integration (real PostgreSQL) + 21 manual E2E checks; integration suites have a hard **wipe guard** (`tests/integration/db-guard.ts`) | Integration tests refuse non-disposable databases automatically |
| API runtime | Every route handler pins `runtime = "nodejs"` | Fully compatible with Vercel Functions |
| Secrets | `.env` git-ignored and untracked; `.env.example` holds empty placeholders only; no credentials anywhere in tracked files | Verified by repository-wide scan |

---

## 2. Category A — Tasks you must perform manually

Each task lists: **why** · **where** · **URL** · **what to click** · **what to
enter** · **where to get it** · **success confirmation** · **what to tell me**.

### M1 — Create (or confirm) your Vercel account

1. **Why:** Vercel hosts the website; every deploy happens from your account.
2. **Where:** browser, on your machine.
3. **URL:** https://vercel.com/signup
4. **Buttons:** *Continue with GitHub* (recommended — the repo already lives on GitHub) → authorize Vercel.
5. **Enter:** your GitHub account; choose a team name (personal default is fine).
6. **Get it:** nothing external needed.
7. **Success:** you land on an empty Vercel dashboard (`vercel.com/<you>`).
8. **Tell me:** "Vercel account ready" (+ the team/scope name you chose, if any).

### M2 — Create the Neon account and production project

1. **Why:** the booking system needs a real PostgreSQL database; Neon is the recommended provider (§3).
2. **Where:** browser.
3. **URL:** https://console.neon.tech/app/signup (sign up with GitHub again for simplicity).
4. **Buttons:** after signup → **Create project** → settings:
   - **Name:** `the-good-dentist`
   - **Region:** choose the one closest to your clinic's users (e.g. *Mumbai* or *Singapore* if offered on your account; otherwise the nearest available).
   - **PostgreSQL version:** the default (latest, 17/18).
   - **Plan:** start on **Free**; upgrade to **Launch** at public launch (M7).
5. **Enter:** project name + region only. No card needed on Free.
6. **Get it:** Neon creates the project, a `neondb` database, and a role automatically.
7. **Success:** the project dashboard opens and shows a branch with a running compute.
8. **Tell me:** "Neon project created" + the region you picked. **Do not paste the connection string.**

### M3 — Create the production database and the test database

1. **Why:** the app needs a real database name, and the integration-test wipe guard requires any *remote* test database to be named `…_test` — keeping tests away from production data by construction.
2. **Where:** Neon Console → your project.
3. **Buttons:** **Databases** (left sidebar) → **Create database**:
   - **Name:** `tgd_prod` → **Create**.
   - Repeat: **Name:** `tgd_prod_test` → **Create**.
4. **Enter:** those two names.
5. **Get it:** nothing.
6. **Success:** both databases are listed under the project.
7. **Tell me:** "both databases created". **Never paste either connection string into chat** — you will paste them into Vercel/your terminal yourself in M6/M11.

### M4 — Generate and store the production `SESSION_SECRET`

1. **Why:** staff-login cookies are HMAC-signed with this secret; without it, staff login returns 503. Production refuses secrets shorter than 32 characters.
2. **Where:** your machine's terminal (PowerShell), then your password manager.
3. **Command:** `openssl rand -base64 48` (if you have Git for Windows installed, `openssl` is available in Git Bash) — or use your password manager's *Generate → Random password* (48+ characters).
4. **Enter:** nothing; read the output.
5. **Get it:** the command itself.
6. **Save it:** store the value in your password manager under "The Good Dentist — SESSION_SECRET". Generate **separate** secrets for Preview and Production if you want maximum hygiene (optional; one value used in two scopes is acceptable at this scale).
7. **Success:** a secret exists in your password manager and **nowhere in chat, email, or Git**.
8. **Tell me:** "secret generated and stored". Do **not** paste it.

### M5 — Import the GitHub repository into Vercel

1. **Why:** Vercel deploys from GitHub on every push.
2. **URL:** https://vercel.com/new
3. **Buttons:** *Import* next to `silver-crow07/the-good-dentist` (grant the Vercel GitHub App access to that repository if prompted — *Configure access*).
4. **On the import screen ("Configure Project"):** leave everything at the detected defaults —
   - Framework Preset: **Next.js** (auto-detected)
   - Build Command: **`npm run build`** (Vercel's default for Next.js — this already runs `prisma generate && next build`)
   - Install Command: **`npm install`** (default)
   - Output Directory: **default** (do not set)
   - **Do not deploy yet** if the env-var screen appears before M6 — you can also just click *Deploy*; the marketing pages will build fine and APIs will answer 503 until M6/M11 (that is safe, not an error).
5. **Success:** the project is created and shows a first deployment.
6. **Tell me:** "repo imported" + the Vercel project URL slug (e.g. `the-good-dentist-xxxx`).

### M6 — Set the environment variables in Vercel

1. **Why:** the backend needs the database URL and the session secret; Vercel injects them at build and runtime. Variables are **per-environment** — Production, Preview, and Development do not share values.
2. **URL:** `https://vercel.com/<you>/<project>/settings/environment-variables`
3. **Add each variable** via *Add New*:

   | Name | Environment(s) | Value |
   | --- | --- | --- |
   | `DATABASE_URL` | **Production** | the **direct** connection string of `tgd_prod` (Neon Console → *Connect* → Connection pooling toggle **OFF** → copy) + append `&sslmode=require` if not already present |
   | `DATABASE_URL` | **Preview** | either the `tgd_prod_test` connection string, or **omit entirely** (booking APIs then answer a clean 503 on previews — a safe default; previews must **never** point at Production) |
   | `SESSION_SECRET` | **Production** + **Preview** | the secret from M4 (paste from password manager directly into the field) |
   | `NEXT_PUBLIC_SITE_URL` | **Production** | `https://<your-final-domain>` — set after M9/M10; you may add it later and redeploy |

4. **Do not set** `STAFF_EMAIL`/`STAFF_PASSWORD` in Vercel — those exist only for the offline staff-creation script (M14).
5. **Phase D storage vars** (`R2_ACCOUNT_ID`/`R2_BUCKET`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, plus `CRON_SECRET`) are added **later** per §7.1 — only after the Cloudflare setup is approved. Until then the dental file endpoints answer a clean 503 in every environment, which is safe.
6. **Success:** the variables are listed under the correct environment chips.
7. **Tell me:** "env vars set for Production" (and whether you set Preview or left it unset). Never paste the values.

### M7 — Approve the paid plans (decision + payment)

1. **Why:** Vercel's Hobby plan is licensed for *personal, non-commercial use*; a clinic website is commercial. Neon Free forces a 5-minute scale-to-zero (cold starts) and a 1 GB cap with only a 6-hour restore window — acceptable for a soft launch, thin for a real clinic.
2. **Where:** Vercel → *Settings → Billing* (upgrade the team to **Pro, $20/mo**); Neon → *Billing* (upgrade project to **Launch**, pay-as-you-go).
3. **Enter:** payment details on the provider sites (never in chat).
4. **Success:** Vercel team shows *Pro*; Neon project shows *Launch*.
5. **Cost expectation:** Vercel Pro is a flat $20/mo including a $20 usage credit (our traffic fits inside it). Neon Launch is usage-based: *estimate* $2–6/mo for this clinic with scale-to-zero enabled, ~$19–20/mo if you disable scale-to-zero for always-on compute (§3.4).
6. **Tell me:** which options you chose (Pro y/n, Launch y/n) so I can set the remaining recommendations accordingly. **You can do M7 later** — Free tiers work for the soft launch.

### M8 — Watch the first production deployment build

1. **Why:** confirms the code builds on Vercel end-to-end (including Prisma client generation).
2. **URL:** `https://vercel.com/<you>/<project>/deployments` → click the newest deployment → **Build Logs**.
3. **What you should see:** install step → `prisma generate` output ("Generated Prisma Client…") → `next build` compiling → **Ready**.
4. **If it fails:** copy the last ~30 lines of the red log into chat (build logs contain no secrets) and I will diagnose.
5. **Success:** deployment status **Ready**; opening the deployment URL shows the homepage.
6. **Tell me:** "deploy Ready" or paste the failing log tail.

### M9 — Choose and purchase the domain (with the client — see C7)

1. **Why:** the canonical URL, SEO, WhatsApp/phone branding, and email trust all depend on a real domain.
2. **Where:** a registrar. Simple options: buy directly through Vercel (*Project → Domains → Buy a domain*), or Cloudflare Registrar (at-cost pricing), Namecheap, or GoDaddy.
3. **Enter:** the domain name approved by the clinic (C7), your registrant details (note: Indian registrant details are published in WHOIS unless you enable privacy — most registrars include privacy free now).
4. **Cost:** *estimate* ~$10–15/yr for a `.com`; `.in` variants vary. Verify the exact price before paying.
5. **Success:** the domain appears as *active* in your registrar account.
6. **Tell me:** the domain name (this is public information — safe for chat).

### M10 — Point the domain's DNS at Vercel

1. **Why:** DNS is how `yourdomain.com` finds the Vercel servers; HTTPS certificates are issued automatically once Vercel verifies the domain.
2. **Where:** your registrar's DNS management page (or Cloudflare's DNS tab if you use it).
3. **The records:** Vercel shows the **exact** values to use — do not use values from any other tutorial:
   - In Vercel: *Project → Domains* → add the domain → Vercel displays the required records (typically an **A record** for the apex and a **CNAME** for `www`, with values specific to your project).
   - Copy those values verbatim into the registrar's DNS editor, one record per row.
4. **Wait:** DNS propagation is usually minutes, up to 24–48 h worst case. Vercel shows the domain as *Valid Configuration* with a ✔ and issues the TLS certificate automatically.
5. **Success:** Vercel Domains tab shows *Valid Configuration* + *HTTPS* issued; `https://yourdomain.com` loads the site.
6. **Tell me:** "domain valid" — I will then handle the canonical-URL update (A7) and verification (M18).

### M11 — Apply the Prisma migrations to the production database

1. **Why:** the empty production database needs all tables **and** the double-booking exclusion constraint — this is the one step that touches production schema, so it is run deliberately by you under my guidance.
2. **Where:** your machine, in the project folder, in PowerShell.
3. **Commands** (run exactly; replace the placeholder with the connection string of `tgd_prod` taken from the Neon *Connect* dialog — **direct**, pooling OFF):

   ```powershell
   cd C:\vercel\the_good_dentist
   $env:DATABASE_URL = "<paste tgd_prod direct connection string here>"
   npx prisma migrate deploy
   ```

4. **What it does:** applies `prisma/migrations/0_init` idempotently (it will say "No pending migrations" if re-run). It **never** drops data — unlike `prisma migrate dev` or `migrate reset`, which you must **never** aim at production (see the red box in §6).
5. **Success:** output ends with something like `3 migrations found` / `Database schema is up to date`.
6. **Afterwards:** close the PowerShell window (the variable lives only in that session) — your normal local `.env` remains untouched.
7. **Tell me:** "migrate deploy done" + the final two lines of output.

### M12 — Verify the double-booking constraint exists in production

1. **Why:** proves the database-level backstop (the exclusion constraint) really landed — this is the last line of defense against double bookings.
2. **Where:** Neon Console → **SQL Editor** (left sidebar) → select `tgd_prod`.
3. **Run:**

   ```sql
   SELECT indexname FROM pg_indexes
   WHERE tablename = 'Appointment' AND indexname = 'Appointment_noDoctorOverlap';
   ```

4. **Success:** one row returned: `Appointment_noDoctorOverlap`.
5. **Tell me:** "constraint verified" (or paste what the editor returned).

### M13 — Seed the production database

1. **Why:** the schedule, services, clinic config and doctor profile live in the database; the booking API cannot work without them.
2. **Where:** your machine, PowerShell, in the project folder:

   ```powershell
   cd C:\vercel\the_good_dentist
   $env:DATABASE_URL = "<paste tgd_prod direct connection string here>"
   npm run db:seed
   ```

3. **Safety:** the seed is an **upsert** — running it twice changes nothing; running it after future client confirmations (C1–C3) updates the values in place. It never deletes rows and prints counts only.
4. **Success:** `Seed complete — clinic config upserted; 1 doctor, 8 services, 7 weekly hours.`
5. **Tell me:** "seed complete".

### M14 — Create the first staff (admin) account on production

1. **Why:** there is deliberately **no public registration**; the admin account must be created offline directly in the production database.
2. **Where:** your machine, PowerShell:

   ```powershell
   cd C:\vercel\the_good_dentist
   $env:DATABASE_URL = "<paste tgd_prod direct connection string here>"
   $env:STAFF_EMAIL = "<the clinic's chosen admin email>"
   npm run staff:create
   # you will be prompted for the password — type a strong one (min 12 chars);
   # it is hashed with scrypt in memory and never stored or logged in plain text
   ```

3. **Get the values:** the clinic chooses the admin email and password (C-task input) — **do not share the password with me**.
4. **Success:** `Created staff account <email> (role ADMIN).`
5. **Tell me:** "staff account created" + the email if you want me to reference it in the verification checklist (the email itself is fine to share; the password never is).

### M15 — Set the canonical site URL and redeploy

1. **Why:** the sitemap, `robots.txt`, Open Graph tags and structured data all derive from `NEXT_PUBLIC_SITE_URL`; until it is set they point at a placeholder domain.
2. **Where:** Vercel → *Settings → Environment Variables* → set `NEXT_PUBLIC_SITE_URL = https://<yourdomain>` for **Production** → then *Deployments* → newest → **•••** → **Redeploy** (env vars are baked in at build time, so a redeploy is required).
3. **Success:** `https://<yourdomain>/robots.txt` shows your domain; `/sitemap.xml` lists your pages.
4. **Tell me:** "canonical URL live" — I will verify the SEO files during M18.

### M16 — Configure backups and perform one restore test

1. **Why:** the database holds real patient bookings; a backup that has never been restored is not a backup.
2. **Where:** Neon Console → your project → **Backups** (or *Settings → Backups*):
   - On **Launch**: enable **scheduled snapshots** (verified price $0.09/GB-month — negligible at this size); the plan also keeps an instant-restore history (up to 7 days on Launch; the *History window* setting controls it, $0.20/GB-month).
   - On **Free**: you get a 6-hour restore window + 1 manual snapshot — take a **manual snapshot** now and weekly thereafter, or upgrade.
3. **Restore test:** Neon → **Backups** → select a snapshot → **Restore** → choose to restore into a **new branch** (never over the live branch) → open its SQL editor and run `SELECT count(*) FROM "Appointment";` → confirm it returns a sensible number → delete the restore branch.
4. **Success:** one verified restore performed; schedule noted (manual weekly snapshot on Free, automatic on Launch).
5. **Tell me:** "restore test passed". We will add a quarterly full `pg_dump` drill later (agent task A8).

### M17 — Turn on usage/spend notifications

1. **Why:** both providers bill by usage; alerts prevent surprises.
2. **Where:**
   - Vercel → *Settings → Billing* → **Usage notifications** (new teams get a default $200 on-demand budget with email/SMS alerts; review it).
   - Neon → *Billing* → **spending notifications** (Launch/Scale: emails at 80 % and 100 % of budget).
3. **Success:** alerts enabled with your email (and phone for Vercel if you want SMS).
4. **Tell me:** "alerts enabled".

### M18 — Run the production verification checklist (§9) together

1. **Why:** the final gate. §9 is a step-by-step plan; we walk it together after M11–M15.
2. **Where:** your browser + a few PowerShell `curl`s I will provide per step.
3. **Success:** every line in §9 marked ✅.
4. **Tell me:** you are ready to verify, and we go one group at a time.

---

## 3. Category B — Tasks I (the AI agent) can perform

### Locally, immediately (no external access needed)

- **A1 — Commit + push the 9 uncommitted review-fix paths** (the security-review hardening: slot-grid enforcement, in-transaction status re-validation, integration-test wipe guard, `Cache-Control: no-store`, docs). *Requires your explicit go-ahead — I never commit automatically.* This must happen **before M5's first meaningful deploy**, because Vercel deploys only pushed code.
- **A2 — Add `.nvmrc`** with Node 22 (and an `engines` hint) so local and Vercel Node versions can never drift. Optional hardening.
- **A3 — Add `/api/health`** (a tiny `runtime = "nodejs"` handler returning `{ ok, db }` using the existing `pingDatabase()`), useful for uptime monitors. Optional; needs your approval since it touches the route tree.
- **A6 — Update durations/slot interval in `data/services.ts` + `prisma/seed.ts`** once C1/C2 are confirmed, re-run tests, and give you the one-line re-seed command for production.
- **A7 — Canonical-URL verification and any follow-up** after M10/M15: confirm `robots.txt`, `sitemap.xml`, Open Graph tags and structured data render the real domain; adjust `lib/constants.ts` fallback if you want the placeholder removed.
- **A8 — Backup-verification script**: a safe script that takes a `pg_dump` of a connection you provide *via a local env var* and restores it into the disposable local embedded database to prove the dump is valid. Runs only against local/disposable targets by construction.
- **A9 — Rollback runbook**: a short doc covering (a) Vercel one-click rollback to the previous deployment, (b) Neon point-in-time branch restore, (c) the golden rule: schema migrations are forward-only — we fix forward unless data is compromised.
- **A10 — Pre-deploy verification on every change**: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:integration` (against the local disposable DB), `npm run build` — then hand you the results before anything is pushed.

### Locally, but needs external inputs first

- **A4 — Shared rate limiting** (replace the per-process in-memory limiter with Upstash Redis, keeping the same `check()` interface). Needs you to create a free Upstash account and set `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` in Vercel. Priority: **before marketing-driven traffic or staff-dashboard phase**; not blocking for launch at clinic-scale traffic (login is additionally protected by per-account limits and scrypt hashing).
- **A5 — Error reporting** (Sentry SDK integration). Needs you to create a free Sentry account and set the DSN in Vercel. Priority: nice-to-have at launch; Vercel's own runtime logs (1-day retention on Hobby, 1 day on Pro / 30 days with add-ons) cover the first weeks.

### Explicitly out of the agent's reach (why each is manual)

Account creation, payments, DNS, and anything inside another company's dashboard require your credentials — I must never hold them. Running `migrate deploy`/`seed`/`staff:create` against **production** is deliberately assigned to you (M11–M14) so that production writes always happen with your awareness; I prepare and explain every command.

---

## 4. Category C — Tasks requiring the clinic client (Dr. Nidhi Paliwal)

| ID | Decision needed | Current state in code | Impact if not confirmed |
| --- | --- | --- | --- |
| **C1** | Final appointment duration per treatment | **Provisional**: General 30, Cleaning 45, Root Canal 60, Implants 60, Whitening 45, Cosmetic 60, Braces 30, Children's 30 minutes — flagged `durationIsProvisional = true` in the DB | Wrong slot lengths → unrealistic schedules |
| **C2** | Final slot interval | **Provisional 30 minutes** (`ClinicConfig.slotIntervalMinutes`) | Same as above |
| **C3** | Auto-confirm vs manual approval | **MANUAL_APPROVAL** (patients get "request received", staff confirms) | If the clinic wants instant confirmation, this flips a policy field |
| **C4** | Final service list | 8 services live | Removing/adding services is a data + page change |
| **C5** | Real clinic & dentist photographs | **Stock CC0 photos** (sources documented in `public/images/IMAGE_SOURCES.md`) | Site works but does not show the real clinic — trust gap |
| **C6** | Dentist introduction/bio | Qualifications (BDS, PGDMLS, PGDHM), 15 yrs, root-canal focus are in; `bio` is `null` — not invented | "Our Dentist" page stays thin |
| **C7** | Final domain name | Placeholder `thegooddentist.example.com` in code | Blocks M9/M10/M15 and public launch |
| **C8** | Privacy policy & terms content approval | Pages exist with sensible default wording for a booking site | **Legally sensitive** — patient contact data is collected; the clinic should approve (or supply) the wording before public launch |
| **C9** | Cancellation / reschedule rules | Staff-side cancellation works; **no public self-cancel** (needs OTP — future phase). No patient-facing policy text yet | The site cannot state a cancellation policy until the clinic defines one |
| **C10** | Go-live date & announcement | — | Scheduling of the public launch |

Already **confirmed** by the client (no action needed): clinic name, address, geolocation, phone/WhatsApp `+91 9180609088`, email, working hours (Mon–Sat 9–13 & 16–21, lunch 13–16, Sunday closed), and the dentist's core profile — all encoded in `lib/constants.ts` and the seed.

---

## 5. PostgreSQL hosting evaluation

Requirements derived from the codebase: plain PostgreSQL 14+ with `btree_gist`
(for the exclusion constraint), `timestamptz` support, connection counts small
(one Next.js app, `pg` pool per function instance), a single region near
Bengaluru, automated backups, and compatibility with Prisma 7's
`@prisma/adapter-pg` (any standard Postgres wire endpoint works — verified
constraint: the app manages its own UTC session via a connection-string
`options` parameter and uses transaction-level advisory locks, which every
pooled mode supports).

All prices below were **verified on the providers' live pricing pages on
31 Oct 2026**. Anything not on those pages is marked *estimate*.

### 5.1 Neon — recommended

| Aspect | Detail (verified) |
| --- | --- |
| Free tier | **$0**, permanent, no card: 1 GB storage/project, 100 CU-hours, scale-to-zero after 5 min (cannot be disabled), 6-hour restore window, 1 manual snapshot, 10 branches |
| Paid | **Launch**: pay-as-you-go — compute **$0.106/CU-hour** (1 CU ≈ 4 GB RAM), storage **$0.35/GB-month**, instant-restore history **$0.20/GB-month**, scheduled snapshots **$0.09/GB-month**; no monthly minimum |
| Storage | Free capped 1 GB (writes blocked beyond); paid grows at $0.35/GB-month (a clinic DB will stay well under 1 GB for years → *estimate* ≤ $0.35/mo) |
| Connections | Direct: ~104 at 0.25 CU … 419 at 1 CU; **pooled (PgBouncer): up to 10,000 client connections** |
| Backups | Restore windows 6 h (Free) → 7 d (Launch) → 30 d (Scale); manual + scheduled snapshots |
| Pooling | Built-in `-pooler` hostname; use **direct** for migrations/`pg_dump`, **pooled** for the app if connection counts ever grow |
| Prisma 7 | Fully compatible (standard Postgres endpoint + driver adapter) |
| Fit for a clinic | Excellent — autoscaling far beyond our needs, region choice, generous free tier for the soft launch |

**Known Neon-specific notes for this codebase:** (1) Neon has no `superuser`,
which affects nothing here — migrations use ordinary DDL; (2) session-level
state (including session advisory locks) dies with a suspended compute — the
code deliberately uses **transaction-level** `pg_advisory_xact_lock`, so this
is safe; (3) the pooled endpoint goes through PgBouncer in transaction mode —
if it ever rejects the `options=-c timezone=UTC` startup parameter, fall back
to the direct string (fine at this scale: the app pools ~10 connections per
function instance) — I will confirm this during M11/M18.

### 5.2 Supabase

| Aspect | Detail (verified) |
| --- | --- |
| Free tier | $0: 500 MB database, **projects pause after 1 week of inactivity**, 2 projects |
| Paid | **Pro $25/mo** including 8 GB disk (+$0.125/GB) and $10 compute credit covering one Micro instance (1 GB RAM, 60 direct / 200 pooler connections) |
| Backups | Pro: daily backups, 7 days. **PITR is a $100/mo add-on** |
| Pooling | Supavisor (transaction mode), like Neon |
| Prisma 7 | Compatible |
| Fit | Good product, but the *cheapest production-capable tier is $25/mo* (vs Neon's ~$2–6 usage) and PITR is very expensive — poorer value for a single small clinic |

### 5.3 Railway

| Aspect | Detail (verified) |
| --- | --- |
| Free | $0 with **$1/mo** included usage (too small to host this reliably) |
| Paid | **Hobby $5/mo** (includes $5 usage; Postgres + a small app fit inside at idle); **Pro $20/mo** with $20 included. Usage rates: memory **$10/GB-month**, CPU **$20/vCPU-month**, volume **$0.15/GB-month**, egress **$0.05/GB** |
| Backups | Volume snapshots are manual on lower tiers — **no automatic PITR** at this level |
| Pooling | No built-in transaction pooler for Postgres; serverless-style connection churn is riskier |
| Fit | Viable all-in-one (DB *and* app), but weaker backup story and pooling — not recommended over Neon+Vercel here |

### 5.4 Reversal-safe constraint checks

Whatever provider is chosen, M12 verifies the exclusion constraint landed, and
the wipe guard (`tests/integration/db-guard.ts`) refuses to run the destructive
integration suites against any remote database **not** named `…_test` — and
always refuses `NODE_ENV=production`.

### 5.5 Recommendation

**Neon, region Mumbai or Singapore, Free tier for the soft launch → Launch at
public launch.** Reasons: verified cheapest production tier for this workload
(*estimate* $2–6/mo), automated restore windows and snapshots at cents,
built-in pooling for serverless, first-class Prisma compatibility, and a free
tier that lets us complete M11–M18 without a credit card. Use the **direct**
connection string for `DATABASE_URL` at this scale (104+ direct connections is
far beyond a single clinic's peak), switching to the pooled string only if we
ever see connection pressure — I will flag it from the logs.

---

## 6. Vercel deployment setup (exact guide)

**No code changes are required for the base deployment.** There is no CI
workflow and no Dockerfile — Vercel's Next.js detection is sufficient (the
only `vercel.json` this project ever adds is the optional cron entry from
§7.1 step 8). The build
pipeline (`prisma generate && next build`) is already deployment-proof, and
every API route pins `runtime = "nodejs"`.

| Setting | Value |
| --- | --- |
| Framework Preset | **Next.js** (auto-detected on import) |
| Build Command | **`npm run build`** (Vercel default; = `prisma generate && next build`) |
| Install Command | **`npm install`** (default) |
| Output Directory | default (do not override) |
| Node Version | Vercel default (22.x); optional `.nvmrc` pin via task A2 |
| Root Directory | repository root (default) |

**Environment variables per environment** (they are *not* interchangeable):

| Variable | Production | Preview | Development (Vercel CLI / local) |
| --- | --- | --- | --- |
| `DATABASE_URL` | `tgd_prod` **direct** Neon string (+`sslmode=require`) | `tgd_prod_test` string, or **omit** (APIs 503 safely) | local embedded DB string (already in local `.env`) |
| `SESSION_SECRET` | secret from M4 | secret (same or separate) | any local value (production-length rule does not apply in dev) |
| `NEXT_PUBLIC_SITE_URL` | `https://<domain>` (after M10) | the `*.vercel.app` preview URL (optional) | `http://localhost:3000` (optional) |
| `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | the four §7.1 values (Production bucket) — **not yet created** | preview-bucket values, or **omit** (file APIs 503 safely) | **never** — tests inject the in-memory storage fake; local dev needs no R2 |
| `CRON_SECRET` | value from §7 (≥ 32 chars) — **not yet created** | omit | omit (local cleanup uses the manual ADMIN endpoint) |
| `STAFF_EMAIL` / `STAFF_PASSWORD` | **never** | **never** | only when running `staff:create` locally |

**Operating procedures:**

- **Redeploy:** *Deployments* → deployment → **•••** → *Redeploy* (needed after env-var changes, since env is baked at build).
- **Build logs:** deployment page → **Build Logs** tab; copy failing tails into chat — they contain no secrets.
- **Rollback:** deployment page → **•••** → *Instant Rollback* → pick any previous deployment (takes seconds; database schema is unaffected).
- **API verification:** `https://<domain>/api/appointments/availability?date=<YYYY-MM-DD>&serviceSlug=general-dentistry` must return JSON with `slots` (200); unauthenticated `GET /api/appointments/anything` must return 401.
- **Preview safety:** Preview deployments must never receive the production `DATABASE_URL` (M6) — this is the one Vercel-side rule that protects patient data from test deploys.

---

## 7. Environment variables checklist (exact — no invented names)

Verified against `lib/server/env.ts`, `lib/constants.ts`, `scripts/create-staff.ts`, and `.env.example`:

| Variable | Required | Purpose | Where to obtain | Environment |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** (booking APIs answer 503 without it) | PostgreSQL connection string; the app automatically appends `options=-c timezone=UTC` unless you provide your own `options` param | Neon Console → project → **Connect** (append `&sslmode=require` if absent) | Production (+ Preview via test DB); local for Development |
| `SESSION_SECRET` | **Yes** for staff login (503 without it; must be ≥ 32 chars in production) | HMAC-SHA256 key signing staff session cookies | Generate: `openssl rand -base64 48` or password-manager generator (M4) | Production, Preview (separate values optional) |
| `NEXT_PUBLIC_SITE_URL` | No (but **yes for correct SEO** before public launch) | Canonical URL for sitemap/robots/Open Graph/structured data | `https://<your-domain>` after M10 | Production; optionally Preview/Development |
| `SESSION_COOKIE_NAME` | No (default `tgd_session`) | Overrides the session cookie name | — | Leave unset unless a cookie-name conflict arises |
| `R2_ACCOUNT_ID` | Only for Phase D X-ray storage — **all four `R2_*` must be set together** | Cloudflare account id; without the full set, dental **file** endpoints answer 503 (records keep working) and cleanup reports `skipped: no_storage` | Cloudflare dashboard → R2 → overview (§7.1 — **pending approval**) | Production; Preview only if previews may use storage |
| `R2_BUCKET` | ″ (same as above) | Private bucket name used for `dental/…` keys | Create per §7.1 (private, no public access) | ″ |
| `R2_ACCESS_KEY_ID` | ″ (same as above) | R2 API token access key (bucket-scoped, Object Read & Write) | Cloudflare R2 → Manage R2 API Tokens (§7.1) | ″ |
| `R2_SECRET_ACCESS_KEY` | ″ (same as above) | Token secret — shown once; server-side only, never serialized | Same token screen (store in password manager) | ″ |
| `CRON_SECRET` | **Yes (Production)** for the daily storage-cleanup cron; route is 503 without it | Bearer secret for `GET /api/cron/dental-storage-cleanup` (SHA-256 on both sides, then constant-time compare) | Generate: `openssl rand -base64 48` (≥ 32 chars) | Production only (local dev uses the manual endpoint) |
| `DENTAL_MAX_FILES_PER_RECORD` | No (optional — default **50**, supported range **1–500**) | Per-record dental file cap (F-5): maximum number of files ONE dental record may hold; integers outside 1–500 are clamped into range, non-integers fall back to 50 | — | Production, Preview, Development (unset = default 50) |
| `STAFF_EMAIL`, `STAFF_PASSWORD` | Only for the offline staff script | Feeds `npm run staff:create` | Chosen by the clinic (M14) | **Local machine only — never in Vercel** |
| `TEST_DATABASE_URL` | Only for running integration tests | Overrides `DATABASE_URL` for the test suites; remote DBs must be named `…_test` (enforced) | Neon `tgd_prod_test` (M3) | Local test runs only |

**Never commit** any value for these — `.env` is git-ignored (verified); keep it that way.

### 7.1 Phase D — private X-ray storage (Cloudflare R2) & cleanup cron

> 🚫 **Nothing in this section has been performed yet.** No Cloudflare
> account, R2 bucket, API token, billing entry, or Vercel cron exists; no real
> R2 credentials exist anywhere; local `.env` has **no** `R2_*`/`CRON_SECRET`
> values and needs none (tests use the in-memory storage fake). Execute only
> after explicit approval — creating accounts, buckets, tokens, payment
> methods, and cron schedules is owner-side external activity.

**A. Cloudflare setup (manual, after approval)**

1. Create/confirm the Cloudflare account and enable R2. Enabling R2 may
   require a payment method on file even within the free tier — treat that as
   a billing decision (approval required). Set a **budget alert of $1–5**
   (Cloudflare → R2 → Metrics/Notifications) so usage anomalies surface.
2. Create **two private buckets** (no public access, no custom domain):
   one for **Production** (e.g. `the-good-dentist-dental`) and one for
   **Preview** (e.g. `the-good-dentist-dental-preview`) so preview deploys
   can never touch production X-rays.
3. For each bucket create a **bucket-scoped API token** with
   *Object Read & Write* only (no account-wide token). Record the four
   values per environment: `R2_ACCOUNT_ID`, `R2_BUCKET`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
4. Configure **CORS** on each bucket to allow the site origin(s)
   (`https://<domain>`, plus the `*.vercel.app` preview URL for the preview
   bucket) with methods `PUT` (upload) and `GET` (view), allowed header
   `Content-Type`. CORS is what lets the browser speak directly to R2; the
   server never proxies bytes.
5. Confirm bucket policy: **anonymous access denied** (the app only ever
   uses presigned URLs, 300 s).
6. Configure the **prepared backstop lifecycle rule** (rule text prepared
   in `docs/BACKEND.md` → *Upload-size enforcement & prepared lifecycle
   rule*): name `dental-abandoned-uploads-backstop`, **Delete objects**,
   filter prefix `dental/` **AND** size > 10 485 760 bytes **AND** age > 1
   day. This only catches objects that violated the 10 MB cap — **never**
   use an age-only filter on `dental/` (it would silently delete healthy
   X-rays of active records). Verify the exact filter syntax in the
   dashboard first; tag-based selection (`state=abandoned`) stays a
   candidate pending the smoke test.

**B. Vercel wiring (after A)**

7. Set the four `R2_*` values (Production; Preview with the preview bucket)
   and `CRON_SECRET` (Production) per §7 — then **redeploy** (env is baked
   at build).
8. Register the cron through Vercel's officially supported mechanism — a
   committed `vercel.json` `crons` entry for path
   `/api/cron/dental-storage-cleanup` with schedule `0 3 * * *` (shipped
   with an authorized deploy), or the CLI: `vercel crons add "/api/cron/dental-storage-cleanup" "0 3 * * *"`.
   The Vercel dashboard (Project → *Settings → Cron Jobs*) is only there
   to verify, inspect, or disable an existing job — registration does not
   happen there. Timing, not a restriction: `0 3 * * *` fires during
   03:00–03:59 UTC, each cron runs at most once per day on the Hobby plan,
   and every plan allows up to 100 cron jobs per project. Vercel is
   documented to attach `Authorization: Bearer <CRON_SECRET>` automatically
   when that env var is set — **verify this in step 11**; if the header is
   not attached, the route will answer 401 (fail-closed, never an
   unauthenticated run).
9. Until the cron exists, cleanup runs manually: ADMIN login →
   `POST https://<domain>/api/admin/dental-records/cleanup` (full run) or
   `GET …/cleanup` (throttled sweep). Runbook: `docs/BACKEND.md` →
   *Cleanup runbook*.

**C. Real-R2 smoke test (separate explicit approval — verified vs assumed)**

10. The assumptions to confirm are listed in `docs/BACKEND.md` →
    *Verified vs assumed R2 behavior*: presigned PUT with signed
    `Content-Type` (and the honest fact that `Content-Length` is **not**
    signed), presigned GET, HEAD size/`Last-Modified` + absent-key
    shape, LIST start-after, **idempotent `DeleteObject` on an absent key**,
    `forcePathStyle`/`region: auto`, plus the lifecycle-rule filter syntax
    from step 6.
11. Planned walk-through (against the **preview** bucket first): upload a
    ≤ 10 MB JPEG via the UI → complete shows `AVAILABLE` → view issues a
    300 s URL that renders → replay complete is idempotent → wrong-type and
    oversize are rejected → delete queues then removes object + row →
    `POST /api/admin/dental-records/cleanup` reports the Jobs → invoke the
    cron URL manually with/without the bearer (expect 200 / 401, and 503
    with `CRON_SECRET` unset) → check the audit trail rows
    (`dentalfile.upload/download/delete`) and R2 metrics for unexpected
    operations. Record each confirmed/failed assumption next to the table
    in `docs/BACKEND.md`.

---

## 8. Database migration & initial staff account (reference)

Development vs test vs production:

| Database | Where | Used for | Wipe policy |
| --- | --- | --- | --- |
| Local dev | embedded PostgreSQL 18.4 on `localhost:55432` (`.pgdata-local/`) | `npm run dev`, integration tests | Integration tests wipe booking rows **by design**; the wipe guard allows loopback only |
| Test (`tgd_prod_test`) | Neon, remote | Optional remote integration-test target | Allowed by the wipe guard (name ends `_test`) |
| Production (`tgd_prod`) | Neon | The live site | **Guarded:** integration tests refuse it outright (`NODE_ENV=production` always refuses; remote non-`_test` names refuse) |

Exact steps: **M11** (migrate deploy) → **M12** (constraint check) → **M13** (seed) → **M14** (staff account) → login verification in §9 step G.

> ### 🚫 Destructive commands — never aim these at production
>
> | Command | What it does | Safe target |
> | --- | --- | --- |
> | `npx prisma migrate reset` | **Drops every table and all data**, re-applies migrations, re-seeds | Local disposable DB only |
> | `npx prisma migrate dev` | Creates/applies migrations *and can reset the dev DB* when the schema drifts | Local dev DB only |
> | `npm run test:integration` | Wipes Appointment/Patient/AuditLog/Staff/StaffSession rows | Local dev DB or `…_test` DB (the guard enforces this) |
> | `DROP DATABASE` / `DELETE FROM …` | Obvious | Never |
>
> Production schema changes are always: I prepare the migration → you review →
> `npx prisma migrate deploy` (forward-only, data-preserving).

---

## 9. Final production testing checklist (§ walk-through plan)

We do this together in M18. Each item: how to run it, and what success looks like.

**A. Public pages**
1. Homepage `https://<domain>/` → 200, hero + booking CTA visible on mobile width.
2. `/services`, `/services/general-dentistry`, `/doctors`, `/about`, `/contact`, `/privacy`, `/terms` → all 200, no 500s.
3. View-source check: `<link rel="canonical" href="https://<domain>/…">` on two pages; `robots.txt` shows your domain's sitemap line; `/sitemap.xml` lists all routes + 8 service pages.

**B. Availability & booking rules**
4. `GET /api/appointments/availability?date=<next Monday>&serviceSlug=general-dentistry` → 200, `closed: false`, first slot `9:00 AM`.
5. Same request with `date=<next Sunday>` → `closed: true`, zero slots.
6. A `13:30` (lunch) start in a booking POST → `VALIDATION_ERROR` mentioning lunch.
7. An off-grid start (`09:07`) → `VALIDATION_ERROR` (slot-bypass protection).

**C. Booking & double-booking**
8. Book a real future slot through the website's 4-step flow → success screen with `apt_…` reference; patient is told it is a *request* (PENDING).
9. Immediately POST the same slot again (I provide the exact `curl`) → **409 CONFLICT**.
10. In Neon SQL editor (`tgd_prod`): `SELECT "publicId", status, "startsAt" FROM "Appointment" ORDER BY "createdAt" DESC LIMIT 3;` → your booking present, `startsAt` is a UTC instant matching the IST wall time (+5:30).

**D. Staff workflow**
11. Log in at the site's staff login with the M14 account → lands authenticated; cookie shows `HttpOnly; Secure; SameSite=Lax` in browser dev tools → *Application → Cookies*.
12. Wrong password ×6 in a minute → 429 RATE_LIMITED.
13. Staff view of the appointment shows the patient's phone (authorized PII), while the public `GET /api/appointments/<id>` **without** the cookie returns 401.
14. Confirm the booking (PATCH → CONFIRMED) → status updates; audit row created (SQL: `SELECT * FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 1;` shows `from/to` metadata).
15. Cancel it → 200; re-run step 4's availability for that slot → available again (slot released).

**E. Cross-cutting security**
16. `curl -X POST https://<domain>/api/appointments -H "Content-Type: application/json" -H "Origin: https://evil.example" -d …` → **403 FORBIDDEN**.
17. Staff PATCH without cookie → 401. Non-existent `apt_…` id → 404.
18. Staff response headers include `Cache-Control: no-store`.

**F. Contact channels**
19. WhatsApp button → opens `wa.me/919180609088`; phone link dials `+919180609088`; email link opens `mailto:nidhi.paliwal@gmail.com`.
20. Mobile (real phone): book a slot end-to-end on mobile data.

**G. Persistence, backups, ops**
21. After the booking in step 8: redeploy Vercel (or wait for a cold start) and confirm the appointment **still exists** (proves DB persistence, not in-memory).
22. M16 restore test completed once.
23. Vercel → *Observability/Runtime Logs*: no repeating `[api]` errors during the above; note the retention limit (1 day on current plans) and plan log checks accordingly.

---

## 10. Security & backup requirements

**Before launch (essential):**

- SESSION_SECRET generated and stored only in Vercel + password manager (M4/M6).
- HTTPS: automatic via Vercel once the domain validates (M10) — cookies are already `Secure` in production.
- Automated backups with a **tested restore** (M16).
- Usage alerts (M17).
- Admin credentials: created offline (M14), password chosen by the clinic, never in chat; password ≥ 12 chars enforced, scrypt-hashed.
- Integration-test wipe guard: already in code — no action.

**Plan for soon after launch:**

- Shared rate limiting (A4) before any marketing spend or the staff-dashboard phase — the current limiter is per-serverless-instance.
- Error reporting (A5); until then, review Vercel runtime logs weekly (retention is short on current plans).
- Quarterly restore drill (A8) + rollback runbook (A9).

**Can wait:**

- Formal uptime monitoring (A3 health endpoint + a free UptimeRobot-style monitor).
- Role-based permissions inside the staff app (single-admin use doesn't need it yet).
- Log drains / SIEM — not proportionate for a single clinic.

---

## 11. Sequential execution plan (with dependencies)

> Each phase lists tasks in order; ⇢ marks what a task unblocks. Do **one
> group at a time** — I will prompt you for the next group when you report back.

### PHASE A — Owner setup (accounts & secrets; nothing destructive)

| ID | Task | Depends on | Unblocks |
| --- | --- | --- | --- |
| **A1* ⇢** | *Agent:* commit+push review fixes (needs your go-ahead) | — | M5, M8 |
| **M1** | Vercel account | — | M5 |
| **M2** | Neon account + project | — | M3 |
| **M3** | Create `tgd_prod` + `tgd_prod_test` | M2 | M6, M11 |
| **M4** | Generate + store `SESSION_SECRET` | — | M6 |
| **M5** | Import repo into Vercel (no deploy needed yet) | M1, A1 | M6, M8 |
| **M6** | Set Production env vars (`DATABASE_URL`, `SESSION_SECRET`) | M3, M4 | M8 |
| **M7** | Approve Vercel Pro / Neon Launch (optional at soft launch) | M1, M2 | M16 options |

\* A1 is an agent task listed here because it gates the first real deploy.

### PHASE B — Agent implementation (while you do Phase A/C)

| ID | Task | Depends on |
| --- | --- | --- |
| **A2** | `.nvmrc` pin (optional) | — |
| **A6** | Apply confirmed durations/interval (C1/C2) to code+seed, re-test | C1, C2 |
| **A7** | Canonical-URL/SEO verification + placeholder cleanup | M10, M15 |
| **A8** | Backup-verification script | — |
| **A9** | Rollback runbook | — |
| **A4** | Shared rate limiting | free Upstash account (you) + M6 |
| **A5** | Error reporting | free Sentry account (you) + M6 |

### PHASE C — Client confirmations (parallel; send the clinic one grouped ask)

| ID | Task | Blocks |
| --- | --- | --- |
| **C1–C3** | Durations, slot interval, booking policy | A6 → final seed (before public launch) |
| **C4** | Service list | A6 |
| **C5, C6** | Photos, dentist bio | post-launch polish |
| **C7** | Domain name | M9 |
| **C8** | Privacy/terms wording approval | public launch |
| **C9** | Cancellation policy definition | future phase scoping |
| **C10** | Go-live date | announcement |

### PHASE D — Database migration & deployment

| ID | Task | Depends on |
| --- | --- | --- |
| **M8** | First Vercel build → **Ready** | A1, M5, M6 |
| **M9** | Domain purchase | C7 |
| **M10** | DNS → Vercel validation + HTTPS | M5, M9 |
| **M11** | `prisma migrate deploy` → `tgd_prod` | M3 |
| **M12** | Verify exclusion constraint | M11 |
| **M13** | `npm run db:seed` | M11 |
| **M14** | `staff:create` (admin account) | M13 |
| **M15** | `NEXT_PUBLIC_SITE_URL` + redeploy | M10 |
| **A6-ship** | Re-seed with confirmed durations (after C1–C3) | M13, A6 |

### PHASE E — Production verification & sign-off

| ID | Task | Depends on |
| --- | --- | --- |
| **M16** | Backups + one restore test | M11 |
| **M17** | Spend/usage alerts | M1, M2 |
| **M18** | Full §9 checklist, walked together | M8, M11–M15, M16 |
| **C10** | Public announcement | M18 + C8 |

---

## 12. Cost & account register (single view)

| Item | Provider | Cost | When needed | Account by |
| --- | --- | --- | --- | --- |
| Hosting | Vercel | Hobby $0 *(non-commercial terms)* / **Pro $20/mo** | M1/M5 | You (M1) |
| Database | Neon | Free $0 → **Launch ~$2–6/mo** (*estimate*; ~$20 always-on) | M2 | You (M2) |
| Domain | Registrar (Vercel/Cloudflare/Namecheap) | *estimate* $10–15/yr | M9 | You (with C7) |
| Shared rate limit | Upstash | Free tier sufficient | After launch (A4) | You |
| Error tracking | Sentry | Free tier sufficient | Optional (A5) | You |
| Source code | GitHub | existing | — | existing |

**Never shared with me:** any password, `SESSION_SECRET`, `DATABASE_URL`,
registrar/Vercel/Neon login, or payment detail.

---

*Prepared from a full audit of the repository on 31 October 2026: git state,
package scripts, env validation, Prisma schema/migration/seed, staff script,
auth stack, all seven API routes, booking domain service, tests (59 unit +
45 integration), docs, and live pricing pages for Neon, Supabase, Railway and
Vercel. No code was modified, nothing committed, nothing deployed.*
