const express = require('express');
const { requireStaff, STAFF_ROLES } = require('../auth');
const { getLanIPs, isTailscaleIp } = require('../net-utils');

const router = express.Router();
router.use(requireStaff(...STAFF_ROLES, 'admin'));

// One entry per kind of page this app serves - reused for both the local
// (localhost) links and every reachable-IP's set of links, so a device on
// the network never has to guess a path.
const LINK_KINDS = [
  { id: 'console', label: 'Owner / staff console', path: '/console/' },
  { id: 'member', label: 'Member app', path: '/member/' },
  { id: 'kiosk', label: 'Door kiosk', path: '/kiosk' },
];

router.get('/info', (req, res) => {
  const port = req.socket.localPort;
  const lanIPs = getLanIPs();
  const buildLinks = (host) => LINK_KINDS.map((k) => ({ id: k.id, label: k.label, url: `http://${host}:${port}${k.path}` }));
  res.json({
    port,
    lanIPs,
    localLinks: buildLinks('localhost'),
    // Grouped by address so the UI can label each group "This network" vs
    // "Tailscale" - a machine on both a LAN and a Tailscale network gets
    // its own real IP address for each, not just one.
    remoteLinkGroups: lanIPs.map((ip) => ({
      address: ip, kind: isTailscaleIp(ip) ? 'tailscale' : 'lan', links: buildLinks(ip),
    })),
    // Kept for any older client code still reading these directly.
    memberAppUrls: lanIPs.map((ip) => `http://${ip}:${port}/member/`),
    localMemberAppUrl: `http://localhost:${port}/member/`,
  });
});

module.exports = router;
