import { validateSafeUrl } from '../utils/ssrf.js';
import { browserClient } from './client.js';

const ACTION_TIMEOUT = 15_000;
const TEXT_TRUNCATE_LIMIT = 20_480;
const SCREENSHOT_SIZE_LIMIT = 2 * 1024 * 1024;

export async function navigate(url: string): Promise<string> {
  validateSafeUrl(url);
  const page = await browserClient.getPage();
  await page.goto(url, { timeout: ACTION_TIMEOUT });
  const title: string = await page.title();
  return title;
}

export async function extractText(selector?: string): Promise<string> {
  const page = await browserClient.getPage();
  let text: string = await page.innerText(selector ?? 'body', { timeout: ACTION_TIMEOUT });
  if (text.length > TEXT_TRUNCATE_LIMIT) {
    text = text.slice(0, TEXT_TRUNCATE_LIMIT) + '[truncated]';
  }
  return text;
}

export async function screenshot(): Promise<Buffer> {
  const page = await browserClient.getPage();
  const buf: Buffer = await page.screenshot({ fullPage: true, timeout: ACTION_TIMEOUT });
  if (buf.length > SCREENSHOT_SIZE_LIMIT) {
    throw new Error(`Screenshot size ${buf.length} bytes exceeds 2 MB limit`);
  }
  return buf;
}

export async function fillForm(fields: Record<string, string>): Promise<void> {
  const page = await browserClient.getPage();
  for (const [selector, value] of Object.entries(fields)) {
    await page.locator(selector).fill(value, { timeout: ACTION_TIMEOUT });
  }
}

export async function click(selector: string): Promise<void> {
  const page = await browserClient.getPage();
  await page.locator(selector).click({ timeout: ACTION_TIMEOUT });
}
