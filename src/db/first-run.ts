import { createTask, listTasks } from './index.js';

/**
 * Parse `- [ ] task title` and `- [x] task title` checkbox items from markdown.
 * Returns only unchecked items ([ ]) as titles to import as pending tasks.
 */
function parseCheckboxTasks(md: string): string[] {
  const lines = md.split('\n');
  const titles: string[] = [];
  for (const line of lines) {
    const match = /^[-*]\s+\[\s\]\s+(.+)$/.exec(line.trim());
    if (match && match[1]) {
      titles.push(match[1].trim());
    }
  }
  return titles;
}

/**
 * Bootstrap tasks from STATE.md and BACKLOG.md markdown files.
 * Creates tasks for any unchecked checkbox items that don't already exist.
 */
export async function bootstrapFromProjectMemory(
  projectId: string,
  stateMd: string | null,
  backlogMd: string | null,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  // Collect titles from both files, deduplicating within the import set
  const allTitles: string[] = [];
  const seen = new Set<string>();

  for (const md of [stateMd, backlogMd]) {
    if (!md) continue;
    for (const title of parseCheckboxTasks(md)) {
      const key = title.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        allTitles.push(title);
      }
    }
  }

  if (allTitles.length === 0) return { imported, skipped };

  // Load existing task titles for this project (case-insensitive comparison)
  let existingTitles: Set<string>;
  try {
    const existingTasks = listTasks({ projectId });
    existingTitles = new Set(existingTasks.map((t) => t.title.toLowerCase()));
  } catch (err) {
    process.stderr.write(
      `[koa/bootstrap] failed to load existing tasks: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    existingTitles = new Set();
  }

  for (const title of allTitles) {
    if (existingTitles.has(title.toLowerCase())) {
      skipped++;
      continue;
    }
    try {
      createTask(projectId, title);
      existingTitles.add(title.toLowerCase()); // prevent duplicates within the same import run
      imported++;
    } catch (err) {
      process.stderr.write(
        `[koa/bootstrap] failed to create task "${title}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
      skipped++;
    }
  }

  return { imported, skipped };
}
