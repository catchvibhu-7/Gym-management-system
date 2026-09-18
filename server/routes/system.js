const express = require('express');
const { requireStaff, STAFF_ROLES } = require('../auth');
const { getLanIPs, isTailscaleIp } = require('../net-utils');
const runtimeInfo = require('../runtime-info');

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
  const { port, httpsPort, tailscaleHostname } = runtimeInfo;
  const lanIPs = getLanIPs();
  const buildLinks = (host, scheme, forPort) => LINK_KINDS.map((k) => ({ id: k.id, label: k.label, url: `${scheme}://${host}:${forPort}${k.path}` }));
  res.json({
    port,
    httpsPort,
    lanIPs,
    localLinks: buildLinks('localhost', 'http', port),
    // Grouped by address so the UI can label each group "This network" vs
    // "Tailscale" - a machine on both a LAN and a Tailscale network gets
    // its own real IP address for each, not just one. Each group also
    // carries an HTTPS variant of the same links (self-signed, so a
    // browser warns once before trusting it) - a plain http:// link to a
    // LAN IP can never get camera access at all, since getUserMedia
    // refuses to run outside a secure context.
    remoteLinkGroups: lanIPs.map((ip) => ({
      address: ip,
      kind: isTailscaleIp(ip) ? 'tailscale' : 'lan',
      links: buildLinks(ip, 'http', port),
      secureLinks: httpsPort ? buildLinks(ip, 'https', httpsPort) : [],
    })),
    // A real, browser-trusted certificate for this device's Tailscale
    // name - only present when the `tailscale` CLI is installed, logged
    // in, and the tailnet has HTTPS certs turned on. Unlike secureLinks
    // above (self-signed), these need no "connection not private"
    // click-through on the other end.
    tailscaleHttps: (httpsPort && tailscaleHostname) ? {
      hostname: tailscaleHostname,
      links: buildLinks(tailscaleHostname, 'https', httpsPort),
    } : null,
    // Kept for any older client code still reading these directly.
    memberAppUrls: lanIPs.map((ip) => `http://${ip}:${port}/member/`),
    localMemberAppUrl: `http://localhost:${port}/member/`,
  });
});

module.exports = router;
