#!/usr/bin/env -S node --no-deprecation
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from '../tui/App.js';
import { AgentLoop } from '../agent/loop.js';
import { ToolRegistry } from '../agent/tools/registry.js';
import { bashTool } from '../agent/tools/bash.js';
import { createFileTools } from '../agent/tools/files.js';
import { createEngramTool } from '../agent/tools/engram_tool.js';
import { createSpiderBrainTools } from '../agent/tools/spiderbrain_tools.js';
import { createRememberTool, forgetTool } from '../agent/tools/memory_tool.js';
import { createAgentDispatchTool } from '../agent/tools/agent_dispatch_tool.js';
import { webFetchTool } from '../agent/tools/web_fetch.js';
import { webSearchTool } from '../agent/tools/web_search.js';
import { createCalendarEventTool, updateCalendarEventTool, deleteCalendarEventTool } from '../agent/tools/calendar_write.js';
import { sendEmailTool } from '../agent/tools/send_email.js';
import { githubTools } from '../agent/tools/github.js';
import { createCustomSkillTool } from '../agent/tools/custom_skill_tool.js';
import { createExecuteCodeTool } from '../agent/tools/execute_code.js';
import { browserTools } from '../agent/tools/browser.js';
import { crossRepoTools } from '../agent/tools/cross_repo.js';
import { loadCustomSkills } from '../skills/store.js';
import { loadPlugins } from '../plugins/loader.js';
import { createPluginTool } from '../plugins/bridge.js';
import { EngramClient } from '../engram/client.js';
import { SpiderBrainClient } from '../spiderbrain/client.js';
import { loadConfig, writeKoaConfigFile, generateWebToken, setWebToken } from '../config/index.js';
import type { KoaConfig } from '../config/index.js';
import { createRunner } from '../sandbox/index.js';
import { UsageTracker } from '../agent/usage.js';
import { writeCredential, deleteCredential, readCredentials, getCredentialsPath } from '../config/credentials.js';

function buildRegistry(
  engram: EngramClient,
  projectRoot: string,
  sb: SpiderBrainClient,
  config: KoaConfig,
): ToolRegistry {
  const apiKey = config.apiKey;
  const registry = new ToolRegistry();
  registry.register(bashTool);
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(createCalendarEventTool);
  registry.register(updateCalendarEventTool);
  registry.register(deleteCalendarEventTool);
  registry.register(sendEmailTool);
  for (const tool of githubTools) registry.register(tool);
  for (const tool of createFileTools(projectRoot)) registry.register(tool);
  registry.register(createEngramTool(engram));
  registry.register(createRememberTool(config.userName ?? 'User'));
  registry.register(forgetTool);
  registry.register(createAgentDispatchTool(projectRoot, apiKey));
  registry.register(createExecuteCodeTool(createRunner(config), config));
  for (const tool of browserTools) registry.register(tool);
  for (const tool of crossRepoTools) registry.register(tool);
  for (const skill of loadCustomSkills()) registry.register(createCustomSkillTool(skill));
  for (const plugin of loadPlugins()) {
    registry.registerMany(plugin.tools.map(createPluginTool));
  }
  if (sb.isAvailable()) {
    for (const tool of createSpiderBrainTools(sb)) registry.register(tool);
  }
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
  .option('-m, --model <model>', 'Claude model to use (fast|standard|powerful or full model name)')
  .option('--no-engram', 'Disable Engram memory integration')
  .option('--no-cache', 'Disable response cache')
  .option('--checkpoint-turns <n>', 'Auto-checkpoint every N turns (0=off)', parseInt)
  .option('--checkpoint-minutes <n>', 'Auto-checkpoint every N minutes (0=off)', parseInt)
  .option('--provider <provider>', 'LLM provider: anthropic or ollama')
  .action(async (opts: { project?: string; model?: string; engram: boolean; cache: boolean; checkpointTurns?: number; checkpointMinutes?: number; provider?: string }) => {
    const config = loadConfig(opts.project);
    // Persist explicit --project as the default so bare `koa` always loads the same context.
    if (opts.project) {
      writeKoaConfigFile({ defaultProjectPath: config.projectPath });
      process.stderr.write(`[koa] default project set to ${config.projectPath}\n`);
    }
    if (opts.model) config.model = opts.model;
    if (!opts.engram) config.engramEnabled = false;
    if (!opts.cache) config.noCache = true;
    if (opts.checkpointTurns !== undefined) config.autoCheckpointTurns = opts.checkpointTurns;
    if (opts.checkpointMinutes !== undefined) config.autoCheckpointMinutes = opts.checkpointMinutes;
    if (opts.provider === 'anthropic' || opts.provider === 'ollama') {
      config.provider = opts.provider;
    }

    if (config.provider !== 'ollama' && !config.apiKey) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      process.exit(1);
    }

    const engram = new EngramClient(config.projectPath);
    const sb = new SpiderBrainClient(config.projectPath, config.spiderBrainBrain, process.cwd());
    const registry = buildRegistry(engram, config.projectPath, sb, config);
    const loop = new AgentLoop(config, registry, engram, new UsageTracker(), sb);
    await loop.initialize();

    const engramContext = loop.getState().engramContext;

    // Suppress stderr writes while Ink is running. Every process.stderr.write call
    // in loop.ts / engram / spiderbrain moves the terminal cursor, causing Ink to
    // lose its render position and re-print the entire layout below itself on each turn.
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: () => boolean }).write = () => true;

    const { waitUntilExit } = render(
      React.createElement(App, { loop, config, engramContext }),
      { exitOnCtrlC: false },
    );

    await waitUntilExit();
    process.stderr.write = origStderrWrite;
    // finalize() already ran inside App.tsx quit() before exit() was called.
    // process.exit() is required here because the Anthropic SDK's HTTP keep-alive
    // connections hold the Node event loop open indefinitely after Ink exits.
    process.exit(0);
  });

