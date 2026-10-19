import { inspectBackendTemplateReadiness, type BackendTemplateReadinessInput } from './backend-template-readiness';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const plannerPath = path.resolve(__dirname, '../../../../scripts/plan-backend-template-migration.cjs');
const { createReadinessReport } = require(plannerPath);

function sample(): BackendTemplateReadinessInput {
  return {
    pipelineId: 'tpl-todo-service-dev', revision: 8, moduleKey: 'todo-service', environment: 'prod', currentVersion: 'b08b2199',
    orchestration: [
      { id: 'build-step', name: '构建', tasks: [{ id: 'build-task', name: 'build', kind: 'script', actions: [{ id: 'build', name: '构建（平台托管）', script: 'npm run build' }] }] },
      { id: 'approval-step', name: '发布确认', tasks: [{ id: 'approval', name: '审批', kind: 'approval' }] },
      { id: 'deploy-step', name: '发布', tasks: [{ id: 'prod-task', name: 'prod', kind: 'script', condition: 'DEPLOY_ENV == prod', actions: [
        { id: 'publish', name: '发布', script: 'old publication' },
        { id: 'record', name: 'write-version · 写版本记录', script: 'record' },
        { id: 'sync', name: 'sync · 目标机代码与依赖（远端）', script: 'RROOT=/data/web_system\ngit reset --hard HEAD' },
        { id: 'activate', name: 'restart · 落地并重启（后端，远端）', script: 'dispatch\n# ══ config-dispatch:end ══\nold restart' },
        { id: 'verify', name: 'verify · 部署验证（后端，远端）', script: 'old verification' },
      ] }] },
    ],
    processes: [{ name: 'todo-service', cwd: '/data/web_system/servers/todo-service', script: '/data/web_system/servers/todo-service/dist/main.js', status: 'online', port: 6005, healthStatus: 200, nodeEnv: 'production' }],
  };
}

