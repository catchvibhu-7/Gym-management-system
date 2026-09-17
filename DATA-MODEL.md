# Data fabric — entity relationships

This documents every table in `server/schema.sql`, how they connect, and
the ownership/snapshot rules that aren't obvious from the column list
alone. Written once there was enough surface area (settings, staff, plans,
memberships, billing, classes, workout plans) that the relationships
needed writing down rather than re-derived from route code each time.

## Entities and relationships

```
settings (key/value, no relationships — see "System configuration" below)

staff ──< staff_sessions
staff ──< classes.coach_staff_id (nullable — "Unassigned")
staff ──< day_passes.sold_by_staff_id (nullable)
staff ──< workout_plans.created_by_staff_id (nullable — set only when created_by='staff')

members ──< member_sessions
members ──< memberships
members ──< invoices
members ──< checkins
members ──< bookings
members ──< workout_plans

plans ──< memberships   (a plan can have many memberships; a membership has exactly one plan)

memberships ──< invoices   (nullable FK — see "Invoices" below)

day_pass_types ──< day_passes
day_passes ──< checkins   (a checkin references EITHER a member OR a day_pass, never both — see "Checkins")

classes ──< class_sessions
class_sessions ──< bookings
members ──< bookings

workout_plans ──< workout_plan_exercises
```

Nothing here is many-to-many — every relationship is a plain one-to-many
via a foreign key, which is why there are no join tables besides
`bookings` (which is really "member × class_session", but it's an entity
in its own right because it carries a `status`, not just a link).

## Table-by-table

- **`settings`** — a flat key/value store (`key TEXT PRIMARY KEY, value
  TEXT`), not a fixed set of columns. This is what "fully customizable"
  means in practice for this app: a new setting is a new row, never a
  migration. `server/settingsStore.js` is the only code that reads or
  writes it directly; everything else goes through its `get`/`set`/
  `getPublic`/`applyGst` helpers. Secrets (`razorpay_key_secret`,
  `razorpay_webhook_secret`, `notification_api_key`) are masked to
  `••••••••` by `getPublic()` — the raw value never round-trips back to
  the browser once saved.

- **`staff`** — login + role (`owner`/`manager`/`coach`/`desk`) +
  `access` (`full`/`limited`, an extra console-visibility flag
  independent of role). Deactivation is soft (`active` flag) — a
  deactivated staff row is never deleted, so it stays valid as the
  `coach_staff_id`/`sold_by_staff_id`/`created_by_staff_id` on old
  classes/day-passes/workout-plans instead of leaving a dangling
  reference or forcing a cascade.

- **`members`** — the customer record. `qr_code` and `fob_code` are the
  two check-in credentials (`fob_code` is null unless `access_method` is
  `fob` or `qr_fob`); `pin_hash` is the member-app login credential
  (phone + PIN, no separate username). `status` (`trial`/`active`/
  `past_due`/`frozen`/`cancelled`) is the single source of truth for
  "can this member check in" — `access_method` becoming `'paused'` is a
  side effect of freezing, not an independent state.

- **`memberships`** — one member can have multiple rows here over time
  (history is kept, not overwritten), but only one should be
  `status = 'active'` at once; routes that need "the current plan" always
  add `ORDER BY id DESC LIMIT 1`. `monthly_price_cents` and
  `billing_period` are **frozen at signup** — a later edit to the parent
  `plans` row (price, period) never changes what an existing member is
  actually billed. This is deliberate: it's the same "freeze at
  transaction time, don't recompute from a mutable parent" pattern the
  invoice snapshot below uses. `monthly_price_cents` is a legacy name
  from before non-monthly billing periods existed — it now means "price
  per billing cycle," not "price per month"; `monthlyEquivalentCents()`
  in `utils.js` is what actually normalizes it to a monthly figure for
  MRR math.

- **`invoices`** — `membership_id` is nullable because day-pass-only
  activity doesn't have a membership (though in practice every invoice
  today comes from a membership signup or retry). `amount_cents` is a
  frozen snapshot that already includes GST if it was enabled at the
  time (`settingsStore.applyGst()`, applied once at creation) — GST rate
  changes later never rewrite historical invoices. `gateway_order_id`/
  `gateway_payment_id` correlate a row to a real Razorpay order/payment
  when a real processor is connected; both stay null under the default
  simulated-retry path.

- **`day_pass_types`** / **`day_passes`** — types are just a price list
  (Single, 5-pass); a sold pass snapshots `amount_cents` from the type at
  sale time (same frozen-price pattern as memberships) and tracks
  `remaining_visits` independently so a 5-pass strip can be partially
  used.

- **`checkins`** — the one table with an either/or foreign key: exactly
  one of `member_id` / `day_pass_id` is set, enforced by a `CHECK`
  constraint rather than two separate tables, because "who's inside right
  now" and "today's door feed" need to query both kinds of visitor in one
  pass. An open checkin (`checked_out_at IS NULL`) is what "inside now"
  means everywhere in the app.

- **`classes`** — a recurring weekly definition (`day_of_week` +
  `start_time`), not a specific date. `active = 0` ("suspended"/"paused")
  stops it from being offered for new sessions, but existing
  `class_sessions` rows already generated from it are untouched — pausing
  doesn't retroactively cancel a session already on the calendar.
  Deleting a class (as opposed to suspending it) cascades to its
  `class_sessions` and, through those, to `bookings` — the console warns
  about this with a confirm dialog before calling `DELETE`.

- **`class_sessions`** — one dated occurrence of a class.
  `UNIQUE(class_id, session_date)` means a class can only have one
  session per calendar day.

- **`bookings`** — member × session, with a `status`
  (`booked`/`waitlisted`/`cancelled`/`attended`) and
  `UNIQUE(session_id, member_id)` so a member can't double-book the same
  session. Whether a new booking lands as `booked` or `waitlisted` is
  decided by comparing the current booked count to the class's
  `capacity` at booking time, not stored redundantly anywhere.

- **`automations`** — standalone config rows (name/description/trigger
  description/channel/enabled), no foreign keys. They describe *when* a
  message would fire; nothing here sends anything until a real
  SMS/email provider is connected in Settings — see
  `notification_provider` in `settings`.

- **`workout_plans`** / **`workout_plan_exercises`** — `created_by`
  (`'member'`/`'staff'`) plus the nullable `created_by_staff_id` records
  whether a plan was self-built or assigned by a coach, shown in the
  member app as "Assigned by your coach" vs not. Exercises are a plain
  ordered child list (`sort_order`); there's no shared exercise library
  table — a name is just a text field on each row, not a foreign key.

## Money and currency

Every price/amount column is an integer count of the smallest currency
unit (`_cents`, even though that's cents/paise/whatever `currency_symbol`
currently is) — never a float, to avoid rounding drift. `currency_symbol`
is a **single global display setting**, not stored per-transaction: if you
change it, every historical amount is displayed with the new symbol on
next render. There is currently no per-invoice currency field, so this
app assumes a gym only ever operates in one currency over its lifetime —
switching currencies after real invoices exist would misrepresent old
amounts, not just relabel them.

## What's intentionally not modeled yet

- No plan-change history table — "recent joins/cancellations" on the
  Plans page stands in for real upgrade/downgrade tracking (see
  `server/routes/plans.js`'s `/moves` route).
- No recurring-billing scheduler — nothing automatically advances
  `memberships.next_charge_date` or generates the next cycle's invoice;
  every invoice today is created either at signup or by a manual retry.
- No exercise library — `workout_plan_exercises.name` is free text, not a
  foreign key into a shared catalog.
