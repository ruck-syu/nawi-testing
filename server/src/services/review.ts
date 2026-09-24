import { get } from '../db/index.ts';
import { forbidden, notFound, type Ctx } from '../http.ts';

export type ReviewStage = 'draft' | 'reviewed' | 'approved';

interface ProjectStageRow {
  id: number;
  status: ReviewStage;
}

export async function requireProjectStage(projectId: number): Promise<ProjectStageRow> {
  const project = await get<ProjectStageRow>('SELECT id, status FROM project WHERE id = ?', [projectId]);
  if (!project) throw notFound(`Project ${projectId} not found`);
  return project;
}

/** Report data is lab-editable (technician or admin) until the admin approves it. */
export async function requireEditableProject(projectId: number, ctx: Ctx): Promise<ProjectStageRow> {
  const project = await requireProjectStage(projectId);
  if (!ctx.user) {
    throw forbidden('Authentication required.');
  }
  if (project.status === 'approved') {
    throw forbidden('Approved reports are read-only.');
  }
  return project;
}
