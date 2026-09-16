const express = require('express');
const { db } = require('../db');
const { requireStaff } = require('../auth');

const router = express.Router();
router.use(requireStaff());

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM automations ORDER BY sort_order').all();
  res.json(rows.map((a) => ({
    id: a.id, name: a.name, desc: a.description, trigger: a.trigger_desc, channel: a.channel,
    enabled: !!a.enabled,
    trackStyle: `position:relative;width:38px;height:22px;border-radius:999px;border:none;cursor:pointer;background:${a.enabled ? '#137a5f' : '#dcded7'}`,
    knobStyle: `position:absolute;top:2px;left:${a.enabled ? 18 : 2}px;width:18px;height:18px;border-radius:999px;background:#fff;transition:left .15s`,
    chipStyle: 'display:inline-block;font-size:11px;font-weight:700;background:#eceded;color:#3d4139;padding:4px 9px;border-radius:999px',
  })));
});

router.post('/:id/toggle', (req, res) => {
  const a = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE automations SET enabled = ? WHERE id = ?').run(a.enabled ? 0 : 1, a.id);
  res.json({ ok: true, enabled: !a.enabled });
});

router.get('/message-stats', (req, res) => {
  // No SMS/email provider is connected yet, so this is a static placeholder
  // shape the console can render until one is - see README.
  res.json({ sentLast30: 0, openedPct: 0, replies: 0 });
});

module.exports = router;
