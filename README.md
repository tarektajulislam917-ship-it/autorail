# Live Server Browser

A Next.js application that embeds a real server-side Chromium window. Playwright and the user control the same persistent, headed browser session. Xvfb provides the display, x11vnc exposes that display inside the Docker network, and noVNC provides interactive mouse, keyboard, and scrolling in the web interface.

## Features

- Next.js App Router frontend with a browser-style toolbar
- Persistent headed Chromium session managed by Playwright
- Live interactive browser display through noVNC
- Back, Forward, Refresh, Stop, and validated URL navigation
- WebSocket browser state, automation logs, and results
- Visible Playwright demo that uses the same browser shown to the user
- Local PNG screenshots in `artifacts/`
- Single-session concurrency guard during automated control
- Private browser-control and VNC containers with only the Next.js gateway published
- Public-network URL validation and request interception to reduce SSRF exposure

## Architecture

```text
Browser
  | HTTP + WebSocket
  v
Next.js gateway :3000
  |-- UI (App Router)
  |-- /browser-api/* and /browser-events --> browser-control :3001
  `-- /novnc/* ---------------------------> noVNC :6080
                                                   |
browser-control --> Playwright --> Chromium --> Xvfb :99 --> x11vnc :5900
```

Ports `3001`, `6080`, and `5900` are not published on the host. The Compose network is the only path between services. The gateway injects the control token, so it never reaches browser JavaScript.

## Requirements

- Linux with Docker Engine and Docker Compose
- At least 2 GB of free memory for the Chromium container
- Internet access from Docker for the included demo sites

## Run

1. Create a local environment file and replace the development secret:

   ```bash
   cp .env.example .env
   openssl rand -hex 32
   id -g
   # Put the generated secret in CONTROL_TOKEN and your group ID in HOST_GID.
   ```

2. Build and start both services:

   ```bash
   docker compose up --build
   ```

3. Open <http://localhost:3000>.

4. Wait for the status to show `Connected`. Enter any public HTTP or HTTPS URL, or select **Run Demo**.

The first build downloads the Playwright image and npm dependencies. Chromium profile data persists in the `browser-profile` Docker volume. Screenshots persist in the host `artifacts/` directory.

## Deploy on Render Free

Render uses [Dockerfile.render](Dockerfile.render) to run the entire stack as one web service. Next.js builds the frontend as a static export. The browser service serves that export, API, and VNC proxy from one Node.js process. Chromium, Xvfb, x11vnc, and noVNC share the same container. Only Render's public `PORT` is exposed; VNC binds to localhost.

1. Push this repository to GitHub or GitLab.
2. In Render, select **New > Blueprint**.
3. Connect the repository. Render detects `render.yaml`.
4. Confirm the `live-server-browser` Free web service and deploy it. Do not change the Dockerfile path.
5. Open the generated `onrender.com` URL after the health check passes.

The Blueprint generates `CONTROL_TOKEN` automatically. No manual environment variables are required.

Render Free provides 512 MB RAM and limited CPU. The Render image therefore uses a 960 × 600 display, one Chromium process, small caches, and Node.js heap limits. This is suitable for a single-user demonstration, not production traffic. The single-process Chromium mode trades crash isolation for lower memory use.

Free-tier storage is ephemeral. Screenshots and Chromium profile data under `/tmp` disappear after a restart, redeploy, or idle spin-down. Download any screenshot you want to keep. The first request after an idle period can take about one minute while Render starts the container and Chromium.

To test the exact Render image locally:

```bash
docker build -f Dockerfile.render -t live-browser-render .
docker run --rm -p 10000:10000 \
  --shm-size=256m \
  --memory=512m \
  -e PORT=10000 \
  -e CONTROL_TOKEN=local-render-test-token \
  live-browser-render
```

Then open <http://localhost:10000> or run `APP_URL=http://localhost:10000 npm run verify:live`.

## Demo flow

**Run Demo** performs the following visible actions in the embedded browser:

1. Opens `https://example.com` and reads its title.
2. Opens `https://www.wikipedia.org`.
3. Types `Next.js` into the search input and submits it.
4. Waits for the resulting page, scrolls down, and returns to the top.
5. Saves a timestamped screenshot under `artifacts/`.
6. Streams each action and the final result to the frontend.

The noVNC interaction layer is temporarily covered while Playwright owns the session. Stop aborts the demo at its next cancellable step and stops active page loading.

## Development checks

Install dependencies once, then run the checks:

```bash
npm install
npm run typecheck
npm test
npm run build
npm run verify:live
```

For the full integration check:

```bash
docker compose up --build -d
docker compose ps
curl -fsS http://localhost:3000
```

`npm run verify:live` checks the UI, noVNC RFB handshake, browser WebSocket events, full demo, and saved PNG. Inspect service logs with `docker compose logs -f web browser`. Stop services with `docker compose down`. Add `-v` only when you also want to delete the persistent Chromium profile.

## Security notes

- Deploy behind authentication if the application is reachable beyond a trusted local network. Any application user can control the shared browser session.
- The browser service rejects non-HTTP protocols, credentials in URLs, local hostnames, and private, loopback, link-local, multicast, and reserved IP ranges. It applies the same policy to page subrequests.
- DNS rebinding protection at the network layer is still recommended for hostile multi-user deployments. Run the browser container on an egress-filtered network that cannot reach cloud metadata, Docker hosts, or internal services.
- noVNC and browser-control ports use Compose `expose`, not host `ports`. Do not publish them.
- This initial version intentionally supports one active browser session. Horizontal scaling needs isolated profiles, displays, and per-session authorization.

## Troubleshooting

- **Disconnected status:** Run `docker compose logs browser`. Confirm Xvfb, x11vnc, noVNC, and Chromium started.
- **Blank browser display:** Reload the page after the browser health check passes. Confirm WebSocket proxying is allowed by any reverse proxy in front of port 3000.
- **Demo navigation failure:** Confirm both demo sites resolve from the `browser` container and that outbound HTTPS is allowed.
- **Profile lock after an unclean stop:** Start the same Compose project again. Do not mount one profile volume into multiple browser containers.
# autorail
