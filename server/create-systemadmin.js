// Provisions (or updates) the vendor support/debug account, out-of-band
// from the app's own UI - there is no "create system admin" button
// anywhere in the console on purpose. Run this ONLY on the specific
// customer's machine you actually need to debug (over a remote support
// session, physical access, etc.) - it needs the same `data/gym.db` the
// running server uses, so it must run on that same machine/container.
//
// Usage:
//   node server/create-systemadmin.js "you@yourcompany.com"
//
// If debugging a packaged (Electron-installed) build rather than a plain
// checkout, point this at that install's real data directory first (see
// db.js's comment on why it isn't just "data/" next to the app there):
//   Windows:  set GYM_DATA_DIR=%APPDATA%\Forge Room Owner Console
//   macOS:    export GYM_DATA_DIR="$HOME/Library/Application Support/Forge Room Owner Console"
//   Linux:    export GYM_DATA_DIR="$HOME/.config/Forge Room Owner Console"
//
// Prompts for a password interactively (not a CLI arg, so it never ends
// up in shell history or process listings) and creates the account fresh,
// or resets the password if one with that email already exists. The
// account behaves like any other row in Team management once created -
// the owner can see it, and deactivate it, at any time.
const readline = require('readline');
const { db } = require('./db');
const { hashPassword } = require('./auth');

// readline has no built-in masked-input mode, so a real terminal needs raw
// mode: read one keystroke at a time and never echo it back, handling
// backspace/Ctrl+C ourselves. Falls back to a plain (visible) readline
// prompt when stdin isn't a TTY (piped input) rather than crashing.
function promptHidden(question) {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let input = '';
    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (char === '\u007f' || char === '\b') {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: node server/create-systemadmin.js "you@yourcompany.com"');
    process.exit(1);
  }

  const password = await promptHidden(`Password for ${email}: `);
  console.log('');
  if (!password || password.length < 12) {
    console.error('Refusing to continue: use a real password, at least 12 characters - this account has complete access.');
    process.exit(1);
  }

  const existing = db.prepare('SELECT id, role FROM staff WHERE email = ?').get(email);
  if (existing) {
    if (existing.role !== 'systemadmin') {
      console.error(`A staff account with this email already exists with role '${existing.role}', not 'systemadmin'. Refusing to overwrite it - use a different email.`);
      process.exit(1);
    }
    db.prepare('UPDATE staff SET password_hash = ?, active = 1 WHERE id = ?').run(hashPassword(password), existing.id);
    console.log(`Password reset and reactivated: system admin account #${existing.id} (${email}).`);
  } else {
    const info = db.prepare(
      `INSERT INTO staff (name, role, email, password_hash, access) VALUES (?, 'systemadmin', ?, ?, 'full')`
    ).run('System Admin (vendor support)', email, hashPassword(password));
    console.log(`Created system admin account #${info.lastInsertRowid} (${email}).`);
  }
  console.log("This account is visible in Team management - the gym's owner can deactivate it there at any time.");
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
