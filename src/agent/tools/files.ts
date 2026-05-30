import fs from 'fs/promises';
import path from 'path';
import type { Tool, ToolInput } from '../../types/index.js';

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file' },
      offset: { type: 'number', description: 'Line number to start reading from (1-indexed)' },
      limit: { type: 'number', description: 'Maximum number of lines to read' },
    },
    required: ['path'],
  },
  async execute(input: ToolInput): Promise<string> {
    const filePath = input['path'] as string;
    const offset = (input['offset'] as number | undefined) ?? 1;
    const limit = input['limit'] as number | undefined;

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = offset - 1;
    const end = limit ? start + limit : lines.length;
    return lines
      .slice(start, end)
      .map((line, i) => `${start + i + 1}\t${line}`)
      .join('\n');
  },
};

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file, creating it if needed',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  async execute(input: ToolInput): Promise<string> {
    const filePath = input['path'] as string;
    const content = input['content'] as string;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return `Wrote ${content.length} bytes to ${filePath}`;
  },
};

export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Replace an exact string in a file with new content',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file' },
      old_string: { type: 'string', description: 'Exact string to find and replace' },
      new_string: { type: 'string', description: 'Replacement string' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  async execute(input: ToolInput): Promise<string> {
    const filePath = input['path'] as string;
    const oldStr = input['old_string'] as string;
    const newStr = input['new_string'] as string;

    const content = await fs.readFile(filePath, 'utf-8');
    if (!content.includes(oldStr)) {
      throw new Error(`old_string not found in ${filePath}`);
    }

    const updated = content.replace(oldStr, newStr);
    await fs.writeFile(filePath, updated, 'utf-8');
    return `Edited ${filePath}`;
  },
};

export const grepTool: Tool = {
  name: 'grep',
  description: 'Search for a pattern in files',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (regex supported)' },
      path: { type: 'string', description: 'File or directory to search in' },
      include: { type: 'string', description: 'File glob pattern to include (e.g. "*.ts")' },
    },
    required: ['pattern'],
  },
  async execute(input: ToolInput): Promise<string> {
    const { execaCommand } = await import('execa');
    const pattern = input['pattern'] as string;
    const searchPath = (input['path'] as string | undefined) ?? '.';
    const include = input['include'] as string | undefined;

    const args = ['-r', '--line-number', pattern, searchPath];
    if (include) args.push('--include', include);

    const result = await execaCommand(`grep ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
      reject: false,
    });
    return result.stdout || '(no matches)';
  },
};
