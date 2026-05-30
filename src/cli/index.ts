#!/usr/bin/env node
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from '../tui/App.js';
import { AgentLoop } from '../agent/loop.js';
import { ToolRegistry } from '../agent/tools/registry.js';
import { bashTool } from '../agent/tools/bash.js';
import { readFileTool, writeFileTool, editFileTool, grepTool } from '../agent/tools/files.js';
import { createEngramTool } from '../agent/tools/engram_tool.js';
import { EngramClient } from '../engram/client.js';
import { loadConfig } from '../config/index.js';

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
    const registry = new ToolRegistry();

    registry.register(bashTool);
    registry.register(readFileTool);
    registry.register(writeFileTool);
    registry.register(editFileTool);
    registry.register(grepTool);
    registry.register(createEngramTool(engram));

    const loop = new AgentLoop(config, registry, engram);
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

program.parse(process.argv);
