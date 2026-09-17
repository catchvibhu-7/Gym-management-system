# Gym Management System

Local-first gym management app: SQLite backend, an owner/staff console, a
door kiosk for check-ins, and a member-facing app for self check-in and
workout plans. Built to run on one machine on the gym's own wifi — no cloud
dependency required.

## Run it

Requires **Node 22.5+** (uses Node's built-in `node:sqlite` — no native
module to compile, so `npm install` has nothing to build; a plain
`npm install` works even on a bare Windows machine with no Python/C++
toolchain installed).

```
npm install
npm start          # plain server, browser only
npm run dev        # desktop app (Electron), relaunches on server file changes
npm run dev:server # plain server only, auto-restarts on file changes
```

The server seeds demo data on first boot (idempotent — skips if data already
exists). It prints a precreated **admin** login to the console:

```
Admin login (system access only, no member/billing data): admin@forgeroom.gym / ForgeAdmin123!
```

That admin account can't see members, billing, or any other gym data — it
exists only to run backups/restore. Opening the console on a fresh install
shows a **setup wizard** instead of a login screen, since no owner account
exists yet; fill it in once to create your real owner account (full access),
after which the wizard never appears again for that database. Override the
precreated admin's credentials with `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars
(the old `OWNER_EMAIL` / `OWNER_PASSWORD` names still work as a fallback),
and `PORT` (default `3300` — if that port is busy, the server automatically
tries the next one up and prints whichever it actually bound).

- Owner/staff console: `http://localhost:3300/console/` — includes a
  **Settings** nav group (owner/manager only) for gym name, currency, GST,
  payment/notification provider connections, and backups.
- Member app: `http://localhost:3300/member/` — log in with any seeded
  member's phone number and a PIN of the last 4 digits (e.g. Priya Raghavan,
  `+1 312 847 1928`, PIN `1928`). On boot the server also prints a LAN
  address (e.g. `http://192.168.1.23:3300/member/`) — that's the one to give
  members on their own phones over the gym's wifi; `localhost` only works on
  the machine actually running the server.
- Door kiosk: click "Open door kiosk" inside the console (needs a staff
  login first — it's meant to run on a tablet at the door that's already
  signed in).

See [`DATA-MODEL.md`](./DATA-MODEL.md) for how every table relates to every
other one, and which fields are deliberately frozen snapshots vs. live
references.

## Desktop app (Electron)

The owner/staff console can also run as native desktop software instead of
in a browser tab — a real window, taskbar icon, and installer. The
member-facing app stays a normal web page (members use their own phone's
browser at `http://<this-pc's-ip>:3300/member/`), since a phone app doesn't
belong in a desktop package.

```
npm install
npm run dev             # launches the app window, relaunches it on server file changes
npm run electron        # launches the app window once, no watch/relaunch
npm run electron:build  # produces a Windows installer in dist-electron/
```

`electron/main.js` starts the same Express server in-process (no separate
`npm start` needed) and opens it in a native window. `View > Kiosk
Fullscreen` (or F11) drops the window into fullscreen for a door-tablet
setup. Closing the window shuts the embedded server down cleanly.

