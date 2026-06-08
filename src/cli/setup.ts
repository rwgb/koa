import path from 'path';
import fs from 'fs';
import { createInterface } from 'readline/promises';
import {
  readKoaConfigFile,
  writeKoaConfigFile,
  generateWebToken,
  setApiKey,
  setWebToken,
} from '../config/index.js';
import { readCredentials, writeCredential } from '../config/credentials.js';
import { validateSafeUrl } from '../utils/ssrf.js';

export async function runSetupWizard(opts: { reset?: boolean; headless?: boolean }): Promise<void> {
  if (opts.headless) {
    await runHeadlessCheck();
    return;
  }

  await runInteractiveSetup(opts.reset ?? false);
}

async function runHeadlessCheck(): Promise<void> {
  const creds = readCredentials();
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? creds['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    console.error(
      'Error: ANTHROPIC_API_KEY is required\nSet it via: koa config set api-key <key>',
    );
    process.exit(1);
  }
  console.log('✓ Configuration OK');
}

async function runInteractiveSetup(reset: boolean): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Step 1 — Anthropic API key
    const existingApiKey =
      readCredentials()['ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'];
    if (existingApiKey && !reset) {
      console.log('✓ Anthropic API key already set — skipping (use --reset to overwrite)');
    } else {
      let validKey = false;
      while (!validKey) {
        const key = await rl.question('Anthropic API key (sk-ant-...): ');
        if (key.startsWith('sk-ant-') && key.length >= 20) {
          setApiKey(key);
          console.log('✓ Key format OK — will validate on first use.');
          validKey = true;
        } else {
          console.error('Invalid API key — must start with sk-ant- and be at least 20 characters.');
        }
      }
    }

    // Step 2 — Web console token
    const existingWebToken =
      readCredentials()['KOA_WEB_TOKEN'] ?? process.env['KOA_WEB_TOKEN'];
    if (existingWebToken && !reset) {
      console.log('✓ Web token already set — skipping');
    } else {
      let tokenSaved = false;
      while (!tokenSaved) {
        const input = await rl.question('Web console token [(G)enerate / paste custom]: ');
        if (input === '' || input.toLowerCase().startsWith('g')) {
          const token = generateWebToken();
          setWebToken(token);
          console.log('✓ Generated web token.');
          tokenSaved = true;
        } else if (input.length >= 16) {
          setWebToken(input);
          tokenSaved = true;
        } else {
          console.error('Token must be at least 16 characters.');
        }
      }
    }

    // Step 3 — Your name
    const existingName = readKoaConfigFile().userName;
    if (existingName && existingName !== 'User' && !reset) {
      console.log('✓ Name already set — skipping');
    } else {
      const input = await rl.question('Your name [User]: ');
      const name = input.trim() === '' ? 'User' : input.trim();
      writeKoaConfigFile({ userName: name });
      console.log(`✓ Name set to "${name}"`);
    }

    // Step 4 — ntfy notifications
    const existingNtfyTopic = readCredentials()['NTFY_TOPIC'];
    if (existingNtfyTopic && !reset) {
      console.log('✓ ntfy already configured — skipping');
    } else {
      const topicInput = await rl.question('ntfy topic (leave blank to skip): ');
      if (topicInput.trim() === '') {
        console.log('  Skipping ntfy.');
      } else {
        let validTopic = false;
        let topic = topicInput.trim();
        while (!validTopic) {
          if (/^[a-zA-Z0-9_-]+$/.test(topic)) {
            validTopic = true;
          } else {
            console.error('Invalid topic — only letters, numbers, underscores, and hyphens are allowed.');
            topic = (await rl.question('ntfy topic (leave blank to skip): ')).trim();
            if (topic === '') {
              console.log('  Skipping ntfy.');
              break;
            }
          }
        }

        if (validTopic) {
          let validUrl = false;
          let url = '';
          while (!validUrl) {
            const urlInput = await rl.question('ntfy server URL [https://ntfy.sh]: ');
            url = urlInput.trim() === '' ? 'https://ntfy.sh' : urlInput.trim();
            try {
              validateSafeUrl(url);
              validUrl = true;
            } catch (err) {
              console.error(
                `Invalid URL: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
          writeCredential('NTFY_TOPIC', topic);
          writeCredential('NTFY_BASE_URL', url);
          console.log(`✓ ntfy configured (${url}/${topic})`);
        }
      }
    }

    // Step 5 — Default project path
    const existingProjectPath = readKoaConfigFile().defaultProjectPath;
    if (existingProjectPath && !reset) {
      console.log('✓ Default project path already set — skipping');
    } else {
      let pathSaved = false;
      while (!pathSaved) {
        const input = await rl.question(
          'Default project path (leave blank to use cwd each time): ',
        );
        if (input.trim() === '') {
          pathSaved = true;
        } else {
          const resolved = path.resolve(input.trim());
          if (fs.existsSync(resolved)) {
            writeKoaConfigFile({ defaultProjectPath: resolved });
            console.log(`✓ Default project path set to "${resolved}"`);
            pathSaved = true;
          } else {
            console.error(`Path does not exist: ${resolved}`);
          }
        }
      }
    }
  } finally {
    rl.close();
  }

  console.log("\nSetup complete. Run 'koa chat' to start.");
}
