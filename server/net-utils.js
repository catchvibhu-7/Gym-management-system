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

module.exports = { findAvailablePort, getLanIPs };