program
  .command('voice')
  .description('Push-to-talk voice interface (requires sox + OPENAI_API_KEY)')
  .option('-p, --project <path>', 'Project path (defaults to cwd)')
  .option('-m, --model <model>', 'Claude model to use')
  .action(async (opts: { project?: string; model?: string }) => {
    const config = loadConfig(opts.project);
    if (opts.model) config.model = opts.model;

    if (!config.apiKey) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      process.exit(1);
    }

    const { AudioRecorder } = await import('../voice/recorder.js');
    const { transcribeAudio } = await import('../voice/whisper.js');
    const { speak, isTtsAvailable } = await import('../voice/tts.js');

    const recorder = new AudioRecorder();
    if (!recorder.isAvailable()) {
      console.error('Error: sox not found. Install with: brew install sox');
      process.exit(1);
    }
    if (!isTtsAvailable()) {
      console.warn('Warning: say command not found — TTS disabled');
    }

    const engram = new EngramClient(config.projectPath);
    const sb = new SpiderBrainClient(config.projectPath, config.spiderBrainBrain, process.cwd());
    const registry = buildRegistry(engram, config.projectPath, sb, config);
    const loop = new AgentLoop(config, registry, engram, new UsageTracker(), sb);
    await loop.initialize();

    console.log('Koa voice ready. Hold ENTER to record, release to send. Ctrl+C to quit.\n');

    // Simple push-to-talk: ENTER down = record, ENTER up = send
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let recording = false;

    process.stdin.on('data', async (key: Buffer) => {
      const code = key[0];
      // ENTER (13) or SPACE (32): toggle record
      if (code === 13 || code === 32) {
        if (!recording) {
          recording = true;
          process.stdout.write('Recording… (press ENTER/SPACE to send)\n');
          recorder.start();
        } else {
          recording = false;
          const audio = recorder.stop();
          if (audio.length < 1000) {
            process.stdout.write('(too short — try again)\n');
            return;
          }
          process.stdout.write('Transcribing…\n');
          let text: string;
          try {
            text = await transcribeAudio(audio);
          } catch (err) {
            process.stdout.write(`Transcription failed: ${err instanceof Error ? err.message : String(err)}\n`);
            return;
          }
          process.stdout.write(`You: ${text}\n`);
          process.stdout.write('Koa: ');
          let response = '';
          const result = await loop.turn(text, {
            onTextDelta: (delta) => {
              process.stdout.write(delta);
              response += delta;
            },
          });
          process.stdout.write('\n');
          speak(result.content || response);
        }
      }
      // Ctrl+C (3): exit
      if (code === 3) {
        await loop.finalize();
        process.exit(0);
      }
    });
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
  .option('-m, --model <model>', 'Claude model to use (fast|standard|powerful or full model name)')
  .option('--no-cache', 'Disable response cache')
  .option('--checkpoint-turns <n>', 'Auto-checkpoint every N turns (0=off)', parseInt)
  .option('--checkpoint-minutes <n>', 'Auto-checkpoint every N minutes (0=off)', parseInt)
  .action(async (opts: { port: string; open: boolean; project?: string; model?: string; cache: boolean; checkpointTurns?: number; checkpointMinutes?: number }) => {
    const config = loadConfig(opts.project);
    if (opts.model) config.model = opts.model;
    if (!opts.cache) config.noCache = true;
    if (opts.checkpointTurns !== undefined) config.autoCheckpointTurns = opts.checkpointTurns;
    if (opts.checkpointMinutes !== undefined) config.autoCheckpointMinutes = opts.checkpointMinutes;

    if (!config.apiKey) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      process.exit(1);
    }

    const engram = new EngramClient(config.projectPath);
    const sb = new SpiderBrainClient(config.projectPath, config.spiderBrainBrain);
    const registry = buildRegistry(engram, config.projectPath, sb, config);
    const loop = new AgentLoop(config, registry, engram, new UsageTracker(), sb);
    await loop.initialize();

    const { createServer } = await import('../server/index.js');
    const { app, getTelegramPoller } = createServer(loop, config);
    const port = parseInt(opts.port, 10);

    app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`Koa web console → ${url}`);
      if (opts.open) {
        import('open').then(({ default: open }) => open(url)).catch(() => {});
      }
    });

    const shutdown = async () => {
      console.log('\nShutting down...');
      const { gmailPoller } = await import('../channels/gmail.js');
      const { calendarSync } = await import('../calendar/sync.js');
      const { escalationScheduler } = await import('../notifications/escalation.js');
      gmailPoller.stop();
      calendarSync.stop();
      escalationScheduler.stop();
      getTelegramPoller()?.stop();
      await loop.finalize();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
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
    const sb = new SpiderBrainClient(config.projectPath, config.spiderBrainBrain);
    const registry = buildRegistry(engram, config.projectPath, sb, config);
    if (config.engramEnabled) {
      await engram.sync().catch(() => {});
    }
    const { createMcpServer, startMcpServer } = await import('../server/mcp.js');
    const server = createMcpServer(registry, config.projectPath);
    await startMcpServer(server);
  });

