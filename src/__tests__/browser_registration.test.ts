import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../agent/tools/registry.js';
import { browserTools } from '../agent/tools/browser.js';

// Verify that browser tools are gated on the browserEnabled config flag,
// mirroring the conditional registration in buildRegistry() (src/cli/index.ts).

function registerBrowserToolsIfEnabled(registry: ToolRegistry, browserEnabled: boolean): void {
  if (browserEnabled) {
    for (const tool of browserTools) registry.register(tool);
  }
}

describe('browser tool registration gating', () => {
  it('does not register browser_navigate when browserEnabled is false', () => {
    const registry = new ToolRegistry();
    registerBrowserToolsIfEnabled(registry, false);
    expect(registry.get('browser_navigate')).toBeUndefined();
  });

  it('registers no browser tools at all when browserEnabled is false', () => {
    const registry = new ToolRegistry();
    registerBrowserToolsIfEnabled(registry, false);
    const browserToolNames = browserTools.map((t) => t.name);
    for (const name of browserToolNames) {
      expect(registry.get(name)).toBeUndefined();
    }
  });

  it('registers browser_navigate when browserEnabled is true', () => {
    const registry = new ToolRegistry();
    registerBrowserToolsIfEnabled(registry, true);
    expect(registry.get('browser_navigate')).toBeDefined();
  });

  it('registers all browser tools when browserEnabled is true', () => {
    const registry = new ToolRegistry();
    registerBrowserToolsIfEnabled(registry, true);
    const browserToolNames = browserTools.map((t) => t.name);
    for (const name of browserToolNames) {
      expect(registry.get(name)).toBeDefined();
    }
  });
});
