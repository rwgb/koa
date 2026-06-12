import { spawn, spawnSync } from 'child_process';
import https from 'https';
import type { Readable } from 'stream';
import { readCredentials } from '../config/credentials.js';

export type TtsProvider = 'say' | 'elevenlabs' | 'none';

export interface TtsConfig {
  provider: TtsProvider;
  elevenLabsVoiceId?: string;
  elevenLabsModel?: string;
  sayVoice?: string;
}

export interface TtsStream {
  stream: Readable;
  contentType: 'audio/aiff' | 'audio/mpeg';
}

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // ElevenLabs Rachel
const DEFAULT_EL_MODEL = 'eleven_turbo_v2_5';

export function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, 'code block omitted')
    .replace(/[*_`#>]/g, '')
    .slice(0, 500);
}

export async function synthesizeStream(text: string, config: TtsConfig): Promise<TtsStream> {
  if (config.provider === 'none') throw new Error('TTS not available');
  const clean = cleanText(text);
  if (config.provider === 'elevenlabs') {
    return synthesizeElevenLabs(clean, config);
  }
  return synthesizeSay(clean, config.sayVoice ?? 'Samantha');
}

function synthesizeSay(text: string, voice: string): TtsStream {
  const proc = spawn('say', ['-v', voice, '--data-format=aiff', '-o', '-', '--', text]);
  return { stream: proc.stdout as Readable, contentType: 'audio/aiff' };
}

async function synthesizeElevenLabs(text: string, config: TtsConfig): Promise<TtsStream> {
  const apiKey = readCredentials()['ELEVENLABS_API_KEY'];
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');

  const voiceId = config.elevenLabsVoiceId ?? DEFAULT_VOICE_ID;
  const modelId = config.elevenLabsModel ?? DEFAULT_EL_MODEL;
  const body = JSON.stringify({
    text,
    model_id: modelId,
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.elevenlabs.io',
        path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`ElevenLabs error: ${res.statusCode}`));
          return;
        }
        resolve({ stream: res as Readable, contentType: 'audio/mpeg' });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export function speak(text: string, config?: TtsConfig): void {
  if (config?.provider === 'none') return;
  const clean = cleanText(text);
  if (config?.provider === 'elevenlabs') {
    synthesizeElevenLabs(clean, config)
      .then(({ stream }) => { stream.resume(); })
      .catch(() => {
        spawn('say', ['-v', 'Samantha', '--', clean], { stdio: 'ignore', detached: true }).unref();
      });
    return;
  }
  spawn('say', ['-v', config?.sayVoice ?? 'Samantha', '--', clean], { stdio: 'ignore', detached: true }).unref();
}

export function isTtsAvailable(provider?: TtsProvider): boolean {
  if (provider === 'none') return false;
  if (provider === 'elevenlabs') {
    return !!readCredentials()['ELEVENLABS_API_KEY'];
  }
  try {
    return spawnSync('which', ['say']).status === 0;
  } catch {
    return false;
  }
}
