import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { inspectRuntimeTarget, runtimeTargetGuardCommand } from './runtime-target';

describe('legacy runtime target guard', () => {
  let temporary: string;
  let directory: string;
  let selected: any;
  beforeEach(() => {
    temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-target-')));
    directory = path.join(temporary, 'web_system/servers/todo-service');
    fs.mkdirSync(path.join(directory, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'dist/main.js'), 'healthy');
    selected = { name: 'todo-service', pid: 123, pm2_env: { status: 'online', pm_cwd: directory, pm_exec_path: path.join(directory, 'dist/main.js') } };
  });
  afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const input = () => ({ serviceDirectory: directory, processNames: ['web-todo', 'todo-service'] });
  it('accepts a uniquely owned service directory', () => {
    expect(inspectRuntimeTarget(input(), { processes: () => [selected] })).toMatchObject({ process: 'todo-service', directory });
  });
  it('accepts a legacy repository cwd only when the actual entry is in the declared service', () => {
    selected.pm2_env.pm_cwd = path.resolve(directory, '../..');
    expect(inspectRuntimeTarget(input(), { processes: () => [selected] }).entry).toBe(path.join(directory, 'dist/main.js'));
  });
  it('refuses a live process running from the other web_system_git tree', () => {
    const other = path.join(temporary, 'web_system_git/servers/todo-service');
    fs.mkdirSync(path.join(other, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(other, 'dist/main.js'), 'different');
    selected.pm2_env.pm_exec_path = path.join(other, 'dist/main.js');
    expect(() => inspectRuntimeTarget(input(), { processes: () => [selected] })).toThrow('非运行树');
  });
  it('recognizes an old compatibility link without treating it as a different runtime tree', () => {
    fs.symlinkSync(path.join(temporary, 'web_system'), path.join(temporary, 'web_system_git'), 'dir');
    selected.pm2_env.pm_exec_path = path.join(temporary, 'web_system_git/servers/todo-service/dist/main.js');
    expect(inspectRuntimeTarget(input(), { processes: () => [selected] }).directory).toBe(directory);
  });
  it('rejects multiple matching processes rather than guessing', () => {
    expect(() => inspectRuntimeTarget(input(), { processes: () => [selected, { ...selected, name: 'web-todo' }] })).toThrow('唯一');
  });
  it('rejects an unexpected cwd', () => {
    selected.pm2_env.pm_cwd = temporary;
    expect(() => inspectRuntimeTarget(input(), { processes: () => [selected] })).toThrow('cwd');
  });
  it('encodes target metadata in its self-contained shell command', () => {
    const command = runtimeTargetGuardCommand(input());
    expect(command).toContain('CONSOLE_RUNTIME_TARGET');
    expect(command).not.toContain(directory);
    expect(command).not.toContain('pm2 restart');
  });
  it('does not bootstrap a PM2 daemon when its runtime socket is unavailable', () => {
    const previous = process.env.PM2_HOME;
    process.env.PM2_HOME = path.join(temporary, 'empty-pm2');
    try { expect(() => inspectRuntimeTarget(input())).toThrow('拒绝自动创建'); }
    finally { if (previous === undefined) delete process.env.PM2_HOME; else process.env.PM2_HOME = previous; }
  });
});