const configCmd = program
  .command('config')
  .description('Manage Koa configuration and credentials');

configCmd
  .command('set <key> [value]')
  .description('Persist a configuration value (e.g. api-key sk-ant-...). Omit value for web-token to auto-generate.')
  .action((key: string, value: string | undefined) => {
    if (key === 'web-token') {
      const token = value ?? generateWebToken();
      setWebToken(token);
      console.log(`Web token saved to ${getCredentialsPath()}`);
      if (!value) console.log(`Generated token: ${token}`);
      return;
    }
    if (value === undefined) {
      console.error(`Error: value required for key "${key}"`);
      process.exit(1);
    }
    const credKey = key === 'api-key' ? 'ANTHROPIC_API_KEY' : key;
    writeCredential(credKey, value);
    console.log(`Saved ${key} to ${getCredentialsPath()}`);
  });

configCmd
  .command('unset <key>')
  .description('Remove a persisted configuration value')
  .action((key: string) => {
    const credKey =
      key === 'api-key' ? 'ANTHROPIC_API_KEY' : key === 'web-token' ? 'KOA_WEB_TOKEN' : key;
    if (deleteCredential(credKey)) {
      console.log(`Removed ${key} from ${getCredentialsPath()}`);
    } else {
      console.error(`Error: "${key}" not found in ${getCredentialsPath()} — nothing removed`);
      process.exit(1);
    }
  });

