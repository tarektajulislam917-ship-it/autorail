import assert from "node:assert/strict";
import WebSocket from "ws";

const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const websocketBase = baseUrl.replace(/^http/, "ws");

async function verifyHttp(path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.ok, true, `${path} returned ${response.status}`);
  return response;
}

function verifyVncHandshake() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${websocketBase}/novnc/websockify`);
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for VNC handshake.")), 10_000);
    socket.once("message", (data) => {
      const version = data.toString();
      clearTimeout(timeout);
      socket.close();
      assert.match(version, /^RFB 003\./, `Unexpected VNC handshake: ${version}`);
      resolve(version.trim());
    });
    socket.once("error", reject);
  });
}

function runDemoAndWait() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${websocketBase}/browser-events`);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for demo result."));
    }, 120_000);

    socket.on("message", (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === "log") console.log(`[${event.level}] ${event.message}`);
      if (event.type === "demo-result") {
        clearTimeout(timeout);
        socket.close();
        if (!event.ok) reject(new Error(event.error ?? "Demo failed."));
        else resolve(event);
      }
    });
    socket.once("error", reject);
    socket.once("open", async () => {
      try {
        const response = await fetch(`${baseUrl}/browser-api/demo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        });
        assert.equal(response.status, 202, `Demo returned ${response.status}: ${await response.text()}`);
      } catch (error) {
        clearTimeout(timeout);
        socket.close();
        reject(error);
      }
    });
  });
}

await verifyHttp("/");
await verifyHttp("/novnc/vnc.html");
const stateResponse = await verifyHttp("/browser-api/state");
const state = await stateResponse.json();
assert.equal(state.connected, true, "Chromium is not connected.");

const vncVersion = await verifyVncHandshake();
console.log(`VNC handshake: ${vncVersion}`);

const result = await runDemoAndWait();
assert.equal(result.title, "Example Domain");
const screenshot = await verifyHttp(result.screenshotUrl);
assert.match(screenshot.headers.get("content-type") ?? "", /^image\/png/);
assert.ok((await screenshot.arrayBuffer()).byteLength > 10_000, "Screenshot is unexpectedly small.");
console.log(`Demo passed. Screenshot: ${result.screenshotUrl}`);
