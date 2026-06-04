import { getForecastData, listProjects } from '../db/index.js';

export interface ProjectForecast {
  projectId: string;
  projectName: string;
  estimatedTotal: number;
  actualTotal: number;
  ratio: number;      // actual / estimated (>1 = over, <1 = under)
  taskCount: number;
}

export interface ForecastSummary {
  projects: ProjectForecast[];
  globalRatio: number | null;
  globalEstimated: number;
  globalActual: number;
  globalTaskCount: number;
}

export function computeForecast(projectId?: string): ForecastSummary {
  const projects = listProjects();
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  const rows = getForecastData(projectId);

  // Group by project
  const byProject = new Map<string, { estimated: number; actual: number; count: number }>();
  for (const row of rows) {
    const entry = byProject.get(row.project_id) ?? { estimated: 0, actual: 0, count: 0 };
    entry.estimated += row.effort_hours;
    entry.actual += row.actual_hours;
    entry.count++;
    byProject.set(row.project_id, entry);
  }

  const projectForecasts: ProjectForecast[] = [];
  let globalEstimated = 0;
  let globalActual = 0;
  let globalTaskCount = 0;

  for (const [pid, data] of byProject) {
    const ratio = data.estimated > 0 ? data.actual / data.estimated : 0;
    projectForecasts.push({
      projectId: pid,
      projectName: projectMap.get(pid) ?? pid,
      estimatedTotal: data.estimated,
      actualTotal: data.actual,
      ratio,
      taskCount: data.count,
    });
    globalEstimated += data.estimated;
    globalActual += data.actual;
    globalTaskCount += data.count;
  }

  projectForecasts.sort((a, b) => b.taskCount - a.taskCount);

  const globalRatio = globalEstimated > 0 ? globalActual / globalEstimated : null;

  return {
    projects: projectForecasts,
    globalRatio,
    globalEstimated,
    globalActual,
    globalTaskCount,
  };
}

export function buildForecastSummaryText(summary: ForecastSummary): string {
  if (summary.globalTaskCount === 0) {
    return 'No forecasting data yet — log actual_hours on completed tasks to enable estimates.';
  }

  const parts: string[] = ['## Effort Forecasting'];

  if (summary.globalRatio !== null) {
    const pct = Math.round((summary.globalRatio - 1) * 100);
    const direction = pct > 0 ? `${pct}% over` : pct < 0 ? `${Math.abs(pct)}% under` : 'on';
    parts.push(`Overall: tasks take ${direction} estimate (${summary.globalTaskCount} completed tasks with time data).`);
    parts.push(`Total: ${summary.globalActual.toFixed(1)}h actual vs ${summary.globalEstimated.toFixed(1)}h estimated.`);
  }

  for (const p of summary.projects.slice(0, 3)) {
    if (p.taskCount === 0) continue;
    const pct = Math.round((p.ratio - 1) * 100);
    const direction = pct > 0 ? `${pct}% over` : pct < 0 ? `${Math.abs(pct)}% under` : 'on';
    parts.push(`- **${p.projectName}**: ${direction} estimate (${p.taskCount} tasks)`);
  }

  return parts.join('\n');
}
