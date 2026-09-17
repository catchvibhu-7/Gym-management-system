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
npm start          # or: npm run dev   (auto-restarts on file changes)
```

The server seeds demo data on first boot (idempotent — skips if data already
exists). It prints the owner login to the console:

```
Owner login: owner@forgeroom.gym / ForgeOwner123!
```

Override with `OWNER_EMAIL` / `OWNER_PASSWORD` env vars, and `PORT` (default
`3300`).

- Owner/staff console: `http://localhost:3300/console/`
- Member app: `http://localhost:3300/member/` — log in with any seeded
  member's phone number and a PIN of the last 4 digits (e.g. Priya Raghavan,
  `+1 312 847 1928`, PIN `1928`).
- Door kiosk: click "Open door kiosk" inside the console (needs a staff
  login first — it's meant to run on a tablet at the door that's already
  signed in).

## Desktop app (Electron)

The owner/staff console can also run as native desktop software instead of
in a browser tab — a real window, taskbar icon, and installer. The
member-facing app stays a normal web page (members use their own phone's
browser at `http://<this-pc's-ip>:3300/member/`), since a phone app doesn't
belong in a desktop package.

```
npm install
npm run electron        # dev: launches the app window directly
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

## Deliberately simple / not wired up

These are placeholders by design, not bugs — each is a vendor/infra
decision that wasn't made yet:

- **No real SMS/email provider.** The Reminders page's automation toggles
  are real and persisted, but nothing actually sends a text — "Send
  reminder"/"Nudge" buttons just record the intent. Wire a provider
  (Twilio, etc.) into `server/routes/members.js`'s `/reminder` route and
  the automations trigger logic when one is chosen.
- **No real card processor.** Invoices and retries are simulated
  (`server/routes/billing.js` — a retry succeeds ~60% of the time at
  random) so the dunning workflow is fully testable end to end. Swap in a
  real processor's webhook the same way the invoice `status` field already
  models it (`pending`/`paid`/`failed`).
- **Local object storage, not real S3.** `server/storage.js` stores files
  on local disk with an S3-shaped interface. Point it at MinIO or AWS S3
  later without touching any route code.
- **"Plan moves"** (upgrade/downgrade tracking) shows recent joins and
  cancellations as a stand-in — there's no plan-change history table yet.
- **Class creation** is limited to adding new dated sessions for classes
  already seeded; there's no "create a new recurring class" UI yet.
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