`npm run electron:build` needs to run on the target OS (build a Windows
installer from Windows) since electron-builder downloads platform-specific
packaging tools on first run — it wasn't run inside this dev sandbox
(no display, and a locked-down proxy that can't reach those downloads), so
treat the packaged installer as unverified until you've run it once
yourself. `build/icon.ico` / `build/icon.png` are placeholder branding
(the green "F" mark from the console's sidebar) — swap them for real
artwork whenever you have it.

## Architecture

- `server/` — Express app, one file per concern. `db.js` opens the SQLite
  file (`data/gym.db`, WAL mode) via Node's built-in `node:sqlite`
  (`DatabaseSync`) and runs `schema.sql` on boot. It's marked experimental
  by Node and prints a one-line warning on boot — harmless, and the
  deliberate tradeoff for zero native-build friction; swap to
  `better-sqlite3` later if you need something more battle-tested and don't
  mind the native-compile step it brings back.
  `storage.js` is a tiny local "bucket" (put/get/delete by key under
  `data/uploads/`) with the same shape a real S3/MinIO client would expose —
  swapping in real object storage later only touches this one file.
  `auth.js` handles both staff and member sessions (separate cookies,
  separate DB tables), with scrypt-hashed passwords/PINs.
- `server/routes/*.js` — one router per resource (members, billing,
  checkins, classes, plans, team, reports, automations, workout plans, plus
  the member-app-facing routes under `/api/member`).
- `public/console/` — the owner/staff console (vanilla JS, no build step).
  Sidebar nav is grouped (Overview / Members / Money / Operations /
  Insights) and gated by role so a desk or coach account doesn't see
  billing internals or team management.
- `public/member/` — the member-facing app: check-in, upcoming classes with
  booking, and workout plans (view what a coach assigned, or build your
  own).
- `data/` — gitignored. SQLite DB + uploaded files live here. Delete it to
  reset to a fresh seeded state.

## Settings (Settings nav group, owner/manager only)

- **General & billing** — gym name/tagline (shown in the sidebar and page
  title), currency code/symbol (applied everywhere `money()` formats an
  amount, immediately), GST toggle + number + percentage (applied to new
  membership/day-pass charges going forward — see `settingsStore.applyGst()`),
  and your own password change.
- **Payments** — connect Razorpay (key ID/secret, optional webhook
  secret) to take real payments instead of the simulated dunning retry.
  `server/payments/razorpay.js` is a real REST integration (order
  creation, payment-signature verification, webhook-signature
  verification) built against Razorpay's documented API shapes — it has
  **not** been exercised against a live Razorpay account (none was
  available while building this), so treat it as correct-by-reading until
  someone with real keys verifies the full checkout round-trip. Without a
  provider connected, billing retries stay simulated (succeed ~60% of the
  time at random) so the dunning workflow is still fully usable.
- **Notifications** — connect an SMS/email provider (Twilio, MSG91, or
  plain SMTP) so the Reminders page's automations and "Send reminder"/
  "Nudge" buttons actually send something. No provider ships connected;
  until one is, those actions just record the intent.
- **Backup** — a backup is taken automatically on every boot and once a
  day while running (`server/backup.js`, rotates the last 20). Download
  any backup, trigger one on demand, or restore from an uploaded `.db`
  file. Restoring closes the live database connection (required on
  Windows, where an open file can't be overwritten) and ends the process
  right after — `npm run dev` and the Electron app both come back on
  their own; a plain `npm start` needs restarting by hand. The current
  database is always safety-copied before a restore overwrites it.

## Deliberately simple / not wired up

These are placeholders by design, not bugs — each is a vendor/infra
decision that wasn't made yet:

- **Local object storage, not real S3.** `server/storage.js` stores files
  on local disk with an S3-shaped interface. Point it at MinIO or AWS S3
  later without touching any route code.
- **"Plan moves"** (upgrade/downgrade tracking) shows recent joins and
  cancellations as a stand-in — there's no plan-change history table yet.
- **No recurring-billing scheduler.** Nothing automatically advances a
  membership to its next cycle or generates the next invoice — every
  invoice today comes from signup or a manual retry. See `DATA-MODEL.md`.
- **Kiosk hardware**: there's no real QR scanner/fob reader integration.
  The kiosk page accepts a code typed or scanned into a text input (works
  with any USB barcode-scanner-as-keyboard hardware) and also has a
  manual name/phone search for desk-assisted check-in.

## Auth model

- Staff: email + password, cookie session, role-gated (`owner`, `manager`,
  `coach`, `desk`).
- Members: phone + PIN, cookie session. PIN defaults to the last 4 digits
  of their phone at signup (no SMS/OTP vendor is wired up to verify phone
  ownership yet — same tradeoff a lot of small local apps make until that
  becomes worth paying for).
