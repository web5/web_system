import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { captureBackendRuntimeCheckpoint, cloneVerifiedBackendRuntime } from './backend-runtime-preparation';
import { executeBackendRuntime } from './backend-runtime';

describe('offline backend candidate and checkpoint preparation', () => {
  let temporary: string;
  let root: string;
  let service: string;
  let output: string;
  let provider: string;
  const tag = 'runtime-checkpoint/todo-prod-fixture';
  const write = (file: string, data: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
  const link = (source: string, destination: string) => { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.symlinkSync(path.relative(path.dirname(destination), source), destination, 'dir'); };
  const distDigest = () => {
    const entries = fs.readdirSync(path.join(service, 'dist')).sort().map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(service, 'dist', name))).digest('hex')]);
    return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  };
  const input = () => ({ runtimeRoot: root, serviceDirectory: service, outputDirectory: output, moduleKey: 'todo-service', versionTag: tag, sourceVersion: 'b08b2199', expectedDistSha256: distDigest() });
  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-preparation-'));
    root = path.join(temporary, 'web_system');
    service = path.join(root, 'servers/todo-service');
    output = path.join(temporary, 'checkpoint');
    provider = path.join(root, 'node_modules/.pnpm/alpha@1/node_modules/alpha');
    const peer = path.join(root, 'node_modules/.pnpm/beta@2/node_modules/beta');
    write(path.join(service, 'package.json'), JSON.stringify({ name: '@web-system/todo-service', dependencies: { alpha: '1', renamed: 'npm:alpha@1' } }));
    write(path.join(service, 'dist/main.js'), 'module.exports = require("alpha");');
    write(path.join(service, '.env'), 'PRIVATE=do-not-export');
    write(path.join(provider, 'package.json'), JSON.stringify({ name: 'alpha', version: '1.0.0', main: 'index.js', dependencies: { beta: '2' }, optionalDependencies: { 'missing-optional': '1' } }));
    write(path.join(provider, 'index.js'), 'module.exports = require("beta");');
    write(path.join(provider, 'native.node'), 'captured-native-bytes');
    write(path.join(peer, 'package.json'), JSON.stringify({ name: 'beta', version: '2.0.0', main: 'index.js', peerDependencies: { alpha: '1' } }));
    write(path.join(peer, 'index.js'), 'module.exports = "same-runtime";');
    link(peer, path.join(path.dirname(provider), 'beta'));
    link(provider, path.join(path.dirname(peer), 'alpha'));
    link(provider, path.join(service, 'node_modules/alpha'));
    link(provider, path.join(service, 'node_modules/renamed'));
  });
  afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

  it('captures unchanged runtime bytes and actual declared providers without claiming a Git commit', async () => {
    const result = await captureBackendRuntimeCheckpoint(input());
    expect(result).toMatchObject({ packages: 2, sourceDistFiles: 1, sourceDistSha256: distDigest(), gitCommit: null, declaredDependencyClosureOnly: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'runtime-manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ provenance: 'runtime-checkpoint', gitCommit: null, sourceVersion: 'b08b2199' });
    expect(fs.readFileSync(path.join(output, 'dist/main.js'))).toEqual(fs.readFileSync(path.join(service, 'dist/main.js')));
    expect(fs.existsSync(path.join(output, 'dist/version.json'))).toBe(false);
    expect(fs.existsSync(path.join(output, '.env'))).toBe(false);
    const resolver = createRequire(path.join(output, 'package.json'));
    expect(fs.realpathSync(resolver.resolve('alpha'))).toBe(fs.realpathSync(resolver.resolve('renamed')));
    expect(fs.readFileSync(path.join(path.dirname(resolver.resolve('alpha')), 'native.node'), 'utf8')).toBe('captured-native-bytes');
    const program = 'const {createRequire}=require("node:module");const resolver=createRequire(' + JSON.stringify(path.join(output, 'package.json')) + ');process.stdout.write(resolver("alpha"));';
    expect(execFileSync(process.execPath, ['-e', program], { encoding: 'utf8' })).toBe('same-runtime');
    await expect(executeBackendRuntime({ action: 'inspect', moduleKey: 'todo-service', versionTag: tag, versionDirectory: output })).resolves.toMatchObject({ files: result.files });
  });

  it('copies runtime workspace dependency bytes rather than rebuilding newer shared code', async () => {
    const workspacePackage = path.join(root, 'packages/shared');
    write(path.join(workspacePackage, 'package.json'), JSON.stringify({ name: '@web-system/shared', version: '1.0.0', main: 'dist/index.js', dependencies: { alpha: '1' } }));
    write(path.join(workspacePackage, 'dist/index.js'), 'module.exports = "production-shared";');
    link(provider, path.join(workspacePackage, 'node_modules/alpha'));
    link(workspacePackage, path.join(service, 'node_modules/@web-system/shared'));
    const metadata = JSON.parse(fs.readFileSync(path.join(service, 'package.json'), 'utf8'));
    metadata.dependencies['@web-system/shared'] = 'workspace:*';
    write(path.join(service, 'package.json'), JSON.stringify(metadata));
    await captureBackendRuntimeCheckpoint(input());
    const captured = fs.realpathSync(path.join(output, 'node_modules/@web-system/shared'));
    expect(fs.readFileSync(path.join(captured, 'dist/index.js'), 'utf8')).toContain('production-shared');
  });

  it('fails before producing output when a required provider is unavailable', async () => {
    fs.unlinkSync(path.join(service, 'node_modules/alpha'));
    await expect(captureBackendRuntimeCheckpoint(input())).rejects.toThrow('Required checkpoint dependency is missing');
    expect(fs.existsSync(output)).toBe(false);
  });

  it('preserves Node builtin dependency resolution without expecting an npm package', async () => {
    const metadata = JSON.parse(fs.readFileSync(path.join(provider, 'package.json'), 'utf8'));
    metadata.dependencies.string_decoder = '1.3.0';
    write(path.join(provider, 'package.json'), JSON.stringify(metadata));
    await captureBackendRuntimeCheckpoint(input());
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'runtime-manifest.json'), 'utf8'));
    expect(manifest.dependencyGraph.flatMap(node => node.edges)).toContainEqual({ name: 'string_decoder', provider: null, required: true, builtin: true });
  });

  it('does not accept changed source runtime bytes', async () => {
    const checkpoint = input(); write(path.join(service, 'dist/main.js'), 'changed runtime');
    await expect(captureBackendRuntimeCheckpoint(checkpoint)).rejects.toThrow('differs from the reviewed checkpoint');
    expect(fs.existsSync(output)).toBe(false);
  });

  it('does not capture dependencies outside the running tree', async () => {
    const outside = path.join(temporary, 'ambient');
    write(path.join(outside, 'package.json'), '{"name":"alpha","version":"1"}');
    fs.unlinkSync(path.join(service, 'node_modules/alpha')); link(outside, path.join(service, 'node_modules/alpha'));
    await expect(captureBackendRuntimeCheckpoint(input())).rejects.toThrow('outside the runtime tree');
  });

  it('rejects private files and escaping links in captured packages', async () => {
    write(path.join(provider, '.env'), 'PRIVATE=fixture');
    await expect(captureBackendRuntimeCheckpoint(input())).rejects.toThrow('Private file');
    fs.unlinkSync(path.join(provider, '.env'));
    link(service, path.join(provider, 'escape'));
    await expect(captureBackendRuntimeCheckpoint(input())).rejects.toThrow('escaping link');
  });

  it('refuses output in the running tree or an existing destination', async () => {
    await expect(captureBackendRuntimeCheckpoint({ ...input(), outputDirectory: path.join(service, 'checkpoint') })).rejects.toThrow('overlaps');
    fs.mkdirSync(output);
    await expect(captureBackendRuntimeCheckpoint(input())).rejects.toThrow('exists');
  });

  it('refuses preparation beneath ambient dependency directories', async () => {
    fs.mkdirSync(path.join(temporary, 'node_modules'));
    await expect(captureBackendRuntimeCheckpoint(input())).rejects.toThrow('ambient ancestor');
  });

  it('clones only reviewed payload roots and leaves unsigned source extras untouched', async () => {
    const checkpoint = await captureBackendRuntimeCheckpoint(input());
    write(path.join(output, 'data/private.db'), 'private extra');
    write(path.join(output, 'src/source.ts'), 'unsigned extra');
    const candidate = path.join(temporary, 'candidate');
    const cloned = await cloneVerifiedBackendRuntime({ sourceDirectory: output, outputDirectory: candidate, moduleKey: 'todo-service', versionTag: tag, expectedPayloadSha256: checkpoint.payloadSha256! });
    expect(cloned.excludedRootEntries.sort()).toEqual(['data', 'src']);
    expect(fs.existsSync(path.join(output, 'data/private.db'))).toBe(true);
    expect(fs.existsSync(path.join(candidate, 'data'))).toBe(false);
    expect(cloned.payloadSha256).toBe(checkpoint.payloadSha256);
  });

  it('refuses cloning tampered payloads and retains no output', async () => {
    const checkpoint = await captureBackendRuntimeCheckpoint(input());
    write(path.join(output, 'dist/main.js'), 'tampered');
    const candidate = path.join(temporary, 'candidate');
    await expect(cloneVerifiedBackendRuntime({ sourceDirectory: output, outputDirectory: candidate, moduleKey: 'todo-service', versionTag: tag, expectedPayloadSha256: checkpoint.payloadSha256! })).rejects.toThrow('checksum');
    expect(fs.existsSync(candidate)).toBe(false);
  });
});
