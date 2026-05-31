import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFileTools } from '../agent/tools/files.js';
import type { Tool } from '../types/index.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

let tmpDir: string;
let readFileTool: Tool;
let writeFileTool: Tool;
let editFileTool: Tool;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'koa-test-'));
  const tools = createFileTools(tmpDir);
  readFileTool = tools.find((t) => t.name === 'read_file')!;
  writeFileTool = tools.find((t) => t.name === 'write_file')!;
  editFileTool = tools.find((t) => t.name === 'edit_file')!;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('writeFileTool', () => {
  it('creates a file with given content', async () => {
    const filePath = path.join(tmpDir, 'hello.txt');
    const result = await writeFileTool.execute({ path: filePath, content: 'hello world' });
    expect(result).toContain('hello.txt');
    expect(await fs.readFile(filePath, 'utf-8')).toBe('hello world');
  });

  it('creates parent directories if needed', async () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'file.txt');
    await writeFileTool.execute({ path: filePath, content: 'deep' });
    expect(await fs.readFile(filePath, 'utf-8')).toBe('deep');
  });
});

describe('readFileTool', () => {
  it('reads a file with line numbers', async () => {
    const filePath = path.join(tmpDir, 'lines.txt');
    await fs.writeFile(filePath, 'line1\nline2\nline3');
    const result = await readFileTool.execute({ path: filePath });
    expect(result).toContain('1\tline1');
    expect(result).toContain('2\tline2');
  });

  it('respects offset and limit', async () => {
    const filePath = path.join(tmpDir, 'lines.txt');
    await fs.writeFile(filePath, 'a\nb\nc\nd\ne');
    const result = await readFileTool.execute({ path: filePath, offset: 2, limit: 2 });
    expect(result).toContain('b');
    expect(result).toContain('c');
    expect(result).not.toContain('a');
    expect(result).not.toContain('d');
  });
});

describe('sandbox enforcement', () => {
  it('blocks reads outside project root', async () => {
    await expect(
      readFileTool.execute({ path: '/etc/passwd' }),
    ).rejects.toThrow('Access denied');
  });

  it('blocks writes outside project root', async () => {
    await expect(
      writeFileTool.execute({ path: '/tmp/evil.txt', content: 'pwned' }),
    ).rejects.toThrow('Access denied');
  });

  it('blocks path traversal via ../', async () => {
    await expect(
      readFileTool.execute({ path: `${tmpDir}/../../etc/passwd` }),
    ).rejects.toThrow('Access denied');
  });
});

describe('editFileTool', () => {
  it('replaces old_string with new_string', async () => {
    const filePath = path.join(tmpDir, 'edit.ts');
    await fs.writeFile(filePath, 'const x = 1;\nconst y = 2;\n');
    await editFileTool.execute({ path: filePath, old_string: 'const x = 1;', new_string: 'const x = 99;' });
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('const x = 99;');
    expect(content).toContain('const y = 2;');
  });

  it('throws when old_string is not found', async () => {
    const filePath = path.join(tmpDir, 'edit.ts');
    await fs.writeFile(filePath, 'hello');
    await expect(
      editFileTool.execute({ path: filePath, old_string: 'NOPE', new_string: 'anything' }),
    ).rejects.toThrow('old_string not found');
  });
});
