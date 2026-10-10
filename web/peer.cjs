// Preloaded with `node --require ./peer.cjs`. Stamps every HTTP request with
// the real TCP peer address in `x-pxls-peer`, overwriting any value the client
// sent. Next.js does not expose the socket address, and it passes a client's
// own X-Forwarded-For through untouched, so lockout and logs use this instead.
const http = require("node:http");

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, ...rest) {
  if (event === "request" && req && req.headers) {
    req.headers["x-pxls-peer"] = (req.socket && req.socket.remoteAddress) || "";
  }
  return emit.call(this, event, req, ...rest);
};
