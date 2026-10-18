import http from "node:http";
import next from "next";
import httpProxy from "http-proxy";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.APP_HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const browserTarget = process.env.BROWSER_SERVICE_URL ?? "http://localhost:3001";
const novncTarget = process.env.NOVNC_SERVICE_URL ?? "http://localhost:6080";
const controlToken = process.env.CONTROL_TOKEN;
if (!controlToken) throw new Error("CONTROL_TOKEN is required.");

const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();
const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: false });

proxy.on("error", (error, _request, response) => {
  console.error("Proxy error:", error.message);
  if (response && "writeHead" in response && !response.headersSent) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Browser service unavailable." }));
  } else if (response && "destroy" in response) {
    response.destroy();
  }
});

function withoutPrefix(url, prefix, fallback = "/") {
  const rewritten = url.slice(prefix.length);
  return rewritten.startsWith("/") ? rewritten : fallback;
}

await nextApp.prepare();

const server = http.createServer((request, response) => {
  const url = request.url ?? "/";
  request.headers.delete?.("x-control-token");
  delete request.headers["x-control-token"];

  if (url === "/browser-api" || url.startsWith("/browser-api/")) {
    request.url = withoutPrefix(url, "/browser-api");
    request.headers["x-control-token"] = controlToken;
    proxy.web(request, response, { target: browserTarget });
    return;
  }

  if (url === "/novnc" || url.startsWith("/novnc/")) {
    request.url = withoutPrefix(url, "/novnc");
    proxy.web(request, response, { target: novncTarget });
    return;
  }

  void handle(request, response);
});

server.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "/";
  delete request.headers["x-control-token"];

  if (url === "/browser-events" || url.startsWith("/browser-events?")) {
    request.url = `/events${url.slice("/browser-events".length)}`;
    request.headers["x-control-token"] = controlToken;
    proxy.ws(request, socket, head, { target: browserTarget });
    return;
  }

  if (url.startsWith("/novnc/")) {
    request.url = withoutPrefix(url, "/novnc");
    proxy.ws(request, socket, head, { target: novncTarget });
    return;
  }

  socket.destroy();
});

server.listen(port, hostname, () => {
  console.log(`Web application listening on http://${hostname}:${port}`);
});
