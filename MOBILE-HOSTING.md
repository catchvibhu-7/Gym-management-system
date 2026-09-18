# Running Forge Room on mobile

Two different questions come up under "can I use this on my phone?" — they
have very different answers.

## 1. Using the console/member app from a phone browser

**Already works today, nothing to set up.** Both the owner/staff console
(`/console/`) and the member app (`/member/`) are plain responsive web
pages, not native apps. As long as the *server* is running somewhere on
the gym's wifi (a laptop, a mini PC, whatever), any phone's browser can
open it directly:

```
http://<that machine's LAN IP>:3300/console/
http://<that machine's LAN IP>:3300/member/
```

The server prints its LAN IP on boot for exactly this reason — `localhost`
only resolves on the machine running the server itself, so phones need the
real IP. See `README.md` for where that's documented.

## 2. Running the server process itself on a phone — no PC at all

This is a different ask: instead of a PC hosting the server and phones
just being clients, the phone *is* the server. More unusual, but this app
is actually a good candidate for it:

- Pure Node.js — only 3 runtime dependencies (`express`, `cookie-parser`,
  `qrcode`), none of them native/compiled.
- Uses Node's built-in `node:sqlite`, not a native SQLite binding, so
  there's no native module to cross-compile for Android.
- No cloud services, no external DB — already built to be fully
  self-contained ("Built to run on one machine on the gym's own wifi," per
  `README.md`).

That combination means it can run directly on an **Android phone via
Termux** (a terminal/Linux environment for Android).

### Setup (Android + Termux)

1. Install Termux from **F-Droid**, not the Play Store — the Play Store
   build is outdated and effectively unmaintained due to a Google policy
   change.
2. Inside Termux:
   ```
   pkg update && pkg install nodejs git
   node -v   # must be >= 22.5.0 (this repo's package.json "engines" requirement)
   ```
   If Termux's `nodejs` package is older than 22.5, look for a
   `nodejs-lts`/`nodejs-current` alternative package, or install a newer
   Node build manually (e.g. via `nvm` inside Termux).
3. Get the code onto the phone and install dependencies:
   ```
   git clone <this repo's URL>
   cd gym-management-system
   npm install
   ```
4. Run it:
   ```
   npm start
   ```
   This runs `node server/index.js` directly — **do not** use `npm run
   electron`/`npm run dev`, those launch the Electron desktop wrapper,
   which is Windows/Mac/Linux only and won't run on Android at all. The
   plain server (`npm start`) is everything you need; the Electron app is
   just a convenience shell around the same server for desktop users.
5. The phone's own IP address becomes the LAN address other devices
   connect to, exactly like a PC would — check Termux's `ifconfig` or the
   phone's wifi settings for its IP, then use
   `http://<phone's IP>:3300/console/` from any other device on the same
   wifi.

### Real caveats

- **Android will try to kill a backgrounded Termux session.** Run
  `termux-wake-lock` before starting the server, and keep the Termux
  notification/session visible rather than fully backgrounding the app,
  or Android's battery optimizer will eventually kill the Node process.
- **The phone needs to stay powered on and connected to the gym's wifi**
  the whole time the "server" needs to be reachable — same requirement a
  dedicated PC would have, just easier to accidentally disrupt on a phone
  people also carry around and use for other things.
- **Performance** is fine for this app's actual load (a single gym's
  staff/members on local wifi) — SQLite plus a lightweight Express app has
  no trouble on modern phone hardware.
- **Data safety**: `data/gym.db` now lives on the phone's storage. Back it
  up the same way `README.md`'s backup/restore feature already supports —
  there's nothing phone-specific about that part.

### iOS

Not practical. There's no Termux-equivalent on stock (non-jailbroken)
iOS — no general-purpose way to run a persistent background Node process.
An iPhone can still be a *client* (case 1 above) just fine; it just can't
host the server itself.