describe('read-only backend template migration readiness', () => {
  it('reports the observed template without exposing scripts or mutating the snapshot', () => {
    const input = sample();
    const before = JSON.stringify(input);
    const report = inspectBackendTemplateReadiness(input);
    expect(report).toMatchObject({ readOnly: true, canPublish: false, evidence: 'snapshot-only', templateShape: 'standard-five-action', revision: 8 });
    expect(report.blockers).toEqual(['legacy-runtime-reset', 'current-version-namespace-unresolved']);
    expect(report.configurationDispatch?.prefixSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain('old publication');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('blocks extra record and pointer operations instead of silently dropping them', () => {
    const input = sample();
    input.orchestration[2].tasks![0].actions!.push({ id: 'extra', name: 'pointer · 切版本指针（远端）', script: 'custom pointer' });
    const report = inspectBackendTemplateReadiness(input);
    expect(report.templateShape).toBe('custom-or-missing');
    expect(report.blockers).toContain('custom-action-sequence-needs-review');
    expect(report.actions.at(-1)?.role).toBe('custom');
  });

  it('requires service cwd compatibility instead of accepting repository cwd', () => {
    const input = sample(); input.processes[0].cwd = '/data/web_system';
    expect(inspectBackendTemplateReadiness(input).blockers).toContain('service-cwd-compatibility-required');
  });

  it.each(['missing', 'duplicate', 'wrong-script'])('rejects %s runtime ownership', variant => {
    const input = sample();
    if (variant === 'missing') input.processes = [];
    if (variant === 'duplicate') input.processes.push({ ...input.processes[0], name: 'duplicate' });
    if (variant === 'wrong-script') input.processes[0].script = '/data/web_system_git/servers/todo-service/dist/main.js';
    expect(inspectBackendTemplateReadiness(input).blockers).toContain('runtime-process-not-unique');
  });

  it.each(['unhealthy', 'offline', 'no-port', 'development'])('blocks %s runtime evidence', variant => {
    const input = sample();
    if (variant === 'unhealthy') input.processes[0].healthStatus = 500;
    if (variant === 'offline') input.processes[0].status = 'stopped';
    if (variant === 'no-port') input.processes[0].port = undefined;
    if (variant === 'development') input.processes[0].nodeEnv = 'development';
    expect(inspectBackendTemplateReadiness(input).blockers).toContain(variant === 'development' ? 'production-environment-not-confirmed' : 'runtime-health-not-confirmed');
  });

  it('does not infer current version from the running repository', () => {
    const input = sample(); input.currentVersion = null;
    expect(inspectBackendTemplateReadiness(input).blockers).toContain('current-version-not-registered');
  });

  it('does not mistake namespaced version metadata for verified bundles or release approval', () => {
    const input = sample(); input.currentVersion = 'todo-service-dev/b08b2199';
    const report = inspectBackendTemplateReadiness(input);
    expect(report.blockers).not.toContain('current-version-namespace-unresolved');
    expect(report.canPublish).toBe(false);
    expect(report.releaseGates).toContain('validated-candidate-and-rollback-runtime-bundles');
  });

  it('fingerprints disabled actions and other environments for later revision comparisons', () => {
    const input = sample(); const before = inspectBackendTemplateReadiness(input);
    input.orchestration[0].tasks![0].actions!.push({ id: 'disabled', name: 'disabled', enabled: false, script: 'private' });
    expect(inspectBackendTemplateReadiness(input).fingerprint).not.toBe(before.fingerprint);
  });

  it('requires review if the configuration dispatch boundary is absent', () => {
    const input = sample(); input.orchestration[2].tasks![0].actions![3].script = 'pm2 restart todo-service';
    expect(inspectBackendTemplateReadiness(input).blockers).toContain('configuration-dispatch-boundary-unconfirmed');
  });

  it('identifies namespace truncation that would break immutable version identities', () => {
    const input = sample(); input.orchestration[2].tasks![0].actions![1].script = 'versionTag="${COMMIT_ID##*/}"';
    expect(inspectBackendTemplateReadiness(input).blockers).toContain('version-namespace-truncated');
  });

  it('identifies duplicate records and legacy target-console credential scraping', () => {
    const input = sample();
    input.orchestration[2].tasks![0].actions!.push(
      { id: 'duplicate-record', name: 'write-version · 写版本记录（远端）', script: 'record' },
      { id: 'remote-pointer', name: 'pointer · 切版本指针（远端）', script: "grep INTERNAL_API_KEY /data/web_system/servers/deploy-console/.env" },
    );
    expect(inspectBackendTemplateReadiness(input).blockers).toEqual(expect.arrayContaining(['duplicate-version-recorders', 'target-console-credential-fallback']));
  });

  it.each(['environment', 'build', 'approval', 'identity'])('blocks ambiguous %s orchestration', variant => {
    const input = sample();
    if (variant === 'environment') input.orchestration[2].tasks!.push({ ...input.orchestration[2].tasks![0], id: 'duplicate-prod' });
    if (variant === 'build') input.orchestration[0].tasks![0].condition = 'DEPLOY_ENV == dev';
    if (variant === 'approval') input.orchestration[1].enabled = false;
    if (variant === 'identity') input.orchestration[2].tasks![0].env = { DEPLOY_ENV: 'dev' };
    const code = { environment: 'environment-task-not-unique', build: 'shared-build-task-not-unique', approval: 'preceding-approval-not-confirmed', identity: 'task-overrides-release-identity' }[variant];
    expect(inspectBackendTemplateReadiness(input).blockers).toContain(code);
  });

  it.each(['module', 'environment', 'root', 'revision'])('rejects invalid %s inputs', variant => {
    const input = sample();
    if (variant === 'module') input.moduleDirectory = '../gateway';
    if (variant === 'environment') (input as any).environment = 'local';
    if (variant === 'root') input.runtimeRoot = '/data/web_system_git';
    if (variant === 'revision') input.revision = 0;
    expect(() => inspectBackendTemplateReadiness(input)).toThrow();
  });

  it('aggregates migration blockers without promoting a structurally standard template to publishable', () => {
    const report = createReadinessReport({ schema: 1, modules: [sample()] }, inspectBackendTemplateReadiness);
    expect(report).toMatchObject({ readOnly: true, canPublish: false, summary: { modules: 1, standardTemplates: 1, customTemplates: 0, blockerCounts: { 'legacy-runtime-reset': 1 } } });
  });

  it('rejects duplicate module/environment snapshots and empty inventories', () => {
    expect(() => createReadinessReport({ schema: 1, modules: [sample(), sample()] }, inspectBackendTemplateReadiness)).toThrow('Duplicate');
    expect(() => createReadinessReport({ schema: 1, modules: [] }, inspectBackendTemplateReadiness)).toThrow('Nonempty');
  });

  it('has no apply mode and fails without echoing private input', () => {
    const result = spawnSync(process.execPath, [plannerPath, '--apply', 'private-value'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('private-value');
  });
});
