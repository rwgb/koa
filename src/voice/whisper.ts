import { readCredentials } from '../config/credentials.js';

export async function transcribeAudio(audioBuffer: Buffer, mimeType = 'audio/wav'): Promise<string> {
  const creds = readCredentials();
  const apiKey = process.env['OPENAI_API_KEY'] ?? creds['OPENAI_API_KEY'];
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  if (audioBuffer.length > 25 * 1024 * 1024) throw new Error('Audio exceeds 25MB Whisper limit');

  // Use fetch directly — OpenAI Whisper API
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), 'audio.wav');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[voice/whisper] Whisper API error:', res.status, errText);
    throw new Error(`Whisper API returned an error (${res.status})`);
  }
  const data = await res.json() as { text: string };
  return data.text.trim();
}
