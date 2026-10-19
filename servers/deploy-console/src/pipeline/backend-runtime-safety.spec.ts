import { assertBackendRuntimePlan } from './backend-runtime-safety';
import type { EngineStep } from '../pipeline-orchestration/orchestration-engine';

const legacyScript = 'RROOT="${PUBLISH_PATH}/../.."\ncd "$RROOT"\ngit reset --hard "origin/$BRANCH"';
const tree = (script: string, condition: string | null = null): EngineStep[] => [{
  id: 'release', name: '发布', tasks: [{
    id: 'sync', name: 'sync', kind: 'script', condition,
    actions: [{ id: 'action', name: '同步目标机', script }],
  }],
}];

describe('backend runtime template migration fence', () => {
  it('rejects legacy mutations in the runtime checkout', () => {
    expect(() => assertBackendRuntimePlan({ env: 'dev', moduleKey: 'todo-service', orchestration: tree(legacyScript) })).toThrow(/重置运行仓库/);
  });

  it('allows git reset in the isolated build checkout', () => {
    expect(() => assertBackendRuntimePlan({ env: 'dev', moduleKey: 'todo-service', orchestration: tree('cd "$RELEASE_DIR"\ngit reset --hard "$COMMIT_ID"') })).not.toThrow();
  });

  it('does not block a dev rollout on an inactive prod branch', () => {
    expect(() => assertBackendRuntimePlan({ env: 'dev', moduleKey: 'todo-service', orchestration: tree(legacyScript, 'DEPLOY_ENV == prod && FEATURE == enabled') })).not.toThrow();
  });

  it('cannot assume an unknown runtime feature variable disables an unsafe action', () => {
    expect(() => assertBackendRuntimePlan({ env: 'dev', moduleKey: 'todo-service', orchestration: tree(legacyScript, 'FEATURE == enabled') })).toThrow(/安全门/);
  });

  it('allows inspection-only isolated runtime actions', () => {
    expect(() => assertBackendRuntimePlan({ env: 'dev', moduleKey: 'todo-service', orchestration: tree('node inspect-immutable-runtime.js') })).not.toThrow();
  });

  it('ignores explicitly disabled steps and actions', () => {
    const plan = tree(legacyScript);
    plan[0].enabled = false;
    expect(() => assertBackendRuntimePlan({ env: 'prod', moduleKey: 'todo-service', orchestration: plan })).not.toThrow();
    plan[0].enabled = true;
    plan[0].tasks![0].actions![0].enabled = false;
    expect(() => assertBackendRuntimePlan({ env: 'prod', moduleKey: 'todo-service', orchestration: plan })).not.toThrow();
  });
});
