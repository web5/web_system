import { FindOptionsWhere, IsNull, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { DeployPipelineEntity } from '../entities/deploy-pipeline.entity';
import { assertRunAfterWorkspaceCutover } from '../git/workspace-safety';

export function submissionConflictWhere(input: { env: string; moduleKey: string; configuredCutover?: unknown }): FindOptionsWhere<DeployPipelineEntity>[] {
  const scope = { env: input.env, moduleKey: input.moduleKey };
  const configured = String(input.configuredCutover ?? '').trim();
  assertRunAfterWorkspaceCutover(Date.now(), input.configuredCutover);
  const approvals = ['pending-approval', 'awaiting-approval'];
  const live: FindOptionsWhere<DeployPipelineEntity>[] = ['pending', 'running'].map(status => ({ ...scope, status }));
  if (!configured) return [...live, ...approvals.map(status => ({ ...scope, status }))];
  const cutover = Number(configured);
  return [...live, ...approvals.flatMap(status => [
    { ...scope, status, startTime: MoreThanOrEqual(cutover) },
    { ...scope, status, startTime: LessThanOrEqual(0) },
    { ...scope, status, startTime: IsNull() },
  ])];
}
