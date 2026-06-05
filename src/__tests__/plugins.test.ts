import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadPlugins } from '../plugins/loader.js';
import { createPluginTool } from '../plugins/bridge.js';

describe('loadPlugins', () => {
  let tmpDir: string;
  let origKoaHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-plugins-test-'));
    fs.mkdirSync(path.join(tmpDir, 'plugins'));
    origKoaHome = process.env['KOA_HOME'];
    process.env['KOA_HOME'] = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
    if (origKoaHome === undefined) delete process.env['KOA_HOME'];
    else process.env['KOA_HOME'] = origKoaHome;
  });

  it('returns empty array when plugins directory does not exist', () => {
    fs.rmdirSync(path.join(tmpDir, 'plugins'));
    expect(loadPlugins()).toEqual([]);
  });

  it('loads a valid bash plugin manifest', () => {
    const manifest = {
      name: 'my_plugin',
      version: '1.0.0',
      description: 'A test plugin',
      tools: [{
        name: 'my_tool',
        description: 'Does something',
        transport: 'bash',
        config: { command: 'echo hello' },
      }],
    };
    fs.writeFileSync(path.join(tmpDir, 'plugins', 'my_plugin.json'), JSON.stringify(manifest));
    const plugins = loadPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.name).toBe('my_plugin');
    expect(plugins[0]!.tools).toHaveLength(1);
    expect(plugins[0]!.tools[0]!.name).toBe('my_tool');
  });

  it('skips invalid JSON files with a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(path.join(tmpDir, 'plugins', 'bad.json'), 'not json {{{');
    const plugins = loadPlugins();
    expect(plugins).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[plugins] Skipping bad.json'));
    warnSpy.mockRestore();
  });

  it('skips manifests failing Zod validation', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { name: 'ok', tools: [{ name: 'bad name!', transport: 'bash', config: {} }] };
    fs.writeFileSync(path.join(tmpDir, 'plugins', 'bad.json'), JSON.stringify(bad));
    const plugins = loadPlugins();
    expect(plugins).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('loads valid manifest and ignores non-.json files', () => {
    const manifest = {
      name: 'p',
      tools: [{ name: 'my_bash', description: 'x', transport: 'bash', config: { command: 'ls' } }],
    };
    fs.writeFileSync(path.join(tmpDir, 'plugins', 'good.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(tmpDir, 'plugins', 'readme.md'), 'ignore me');
    const plugins = loadPlugins();
    expect(plugins).toHaveLength(1);
  });
});

describe('createPluginTool', () => {
  it('creates a bash tool that executes the command', async () => {
    const tool = createPluginTool({
      name: 'echo_tool',
      description: 'Echoes input',
      transport: 'bash',
      config: { command: 'echo hello' },
    });
    expect(tool.name).toBe('echo_tool');
    expect(tool.source).toBe('plugin');
    const result = await tool.execute({});
    expect(result).toContain('hello');
  });

  it('creates an mcp stub tool that returns unsupported message', async () => {
    const tool = createPluginTool({
      name: 'mcp_tool',
      description: 'MCP tool',
      transport: 'mcp',
      config: {},
    });
    expect(tool.source).toBe('plugin');
    const result = await tool.execute({});
    expect(result).toContain('not yet supported');
  });
});
