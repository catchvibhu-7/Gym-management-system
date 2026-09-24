# Gym Management System

Local-first gym management app: SQLite backend, an owner/staff console, a
door kiosk for check-ins, and a member-facing app for self check-in and
workout plans. Built to run on one machine on the gym's own wifi — no cloud
dependency required.

## Run it

Requires **Node 22.5+** (uses Node's built-in `node:sqlite` — no native
module to compile, so `npm install` has nothing to build; a plain
`npm install` works even on a bare Windows machine with no Python/C++
toolchain installed). This one `npm install` + the commands below are
identical on Windows, macOS, and Linux — nothing platform-specific until
you get to building an installer, further down.

```
npm install
npm start          # plain server, browser only
npm run dev        # desktop app (Electron), relaunches on server file changes
npm run dev:server # plain server only, auto-restarts on file changes
```

The server bootstraps two accounts on first boot (idempotent — skips
entirely if any staff already exist), and prints them to the console:

```
Admin login (system access only, no member/billing data): admin@forgeroom.gym / ForgeAdmin123!
System admin (vendor support) account created: systemadmin@forgeroom.local - password written to <path>/data/systemadmin-credentials.txt
```

- **`admin`** can't see members, billing, or any other gym data — it
  exists only to run backups/restore. Override its credentials with
  `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars (the old `OWNER_EMAIL` /
  `OWNER_PASSWORD` names still work as a fallback).
- **`systemadmin`** is a vendor-support account with complete access
  (bypasses every role check), for the product team to debug a specific
  install when asked to help — never a fixed password, a fresh random one
  is generated per install and written once to
  `data/systemadmin-credentials.txt` (gitignored). The gym owner can see
  it in Team management and deactivate or change it at any time. See
  `server/create-systemadmin.js` to provision a new one later (password
  rotation, or recreating one the owner removed).

`npm run dev` / `npm run dev:server` also seed a full sample dataset (staff,
plans, ~60 fake members with invoices/checkins, classes) so local
development has something to click through — see `nodemon.json`, which sets
`SEED_DEMO_DATA=1` for those two scripts only. `npm start`, the plain
Electron app (`npm run electron`), and every packaged installer boot with
**no fake data at all** — a real customer's clean install gets only the two
accounts above and the setup wizard, never sample members/staff/classes. To
seed the sample dataset by hand into a specific database, run
`node server/seed.js` directly (this always seeds it, regardless of the env
var, since running it by hand is itself the explicit request).

Opening the console on a fresh install shows a **setup wizard** instead of
a login screen, since no owner account exists yet — it walks through
creating the real owner account, the gym's name/currency, and starting
fees/GST, all in one flow. It only ever appears once per database.
`PORT` (default `3300` — if busy, the server automatically tries the next
one up and prints whichever it actually bound).

- Owner/staff console: `http://localhost:3300/console/` — includes a
  **Settings** nav group (owner/manager only) for gym name, currency, GST,
  payment/notification provider connections, and backups.
- Member app: `http://localhost:3300/member/` — log in with a member's phone
  number and a PIN of the last 4 digits. Under `npm run dev`/`dev:server`'s
  sample dataset, e.g. Priya Raghavan, `+1 312 847 1928`, PIN `1928`. On boot the server also prints a LAN
  address (e.g. `http://192.168.1.23:3300/member/`) — that's the one to give
  members on their own phones over the gym's wifi; `localhost` only works on
  the machine actually running the server.
