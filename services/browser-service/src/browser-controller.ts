import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page, type Route } from "playwright";
import { validatePublicUrl } from "./url-policy.js";

export type BrowserState = {
  connected: boolean;
  busy: "idle" | "manual" | "automation";
  url: string;
  title: string;
  error?: string;
  lastScreenshot?: string;
};

export type BrowserEvent =
  | { type: "state"; state: BrowserState }
  | { type: "log"; level: "info" | "success" | "error"; message: string; timestamp: string }
  | { type: "demo-result"; ok: boolean; title?: string; screenshotUrl?: string; error?: string };

const delay = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new Error("Demo stopped."));
      },
      { once: true }
    );
  });

export class BrowserController extends EventEmitter {
  private context?: BrowserContext;
  private page?: Page;
  private abortController?: AbortController;
  private restarting = false;
  private state: BrowserState = { connected: false, busy: "idle", url: "about:blank", title: "Server Browser" };
  private readonly artifactsDir = process.env.ARTIFACTS_DIR ?? path.resolve("artifacts");
  private readonly profileDir = process.env.PROFILE_DIR ?? path.resolve(".browser-profile");
  private readonly screenWidth = Number(process.env.SCREEN_WIDTH ?? 1440);
  private readonly screenHeight = Number(process.env.SCREEN_HEIGHT ?? 900);

  getState(): BrowserState {
    return { ...this.state };
  }

  private publish(event: BrowserEvent): void {
    this.emit("event", event);
  }

  private updateState(patch: Partial<BrowserState>): void {
    this.state = { ...this.state, ...patch };
    this.publish({ type: "state", state: this.getState() });
  }

  private log(message: string, level: "info" | "success" | "error" = "info"): void {
    this.publish({ type: "log", level, message, timestamp: new Date().toISOString() });
  }

  async start(): Promise<void> {
    await mkdir(this.artifactsDir, { recursive: true });
    await mkdir(this.profileDir, { recursive: true });
    await this.launchBrowser();
  }

