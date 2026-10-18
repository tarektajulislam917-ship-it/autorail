import http from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import httpProxy from "http-proxy";
import { WebSocketServer } from "ws";
import { BrowserController, type BrowserEvent } from "./browser-controller.js";

const singleService = process.env.SINGLE_SERVICE === "true";
const port = Number(singleService ? process.env.PORT ?? 10_000 : process.env.BROWSER_SERVICE_PORT ?? process.env.PORT ?? 3001);
const apiPrefix = singleService ? "/browser-api" : "";
const controlToken = process.env.CONTROL_TOKEN;
if (!controlToken) throw new Error("CONTROL_TOKEN is required.");

const controller = new BrowserController();
const app = express();
app.disable("x-powered-by");
if (singleService) {
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });
}
app.use(express.json({ limit: "16kb" }));
const api = express.Router();

api.get("/health", (_request, response) => {
  const state = controller.getState();
  response.status(state.connected ? 200 : 503).json({ ok: state.connected });
});

function requireToken(request: Request, response: Response, next: NextFunction): void {
  if (request.header("x-control-token") !== controlToken) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

if (!singleService) api.use(requireToken);
api.get("/state", (_request, response) => response.json(controller.getState()));

api.post("/navigate", async (request, response, next) => {
  try {
    if (typeof request.body?.url !== "string" || request.body.url.length > 2_048) {
      response.status(400).json({ error: "A URL of at most 2,048 characters is required." });
      return;
    }
    await controller.navigate(request.body.url);
    response.json(controller.getState());
  } catch (error) {
    next(error);
  }
});

api.post("/actions/:name", async (request, response, next) => {
  try {
    const name = request.params.name;
    if (name === "stop") {
      await controller.stop();
    } else if (name === "back" || name === "forward" || name === "refresh") {
      await controller.action(name);
    } else {
      response.status(404).json({ error: "Unknown browser action." });
      return;
    }
    response.json(controller.getState());
  } catch (error) {
    next(error);
  }
});

api.post("/demo", (_request, response, next) => {
  try {
    controller.startDemo();
    response.status(202).json({ accepted: true });
  } catch (error) {
    next(error);
  }
});

const artifactsDir = process.env.ARTIFACTS_DIR ?? path.resolve("artifacts");
api.use("/screenshots", express.static(artifactsDir, { dotfiles: "deny", fallthrough: false, index: false, maxAge: "1h" }));
app.use(apiPrefix || "/", api);

const vncProxy = httpProxy.createProxyServer({ ws: true });
vncProxy.on("error", (error, _request, target) => {
  console.error("VNC proxy error:", error.message);
  if (target && "destroy" in target) target.destroy();
});

if (singleService) {
  app.use("/novnc", express.static("/usr/share/novnc", { fallthrough: false, index: false }));
  const webOutput = path.resolve("/app/apps/web/out");
  app.use(express.static(webOutput, { index: "index.html" }));
  app.get("*", (_request, response) => response.sendFile(path.join(webOutput, "index.html")));
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected browser service error.";
  const status = message.includes("busy") ? 409 : message.includes("allowed") || message.includes("valid") || message.includes("resolved") ? 400 : 500;
  response.status(status).json({ error: message });
});

const server = http.createServer(app);
const sockets = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", "http://browser-service").pathname;
  if (singleService && pathname === "/novnc/websockify") {
    request.url = "/websockify";
    vncProxy.ws(request, socket, head, { target: "http://127.0.0.1:6080" });
    return;
  }
  const eventPath = singleService ? "/browser-events" : "/events";
  if (pathname !== eventPath || (!singleService && request.headers["x-control-token"] !== controlToken)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (websocket) => sockets.emit("connection", websocket, request));
});

sockets.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", state: controller.getState() } satisfies BrowserEvent));
});

controller.on("event", (event: BrowserEvent) => {
  const payload = JSON.stringify(event);
  for (const client of sockets.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
});

await controller.start();
server.listen(port, "0.0.0.0", () => console.log(`Browser service listening on ${port}`));

async function shutdown(): Promise<void> {
  sockets.close();
  server.close();
  await controller.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