- Door kiosk: click "Open door kiosk" inside the console (needs a staff
  login first — it's meant to run on a tablet at the door that's already
  signed in), or the bookmarkable `http://localhost:3300/kiosk` link.

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
npm run dev       # launches the app window, relaunches it on server file changes
npm run electron  # launches the app window once, no watch/relaunch
```

`electron/main.js` starts the same Express server in-process (no separate
`npm start` needed) and opens it in a native window. `View > Kiosk
Fullscreen` (or F11) drops the window into fullscreen for a door-tablet
setup. Closing the window shuts the embedded server down cleanly. This is
identical on all three OSes — no platform-specific step until you build an
actual installer, below.

**Where a packaged install's data actually lives:** once installed (not
running via `npm run dev`/`electron` from source), the app's own files are
inside a read-only `app.asar` archive — `data/` can't just sit next to
them the way it does in a plain checkout. `electron/main.js` points the
server at Electron's real per-OS user-data folder instead
(`app.getPath('userData')`, via the `GYM_DATA_DIR` env var it sets before
starting the server):

- Windows: `%APPDATA%\Forge Room Owner Console\`
- macOS: `~/Library/Application Support/Forge Room Owner Console/`
- Linux: `~/.config/gym-management-system/`

That's where `gym.db`, `uploads/`, `certs/`, `backups/`, and
`systemadmin-credentials.txt` actually end up for an installed app — not
in the install directory itself (which is often read-only for a non-admin
user anyway). Point `server/create-systemadmin.js` at one of these paths
via the same `GYM_DATA_DIR` env var when debugging an installed build
rather than a plain checkout.

## Building an installer, per OS

`npm run electron:build` (or the OS-specific variants below) packages the
app with [electron-builder](https://www.electron.build/) into
`dist-electron/`. The **big rule that decides everything else**:
electron-builder can only ever produce a **macOS** build by actually
running on a Mac — Apple doesn't allow cross-compiling a `.app`/`.dmg`
anywhere else, no exceptions. Windows and Linux builds are more flexible:
each can be built on its own OS natively, and Windows can *also* be
cross-built from Linux if Wine is installed.

| Building on → | Windows installer | macOS installer | Linux installer |
|---|---|---|---|
| **Windows** | ✅ native | ❌ not possible | ❌ not possible |
| **macOS** | ✅ with Wine (`brew install wine-stable`) | ✅ native | ✅ native |
| **Linux** | ✅ with Wine (see below) | ❌ not possible | ✅ native |

In practice: build the Windows installer on a Windows machine (or a Linux
box with Wine), build the macOS installer only on a Mac, and the Linux
build works basically anywhere Linux does.

### Windows

```
npm install
npm run electron:build:win
```

Produces an NSIS installer (`Forge Room Owner Console Setup <version>.exe`)
in `dist-electron/`. Running it lets the user pick an install directory and
optionally add a desktop shortcut (`nsis` settings in `package.json`'s
`build` block). To cross-build this from Linux instead of a real Windows
machine, install Wine first (Debian/Ubuntu: `sudo apt install wine`;
Fedora: `sudo dnf install wine`) — electron-builder shells out to it
automatically, no extra config needed.

The installer isn't code-signed, so Windows SmartScreen will show an
"unrecognized app" warning the first time someone runs it ("More info" →
"Run anyway"). Getting rid of that warning needs a paid code-signing
certificate — a separate decision to make later, not something
electron-builder can do for free.

### macOS

```
npm install
npm run electron:build:mac
```

**Must run on an actual Mac** — see the table above. Produces a `.dmg` in
`dist-electron/`. Without an Apple Developer ID and notarization (neither
set up here — that's a paid Apple Developer Program enrollment, a
separate decision to make later), the app is unsigned: Gatekeeper will
block it on first open with "can't be opened because it is from an
unidentified developer." The workaround for testing is right-click (or
Control-click) the app → **Open** → **Open** in the dialog, which only
needs doing once. For real distribution to gym owners, plan on enrolling
in the Apple Developer Program and adding `notarize`/signing config to
`package.json`'s `build` block before shipping the `.dmg` around — an
unsigned build is fine for your own team's testing, not for handing to a
customer.

### Linux

```
npm install
npm run electron:build:linux
```

Produces an AppImage (`Forge Room Owner Console-<version>.AppImage`) in
`dist-electron/` — a single self-contained executable, no system-wide
install step. Make it executable and run it directly:

```
chmod +x "dist-electron/Forge Room Owner Console-1.0.0.AppImage"
"./dist-electron/Forge Room Owner Console-1.0.0.AppImage"
```

This is the one target verified end-to-end in this repo's own dev
sandbox — packaging, the native-module rebuild step, and the resulting
AppImage all built successfully.

### Notes for all three

- `build/icon.ico` (Windows) / `build/icon.png` (Linux + macOS fallback)
  are placeholder branding (the green "F" mark from the console's
  sidebar) — swap them for real artwork whenever you have it. macOS
  ideally wants a proper multi-resolution `.icns` file (electron-builder
  will generate one from the PNG if you don't supply it, but a real
  `.icns` looks sharper); add `"icon": "build/icon.icns"` under `mac` in
  `package.json` once you have one.
- Plain `npm run electron:build` (no OS suffix) builds an installer for
  whatever OS you're currently running it on — the `:win`/`:mac`/`:linux`
  variants above just make that explicit.
- None of these builds are code-signed or notarized. That's fine for
  internal testing; plan on it before handing an installer to an actual
  customer (see the OS-specific notes above).
- Whichever installer you end up running, the very first launch behaves
  exactly like the plain-server "Run it" section above: demo data seeds,
  the `admin`/`systemadmin` credentials print to the console (Electron's
  `View > Toggle Developer Tools` shows the console inside the app
  window), and the setup wizard opens to create the real owner account.

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
  `coach`, `desk` — the actual gym team; plus `kiosk` for a door-only
  terminal, `admin` for the precreated system-only bootstrap account, and
  `systemadmin` for vendor support access, see "Run it" above).
- Members: phone + PIN, cookie session. PIN defaults to the last 4 digits
  of their phone at signup (no SMS/OTP vendor is wired up to verify phone
  ownership yet — same tradeoff a lot of small local apps make until that
  becomes worth paying for).
