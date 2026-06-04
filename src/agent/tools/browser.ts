import type { Tool, ToolInput } from '../../types/index.js';
import { isBrowserAvailable } from '../../browser/client.js';
import { navigate, extractText, screenshot, fillForm, click } from '../../browser/actions.js';
import { validateSafeUrl } from '../../utils/ssrf.js';

const UNAVAILABLE_MSG = 'Browser tools unavailable: run npm install playwright';

function unavailable(): string {
  return UNAVAILABLE_MSG;
}

const browserNavigate: Tool = {
  name: 'browser_navigate',
  description:
    'Navigate the browser to a URL and return the page title. ' +
    'Only HTTPS URLs to public hosts are permitted (SSRF guard enforced).',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The HTTPS URL to navigate to',
      },
    },
    required: ['url'],
  },
  async execute(input: ToolInput): Promise<string> {
    if (!isBrowserAvailable()) return unavailable();
    const url = input['url'] as string;
    // Belt-and-suspenders: validate before passing to actions layer
    try {
      validateSafeUrl(url);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
    try {
      const title = await navigate(url);
      return `Navigated to: ${title}`;
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  },
};

const browserExtract: Tool = {
  name: 'browser_extract',
  description:
    'Extract visible text from the current page. Optionally provide a CSS selector ' +
    'to scope extraction; defaults to the full body.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to scope extraction (default: body)',
      },
    },
    required: [],
  },
  async execute(input: ToolInput): Promise<string> {
    if (!isBrowserAvailable()) return unavailable();
    const selector = input['selector'] as string | undefined;
    try {
      return await extractText(selector);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  },
};

const browserScreenshot: Tool = {
  name: 'browser_screenshot',
  description:
    'Take a full-page screenshot of the current browser page. ' +
    'Returns a base64-encoded PNG data URL compatible with Claude vision.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_input: ToolInput): Promise<string> {
    if (!isBrowserAvailable()) return unavailable();
    try {
      const buf = await screenshot();
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  },
};

const browserFill: Tool = {
  name: 'browser_fill',
  description:
    'Fill form fields on the current page. ' +
    'Provide a map of CSS selectors to values.',
  inputSchema: {
    type: 'object',
    properties: {
      fields: {
        type: 'object',
        description: 'Map of CSS selectors to string values to fill',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['fields'],
  },
  async execute(input: ToolInput): Promise<string> {
    if (!isBrowserAvailable()) return unavailable();
    const fields = input['fields'] as Record<string, string>;
    try {
      await fillForm(fields);
      return 'Form filled';
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  },
};

const browserClick: Tool = {
  name: 'browser_click',
  description: 'Click an element on the current page identified by a CSS selector.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the element to click',
      },
    },
    required: ['selector'],
  },
  async execute(input: ToolInput): Promise<string> {
    if (!isBrowserAvailable()) return unavailable();
    const selector = input['selector'] as string;
    try {
      await click(selector);
      return `Clicked: ${selector}`;
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  },
};

export const browserTools: Tool[] = [
  browserNavigate,
  browserExtract,
  browserScreenshot,
  browserFill,
  browserClick,
];