  private async launchBrowser(): Promise<void> {
    this.log("Starting headed Chromium session...");
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: false,
      viewport: null,
      screen: { width: this.screenWidth, height: this.screenHeight },
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-extensions",
        "--disable-gpu",
        "--disable-infobars",
        "--disable-session-crashed-bubble",
        "--disable-site-isolation-trials",
        "--disable-software-rasterizer",
        "--disable-translate",
        "--disk-cache-size=8388608",
        "--media-cache-size=4194304",
        "--no-zygote",
        "--no-first-run",
        "--renderer-process-limit=1",
        "--single-process",
        "--js-flags=--max-old-space-size=96",
        "--window-position=0,0",
        `--window-size=${this.screenWidth},${this.screenHeight}`,
        "--kiosk"
      ]
    });

    await this.context.route("**/*", (route) => this.guardRequest(route));
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.attachPageEvents(this.page);
    this.context.on("page", (page) => {
      if (this.page && page !== this.page) void page.close();
    });
    this.context.browser()?.on("disconnected", () => void this.handleDisconnect());

    if (this.page.url() === "about:blank") {
      await this.page.setContent(
        "<main style='font:24px system-ui;display:grid;place-content:center;height:90vh;color:#475569'><div><h1>Server browser ready</h1><p>Enter a public URL above.</p></div></main>"
      );
    }
    await this.syncPageState();
    this.updateState({ connected: true, error: undefined });
    this.log("Chromium connected.", "success");
  }

  private attachPageEvents(page: Page): void {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) void this.syncPageState();
    });
    page.on("load", () => void this.syncPageState());
    page.on("pageerror", (error) => this.log(`Page error: ${error.message}`, "error"));
    page.on("crash", () => {
      this.updateState({ error: "Chromium page crashed." });
      this.log("Chromium page crashed.", "error");
    });
  }

  private async guardRequest(route: Route): Promise<void> {
    const requestUrl = route.request().url();
    const protocol = new URL(requestUrl).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      await route.continue();
      return;
    }
    try {
      await validatePublicUrl(requestUrl);
      await route.continue();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blocked unsafe request.";
      this.log(`Blocked request to ${new URL(requestUrl).hostname}: ${message}`, "error");
      await route.abort("blockedbyclient");
    }
  }

  private async handleDisconnect(): Promise<void> {
    this.updateState({ connected: false, error: "Chromium disconnected." });
    this.log("Chromium disconnected. Restarting...", "error");
    if (this.restarting) return;
    this.restarting = true;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await delay(attempt * 1_000);
        await this.launchBrowser();
        this.restarting = false;
        return;
      } catch (error) {
        this.log(`Restart attempt ${attempt} failed: ${this.errorMessage(error)}`, "error");
      }
    }
    this.restarting = false;
    this.updateState({ error: "Could not restart Chromium." });
  }

  private requirePage(): Page {
    if (!this.page || !this.state.connected) throw new Error("Chromium is not connected.");
    return this.page;
  }

  private ensureIdle(): void {
    if (this.state.busy !== "idle") throw new Error(`Browser is busy with ${this.state.busy} control.`);
  }

  private async syncPageState(): Promise<void> {
    const page = this.page;
    if (!page || page.isClosed()) return;
    let title = "";
    try {
      title = await page.title();
    } catch {
      // Navigation can destroy the execution context. Next load event will resync.
    }
    this.updateState({ url: page.url(), title: title || page.url() || "Server Browser" });
  }

  async navigate(input: string): Promise<void> {
    this.ensureIdle();
    const page = this.requirePage();
    const url = await validatePublicUrl(input);
    this.updateState({ busy: "manual", error: undefined });
    try {
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await this.syncPageState();
    } finally {
      this.updateState({ busy: "idle" });
    }
  }

  async action(name: "back" | "forward" | "refresh"): Promise<void> {
    this.ensureIdle();
    const page = this.requirePage();
    this.updateState({ busy: "manual", error: undefined });
    try {
      if (name === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
      if (name === "forward") await page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 });
      if (name === "refresh") await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      await this.syncPageState();
    } finally {
      this.updateState({ busy: "idle" });
    }
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    const page = this.requirePage();
    await page.evaluate(() => window.stop()).catch(() => undefined);
    await page.keyboard.press("Escape").catch(() => undefined);
    this.log("Stop requested.");
  }

  startDemo(): void {
    this.ensureIdle();
    this.requirePage();
    this.updateState({ busy: "automation", error: undefined });
    this.abortController = new AbortController();
    void this.runDemo(this.abortController.signal);
  }

  private async runDemo(signal: AbortSignal): Promise<void> {
    const page = this.requirePage();
    let exampleTitle: string | undefined;
    try {
      this.log("Demo started: opening https://example.com");
      await page.goto("https://example.com", { waitUntil: "load", timeout: 45_000 });
      exampleTitle = await page.title();
      this.log(`Page title: ${exampleTitle}`, "success");
      await delay(1_000, signal);

      this.log("Opening https://www.wikipedia.org");
      await page.goto("https://www.wikipedia.org", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await delay(1_000, signal);

      this.log('Typing "Next.js" into Wikipedia search.');
      const searchInput = page.locator('input[name="search"]');
      await searchInput.waitFor({ state: "visible", timeout: 20_000 });
      await searchInput.click();
      await searchInput.pressSequentially("Next.js", { delay: 140 });
      await delay(700, signal);
      this.log("Submitting Wikipedia search.");
      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => undefined),
        searchInput.press("Enter")
      ]);
      await page.locator("#firstHeading, h1").first().waitFor({ state: "visible", timeout: 20_000 });
      this.log(`Wikipedia loaded: ${await page.title()}`, "success");

      this.log("Scrolling down.");
      await page.mouse.wheel(0, 1_200);
      await delay(1_500, signal);
      this.log("Scrolling back to top.");
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await delay(1_500, signal);

      const filename = `demo-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      await page.screenshot({ path: path.join(this.artifactsDir, filename), fullPage: false });
      const screenshotUrl = `/browser-api/screenshots/${encodeURIComponent(filename)}`;
      this.updateState({ lastScreenshot: screenshotUrl });
      this.log(`Screenshot saved: ${filename}`, "success");
      this.publish({ type: "demo-result", ok: true, title: exampleTitle, screenshotUrl });
      this.log("Demo completed.", "success");
    } catch (error) {
      const message = this.errorMessage(error);
      this.updateState({ error: message });
      this.log(`Demo failed: ${message}`, "error");
      this.publish({ type: "demo-result", ok: false, title: exampleTitle, error: message });
    } finally {
      this.abortController = undefined;
      this.updateState({ busy: "idle" });
      await this.syncPageState();
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async close(): Promise<void> {
    this.abortController?.abort();
    this.restarting = true;
    await this.context?.close().catch(() => undefined);
    this.updateState({ connected: false, busy: "idle" });
  }
}
