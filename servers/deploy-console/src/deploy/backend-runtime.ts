export interface BackendRuntimeInput {
  action: 'package' | 'publish' | 'inspect' | 'activate';
  workspace?: string;
  runtimeRoot?: string;
  moduleDirectory?: string;
  moduleKey: string;
  versionTag: string;
  serviceDirectory?: string;
  versionDirectory?: string;
  pnpm?: string;
  processName?: string;
  port?: string;
  healthPath?: string;
  timeoutMs?: number;
  archivePath?: string;
  archiveSha256?: string;
  runtimeStorageRoot?: string;
}

export interface BackendRuntimeAdapters {
  run?: (file: string, args: string[], options?: Record<string, unknown>) => string;
  probe?: (port: number, route: string) => Promise<number>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export async function executeBackendRuntime(input: BackendRuntimeInput, adapters: BackendRuntimeAdapters = {}) {
  const fs: typeof import('node:fs') = require('node:fs');
  const path: typeof import('node:path') = require('node:path');
  const crypto: typeof import('node:crypto') = require('node:crypto');
  const child: typeof import('node:child_process') = require('node:child_process');
  const os: typeof import('node:os') = require('node:os');
  const { createRequire }: typeof import('node:module') = require('node:module');
  const run = adapters.run ?? ((file, args, options = {}) => child.execFileSync(file, args, {
    encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], ...options,
  }).toString());
  const now = adapters.now ?? Date.now;
  const sleep = adapters.sleep ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  const probe = adapters.probe ?? ((port, route) => new Promise<number>(resolve => {
    const http: typeof import('node:http') = require('node:http');
    const request = http.get({ hostname: '127.0.0.1', port, path: route, timeout: 1000 }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
      response.on('error', () => resolve(0));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(0));
  }));
  const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
  const contains = (parent: string, childPath: string) => {
    const relative = path.relative(parent, childPath);
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
  };
  const canonical = (value: string) => {
    let existing = path.resolve(value);
    const remainder: string[] = [];
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      remainder.unshift(path.basename(existing));
      existing = parent;
    }
    return path.join(fs.realpathSync(existing), ...remainder);
  };
  const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const inventory = (root: string) => {
    const entries: Array<[string, string]> = [];
    const walk = (relative: string) => {
      const file = path.join(root, relative);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        if (path.isAbsolute(fs.readlinkSync(file))) throw new Error('Runtime dependency link is not relocatable: ' + relative);
        const destination = fs.realpathSync(file);
        if (!contains(root, destination)) throw new Error('Runtime dependency link escapes artifact: ' + relative);
        entries.push([relative, 'link:' + fs.readlinkSync(file)]);
      } else if (stat.isDirectory()) {
        for (const name of fs.readdirSync(file).sort()) walk(path.join(relative, name));
      } else if (stat.isFile()) entries.push([relative, hash(fs.readFileSync(file))]);
      else throw new Error('Unsupported runtime artifact entry');
    };
    for (const relative of ['package.json', 'version.json', 'dist', 'node_modules']) {
      if (!fs.existsSync(path.join(root, relative))) throw new Error('Incomplete isolated runtime: ' + relative);
      if (['dist', 'node_modules'].includes(relative) && !fs.lstatSync(path.join(root, relative)).isDirectory()) throw new Error('Runtime payload root must be a real directory');
      walk(relative);
    }
    return { files: entries.length, sha256: hash(JSON.stringify(entries)) };
  };
  const inspect = (directory: string, environmentSource?: string) => {
    const root = fs.realpathSync(directory);
    const allowed = new Set(['package.json', 'version.json', 'runtime-manifest.json', 'dist', 'node_modules']);
    for (const name of fs.readdirSync(root)) {
      if (allowed.has(name)) continue;
      const file = path.join(root, name);
      const source = environmentSource && ['.env', '.env.generated'].includes(name) ? path.join(environmentSource, name) : null;
      if (source && fs.lstatSync(file).isSymbolicLink() && path.resolve(path.dirname(file), fs.readlinkSync(file)) === path.resolve(source)) continue;
      throw new Error('Unexpected unsigned runtime entry: ' + name);
    }
    for (const name of ['package.json', 'version.json', 'runtime-manifest.json']) {
      if (!fs.lstatSync(path.join(root, name)).isFile()) throw new Error('Runtime metadata must be a regular file: ' + name);
    }
    const manifest = readJson(path.join(root, 'runtime-manifest.json'));
    if (manifest.format !== 'web-system-runtime-v1' || manifest.moduleKey !== input.moduleKey || manifest.versionTag !== input.versionTag) {
      throw new Error('Runtime artifact identity mismatch');
    }
    if (manifest.nodeAbi !== process.versions.modules || manifest.platform !== process.platform || manifest.architecture !== process.arch) {
      throw new Error('Runtime artifact platform or Node ABI mismatch');
    }
    if (manifest.entry !== 'dist/main.js' || !fs.statSync(path.join(root, manifest.entry)).isFile() || fs.statSync(path.join(root, manifest.entry)).size === 0) throw new Error('Runtime main entry is missing');
    const actual = inventory(root);
    if (actual.sha256 !== manifest.payloadSha256 || actual.files !== manifest.payloadFiles) throw new Error('Runtime artifact checksum mismatch');
    return { root, manifest, payload: actual };
  };
  if (typeof input.moduleKey !== 'string' || typeof input.versionTag !== 'string' || !/^[A-Za-z0-9_-]+$/.test(input.moduleKey) || !/^[A-Za-z0-9._/-]+$/.test(input.versionTag) || input.versionTag.split('/').some(part => part === '..' || part === '.' || !part)) {
    throw new Error('Invalid runtime module or version identity');
  }

  if (input.action === 'package') {
    if (!input.workspace || !input.moduleDirectory || !/^[A-Za-z0-9_-]+$/.test(input.moduleDirectory)) throw new Error('Backend build workspace and module directory are required');
    const root = fs.realpathSync(input.workspace);
    for (const protectedRoot of [input.runtimeRoot, input.serviceDirectory, input.runtimeStorageRoot || path.join(os.homedir(), 'web_system_runtimes')].filter(Boolean) as string[]) {
      const runtime = fs.existsSync(protectedRoot) ? fs.realpathSync(protectedRoot) : path.resolve(protectedRoot);
      if (contains(root, runtime) || contains(runtime, root)) throw new Error('Backend packaging workspace overlaps runtime');
    }
    const service = fs.realpathSync(path.join(root, 'servers', input.moduleDirectory));
    const output = path.join(service, 'dist');
    if (!contains(root, service) || !contains(root, fs.realpathSync(output))) throw new Error('Backend build output escapes workspace');
    if (!fs.existsSync(path.join(output, 'main.js'))) throw new Error('Backend main.js was not built');
    const pkg = readJson(path.join(service, 'package.json'));
    const packageRoot = path.join(root, 'artifacts', 'backend-runtime');
    if (!contains(root, canonical(packageRoot))) throw new Error('Backend staging directory escapes workspace');
    fs.mkdirSync(packageRoot, { recursive: true });
    if (!contains(root, fs.realpathSync(packageRoot))) throw new Error('Backend staging directory escapes workspace');
    const staging = fs.mkdtempSync(path.join(packageRoot, input.moduleKey + '-'));
    const bundle = path.join(staging, 'runtime');
    const previous = path.join(staging, 'original-dist');
    let moved = false;
    try {
      run(input.pnpm || 'pnpm', ['--filter', pkg.name, 'deploy', '--prod', '--offline', '--frozen-lockfile', '--ignore-scripts', '--config.inject-workspace-packages=true', '--config.node-linker=isolated', bundle], { cwd: root, timeout: 180000 });
      for (const name of fs.readdirSync(bundle)) {
        if (name !== '.env.example' && /^(?:\.env(?:$|\.)|\.npmrc$|id_(?:rsa|ed25519)$)|\.(?:key|pem)$/.test(name)) throw new Error('Private environment file was included in runtime package');
        if (!['package.json', 'dist', 'node_modules'].includes(name)) fs.rmSync(path.join(bundle, name), { recursive: true, force: true });
      }
      fs.rmSync(path.join(bundle, 'dist'), { recursive: true, force: true });
      fs.cpSync(output, path.join(bundle, 'dist'), { recursive: true, dereference: false, verbatimSymlinks: true });
      const workspacePackages = new Map<string, string>();
      for (const name of fs.readdirSync(path.join(root, 'packages'))) {
        const directory = path.join(root, 'packages', name);
        if (fs.existsSync(path.join(directory, 'package.json'))) workspacePackages.set(readJson(path.join(directory, 'package.json')).name, directory);
      }
      const copied = new Set<string>();
      const copyWorkspaceOutputs = (manifest: Record<string, any>, from: string) => {
        for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }).sort()) {
          const source = workspacePackages.get(name);
          if (!source || copied.has(name)) continue;
          if (!contains(root, fs.realpathSync(source))) throw new Error('Workspace dependency source escapes checkout');
          const resolver = createRequire(path.join(from, 'package.json'));
          let target: string | undefined;
          for (const search of resolver.resolve.paths(name) ?? []) {
            if (fs.existsSync(path.join(search, name, 'package.json'))) { target = fs.realpathSync(path.join(search, name)); break; }
          }
          if (!target || !contains(bundle, target)) throw new Error('Workspace dependency was not isolated: ' + name);
          if (!fs.existsSync(path.join(source, 'dist'))) throw new Error('Workspace dependency has no build output: ' + name);
          copied.add(name);
          fs.rmSync(path.join(target, 'dist'), { recursive: true, force: true });
          fs.cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true, dereference: false, verbatimSymlinks: true });
          copyWorkspaceOutputs(readJson(path.join(source, 'package.json')), target);
        }
      };
      copyWorkspaceOutputs(pkg, bundle);
      const commit = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
      if (!commit.startsWith(input.versionTag.split('/').pop()!)) throw new Error('Backend runtime version does not match checkout');
      const version = { version: input.versionTag, gitCommit: commit, builtAt: new Date(now()).toISOString() };
      fs.writeFileSync(path.join(bundle, 'dist', 'version.json'), JSON.stringify(version));
      fs.writeFileSync(path.join(bundle, 'version.json'), JSON.stringify(version));
      const payload = inventory(bundle);
      const manifest = { format: 'web-system-runtime-v1', moduleKey: input.moduleKey, versionTag: input.versionTag, gitCommit: commit, entry: 'dist/main.js', nodeAbi: process.versions.modules, platform: process.platform, architecture: process.arch, lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), workspacePackages: [...copied].sort(), payloadSha256: payload.sha256, payloadFiles: payload.files };
      fs.writeFileSync(path.join(bundle, 'runtime-manifest.json'), JSON.stringify(manifest));
      inspect(bundle);
      fs.renameSync(output, previous); moved = true;
      fs.renameSync(bundle, output);
      return { action: 'package', moduleKey: input.moduleKey, versionTag: input.versionTag, files: payload.files, payloadSha256: payload.sha256, workspacePackages: manifest.workspacePackages };
    } catch (error) {
      if (moved && !fs.existsSync(output)) fs.renameSync(previous, output);
      throw error;
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }

  if (!input.versionDirectory) throw new Error('Runtime version directory required');
  if (input.action === 'publish') {
    if (!input.serviceDirectory || !input.archivePath || !/^[a-f0-9]{64}$/.test(input.archiveSha256 || '')) throw new Error('Runtime publication requires service, archive, and checksum');
    const service = fs.realpathSync(input.serviceDirectory);
    const destination = canonical(input.versionDirectory);
    if (!contains(service, destination) || service === destination) throw new Error('Runtime publication target escapes service');
    if (hash(fs.readFileSync(input.archivePath)) !== input.archiveSha256) throw new Error('Runtime archive checksum mismatch');
    const names = run('tar', ['-tzf', input.archivePath]).trim().split('\n');
    if (names.some(name => path.isAbsolute(name) || name.split('/').includes('..'))) throw new Error('Unsafe runtime archive entry');
    const staging = fs.mkdtempSync(path.join(service, '.incoming-runtime-'));
    try {
      run('tar', ['--no-same-owner', '-xzf', input.archivePath, '-C', staging], { timeout: 120000 });
      const incoming = inspect(staging);
      if (fs.existsSync(destination)) {
        const existing = inspect(destination);
        if (existing.payload.sha256 !== incoming.payload.sha256) throw new Error('Immutable runtime version already exists with different content');
        return { action: 'publish', unchanged: true, versionTag: input.versionTag, payloadSha256: incoming.payload.sha256 };
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(staging, destination);
      return { action: 'publish', unchanged: false, versionTag: input.versionTag, payloadSha256: incoming.payload.sha256 };
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
  if (input.action === 'inspect') {
    const inspected = inspect(input.versionDirectory);
    return { action: 'inspect', moduleKey: input.moduleKey, versionTag: input.versionTag, files: inspected.payload.files, payloadSha256: inspected.payload.sha256 };
  }
  if (input.action !== 'activate' || !input.serviceDirectory) throw new Error('Runtime activation requires a service directory');
  const service = fs.realpathSync(input.serviceDirectory);
  const storage = canonical(input.runtimeStorageRoot || path.join(os.homedir(), 'web_system_runtimes'));
  const installed = canonical(path.join(storage, input.moduleKey, input.versionTag));
  // 隔离产物真源优先 storage（activate 的落地目标，发布时已 inspect 过、干净）：
  // 历史债是投递副本 servers/<svc>/<vtag> 曾整目录带源码，被 inspect 白名单拒。
  // 若 storage 已有该版本，直接用干净副本；否则才回退到投递副本校验。
  let inspected;
  if (fs.existsSync(path.join(installed, 'runtime-manifest.json'))) {
    inspected = inspect(installed, service);
  } else {
    inspected = inspect(input.versionDirectory);
  }
  const inService = contains(service, inspected.root) && service !== inspected.root;
  const inStorage = contains(storage, inspected.root) && storage !== inspected.root;
  if (!inService && !inStorage) throw new Error('Runtime version is outside the target service or storage root');
  const active = path.join(service, 'dist');
  if (!fs.existsSync(active)) throw new Error('Current runtime is unavailable; refusing unprovisioned activation');
  const list = () => JSON.parse(run('pm2', ['jlist'], { cwd: service })) as Array<{ name: string; pid: number; pm2_env: Record<string, any> }>;
  const owned = list().filter(row => row.pm2_env.pm_cwd && fs.realpathSync(row.pm2_env.pm_cwd) === service);
  if (owned.length !== 1 || owned[0].pm2_env.status !== 'online') throw new Error('Target service must have exactly one healthy managed process');
  const selected = owned[0];
  if (selected.pm2_env.env?.NODE_PATH || /--preserve-symlinks/.test(JSON.stringify([selected.pm2_env.node_args, selected.pm2_env.env?.NODE_OPTIONS]))) throw new Error('Isolated runtime cannot inherit ambient module paths or preserve-symlink flags');
  let configuredPort = input.port || selected.pm2_env.env?.PORT;
  for (const name of ['.env', '.env.generated']) {
    const file = path.join(service, name);
    if (fs.existsSync(file)) {
      const value = /^\s*(?:export\s+)?PORT\s*=\s*['"]?(\d+)['"]?\s*(?:#.*)?$/m.exec(fs.readFileSync(file, 'utf8'))?.[1];
      if (value) {
        if (configuredPort && Number(configuredPort) !== Number(value)) throw new Error('Runtime port differs from target environment configuration');
        configuredPort = value;
      }
    }
  }
  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Runtime health port is required');
  const project = path.resolve(service, '..', '..');
  if (contains(project, storage) || contains(storage, project)) throw new Error('Isolated runtime storage overlaps the running repository');
  if (!contains(storage, installed)) throw new Error('Isolated runtime storage escapes its root');
  for (let ancestor = path.dirname(installed); ; ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(path.join(ancestor, 'node_modules'))) throw new Error('Isolated runtime has ambient ancestor dependencies');
    if (path.dirname(ancestor) === ancestor) break;
  }
  if (!fs.existsSync(installed)) {
    fs.mkdirSync(path.dirname(installed), { recursive: true, mode: 0o700 });
    const staging = fs.mkdtempSync(path.join(path.dirname(installed), '.runtime-copy-'));
    try {
      fs.cpSync(inspected.root, staging, { recursive: true, dereference: false, verbatimSymlinks: true });
      if (inspect(staging).payload.sha256 !== inspected.payload.sha256) throw new Error('Isolated runtime copy differs from published artifact');
      fs.renameSync(staging, installed);
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
  if (inspect(installed, service).payload.sha256 !== inspected.payload.sha256) throw new Error('Installed runtime version is immutable');
  for (const name of ['.env', '.env.generated']) {
    const source = path.join(service, name);
    const destination = path.join(installed, name);
    if (!fs.existsSync(source)) continue;
    if (fs.existsSync(destination)) {
      if (!fs.lstatSync(destination).isSymbolicLink() || fs.realpathSync(destination) !== fs.realpathSync(source)) throw new Error('Unexpected environment file inside immutable runtime');
    } else fs.symlinkSync(path.relative(installed, source), destination);
  }
  const waitHealthy = async () => {
    const deadline = now() + (input.timeoutMs ?? 30000);
    let stable: number | null = null;
    while (now() < deadline) {
      const process = list().find(row => row.name === selected.name);
      const status = await probe(port, input.healthPath || '/health');
      let listener = '';
      try { listener = run('ss', ['-ltnp', 'sport = :' + port], { cwd: service }); } catch {}
      if (process?.pm2_env.status === 'online' && status >= 200 && status < 300 && listener.includes('pid=' + process.pid + ',')) {
        if (stable === process.pid) return process;
        stable = process.pid;
      } else stable = null;
      await sleep(500);
    }
    throw new Error('Runtime did not become healthy with the expected process and port');
  };
  const target = path.join(installed, 'dist');
  if (fs.lstatSync(active).isSymbolicLink() && fs.realpathSync(active) === target) {
    const process = await waitHealthy();
    return { action: 'activate', unchanged: true, process: process.name, pid: process.pid, port, versionTag: input.versionTag, runtimeDirectory: installed };
  }
  const backup = path.join(service, 'dist.bak-' + now() + '-' + process.pid);
  fs.renameSync(active, backup);
  try {
    fs.symlinkSync(path.relative(service, target), active, 'dir');
    run('pm2', ['restart', selected.name], { cwd: service });
    const process = await waitHealthy();
    return { action: 'activate', unchanged: false, process: process.name, pid: process.pid, port, versionTag: input.versionTag, backup, isolatedDependencies: true, runtimeDirectory: installed };
  } catch (failure) {
    let activeStat: import('node:fs').Stats | null = null;
    try { activeStat = fs.lstatSync(active); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (activeStat) {
      if (!activeStat.isSymbolicLink() || path.resolve(service, fs.readlinkSync(active)) !== target) throw new Error('Runtime activation failed and active directory changed unexpectedly; backup retained');
      fs.unlinkSync(active);
    }
    fs.renameSync(backup, active);
    run('pm2', ['restart', selected.name], { cwd: service });
    await waitHealthy();
    throw new Error('Runtime activation failed; previous dist restored and healthy: ' + (failure as Error).message);
  }
}

export function backendRuntimeProgram(): string {
  return '(' + executeBackendRuntime.toString() + ')(process.env.BACKEND_RUNTIME_PAYLOAD?JSON.parse(Buffer.from(process.env.BACKEND_RUNTIME_PAYLOAD,"base64").toString("utf8")):{' +
    "action:process.env.BACKEND_RUNTIME_ACTION,workspace:process.env.RELEASE_DIR,runtimeRoot:process.env.WEB_SYSTEM_DIR,runtimeStorageRoot:process.env.BACKEND_RUNTIME_ROOT,moduleDirectory:process.env.MODULE_DIR,moduleKey:process.env.MODULE_KEY,versionTag:process.env.COMMIT_ID,serviceDirectory:process.env.RUNTIME_SERVICE_DIR,versionDirectory:process.env.RUNTIME_VERSION_DIR,pnpm:process.env.RELEASE_PNPM_BIN||'pnpm',processName:process.env.PM2_NAME,port:process.env.PORT,healthPath:process.env.RUNTIME_HEALTH_PATH||'/health'" +
    "}).then(result=>process.stdout.write(JSON.stringify(result)+'\\n')).catch(error=>{console.error(error.message);process.exitCode=1;});";
}

export function backendRuntimeActivationCommand(input: Omit<BackendRuntimeInput, 'action'>): string {
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const environment = { BACKEND_RUNTIME_ACTION: 'activate', MODULE_KEY: input.moduleKey, COMMIT_ID: input.versionTag, RUNTIME_SERVICE_DIR: input.serviceDirectory || '', RUNTIME_VERSION_DIR: input.versionDirectory || '', PM2_NAME: input.processName || '', PORT: input.port || '', BACKEND_RUNTIME_ROOT: input.runtimeStorageRoot || '', RUNTIME_HEALTH_PATH: input.healthPath || '/health' };
  return Object.entries(environment).map(([key, value]) => key + '=' + quote(value)).join(' ') + " node <<'CONSOLE_BACKEND_RUNTIME'\n" + backendRuntimeProgram() + '\nCONSOLE_BACKEND_RUNTIME';
}
