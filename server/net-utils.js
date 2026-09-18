const net = require('net');
const os = require('os');

// Tries the requested port first, then walks upward until one is free -
// so a stale process holding 3300 doesn't stop the app from starting.
function findAvailablePort(startPort, host = '0.0.0.0', maxAttempts = 20) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let attempts = 0;

    function tryPort() {
      const tester = net.createServer();
      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          attempts += 1;
          port += 1;
          tryPort();
        } else {
          reject(err);
        }
      });
      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port, host);
    }

    tryPort();
  });
}

// Non-internal IPv4 addresses of this machine, so a phone on the same
// wifi can reach the member app without anyone typing "localhost".
function getLanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// Tailscale always hands out addresses in its CGNAT range (100.64.0.0/10) -
// this is what lets the Links page label a Tailscale address apart from a
// plain router-assigned LAN one (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
// without needing to shell out to `tailscale status`.
function isTailscaleIp(ip) {
  const parts = ip.split('.').map(Number);
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

module.exports = { findAvailablePort, getLanIPs, isTailscaleIp };
