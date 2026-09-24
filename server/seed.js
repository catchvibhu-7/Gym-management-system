// Idempotent demo-data seed. Safe to run every boot: skips if staff already exist.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, DATA_DIR } = require('./db');
const { hashPassword } = require('./auth');
const { newCode, addDays, todayISO } = require('./utils');

const FIRST_NAMES = ['Priya','Marcus','Yuki','Ana','Tobias','Nneka','Dmitri','Hannah','Liam','Sofia','Kenji','Grace','Omar','Elena','Noah','Fatima','Lucas','Mei','Diego','Chloe','Arjun','Ines','Felix','Zara','Mateo','Ivy','Sami','Rosa','Theo','Amara','Jonas','Nadia','Ravi','Clara','Hugo','Tara','Leo','Sana','Bruno','Wren'];
const LAST_NAMES = ['Raghavan','Delaney','Tanabe','Rueda','Lindqvist','Obi','Volkov','Okafor','Chen','Bianchi','Sato','Novak','Haddad','Petrov','Kim','Andersson','Silva','Costa','Nasser','Weber','Ferreira','Kapoor','Moreau','Nilsson','Alvarez','Brennan','Osei','Marchetti','Reyes','Cohen'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function seed() {
  const staffCount = db.prepare('SELECT COUNT(*) c FROM staff').get().c;
  if (staffCount > 0) {
    console.log('Seed skipped: data already present.');
    return;
  }

  db.exec('BEGIN');
  try {
    db.prepare("INSERT INTO settings (key, value) VALUES ('gym_name','Forge Room'), ('gym_tagline','Strength Club')").run();

    // The precreated account is a system-level admin, not a gym owner - it
    // exists only to run backups/restore and to bootstrap the app. It has
    // no access to member/billing/staff data (see auth.js's STAFF_ROLES).
    // The real owner account is created via the first-run setup wizard
    // (GET/POST /api/setup) the first time nobody with role='owner' exists.
    const adminEmail = process.env.ADMIN_EMAIL || process.env.OWNER_EMAIL || 'admin@forgeroom.gym';
    const adminPassword = process.env.ADMIN_PASSWORD || process.env.OWNER_PASSWORD || 'ForgeAdmin123!';
    db.prepare(
      `INSERT INTO staff (name, role, email, phone, password_hash, access) VALUES (?,?,?,?,?,'full')`
    ).run('System Admin', 'admin', adminEmail, null, hashPassword(adminPassword));

    // A second, separate account for the product team's own debugging
    // access (see auth.js: 'systemadmin' bypasses every role check, unlike
    // 'admin' above which is deliberately locked out of member/billing
    // data). Auto-created on first run so there's no manual step to
    // remember - but never with a fixed/shared password baked into the
    // app itself, since that would be one password that opens every
    // customer's install. A fresh random one is generated per install and
    // written where only someone with actual access to this machine can
    // read it (this console's boot log, and a local file) - see the
    // credentials-file write after commit, below. The owner can see this
    // account in Team management and deactivate it at any time.
    const systemAdminEmail = process.env.SYSTEMADMIN_EMAIL || 'systemadmin@forgeroom.local';
    const systemAdminPassword = crypto.randomBytes(18).toString('base64url');
    db.prepare(
      `INSERT INTO staff (name, role, email, phone, password_hash, access) VALUES (?,?,?,?,?,'full')`
    ).run('System Admin (vendor support)', 'systemadmin', systemAdminEmail, null, hashPassword(systemAdminPassword));

    const inesId = db.prepare(
      `INSERT INTO staff (name, role, email, phone, password_hash, access) VALUES (?,?,?,?,?,'limited')`
    ).run('Ines Duarte', 'coach', 'ines@forgeroom.gym', '+1 312 555 0111', hashPassword('CoachPass123!')).lastInsertRowid;

    const samId = db.prepare(
      `INSERT INTO staff (name, role, email, phone, password_hash, access) VALUES (?,?,?,?,?,'limited')`
    ).run('Sam Whitfield', 'coach', 'sam@forgeroom.gym', '+1 312 555 0112', hashPassword('CoachPass123!')).lastInsertRowid;

    db.prepare(
      `INSERT INTO staff (name, role, email, phone, password_hash, access) VALUES (?,?,?,?,?,'limited')`
    ).run('Dana Okoye', 'desk', 'dana@forgeroom.gym', '+1 312 555 0113', hashPassword('DeskPass123!'));

    db.prepare(
      `INSERT INTO staff (name, role, email, phone, password_hash, access) VALUES (?,?,?,?,?,'full')`
    ).run('Priti Shah', 'manager', 'priti@forgeroom.gym', '+1 312 555 0114', hashPassword('ManagerPass123!'));

    const planUnlimited = db.prepare(
      `INSERT INTO plans (name, price_cents, description, tag, sort_order) VALUES (?,?,?,?,?)`
    ).run('Unlimited', 8900, 'Unlimited visits, every class included.', 'Most popular', 1).lastInsertRowid;
    const planOffPeak = db.prepare(
      `INSERT INTO plans (name, price_cents, description, sort_order) VALUES (?,?,?,?)`
    ).run('Off-peak', 4900, 'Before 11am and after 8pm on weekdays, any time weekends.', 2).lastInsertRowid;
    const planPT = db.prepare(
      `INSERT INTO plans (name, price_cents, description, tag, sort_order) VALUES (?,?,?,?,?)`
    ).run('Unlimited + PT', 18900, 'Unlimited visits plus 4 personal training sessions a month.', 'Best value', 3).lastInsertRowid;
    const plans = [planUnlimited, planOffPeak, planPT];

    const singlePass = db.prepare('INSERT INTO day_pass_types (name, price_cents, visits) VALUES (?,?,?)').run('Single pass', 1800, 1).lastInsertRowid;
    db.prepare('INSERT INTO day_pass_types (name, price_cents, visits) VALUES (?,?,?)').run('5-pass strip', 7500, 5);

    // --- Members ---
    const seedMembers = [
      { name: 'Priya Raghavan', plan: planUnlimited, status: 'active', access: 'qr_fob', phone: '+1 312 847 1928', joinedDaysAgo: 560 },
      { name: 'Marcus Delaney', plan: planOffPeak, status: 'past_due', access: 'fob', phone: '+1 312 555 0104', joinedDaysAgo: 240 },
      { name: 'Yuki Tanabe', plan: planUnlimited, status: 'active', access: 'qr_fob', phone: '+1 312 555 0187', joinedDaysAgo: 760 },
      { name: 'Ana Sofia Rueda', plan: planUnlimited, status: 'trial', access: 'qr', phone: '+1 312 555 0142', joinedDaysAgo: 3 },
      { name: 'Tobias Lindqvist', plan: planUnlimited, status: 'frozen', access: 'paused', phone: '+1 312 555 0163', joinedDaysAgo: 1160 },
      { name: 'Nneka Obi', plan: planOffPeak, status: 'active', access: 'fob', phone: '+1 312 555 0129', joinedDaysAgo: 220 },
      { name: 'Dmitri Volkov', plan: planPT, status: 'active', access: 'qr_fob', phone: '+1 312 555 0176', joinedDaysAgo: 320 },
      { name: 'Hannah Okafor', plan: planOffPeak, status: 'past_due', access: 'fob', phone: '+1 312 555 0198', joinedDaysAgo: 380 },
    ];

    // Round out to a realistic-sized roster.
    const usedPhones = new Set(seedMembers.map((m) => m.phone));
    while (seedMembers.length < 60) {
      const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      let phone;
      do { phone = `+1 312 555 ${randInt(1000, 9999)}`; } while (usedPhones.has(phone));
      usedPhones.add(phone);
      const r = Math.random();
      const status = r < 0.78 ? 'active' : r < 0.86 ? 'trial' : r < 0.94 ? 'past_due' : 'frozen';
      seedMembers.push({
        name,
        plan: pick(plans),
        status,
        access: pick(['qr', 'fob', 'qr_fob']),
        phone,
        joinedDaysAgo: status === 'trial' ? randInt(0, 6) : randInt(14, 1400),
      });
    }

    const insertMember = db.prepare(
      `INSERT INTO members (name, phone, email, emergency_name, emergency_phone, status, access_method, fob_code, qr_code, pin_hash, notes, joined_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const insertMembership = db.prepare(
      `INSERT INTO memberships (member_id, plan_id, monthly_price_cents, joining_fee_cents, start_date, next_charge_date, status, frozen_until)
       VALUES (?,?,?,?,?,?,?,?)`
    );
    const insertInvoice = db.prepare(
      `INSERT INTO invoices (member_id, membership_id, amount_cents, due_date, attempted_at, paid_at, status, payment_method, retry_count)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    const insertCheckin = db.prepare(
      `INSERT INTO checkins (member_id, method, checked_in_at, checked_out_at) VALUES (?,?,?,?)`
    );
    const planPrice = new Map([[planUnlimited, 8900], [planOffPeak, 4900], [planPT, 18900]]);

    const memberIds = [];
    for (const m of seedMembers) {
      const joinedAt = addDays(todayISO(), -m.joinedDaysAgo);
      const accessMethod = m.status === 'frozen' ? 'paused' : m.access;
      const last4 = m.phone.replace(/\D/g, '').slice(-4);
      const id = insertMember.run(
        m.name, m.phone, null, null, null, m.status, accessMethod,
        accessMethod === 'paused' ? null : newCode('FOB'), newCode('QR'), hashPassword(last4), null, joinedAt
      ).lastInsertRowid;
      memberIds.push({ id, ...m, joinedAt });

      if (m.status !== 'trial') {
        const price = planPrice.get(m.plan);
        const membershipId = insertMembership.run(
          id, m.plan, price, 2500, joinedAt,
          m.status === 'frozen' ? addDays(todayISO(), 45) : addDays(todayISO(), randInt(1, 20)),
          m.status === 'frozen' ? 'frozen' : 'active',
          m.status === 'frozen' ? addDays(todayISO(), 45) : null
        ).lastInsertRowid;

        // last 3 months of invoices
        for (let i = 3; i >= 0; i--) {
          const due = addDays(todayISO(), -30 * i);
          const failedThisOne = m.status === 'past_due' && i <= 1;
          insertInvoice.run(
            id, membershipId, price, due,
            failedThisOne ? due : due,
            failedThisOne ? null : due,
            failedThisOne ? 'failed' : 'paid',
            'card', failedThisOne ? randInt(1, 3) : 0
          );
        }
      } else {
        // trial week: single pending invoice-free record via membership row w/ 0 price is skipped
      }

      // attendance history, last 30 days
      if (accessMethod !== 'paused') {
        const visitChance = m.status === 'active' ? 0.5 : m.status === 'trial' ? 0.6 : 0.2;
        for (let d = 30; d >= 0; d--) {
          if (Math.random() < visitChance) {
            const day = addDays(todayISO(), -d);
            const hour = randInt(6, 20);
            const minute = randInt(0, 59);
            const checkedIn = `${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
            const checkedOut = `${day} ${String(Math.min(hour + 1, 23)).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
            const method = accessMethod === 'qr' ? 'qr' : accessMethod === 'fob' ? 'fob' : pick(['qr', 'fob']);
            insertCheckin.run(id, method, checkedIn, d === 0 && Math.random() < 0.3 ? null : checkedOut);
          }
        }
      }
    }

    // A couple of members currently on the floor (checked in today, not checked out)
    const insideCandidates = memberIds.filter((m) => m.access !== 'paused').slice(0, 6);
    for (const m of insideCandidates) {
      insertCheckin.run(m.id, pick(['qr', 'fob']), new Date().toISOString().slice(0, 19).replace('T', ' '), null);
    }

    // --- Classes ---
    const classesDef = [
      { name: 'Barbell Club', coach: inesId, day: 1, time: '18:30', duration: 60, capacity: 16 },
      { name: 'Conditioning', coach: samId, day: 1, time: '12:15', duration: 45, capacity: 20 },
      { name: 'Olympic Lifting', coach: inesId, day: 2, time: '07:00', duration: 60, capacity: 10 },
      { name: 'Mobility & Recovery', coach: samId, day: 3, time: '09:00', duration: 45, capacity: 18 },
      { name: 'Barbell Club', coach: inesId, day: 4, time: '18:30', duration: 60, capacity: 16 },
      { name: 'Conditioning', coach: samId, day: 5, time: '17:30', duration: 45, capacity: 20 },
      { name: 'Open Gym Yoga', coach: samId, day: 6, time: '10:00', duration: 50, capacity: 14 },
    ];
    const insertClass = db.prepare(
      `INSERT INTO classes (name, coach_staff_id, day_of_week, start_time, duration_min, capacity) VALUES (?,?,?,?,?,?)`
    );
    const insertSession = db.prepare(
      `INSERT INTO class_sessions (class_id, session_date, start_at) VALUES (?,?,?)`
    );
    const insertBooking = db.prepare(
      `INSERT INTO bookings (session_id, member_id, status) VALUES (?,?,?)`
    );
    const activeMembers = memberIds.filter((m) => m.status === 'active');

    for (const c of classesDef) {
      const classId = insertClass.run(c.name, c.coach, c.day, c.time, c.duration, c.capacity).lastInsertRowid;
      // this week + next week sessions
      for (const weekOffset of [0, 7]) {
        const today = new Date();
        const diff = (c.day - today.getDay() + 7) % 7;
        const sessionDate = addDays(todayISO(), diff + weekOffset);
        const sessionId = insertSession.run(classId, sessionDate, `${sessionDate} ${c.time}:00`).lastInsertRowid;
        const bookedCount = randInt(Math.floor(c.capacity * 0.4), c.capacity + 3);
        const attendees = [...activeMembers].sort(() => Math.random() - 0.5).slice(0, bookedCount);
        attendees.forEach((m, idx) => {
          insertBooking.run(sessionId, m.id, idx < c.capacity ? 'booked' : 'waitlisted');
        });
      }
    }

    // --- Automations ---
    const automations = [
      ['Card about to expire', 'Texts members 7 days before their card on file expires with a link to update it.', 'Card expires in 7 days', 'SMS'],
      ['Payment failed', 'Sends a payment link the same day a charge fails, then again after 3 days.', 'Charge fails', 'SMS'],
      ['Trial ending', 'Reminds a trial member the day before it ends and offers the Unlimited plan.', '1 day before trial ends', 'SMS'],
      ['Renewal in 3 days', 'Confirms the upcoming charge amount and date.', '3 days before next charge', 'Email'],
      ['Win-back at 14 days', 'Nudges a member who has not checked in for 14 days.', 'No visit in 14 days', 'SMS'],
    ];
    const insertAutomation = db.prepare(
      `INSERT INTO automations (name, description, trigger_desc, channel, enabled, sort_order) VALUES (?,?,?,?,?,?)`
    );
    automations.forEach((a, i) => insertAutomation.run(a[0], a[1], a[2], a[3], 1, i));

    db.exec('COMMIT');
    console.log(`Seed complete: ${memberIds.length} members, ${classesDef.length} classes.`);
    console.log(`Admin login (system access only, no member/billing data): ${adminEmail} / ${adminPassword}`);
    console.log('First launch shows a setup wizard to create your real owner account.');

    // Written once, at the moment the account is created - this is the
    // ONLY place the plaintext password ever exists; only its hash is
    // stored in the database from here on. Deleting this file (or just
    // deactivating/changing the account from Team management) is enough
    // to invalidate it going forward.
    const credentialsPath = path.join(DATA_DIR, 'systemadmin-credentials.txt');
    fs.writeFileSync(
      credentialsPath,
      `System admin (vendor support) account - created ${new Date().toISOString()}\n`
      + `Email:    ${systemAdminEmail}\n`
      + `Password: ${systemAdminPassword}\n\n`
      + `This is the only record of this password - it is not recoverable once this file is deleted.\n`
      + `The gym owner can see this account in Team management and deactivate or change it at any time.\n`
      + `Delete this file once you've stored the password somewhere safer.\n`
    );
    console.log(`System admin (vendor support) account created: ${systemAdminEmail} - password written to ${credentialsPath}`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
