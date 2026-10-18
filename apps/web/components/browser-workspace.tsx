"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type BrowserState = {
  connected: boolean;
  busy: "idle" | "manual" | "automation";
  url: string;
  title: string;
  error?: string;
  lastScreenshot?: string;
};

type LogEntry = { level: "info" | "success" | "error"; message: string; timestamp: string };
type DemoResult = { ok: boolean; title?: string; screenshotUrl?: string; error?: string };
type BrowserEvent =
  | { type: "state"; state: BrowserState }
  | ({ type: "log" } & LogEntry)
  | ({ type: "demo-result" } & DemoResult);

const initialState: BrowserState = {
  connected: false,
  busy: "idle",
  url: "about:blank",
  title: "Server Browser"
};

function socketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/browser-events`;
}

export function BrowserWorkspace() {
  const [browser, setBrowser] = useState(initialState);
  const [address, setAddress] = useState("https://example.com");
  const [editingAddress, setEditingAddress] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<DemoResult>();
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = useCallback((entry: LogEntry) => {
    setLogs((current) => [...current.slice(-99), entry]);
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(socketUrl());
      socket.onopen = () => setSocketConnected(true);
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as BrowserEvent;
        if (event.type === "state") setBrowser(event.state);
        if (event.type === "log") addLog(event);
        if (event.type === "demo-result") setResult(event);
      };
      socket.onclose = () => {
        setSocketConnected(false);
        if (!disposed) reconnectTimer.current = setTimeout(connect, 1_500);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      disposed = true;
      socket?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [addLog]);

  useEffect(() => {
    if (!editingAddress && browser.url.startsWith("http")) setAddress(browser.url);
  }, [browser.url, editingAddress]);

  const request = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`/browser-api${path}`, {
      ...options,
      headers: { "content-type": "application/json", ...options.headers }
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? `Request failed with status ${response.status}.`);
    return payload;
  };

  const run = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      addLog({
        level: "error",
        message: error instanceof Error ? error.message : "Browser request failed.",
        timestamp: new Date().toISOString()
      });
    }
  };

  const navigate = (event: FormEvent) => {
    event.preventDefault();
    let destination = address.trim();
    if (!/^https?:\/\//i.test(destination)) destination = `https://${destination}`;
    setAddress(destination);
    void run(() => request("/navigate", { method: "POST", body: JSON.stringify({ url: destination }) }));
  };

  const action = (name: "back" | "forward" | "refresh" | "stop") =>
    void run(() => request(`/actions/${name}`, { method: "POST", body: "{}" }));

  const runDemo = () => {
    setResult(undefined);
    setLogs([]);
    void run(() => request("/demo", { method: "POST", body: "{}" }));
  };

  const connected = socketConnected && browser.connected;
  const manualLocked = !connected || browser.busy === "automation";

  return (
    <main className="workspace">
      <header className="app-header">
        <div>
          <p className="eyebrow">PLAYWRIGHT · CHROMIUM · NOVNC</p>
          <h1>Server Browser</h1>
        </div>
        <div className={`status ${connected ? "online" : "offline"}`}>
          <span aria-hidden="true" />
          {connected ? (browser.busy === "automation" ? "Automation running" : "Connected") : "Disconnected"}
        </div>
      </header>

      <section className="browser-shell" aria-label="Remote browser">
        <div className="toolbar">
          <div className="nav-buttons">
            <button onClick={() => action("back")} disabled={manualLocked} title="Back" aria-label="Back">←</button>
            <button onClick={() => action("forward")} disabled={manualLocked} title="Forward" aria-label="Forward">→</button>
            <button onClick={() => action("refresh")} disabled={manualLocked} title="Refresh" aria-label="Refresh">↻</button>
            <button onClick={() => action("stop")} disabled={!connected || browser.busy === "idle"} title="Stop" aria-label="Stop">×</button>
          </div>
          <form onSubmit={navigate} className="address-form">
            <span className="lock" aria-hidden="true">◇</span>
            <input
              aria-label="Address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onFocus={() => setEditingAddress(true)}
              onBlur={() => setEditingAddress(false)}
              disabled={manualLocked}
              spellCheck={false}
            />
          </form>
          <button className="demo-button" onClick={runDemo} disabled={!connected || browser.busy !== "idle"}>
            Run Demo
          </button>
        </div>

        <div className="viewport">
          <iframe
            src="/novnc/vnc.html?autoconnect=1&resize=scale&reconnect=1&show_dot=1&path=novnc%2Fwebsockify"
            title="Live server-side Chromium"
            allow="clipboard-read; clipboard-write"
          />
          {browser.busy === "automation" && <div className="automation-shield"><span>Playwright has control</span></div>}
          {!browser.connected && <div className="connection-cover">Starting Chromium…</div>}
        </div>
      </section>

      <section className="details-grid">
        <article className="panel log-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LIVE OUTPUT</p>
              <h2>Execution logs</h2>
            </div>
            <button className="text-button" onClick={() => setLogs([])}>Clear</button>
          </div>
          <div className="logs" aria-live="polite">
            {logs.length === 0 && <p className="empty">Run demo to watch each automation step.</p>}
            {logs.map((entry, index) => (
              <div className={`log ${entry.level}`} key={`${entry.timestamp}-${index}`}>
                <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel result-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LATEST RUN</p>
              <h2>Demo result</h2>
            </div>
            {result && <span className={`result-badge ${result.ok ? "passed" : "failed"}`}>{result.ok ? "Passed" : "Failed"}</span>}
          </div>
          {!result && !browser.lastScreenshot && <p className="empty">Screenshot and page title appear here.</p>}
          {result?.title && <p className="result-title">example.com title: <strong>{result.title}</strong></p>}
          {result?.error && <p className="error-message">{result.error}</p>}
          {(result?.screenshotUrl ?? browser.lastScreenshot) && (
            // The URL is generated by the trusted browser service and proxied by this application.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="screenshot" src={result?.screenshotUrl ?? browser.lastScreenshot} alt="Screenshot from latest demo run" />
          )}
        </article>
      </section>
    </main>
  );
}
