#!/usr/bin/env node
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from '../tui/App.js';
import { AgentLoop } from '../agent/loop.js';
import { ToolRegistry } from '../agent/tools/registry.js';
import { bashTool } from '../agent/tools/bash.js';
import { createFileTools } from '../agent/tools/files.js';
import { createEngramTool } from '../agent/tools/engram_tool.js';
import { EngramClient } from '../engram/client.js';
import { loadConfig } from '../config/index.js';
import { UsageTracker } from '../agent/usage.js';

function buildRegistry(engram: EngramClient, projectRoot: string): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(bashTool);
  for (const tool of createFileTools(projectRoot)) registry.register(tool);
  registry.register(createEngramTool(engram));
  return registry;
}

const program = new Command();

program
  .name('koa')
  .description('Engram-aware Claude agent CLI')
  .version('0.1.0');

program
  .command('chat', { isDefault: true })
  .description('Start an interactive chat session')
  .option('-p, --project <path>', 'Project path (defaults to cwd)')
  .option('-m, --model <model>', 'Claude model to use')
  .option('--no-engram', 'Disable Engram memory integration')
  .action(async (opts: { project?: string; model?: string; engram: boolean }) => {
    const config = loadConfig(opts.project);
    if (opts.model) config.model = opts.model;
    if (!opts.engram) config.engramEnabled = false;

    if (!config.apiKey) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      process.exit(1);
    }

    const engram = new EngramClient(config.projectPath);
    const registry = buildRegistry(engram, config.projectPath);
    const loop = new AgentLoop(config, registry, engram, new UsageTracker());
    await loop.initialize();

    const engramContext = loop.getState().engramContext;

    const { waitUntilExit } = render(
      React.createElement(App, { loop, config, engramContext }),
      { exitOnCtrlC: false },
    );

    await waitUntilExit();
    await loop.finalize();
  });

program
  .command('query <terms>')
  .description('Query Engram memory for this project')
  .option('-p, --project <path>', 'Project path (defaults to cwd)')
  .action(async (terms: string, opts: { project?: string }) => {
    const config = loadConfig(opts.project);
    const engram = new EngramClient(config.projectPath);
    const result = await engram.query(terms);
    console.log(result || '(no results)');
  });

program
  .command('web')
  .description('Start the Koa web console')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('--no-open', 'Do not open browser automatically')
  .option('--project <path>', 'Project path (defaults to cwd)')
  .option('-m, --model <model>', 'Claude model to use')
  .action(async (opts: { port: string; open: boolean; project?: string; model?: string }) => {
    const config = loadConfig(opts.project);
    if (opts.model) config.model = opts.model;

    if (!config.apiKey) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      process.exit(1);
    }

    const engram = new EngramClient(config.projectPath);
    const registry = buildRegistry(engram, config.projectPath);
    const loop = new AgentLoop(config, registry, engram, new UsageTracker());
    await loop.initialize();

    const { createServer } = await import('../server/index.js');
    const app = createServer(loop, config);
    const port = parseInt(opts.port, 10);

    app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`Koa web console → ${url}`);
      if (opts.open) {
        import('open').then(({ default: open }) => open(url)).catch(() => {});
      }
    });

    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await loop.finalize();
      process.exit(0);
    });
  });

program
  .command('mcp')
  .description('Start Koa as an MCP tool server on stdio (for Claude Desktop)')
  .option('-p, --project <path>', 'Project root path (defaults to cwd)')
  .option('--no-engram', 'Disable Engram memory integration')
  .action(async (opts: { project?: string; engram: boolean }) => {
    const config = loadConfig(opts.project);
    if (!opts.engram) config.engramEnabled = false;
    const engram = new EngramClient(config.projectPath);
    const registry = buildRegistry(engram, config.projectPath);
    if (config.engramEnabled) {
      await engram.sync().catch(() => {});
    }
    const { createMcpServer, startMcpServer } = await import('../server/mcp.js');
    const server = createMcpServer(registry, config.projectPath);
    await startMcpServer(server);
  });

program.parse(process.argv);
