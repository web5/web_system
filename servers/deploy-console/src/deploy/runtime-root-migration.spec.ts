import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
const { createPlan, applyPlan, rollbackMigration } = require('../../../../scripts/normalize-runtime-root.cjs');

describe('offline runtime root normalization', () => {
  let temporary: string;
  let root: string;
  let legacy: string;
  let processRow: any;
  function project(directory: string, marker: string) {
    fs.mkdirSync(path.join(directory, 'servers/todo-service/dist'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), '{}');
    fs.writeFileSync(path.join(directory, 'servers/todo-service/dist/main.js'), marker);
    fs.writeFileSync(path.join(directory, '.env'), 'PASSWORD=never-print-this-value');
  }
  beforeEach(() => {
    temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-migration-')));
    root = path.join(temporary, 'web_system'); legacy = path.join(temporary, 'web_system_git');
    project(root, 'old-inactive'); project(legacy, 'live-source');
    processRow = { name: 'todo-service', pid: 0, status: 'stopped', cwd: legacy, script: path.join(legacy, 'servers/todo-service/dist/main.js') };
  });
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(temporary, { recursive: true, force: true }); });
  const options = () => ({ root, legacy });
  it('is read-only by default and exposes hashes rather than secrets', () => {
    const plan = createPlan(options(), [{ ...processRow, status: 'online', pid: 10 }]);
    expect(plan.mode).toBe('promote-legacy-tree'); expect(plan.activeProcesses).toHaveLength(1);
    expect(fs.lstatSync(legacy).isSymbolicLink()).toBe(false);
    expect(JSON.stringify(plan)).not.toContain('never-print-this-value');
  });
  it('keeps the CLI plan read-only and rejects mixing a plan with an apply request', () => {
    const script = path.resolve(__dirname, '../../../../scripts/normalize-runtime-root.cjs');
    const env = { ...process.env, PM2_HOME: path.join(temporary, 'no-pm2-daemon') };
    const output = execFileSync(process.execPath, [script, '--plan', '--root', root, '--legacy', legacy], { env, encoding: 'utf8' });
    expect(JSON.parse(output).readOnly).toBe(true);
    expect(fs.existsSync(path.join(temporary, 'web_system_backups'))).toBe(false);
    expect(() => execFileSync(process.execPath, [script, '--plan', '--apply', '/not-a-plan'], { env, stdio: 'pipe' })).toThrow();
  });
  it('will not cut over a running production tree', () => {
    const rows = [{ ...processRow, status: 'online', pid: 10 }]; const plan = createPlan(options(), rows);
    expect(() => applyPlan(plan, { confirmRoot: root }, rows)).toThrow('Maintenance window');
    expect(fs.existsSync(path.join(temporary, 'web_system_backups'))).toBe(false);
  });
  it('preserves both trees, creates a compatibility link, and can roll back offline', () => {
    const plan = createPlan(options(), [processRow]); const receipt = applyPlan(plan, { confirmRoot: root }, [processRow]);
    expect(fs.readFileSync(path.join(root, 'servers/todo-service/dist/main.js'), 'utf8')).toBe('live-source');
    expect(fs.realpathSync(legacy)).toBe(root);
    expect(fs.readFileSync(path.join(receipt.previous, 'servers/todo-service/dist/main.js'), 'utf8')).toBe('old-inactive');
    expect(fs.statSync(receipt.receiptFile).mode & 0o777).toBe(0o600);
    const restored = rollbackMigration(receipt, { confirmRoot: root }, [processRow]);
    expect(restored.status).toBe('rolled-back');
    expect(fs.readFileSync(path.join(legacy, 'servers/todo-service/dist/main.js'), 'utf8')).toBe('live-source');
    expect(fs.readFileSync(path.join(root, 'servers/todo-service/dist/main.js'), 'utf8')).toBe('old-inactive');
  });
  it('refuses changed files after the reviewed plan', () => {
    const plan = createPlan(options(), [processRow]); fs.writeFileSync(path.join(legacy, '.env'), 'changed');
    expect(() => applyPlan(plan, { confirmRoot: root }, [processRow])).toThrow('changed after planning');
  });
  it('invalidates a plan if the runtime Git branch reference advances', () => {
    fs.mkdirSync(path.join(legacy, '.git/refs/heads'), { recursive: true });
    fs.writeFileSync(path.join(legacy, '.git/HEAD'), 'ref: refs/heads/master\n');
    fs.writeFileSync(path.join(legacy, '.git/refs/heads/master'), 'before');
    const plan = createPlan(options(), [processRow]);
    fs.writeFileSync(path.join(legacy, '.git/refs/heads/master'), 'after');
    expect(() => applyPlan(plan, { confirmRoot: root }, [processRow])).toThrow('changed after planning');
  });
  it('restores original paths if compatibility link creation fails', () => {
    const plan = createPlan(options(), [processRow]); jest.spyOn(require('node:fs'), 'symlinkSync').mockImplementationOnce(() => { throw new Error('injected link failure'); });
    expect(() => applyPlan(plan, { confirmRoot: root }, [processRow])).toThrow('injected link failure');
    expect(fs.readFileSync(path.join(legacy, 'servers/todo-service/dist/main.js'), 'utf8')).toBe('live-source');
    expect(fs.readFileSync(path.join(root, 'servers/todo-service/dist/main.js'), 'utf8')).toBe('old-inactive');
  });
  it('rejects a backup symlink that resolves into the active tree', () => {
    fs.mkdirSync(path.join(legacy, 'backups')); const alias = path.join(temporary, 'backup-alias'); fs.symlinkSync(path.join(legacy, 'backups'), alias, 'dir');
    expect(() => createPlan({ ...options(), backupRoot: alias }, [processRow])).toThrow('outside both');
  });
  it('refuses ambiguous references to both live roots', () => {
    const rows = [processRow, { ...processRow, name: 'other', script: path.join(root, 'servers/todo-service/dist/main.js') }]; const plan = createPlan(options(), rows);
    expect(() => applyPlan(plan, { confirmRoot: root }, rows)).toThrow('Blocked plan');
  });
  it('requires explicit confirmation for a filesystem change', () => {
    const plan = createPlan(options(), [processRow]); expect(() => applyPlan(plan, {}, [processRow])).toThrow('confirm-root');
  });
  it('refuses directory rollback until original PM2 references are restored', () => {
    const plan = createPlan(options(), [processRow]); const receipt = applyPlan(plan, { confirmRoot: root }, [processRow]);
    const updated = { ...processRow, cwd: root, script: path.join(root, 'servers/todo-service/dist/main.js') };
    expect(() => rollbackMigration(receipt, { confirmRoot: root }, [updated])).toThrow('Restore original stopped PM2 references');
  });
});
