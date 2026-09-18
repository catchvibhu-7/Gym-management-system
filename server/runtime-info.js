// Small shared record of the ports/hostnames this process actually bound
// to, filled in once by server/index.js's startServer(). Exists because
// routes/system.js (the Links page) needs to report BOTH the http and
// https port together, and a single incoming request only ever tells you
// which one it arrived on.
module.exports = {
  port: null,
  httpsPort: null,
  tailscaleHostname: null,
};
