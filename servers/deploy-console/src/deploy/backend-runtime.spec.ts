import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { backendRuntimeActivationCommand, backendRuntimeProgram, executeBackendRuntime } from './backend-runtime';

describe('isolated backend runtime', () => {
  let temporary: string;
  let workspace: string;
  let runtime: string;
  let output: string;
  const commit = 'abcdef1234567890abcdef1234567890abcdef12';
  const versionTag = 'todo-service-dev/abcdef12';

  const write = (file: string, data: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };

  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-runtime-'));
    workspace = path.join(temporary, 'build');
    runtime = path.join(temporary, 'runtime');
    output = path.join(workspace, 'servers/todo-service/dist');
    write(path.join(workspace, 'pnpm-lock.yaml'), 'frozen-lock');
    write(path.join(workspace, 'servers/todo-service/package.json'), JSON.stringify({ name: '@web-system/todo-service', dependencies: { '@web-system/shared': 'workspace:*' } }));
    write(path.join(output, 'main.js'), 'module.exports = "new-runtime";');
    write(path.join(workspace, 'packages/shared/package.json'), JSON.stringify({ name: '@web-system/shared', main: 'dist/index.js' }));
    write(path.join(workspace, 'packages/shared/dist/index.js'), 'module.exports = "shared-runtime";');
    fs.mkdirSync(runtime);
  });

  afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

  function packager(prepare?: (bundle: string) => void) {
    return jest.fn((file: string, args: string[]) => {
      if (file === 'git') return commit;
      expect(file).toBe('pnpm');
      expect(args).toEqual(expect.arrayContaining(['deploy', '--prod', '--offline', '--frozen-lockfile', '--ignore-scripts', '--config.inject-workspace-packages=true', '--config.node-linker=isolated']));
      expect(args).not.toContain('--legacy');
      const bundle = args[args.length - 1];
      write(path.join(bundle, 'package.json'), fs.readFileSync(path.join(workspace, 'servers/todo-service/package.json'), 'utf8'));
      write(path.join(bundle, 'node_modules/@web-system/shared/package.json'), JSON.stringify({ name: '@web-system/shared', main: 'dist/index.js' }));
      write(path.join(bundle, 'node_modules/@web-system/shared/dist/index.js'), 'stale-output');
      fs.symlinkSync('@web-system/shared', path.join(bundle, 'node_modules/alias-shared'), 'dir');
      prepare?.(bundle);
      return '';
    });
  }

  const packageInput = () => ({ action: 'package' as const, workspace, runtimeRoot: runtime, moduleDirectory: 'todo-service', moduleKey: 'todo-service', versionTag });
  const inspectInput = (directory = output) => ({ action: 'inspect' as const, moduleKey: 'todo-service', versionTag, versionDirectory: directory });

  it('packages production dependencies and built workspace outputs without touching runtime', async () => {
    write(path.join(runtime, 'sentinel'), 'running-service');
    const commands = packager();
    const result = await executeBackendRuntime(packageInput(), { run: commands });
    expect(result).toMatchObject({ action: 'package', workspacePackages: ['@web-system/shared'] });
    expect(fs.readFileSync(path.join(output, 'dist/main.js'), 'utf8')).toContain('new-runtime');
    expect(fs.readFileSync(path.join(output, 'node_modules/@web-system/shared/dist/index.js'), 'utf8')).toContain('shared-runtime');
    expect(fs.readFileSync(path.join(runtime, 'sentinel'), 'utf8')).toBe('running-service');
    await expect(executeBackendRuntime(inspectInput())).resolves.toMatchObject({ action: 'inspect' });
  });

  it('failed packaging retains the original build output', async () => {
    const commands = jest.fn(() => { throw new Error('offline dependency unavailable'); });
    await expect(executeBackendRuntime(packageInput(), { run: commands })).rejects.toThrow('offline dependency unavailable');
    expect(fs.readFileSync(path.join(output, 'main.js'), 'utf8')).toContain('new-runtime');
  });

  it('refuses runtime overlap before running a package manager', async () => {
    const commands = packager();
    await expect(executeBackendRuntime({ ...packageInput(), runtimeRoot: workspace }, { run: commands })).rejects.toThrow(/overlaps/);
    expect(commands).not.toHaveBeenCalled();
  });

  it('refuses environment files in the distributable package', async () => {
    await expect(executeBackendRuntime(packageInput(), { run: packager(bundle => write(path.join(bundle, '.env'), 'PRIVATE=fixture')) })).rejects.toThrow(/Private environment/);
    expect(fs.existsSync(path.join(output, 'main.js'))).toBe(true);
  });

  it('packages only signed payload roots, excluding source and mutable data', async () => {
    await executeBackendRuntime(packageInput(), { run: packager(bundle => {
      write(path.join(bundle, 'data/todo.db'), 'private live data');
      write(path.join(bundle, 'src/main.ts'), 'unverified source');
    }) });
    expect(fs.readdirSync(output).sort()).toEqual(['dist', 'node_modules', 'package.json', 'runtime-manifest.json', 'version.json']);
  });

  it.each(['data/private.db', 'src/main.ts', '.env', '.npmrc'])('rejects unsigned artifact entry %s even when the payload checksum matches', async relative => {
    await executeBackendRuntime(packageInput(), { run: packager() });
    write(path.join(output, relative), 'private unverified fixture');
    await expect(executeBackendRuntime(inspectInput())).rejects.toThrow(/unsigned runtime entry/);
  });

  it('rejects a manifest symlink outside the bundle', async () => {
    await executeBackendRuntime(packageInput(), { run: packager() });
    const manifest = path.join(output, 'runtime-manifest.json');
    const outside = path.join(temporary, 'manifest.json');
    fs.renameSync(manifest, outside);
    fs.symlinkSync(outside, manifest);
    await expect(executeBackendRuntime(inspectInput())).rejects.toThrow(/metadata must be a regular file/);
  });

  it('rejects dependency links outside the version payload', async () => {
    const commands = packager(bundle => fs.symlinkSync(runtime, path.join(bundle, 'node_modules/escape'), 'dir'));
    await expect(executeBackendRuntime(packageInput(), { run: commands })).rejects.toThrow(/link/);
    expect(fs.existsSync(path.join(output, 'main.js'))).toBe(true);
  });

  it('rejects tampered artifacts and mismatched identities before activation', async () => {
    await executeBackendRuntime(packageInput(), { run: packager() });
    await expect(executeBackendRuntime({ ...inspectInput(), versionTag: 'wrong-version' })).rejects.toThrow(/identity/);
    write(path.join(output, 'dist/main.js'), 'tampered');
    await expect(executeBackendRuntime(inspectInput())).rejects.toThrow(/checksum/);
  });

  it('rejects a different Node ABI', async () => {
    await executeBackendRuntime(packageInput(), { run: packager() });
    const file = path.join(output, 'runtime-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.nodeAbi = 'unsupported';
    fs.writeFileSync(file, JSON.stringify(manifest));
    await expect(executeBackendRuntime(inspectInput())).rejects.toThrow(/ABI/);
  });

  function archive(directory: string, name: string) {
    const file = path.join(temporary, name + '.tgz');
    execFileSync('tar', ['--no-xattrs', '--format=ustar', '-czf', file, '-C', directory, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    return { archivePath: file, archiveSha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  }

  it('publishes a version atomically and allows only identical retries', async () => {
    await executeBackendRuntime(packageInput(), { run: packager() });
    const service = path.join(runtime, 'servers/todo-service');
    const destination = path.join(service, versionTag);
    fs.mkdirSync(service, { recursive: true });
    const input = { action: 'publish' as const, moduleKey: 'todo-service', versionTag, serviceDirectory: service, versionDirectory: destination, ...archive(output, 'first') };
    await expect(executeBackendRuntime(input)).resolves.toMatchObject({ action: 'publish', unchanged: false });
    await expect(executeBackendRuntime(input)).resolves.toMatchObject({ action: 'publish', unchanged: true });

    const secondRoot = path.join(temporary, 'second-build');
    fs.cpSync(workspace, secondRoot, { recursive: true });
    const secondOutput = path.join(secondRoot, 'servers/todo-service/dist');
    fs.rmSync(secondOutput, { recursive: true });
    write(path.join(secondOutput, 'main.js'), 'different runtime with the same version label');
    await executeBackendRuntime({ ...packageInput(), workspace: secondRoot }, { run: packager() });
    await expect(executeBackendRuntime({ ...input, ...archive(secondOutput, 'different') })).rejects.toThrow(/Immutable runtime/);
    expect(fs.readFileSync(path.join(destination, 'dist/main.js'), 'utf8')).toContain('new-runtime');
  });

  it('rejects an archive digest mismatch before creating version files', async () => {
    await executeBackendRuntime(packageInput(), { run: packager() });
    const service = path.join(runtime, 'servers/todo-service');
    fs.mkdirSync(service, { recursive: true });
    const destination = path.join(service, versionTag);
    await expect(executeBackendRuntime({ action: 'publish', moduleKey: 'todo-service', versionTag, serviceDirectory: service, versionDirectory: destination, ...archive(output, 'bad-hash'), archiveSha256: '0'.repeat(64) })).rejects.toThrow(/archive checksum/);
    expect(fs.existsSync(destination)).toBe(false);
  });

  async function activationFixture(unhealthy = false) {
    await executeBackendRuntime(packageInput(), { run: packager() });
    const service = path.join(runtime, 'servers/todo-service');
    const version = path.join(service, versionTag);
    write(path.join(service, 'dist/main.js'), 'old-runtime');
    write(path.join(service, '.env'), 'PORT=6005\nNODE_ENV=production\n');
    fs.cpSync(output, version, { recursive: true, verbatimSymlinks: true });
    let pid = 10;
    let clock = 10000;
    const commands = jest.fn((file: string, args: string[]) => {
      if (file === 'ss') return 'users:(("node",pid=' + pid + ',fd=18))';
      if (file !== 'pm2') throw new Error('Unexpected command');
      if (args[0] === 'restart') { expect(args[1]).toBe('todo-service'); pid++; return ''; }
      return JSON.stringify([{ name: 'todo-service', pid, pm2_env: { pm_cwd: service, status: 'online' } }]);
    });
    const probe = jest.fn(async () => unhealthy && fs.lstatSync(path.join(service, 'dist')).isSymbolicLink() ? 500 : 200);
    const storage = path.join(temporary, 'isolated-runtimes');
    return { service, version, storage, commands, probe, adapters: { run: commands, probe, now: () => clock, sleep: async (milliseconds: number) => { clock += milliseconds; } }, input: { action: 'activate' as const, moduleKey: 'todo-service', versionTag, serviceDirectory: service, versionDirectory: version, runtimeStorageRoot: storage, processName: 'web-todo', port: '6005', timeoutMs: 1500 } };
  }

  it('activates an immutable version and uses only the process owned by that service directory', async () => {
    const fixture = await activationFixture();
    const result = await executeBackendRuntime(fixture.input, fixture.adapters);
    expect(result).toMatchObject({ action: 'activate', isolatedDependencies: true, process: 'todo-service', port: 6005 });
    const installed = path.join(fixture.storage, 'todo-service', versionTag);
    expect(fs.realpathSync(path.join(fixture.service, 'dist'))).toBe(fs.realpathSync(path.join(installed, 'dist')));
    expect(fs.realpathSync(path.join(installed, '.env'))).toBe(fs.realpathSync(path.join(fixture.service, '.env')));
    expect(fs.existsSync(path.join(fixture.version, '.env'))).toBe(false);
    expect(fixture.commands.mock.calls.every(([file]) => ['pm2', 'ss'].includes(file))).toBe(true);
  });

  it('does not resolve dependencies from the original runtime repository', async () => {
    const fixture = await activationFixture();
    write(path.join(runtime, 'node_modules/original-repository-only/package.json'), JSON.stringify({ name: 'original-repository-only', main: 'index.js' }));
    write(path.join(runtime, 'node_modules/original-repository-only/index.js'), 'module.exports = true;');
    await executeBackendRuntime(fixture.input, fixture.adapters);
    const installed = path.join(fixture.storage, 'todo-service', versionTag, 'dist');
    const program = "const {createRequire}=require('node:module');const resolver=createRequire(" + JSON.stringify(path.join(installed, 'main.js')) + ");let ambient=false;try{resolver.resolve('original-repository-only');ambient=true}catch{}process.stdout.write(JSON.stringify({ambient,shared:resolver.resolve('@web-system/shared')})+'\\n');";
    const result = JSON.parse(execFileSync(process.execPath, ['-e', program], { encoding: 'utf8' }));
    expect(result.ambient).toBe(false);
    expect(result.shared.startsWith(fs.realpathSync(fixture.storage))).toBe(true);
  });

  it('restores the real previous dist and health on failed activation', async () => {
    const fixture = await activationFixture(true);
    await expect(executeBackendRuntime(fixture.input, fixture.adapters)).rejects.toThrow(/previous dist restored and healthy/);
    expect(fs.lstatSync(path.join(fixture.service, 'dist')).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(fixture.service, 'dist/main.js'), 'utf8')).toBe('old-runtime');
    expect(fixture.commands.mock.calls.filter(([, args]) => args[0] === 'restart')).toHaveLength(2);
  });

  it('accepts only the original service environment binding on installed-runtime retries', async () => {
    const fixture = await activationFixture();
    await executeBackendRuntime(fixture.input, fixture.adapters);
    await expect(executeBackendRuntime(fixture.input, fixture.adapters)).resolves.toMatchObject({ unchanged: true });
    const installed = path.join(fixture.storage, 'todo-service', versionTag);
    const foreign = path.join(temporary, 'foreign.env');
    write(foreign, 'PORT=6005');
    fs.unlinkSync(path.join(installed, '.env'));
    fs.symlinkSync(foreign, path.join(installed, '.env'));
    await expect(executeBackendRuntime(fixture.input, fixture.adapters)).rejects.toThrow(/unsigned runtime entry/);
    expect(fixture.commands.mock.calls.filter(([, args]) => args[0] === 'restart')).toHaveLength(1);
  });

  it('preserves generated-config removal fallback without rejecting its original dangling binding', async () => {
    const fixture = await activationFixture();
    write(path.join(fixture.service, '.env.generated'), 'PORT=6005\n');
    await executeBackendRuntime(fixture.input, fixture.adapters);
    fs.unlinkSync(path.join(fixture.service, '.env.generated'));
    await expect(executeBackendRuntime(fixture.input, fixture.adapters)).resolves.toMatchObject({ unchanged: true });
    expect(fixture.commands.mock.calls.filter(([, args]) => args[0] === 'restart')).toHaveLength(1);
  });

  it('rejects port drift before touching the active service', async () => {
    const fixture = await activationFixture();
    await expect(executeBackendRuntime({ ...fixture.input, port: '7000' }, fixture.adapters)).rejects.toThrow(/port differs/);
    expect(fs.readFileSync(path.join(fixture.service, 'dist/main.js'), 'utf8')).toBe('old-runtime');
    expect(fixture.commands.mock.calls.some(([, args]) => args[0] === 'restart')).toBe(false);
  });

  it('prefers the isolated storage copy over a dirty delivery directory on reactivation', async () => {
    const fixture = await activationFixture();
    await executeBackendRuntime(fixture.input, fixture.adapters);
    // 历史债：投递副本 servers/<svc>/<vtag> 曾被整目录带源码，触发 inspect 白名单拒绝。
    // 修复后 activate 应优先用 storage 里的干净副本，不再碰这个脏投递副本。
    write(path.join(fixture.version, 'src/main.ts'), 'unverified source');
    await expect(executeBackendRuntime(fixture.input, fixture.adapters)).resolves.toMatchObject({ unchanged: true });
    expect(fs.realpathSync(path.join(fixture.service, 'dist'))).toBe(fs.realpathSync(path.join(fixture.storage, 'todo-service', versionTag, 'dist')));
  });

  it('serializes a self-contained program and quotes remote values safely', async () => {
    await executeBackendRuntime(packageInput(), { run: packager() });
    const response = execFileSync(process.execPath, ['-e', backendRuntimeProgram()], { encoding: 'utf8', env: { ...process.env, BACKEND_RUNTIME_ACTION: 'inspect', MODULE_KEY: 'todo-service', COMMIT_ID: versionTag, RUNTIME_VERSION_DIR: output } });
    expect(JSON.parse(response)).toMatchObject({ action: 'inspect', versionTag });
    const encoded = Buffer.from(JSON.stringify(inspectInput())).toString('base64');
    const remoteResponse = execFileSync(process.execPath, ['-e', backendRuntimeProgram()], { encoding: 'utf8', env: { ...process.env, BACKEND_RUNTIME_PAYLOAD: encoded } });
    expect(JSON.parse(remoteResponse)).toMatchObject({ action: 'inspect', versionTag });
    const command = backendRuntimeActivationCommand({ moduleKey: 'todo-service', versionTag, serviceDirectory: "/tmp/service's-folder", versionDirectory: '/tmp/version' });
    expect(command).toContain("service'\\''s-folder");
    execFileSync('bash', ['-n'], { input: command });
  });
});