configCmd
  .command('show')
  .description('Show current configuration (credentials are masked)')
  .action(() => {
    const credentials = readCredentials();
    const apiKey = process.env['ANTHROPIC_API_KEY'] ?? credentials['ANTHROPIC_API_KEY'];
    const source = process.env['ANTHROPIC_API_KEY']
      ? 'env'
      : credentials['ANTHROPIC_API_KEY']
        ? getCredentialsPath()
        : 'not set';

    const masked = apiKey
      ? `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`
      : '(not set)';

    console.log(`ANTHROPIC_API_KEY  ${masked}  [${source}]`);
    console.log(`Credentials file   ${getCredentialsPath()}`);
  });

program
  .command('setup')
  .description('Interactive first-run setup wizard')
  .option('--reset', 'Re-prompt for all values even if already set')
  .option('--headless', 'Validate T1 credentials only; exit 1 if missing (for Docker/CI)')
  .action(async (opts: { reset?: boolean; headless?: boolean }) => {
    const { runSetupWizard } = await import('./setup.js');
    await runSetupWizard(opts);
  });

program
  .command('doctor')
  .description('Diagnose and optionally fix stale ~/.koa/config.json entries')
  .option('--fix', 'Back up config and rewrite to canonical format')
  .action(async (opts: { fix?: boolean }) => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');

    // KOA_HOME redirects the config dir (Docker/systemd) — same convention as credentials.ts.
    const configPath = path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'config.json');
    if (!fs.existsSync(configPath)) {
      console.log('No config file found at', configPath);
      return;
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      console.error('Could not parse config.json — file may be corrupt.');
      process.exit(1);
    }

    const issues: Array<{ field: string; description: string; fix: (cfg: Record<string, unknown>) => void }> = [];

    if ('smartRouting' in raw) {
      issues.push({
        field: 'smartRouting',
        description: raw['smartRouting'] === true
          ? 'smartRouting: true — migrate to provider: "auto"'
          : 'smartRouting field is obsolete — removing',
        fix: (cfg) => {
          if (cfg['smartRouting'] === true && !('provider' in cfg)) cfg['provider'] = 'auto';
          delete cfg['smartRouting'];
        },
      });
    }
    if ('compactAfterTurns' in raw) {
      issues.push({
        field: 'compactAfterTurns',
        description: 'compactAfterTurns is a dead config field — removing',
        fix: (cfg) => { delete cfg['compactAfterTurns']; },
      });
    }

    if (issues.length === 0) {
      console.log('Config looks clean. No issues found.');
      return;
    }

    console.log(`Found ${issues.length} issue(s):`);
    for (const issue of issues) console.log(`  • ${issue.description}`);

    if (!opts.fix) {
      console.log("\nRun 'koa doctor --fix' to automatically apply these fixes.");
      return;
    }

    // --fix path: backup + atomic write
    const backup = configPath + '.bak';
    fs.copyFileSync(configPath, backup);
    const updated = { ...raw };
    for (const issue of issues) issue.fix(updated);
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, configPath);
    console.log(`Fixed ${issues.length} issue(s). Backup saved to ${backup}`);
  });

program
  .command('update')
  .description('Update Koa: git pull + rebuild, with automatic rollback if the build or tests fail')
  .option('--check', 'Report whether an update is available without applying it')
  .option('--no-test', 'Skip the vitest verification step after building')
  .option('--force', 'Proceed even if guards (e.g. dirty worktree) would normally block')
  .action(async (opts: { check?: boolean; test: boolean; force?: boolean }) => {
    const { runUpdate } = await import('../updater/index.js');
    const result = await runUpdate({
      check: opts.check ?? false,
      test: opts.test,
      force: opts.force ?? false,
      log: (msg) => console.log(msg),
    });
    console.log(result.message);
    if (result.status === 'blocked' || result.status === 'rolled-back' || result.status === 'error') {
      process.exit(1);
    }
  });

program.parse(process.argv);
