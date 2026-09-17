const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');

const router = express.Router();
router.use(requireStaff());

router.get('/', (req, res) => {
  const includeInactive = req.query.all === '1';
  const rows = db.prepare(`SELECT * FROM facilities ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name`).all();
  res.json(rows.map((f) => ({ id: f.id, name: f.name, active: !!f.active })));
});

router.post('/', requireStaff('owner', 'manager'), (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const info = db.prepare('INSERT INTO facilities (name) VALUES (?)').run(name.trim());
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/:id', requireStaff('owner', 'manager'), (req, res) => {
  const f = db.prepare('SELECT * FROM facilities WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const { name } = req.body || {};
  db.prepare('UPDATE facilities SET name = ? WHERE id = ?').run(name && name.trim() ? name.trim() : f.name, f.id);
  res.json({ ok: true });
});

router.post('/:id/deactivate', requireStaff('owner', 'manager'), (req, res) => {
  db.prepare('UPDATE facilities SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/reactivate', requireStaff('owner', 'manager'), (req, res) => {
  db.prepare('UPDATE facilities SET active = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
