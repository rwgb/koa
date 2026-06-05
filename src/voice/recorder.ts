import { spawn, spawnSync } from 'child_process';
import { EventEmitter } from 'events';

export class AudioRecorder extends EventEmitter {
  private proc: ReturnType<typeof spawn> | null = null;
  private chunks: Buffer[] = [];

  start(): void {
    this.chunks = [];
    // sox: record from default mic, 16kHz mono WAV to stdout
    this.proc = spawn('sox', [
      '-d',                    // default input device
      '-r', '16000',           // sample rate
      '-c', '1',               // mono
      '-e', 'signed-integer',
      '-b', '16',
      '-t', 'wav',
      '-',                     // stdout
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    this.proc.stdout?.on('data', (chunk: Buffer) => this.chunks.push(chunk));
    this.proc.on('error', (err) => this.emit('error', err));
  }

  stop(): Buffer {
    this.proc?.kill('SIGTERM');
    this.proc = null;
    return Buffer.concat(this.chunks);
  }

  isAvailable(): boolean {
    try {
      return spawnSync('which', ['sox']).status === 0;
    } catch {
      return false;
    }
  }
}
