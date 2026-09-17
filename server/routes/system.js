const express = require('express');
const { requireStaff, STAFF_ROLES } = require('../auth');
const { getLanIPs } = require('../net-utils');

const router = express.Router();
router.use(requireStaff(...STAFF_ROLES, 'admin'));

router.get('/info', (req, res) => {
  const port = req.socket.localPort;
  const lanIPs = getLanIPs();
  res.json({
    port,
    lanIPs,
    memberAppUrls: lanIPs.map((ip) => `http://${ip}:${port}/member/`),
    localMemberAppUrl: `http://localhost:${port}/member/`,
  });
});

module.exports = router;
