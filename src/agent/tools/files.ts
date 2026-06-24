import fs from 'fs/promises';
import path from 'path';
import type { Tool, ToolInput, ToolResultContent } from '../../types/index.js';

const IMAGE_TYPES: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function sandboxPath(rawPath: string, projectRoot: string): string {
  const resolved = path.resolve(rawPath);
  const root = path.resolve(projectRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Access denied: path is outside project root (${root})`);
  }
  return resolved;
}

export function createFileTools(projectRoot: string): Tool[] {
  const readFileTool: Tool = {
    name: 'read_file',
    description: 'Read the contents of a file within the project',
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
      const filePath = sandboxPath(input['path'] as string, projectRoot);
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

  const writeFileTool: Tool = {
    name: 'write_file',
    description: 'Write content to a file within the project, creating it if needed',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    async execute(input: ToolInput): Promise<string> {
      const filePath = sandboxPath(input['path'] as string, projectRoot);
      const content = input['content'] as string;
      const dir = path.dirname(filePath);
      sandboxPath(dir, projectRoot);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return `Wrote ${content.length} bytes to ${filePath}`;
    },
  };

  const editFileTool: Tool = {
    name: 'edit_file',
    description: 'Replace an exact string in a file within the project',
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
      const filePath = sandboxPath(input['path'] as string, projectRoot);
      const oldStr = input['old_string'] as string;
      const newStr = input['new_string'] as string;

      const content = await fs.readFile(filePath, 'utf-8');
      if (!content.includes(oldStr)) {
        throw new Error(`old_string not found in file`);
      }

      const updated = content.replace(oldStr, newStr);
      await fs.writeFile(filePath, updated, 'utf-8');
      return `Edited ${path.relative(projectRoot, filePath)}`;
    },
  };

  const grepTool: Tool = {
    name: 'grep',
    description: 'Search for a pattern in files within the project',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex supported)' },
        path: { type: 'string', description: 'File or directory to search in (defaults to project root)' },
        include: { type: 'string', description: 'File glob pattern to include (e.g. "*.ts")' },
      },
      required: ['pattern'],
    },
    async execute(input: ToolInput): Promise<string> {
      const { execa } = await import('execa');
      const pattern = input['pattern'] as string;
      const rawSearch = (input['path'] as string | undefined) ?? projectRoot;
      const searchPath = sandboxPath(rawSearch, projectRoot);
      const include = input['include'] as string | undefined;

      const args = ['-r', '--line-number', pattern, searchPath];
      if (include) args.push('--include', include);

      const result = await execa('grep', args, { reject: false });
      return result.stdout || '(no matches)';
    },
  };

  const analyzeImageTool: Tool = {
    name: 'analyze_image',
    description:
      'Read an image file from within the project directory and return it for visual analysis. The image path must be inside the project root. Supported types: jpg, jpeg, png, gif, webp.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the image file (must be within the project directory)' },
      },
      required: ['path'],
    },
    async execute(input: ToolInput): Promise<ToolResultContent> {
      const resolved = path.resolve(input['path'] as string);
      // Enforce sandbox — throws if path escapes the project root
      const filePath = sandboxPath(resolved, projectRoot);
      console.log(`[analyze_image] path=${filePath}`);
      const ext = path.extname(filePath).toLowerCase();
      const mediaType = IMAGE_TYPES[ext];
      if (!mediaType) {
        return `Unsupported image type "${ext}". Supported: ${Object.keys(IMAGE_TYPES).join(', ')}`;
      }
      const data = await fs.readFile(filePath);
      return [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: data.toString('base64') } },
        { type: 'text', text: `Image loaded from ${filePath}` },
      ];
    },
  };

  return [readFileTool, writeFileTool, editFileTool, grepTool, analyzeImageTool];
}
