const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireStaff } = require('../auth');
const backup = require('../backup');

const router = express.Router();
router.use(requireStaff('owner', 'manager', 'admin'));

router.get('/', (req, res) => {
  res.json(backup.listBackups());
});

router.post('/run', (req, res) => {
  try {
    const filename = backup.runBackup('manual');
    res.json({ ok: true, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(backup.BACKUPS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup not found' });
  res.download(filePath);
});

router.post('/restore', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  try {
    backup.restoreFrom(req.body);
    res.json({ ok: true, message: 'Restored. The application will restart in a moment — reopen it if it does not come back on its own.' });
    res.on('finish', () => backup.triggerRestoreRestart());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
