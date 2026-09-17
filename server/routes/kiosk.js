const express = require('express');
const { db } = require('../db');
const { requireStaff, ALL_STAFF_ROLES } = require('../auth');

const router = express.Router();

// Deliberately its own tiny endpoint rather than reusing GET /api/members -
// the kiosk role should never see the full roster response (phone, status,
// plan). This returns just enough to let the door screen resolve a name to
// an id for a manual check-in.
router.get('/search-members', requireStaff(...ALL_STAFF_ROLES), (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const rows = db.prepare(
    `SELECT id, name FROM members WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 5`
  ).all(`%${q}%`, `%${q}%`);
  res.json(rows);
});

module.exports = router;
