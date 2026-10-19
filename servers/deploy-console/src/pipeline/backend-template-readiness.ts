import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { DEFAULT_RUNTIME_ROOT } from '../deploy/runtime-root';
import type { EngineAction, EngineStep } from '../pipeline-orchestration/orchestration-engine';

export interface BackendTemplateReadinessInput {
  pipelineId: string;
  revision: number;
  moduleKey: string;
  moduleDirectory?: string;
  environment: 'dev' | 'prod';
  runtimeRoot?: string;
  orchestration: EngineStep[];
  processes: Array<{
    name: string;
    cwd: string;
    script: string;
    status: string;
    nodeEnv?: string;
    port?: number;
    healthStatus?: number;
  }>;
  currentVersion?: string | null;
}

const actionRoles = ['publish', 'record', 'sync', 'activate', 'verify'] as const;

function actionRole(action: EngineAction): string {
  if (action.name === '发布') return 'publish';
  if (action.name.startsWith('write-version ·')) return 'record';
  if (action.name.startsWith('sync ·')) return 'sync';
  if (action.name.startsWith('restart ·')) return 'activate';
  if (action.name.startsWith('verify ·')) return 'verify';
  return 'custom';
}

export function inspectBackendTemplateReadiness(input: BackendTemplateReadinessInput) {
  if (!['dev', 'prod'].includes(input.environment)) throw new Error('Explicit dev/prod environment required');
  if (!input.pipelineId || !Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('Template identity and revision required');
  const moduleDirectory = input.moduleDirectory || input.moduleKey;
  if (![input.moduleKey, moduleDirectory].every(value => /^[a-z0-9][a-z0-9-]*$/.test(value))) throw new Error('Invalid backend module identity');
  const root = path.posix.normalize(input.runtimeRoot || DEFAULT_RUNTIME_ROOT).replace(/\/+$/, '');
  if (!path.posix.isAbsolute(root) || path.posix.basename(root) !== 'web_system') throw new Error('Canonical web_system runtime root required');
  const serviceDirectory = path.posix.join(root, 'servers', moduleDirectory);
  const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
  const snapshot = input.orchestration.map(step => ({ ...step, tasks: step.tasks?.map(task => ({ ...task, actions: task.actions?.map(action => ({ id: action.id, name: action.name, enabled: action.enabled !== false, scriptSha256: sha256(action.script) })) })) }));
  const fingerprint = sha256(JSON.stringify({ pipelineId: input.pipelineId, revision: input.revision, moduleKey: input.moduleKey, moduleDirectory, environment: input.environment, root, snapshot }));
  const blockers: string[] = [];
  const tasks = input.orchestration.filter(step => step.enabled !== false).flatMap(step => step.tasks || []).filter(task => task.enabled !== false);
  const targets = tasks.filter(task => task.kind === 'script' && task.condition?.trim() === `DEPLOY_ENV == ${input.environment}`);
  const builds = tasks.filter(task => task.kind === 'script' && task.name === 'build' && !task.condition);
  if (targets.length !== 1) blockers.push('environment-task-not-unique');
  if (builds.length !== 1) blockers.push('shared-build-task-not-unique');
  if (tasks.some(task => task.env && Object.keys(task.env).some(key => ['DEPLOY_ENV', 'MODULE_KEY', 'MODULE_DIR', 'RELEASE_DIR'].includes(key)))) blockers.push('task-overrides-release-identity');
  const target = targets.length === 1 ? targets[0] : undefined;
  const actions = target?.actions?.filter(action => action.enabled !== false) || [];
  const roles = actions.map(actionRole);
  const standardShape = roles.length === actionRoles.length && roles.every((role, index) => role === actionRoles[index]);
  if (!standardShape) blockers.push('custom-action-sequence-needs-review');
  if (roles.filter(role => role === 'record').length > 1) blockers.push('duplicate-version-recorders');
  if (actions.some(action => action.script.includes('${COMMIT_ID##*/}'))) blockers.push('version-namespace-truncated');
  if (actions.some(action => action.script.includes('servers/deploy-console/.env') && action.script.includes('INTERNAL_API_KEY'))) blockers.push('target-console-credential-fallback');
  const targetStep = input.orchestration.findIndex(step => step.tasks?.some(task => task.id === target?.id));
  const precedingApproval = targetStep >= 0 && input.orchestration.slice(0, targetStep).some(step => step.enabled !== false && step.tasks?.some(task => task.kind === 'approval' && task.enabled !== false && !task.condition));
  if (!precedingApproval) blockers.push('preceding-approval-not-confirmed');
  const legacyReset = actions.some(action => /\bRROOT\b/.test(action.script) && /git\s+(?:reset\s+--hard|checkout\s+-B)/.test(action.script));
  if (legacyReset) blockers.push('legacy-runtime-reset');
  const restart = actions.find(action => actionRole(action) === 'activate');
  const boundary = '# ══ config-dispatch:end ══';
  const configurationDispatch = restart?.script.includes(boundary) ? { actionId: restart.id, prefixSha256: sha256(restart.script.slice(0, restart.script.indexOf(boundary) + boundary.length)) } : null;
  if (!configurationDispatch) blockers.push('configuration-dispatch-boundary-unconfirmed');
  const owned = input.processes.filter(process => process.script === path.posix.join(serviceDirectory, 'dist/main.js'));
  const process = owned.length === 1 ? owned[0] : undefined;
  if (!process) blockers.push('runtime-process-not-unique');
  if (process) {
    if (process.cwd !== serviceDirectory) blockers.push('service-cwd-compatibility-required');
    if (process.status !== 'online' || !Number.isInteger(process.port) || process.port! < 1 || process.port! > 65535 || !process.healthStatus || process.healthStatus < 200 || process.healthStatus >= 300) blockers.push('runtime-health-not-confirmed');
    if (input.environment === 'prod' && process.nodeEnv !== 'production') blockers.push('production-environment-not-confirmed');
  }
  if (!input.currentVersion) blockers.push('current-version-not-registered');
  else if (!/^[a-z0-9][a-z0-9-]*\/[a-f0-9]{7,40}$/.test(input.currentVersion)) blockers.push('current-version-namespace-unresolved');
  return {
    readOnly: true,
    evidence: 'snapshot-only' as const,
    canPublish: false,
    pipelineId: input.pipelineId,
    revision: input.revision,
    moduleKey: input.moduleKey,
    environment: input.environment,
    serviceDirectory,
    fingerprint,
    templateShape: standardShape ? 'standard-five-action' : 'custom-or-missing',
    configurationDispatch,
    actions: actions.map((action, index) => ({ id: action.id, name: action.name, role: roles[index], scriptSha256: sha256(action.script) })),
    process: process ? { name: process.name, cwd: process.cwd, status: process.status, port: process.port, healthStatus: process.healthStatus } : null,
    currentVersion: input.currentVersion || null,
    blockers,
    requiredChanges: ['environment-scoped-runtime-packaging', 'immutable-runtime-publication', 'preserve-namespaced-version-records', 'replace-runtime-reset-with-inspection', 'preserve-config-dispatch-before-isolated-activation', 'verify-owned-health-before-control-plane-pointer'],
    releaseGates: ['reviewed-template-revision', 'validated-candidate-and-rollback-runtime-bundles', 'candidate-schema-review', 'new-release-run-and-approval', 'module-release-and-rollback-rehearsal'],
  };
}
