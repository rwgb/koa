import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the MCP SDK before importing the client under test
const mockListTools = vi.fn();
const mockCallTool = vi.fn();
const mockConnect = vi.fn();
const mockClose = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    connect = mockConnect;
    close = mockClose;
    listTools = mockListTools;
    callTool = mockCallTool;
    constructor(_info: unknown, _opts: unknown) {}
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockTransport {
    constructor(_params: unknown) {}
  },
}));

import { McpClient } from '../agent/mcp/client.js';
import { McpManager } from '../agent/mcp/manager.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockClose.mockResolvedValue(undefined);
});

describe('McpClient', () => {
  it('prefixes tool name with mcp_{server}_{tool}', async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: 'echo', description: 'echoes input', inputSchema: { type: 'object', properties: {} } }],
    });
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
    });

    const client = new McpClient({ name: 'myserver', command: 'npx', args: ['myserver'] });
    await client.connect();
    const tools = await client.getTools();

    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('mcp_myserver_echo');
  });

  it('wraps non-trusted tool output with KOA_UNTRUSTED markers', async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: 'fetch', description: 'fetches a URL', inputSchema: { type: 'object', properties: {} } }],
    });
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'untrusted result' }],
    });

    const client = new McpClient({ name: 'webserver', command: 'npx', trusted: false });
    await client.connect();
    const tools = await client.getTools();
    const result = await tools[0]!.execute({});

    expect(typeof result).toBe('string');
    expect(result as string).toContain('KOA_UNTRUSTED');
    expect(result as string).toContain('untrusted result');
  });

  it('passes trusted tool output through without UNTRUSTED markers', async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: 'list_files', description: 'lists files', inputSchema: { type: 'object', properties: {} } }],
    });
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'file1.txt\nfile2.txt' }],
    });

    const client = new McpClient({ name: 'localserver', command: '/usr/local/bin/myserver', trusted: true });
    await client.connect();
    const tools = await client.getTools();
    const result = await tools[0]!.execute({});

    expect(typeof result).toBe('string');
    expect(result as string).not.toContain('KOA_UNTRUSTED');
    expect(result as string).toBe('file1.txt\nfile2.txt');
  });
});

describe('McpManager', () => {
  it('connectAll does not throw when a server fails to connect', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConnect.mockRejectedValueOnce(new Error('ENOENT: command not found'));

    const manager = new McpManager([{ name: 'broken', command: 'does-not-exist' }]);

    await expect(manager.connectAll()).resolves.not.toThrow();
    consoleErrorSpy.mockRestore();
  });

  it('returns empty tool list when no servers connected', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConnect.mockRejectedValueOnce(new Error('connection refused'));

    const manager = new McpManager([{ name: 'broken', command: 'does-not-exist' }]);
    await manager.connectAll();
    const tools = await manager.getTools();

    expect(tools).toHaveLength(0);
    consoleErrorSpy.mockRestore();
  });
});
