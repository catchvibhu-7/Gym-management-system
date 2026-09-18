-- Gym Management System schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','coach','desk')),
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'limited' CHECK (access IN ('full','limited')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  token TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  photo_key TEXT,
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','past_due','frozen','cancelled')),
  access_method TEXT NOT NULL DEFAULT 'qr' CHECK (access_method IN ('qr','fob','qr_fob','manual','paused')),
  fob_code TEXT UNIQUE,
  qr_code TEXT UNIQUE NOT NULL,
  pin_hash TEXT,
  notes TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_sessions (
  token TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  billing_period TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','quarterly','half_yearly','yearly')),
  description TEXT,
  tag TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  gst_applicable INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  monthly_price_cents INTEGER NOT NULL,
  billing_period TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','quarterly','half_yearly','yearly')),
  joining_fee_cents INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  next_charge_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','cancelled')),
  frozen_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  membership_id INTEGER REFERENCES memberships(id),
  amount_cents INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  attempted_at TEXT,
  paid_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  payment_method TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS day_pass_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  visits INTEGER NOT NULL DEFAULT 1,
  gst_applicable INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS day_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  type_id INTEGER NOT NULL REFERENCES day_pass_types(id),
  amount_cents INTEGER NOT NULL,
  remaining_visits INTEGER NOT NULL,
  qr_code TEXT UNIQUE NOT NULL,
  sold_by_staff_id INTEGER REFERENCES staff(id),
  sold_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  day_pass_id INTEGER REFERENCES day_passes(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('qr','fob','manual')),
  checked_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  checked_out_at TEXT,
  CHECK ((member_id IS NOT NULL) OR (day_pass_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  coach_staff_id INTEGER REFERENCES staff(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 45,
  capacity INTEGER NOT NULL DEFAULT 12,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS class_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0,
  UNIQUE(class_id, session_date)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','waitlisted','cancelled','attended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, member_id)
);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  trigger_desc TEXT,
  channel TEXT NOT NULL DEFAULT 'SMS' CHECK (channel IN ('SMS','Email')),
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workout_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL DEFAULT 'member' CHECK (created_by IN ('member','staff')),
  created_by_staff_id INTEGER REFERENCES staff(id),
  title TEXT NOT NULL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_template INTEGER NOT NULL DEFAULT 0,
  plan_type TEXT NOT NULL DEFAULT 'weekly' CHECK (plan_type IN ('weekly','monthly')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','trainer','universal')),
  price_cents INTEGER NOT NULL DEFAULT 0,
  source_template_id INTEGER REFERENCES workout_plans(id)
);

CREATE TABLE IF NOT EXISTS workout_plan_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL DEFAULT 1,
  day_of_week INTEGER NOT NULL DEFAULT 0,
  section TEXT NOT NULL DEFAULT 'workout' CHECK (section IN ('warmup','workout','stretch')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  sets INTEGER,
  reps TEXT,
  weight_note TEXT,
  rest_seconds INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS facilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- A staff member's own shift clock-in/out - deliberately separate from
-- `checkins`, which is member/day-pass floor attendance. Self-service:
-- any logged-in staff member clocks themselves in/out.
CREATE TABLE IF NOT EXISTS staff_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  clocked_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  clocked_out_at TEXT
);

CREATE TABLE IF NOT EXISTS pt_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  trainer_staff_id INTEGER NOT NULL REFERENCES staff(id),
  facility_id INTEGER REFERENCES facilities(id),
  scheduled_at TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','completed','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  payment_method TEXT,
  gateway_order_id TEXT,
  gateway_payment_id TEXT,
  paid_at TEXT,
  created_by_staff_id INTEGER REFERENCES staff(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checkins_member ON checkins(member_id);
CREATE INDEX IF NOT EXISTS idx_checkins_time ON checkins(checked_in_at);
CREATE INDEX IF NOT EXISTS idx_invoices_member ON invoices(member_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_bookings_session ON bookings(session_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_date ON class_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_workout_plans_member ON workout_plans(member_id);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff ON staff_attendance(staff_id);
CREATE INDEX IF NOT EXISTS idx_pt_sessions_member ON pt_sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_pt_sessions_trainer ON pt_sessions(trainer_staff_id);
