// BrowserClient — lazy-initialises a Playwright chromium browser singleton.
// Playwright is an optional dependency; if not installed the tools register
// but return a helpful error string via isBrowserAvailable().

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightBrowser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightPage = any;

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let playwrightAvailable = false;

// Attempt to detect Playwright at module load time without triggering a hard
// import failure.  We use require.resolve() so the check is synchronous and
// does not leave an unresolved dynamic import floating on the event loop.
try {
  require.resolve('playwright');
  playwrightAvailable = true;
} catch {
  playwrightAvailable = false;
}

export function isBrowserAvailable(): boolean {
  return playwrightAvailable;
}

export class BrowserClient {
  private browser: PlaywrightBrowser | null = null;
  private page: PlaywrightPage | null = null;

  async getPage(): Promise<PlaywrightPage> {
    if (!playwrightAvailable) {
      throw new Error('Playwright is not installed. Run: npm install playwright');
    }

    if (this.page) {
      return this.page;
    }

    // Dynamic import so the module loads successfully even without playwright.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { chromium } = await import('playwright' as any);
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
    return this.page;
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

export const browserClient = new BrowserClient();
