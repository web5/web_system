import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createRequire, isBuiltin } from 'node:module';
import { executeBackendRuntime } from './backend-runtime';

const payloadRoots = ['package.json', 'version.json', 'dist', 'node_modules'];
const sha256 = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const contains = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
};
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const packageNameIsSafe = (value: string) => /^(?:@[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(value);

interface CheckpointDependencyEdge {
  name: string;
  provider: number | null;
  required: boolean;
  builtin?: boolean;
}

function inventory(root: string, roots = [''], skipNodeModules = false) {
  const entries: Array<[string, string]> = [];
  let bytes = 0;
  const walk = (relative: string) => {
    if (skipNodeModules && relative === 'node_modules') return;
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const link = fs.readlinkSync(file);
      if (path.isAbsolute(link) || !contains(root, fs.realpathSync(file))) throw new Error('Captured dependency has an escaping link');
      entries.push([relative, 'link:' + link]);
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) walk(path.join(relative, name));
    } else if (stat.isFile()) {
      bytes += stat.size;
      entries.push([relative, sha256(fs.readFileSync(file))]);
    } else throw new Error('Unsupported checkpoint file');
  };
  for (const relative of roots) walk(relative);
  return { sha256: sha256(JSON.stringify(entries)), files: entries.length, bytes };
}

function stagingDirectory(output: string, protectedRoots: string[]) {
  if (!path.isAbsolute(output)) throw new Error('Absolute preparation output required');
  const parent = fs.realpathSync(path.dirname(output));
  const destination = path.join(parent, path.basename(output));
  if (fs.existsSync(destination) || protectedRoots.some(root => contains(root, destination) || contains(destination, root))) throw new Error('Preparation output exists or overlaps its source');
  for (let ancestor = parent; ; ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(path.join(ancestor, 'node_modules'))) throw new Error('Preparation output has ambient ancestor dependencies');
    if (ancestor === path.dirname(ancestor)) break;
  }
  const staging = fs.mkdtempSync(path.join(parent, '.runtime-prepare-'));
  fs.chmodSync(staging, 0o700);
  return { destination, staging };
}

export async function cloneVerifiedBackendRuntime(input: {
  sourceDirectory: string;
  outputDirectory: string;
  moduleKey: string;
  versionTag: string;
  expectedPayloadSha256: string;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.expectedPayloadSha256)) throw new Error('Expected candidate payload digest required');
  const source = fs.realpathSync(input.sourceDirectory);
  const { staging, destination } = stagingDirectory(input.outputDirectory, [source]);
  try {
    for (const name of [...payloadRoots, 'runtime-manifest.json']) {
      const file = path.join(source, name);
      const stat = fs.lstatSync(file);
      if (['dist', 'node_modules'].includes(name) ? !stat.isDirectory() : !stat.isFile()) throw new Error('Candidate payload root is not a real file/directory');
      fs.cpSync(file, path.join(staging, name), { recursive: true, dereference: false, verbatimSymlinks: true });
    }
    const inspected = await executeBackendRuntime({ action: 'inspect', moduleKey: input.moduleKey, versionTag: input.versionTag, versionDirectory: staging });
    if (inspected.payloadSha256 !== input.expectedPayloadSha256) throw new Error('Candidate does not match the reviewed payload');
    fs.renameSync(staging, destination);
    return { ...inspected, action: 'prepare-candidate', directory: destination, excludedRootEntries: fs.readdirSync(source).filter(name => ![...payloadRoots, 'runtime-manifest.json'].includes(name)) };
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

export async function captureBackendRuntimeCheckpoint(input: {
  runtimeRoot: string;
  serviceDirectory: string;
  outputDirectory: string;
  moduleKey: string;
  versionTag: string;
  sourceVersion: string;
  expectedDistSha256: string;
}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.moduleKey) || !/^runtime-checkpoint\/[a-zA-Z0-9_-]+$/.test(input.versionTag) || !/^[a-zA-Z0-9._/-]+$/.test(input.sourceVersion) || !/^[a-f0-9]{64}$/.test(input.expectedDistSha256)) throw new Error('Explicit checkpoint identity and reviewed runtime digest required');
  const root = fs.realpathSync(input.runtimeRoot);
  const service = fs.realpathSync(input.serviceDirectory);
  if (service !== path.join(root, 'servers', input.moduleKey)) throw new Error('Checkpoint service is not the declared runtime module');
  const active = fs.realpathSync(path.join(service, 'dist'));
  if (!contains(root, active)) throw new Error('Legacy checkpoint source escapes the reviewed runtime tree');
  const distBefore = inventory(active);
  if (distBefore.sha256 !== input.expectedDistSha256) throw new Error('Current runtime differs from the reviewed checkpoint');
  const serviceManifest = fs.readFileSync(path.join(service, 'package.json'));
  const metadata = JSON.parse(serviceManifest.toString());
  const nodes: Array<{ source: string; manifest: any; payload: ReturnType<typeof inventory>; edges: CheckpointDependencyEdge[] }> = [];
  const index = new Map<string, number>();
  let totalBytes = 0;
  const resolvePackage = (directory: string, name: string) => {
    const resolver = createRequire(path.join(directory, 'package.json'));
    for (const search of resolver.resolve.paths(name) || []) {
      const file = path.join(search, name, 'package.json');
      if (!fs.existsSync(file)) continue;
      const resolved = fs.realpathSync(path.dirname(file));
      if (!contains(root, resolved)) throw new Error('Checkpoint dependency resolves outside the runtime tree');
      return resolved;
    }
    return null;
  };
  const edgesFor = (directory: string, manifest: any): CheckpointDependencyEdge[] => {
    const names = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }).sort();
    return names.map(name => {
      if (!packageNameIsSafe(name)) throw new Error('Unsafe checkpoint dependency name');
      const required = !!manifest.dependencies?.[name] && !manifest.optionalDependencies?.[name];
      if (isBuiltin(name)) return { name, provider: null, required, builtin: true };
      const resolved = resolvePackage(directory, name);
      if (!resolved && required) throw new Error('Required checkpoint dependency is missing: ' + name);
      return { name, provider: resolved ? captureNode(resolved) : null, required };
    });
  };
  const captureNode = (source: string): number => {
    const existing = index.get(source);
    if (existing !== undefined) return existing;
    if (nodes.length >= 512) throw new Error('Checkpoint dependency graph exceeds its bounded package limit');
    for (const name of fs.readdirSync(source)) if (name !== '.env.example' && /^(?:\.env(?:$|\.)|\.npmrc$|id_(?:rsa|ed25519)$)|\.(?:key|pem)$/.test(name)) throw new Error('Private file present in checkpoint dependency');
    const manifest = readJson(path.join(source, 'package.json'));
    if (typeof manifest.name !== 'string' || !packageNameIsSafe(manifest.name)) throw new Error('Unsafe checkpoint package identity');
    const payload = inventory(source, [''], true);
    totalBytes += payload.bytes;
    if (totalBytes > 512 * 1024 * 1024) throw new Error('Checkpoint dependency payload exceeds its bounded size limit');
    const position = nodes.length;
    index.set(source, position);
    const node = { source, manifest, payload, edges: [] as CheckpointDependencyEdge[] };
    nodes.push(node);
    node.edges = edgesFor(source, manifest);
    const self = manifest.name && resolvePackage(source, manifest.name);
    if (self === source && !node.edges.some(edge => edge.name === manifest.name)) node.edges.push({ name: manifest.name, provider: position, required: false });
    return position;
  };
  const rootEdges = edgesFor(service, metadata);
  const { staging, destination } = stagingDirectory(input.outputDirectory, [root]);
  try {
    const locations = nodes.map((node, position) => path.join(staging, 'node_modules/.runtime-checkpoint', String(position), 'package'));
    fs.mkdirSync(path.join(staging, 'node_modules'), { mode: 0o700 });
    fs.writeFileSync(path.join(staging, 'package.json'), serviceManifest);
    fs.cpSync(active, path.join(staging, 'dist'), { recursive: true, dereference: false, verbatimSymlinks: true });
    const linkEdges = (directory: string, edges: typeof rootEdges) => {
      fs.mkdirSync(path.join(directory, 'node_modules'), { recursive: true });
      for (const edge of edges) {
        if (edge.provider === null) continue;
        const target = path.join(directory, 'node_modules', edge.name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.symlinkSync(path.relative(path.dirname(target), locations[edge.provider]), target, 'dir');
      }
    };
    for (const [position, node] of nodes.entries()) {
      const target = locations[position];
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(node.source)) {
        if (name === 'node_modules') continue;
        fs.cpSync(path.join(node.source, name), path.join(target, name), { recursive: true, dereference: false, verbatimSymlinks: true });
      }
      if (inventory(target, [''], true).sha256 !== node.payload.sha256) throw new Error('Copied checkpoint dependency differs from its source');
      linkEdges(target, node.edges);
    }
    linkEdges(staging, rootEdges);
    if (inventory(active).sha256 !== distBefore.sha256 || inventory(path.join(staging, 'dist')).sha256 !== distBefore.sha256 || !fs.readFileSync(path.join(service, 'package.json')).equals(serviceManifest)) throw new Error('Checkpoint runtime changed during capture');
    for (const node of nodes) if (inventory(node.source, [''], true).sha256 !== node.payload.sha256) throw new Error('Checkpoint dependency changed during capture');
    const capturedAt = new Date().toISOString();
    const version = { version: input.versionTag, sourceVersion: input.sourceVersion, gitCommit: null, provenance: 'runtime-checkpoint', capturedAt };
    fs.writeFileSync(path.join(staging, 'version.json'), JSON.stringify(version));
    const payload = inventory(staging, payloadRoots);
    const graph = nodes.map((node, position) => ({ id: position, name: node.manifest.name, version: node.manifest.version, packagePayloadSha256: node.payload.sha256, edges: node.edges }));
    const manifest = { format: 'web-system-runtime-v1', moduleKey: input.moduleKey, versionTag: input.versionTag, gitCommit: null, provenance: 'runtime-checkpoint', sourceVersion: input.sourceVersion, sourceDistSha256: distBefore.sha256, sourceDistFiles: distBefore.files, capturedAt, entry: 'dist/main.js', nodeAbi: process.versions.modules, platform: process.platform, architecture: process.arch, payloadSha256: payload.sha256, payloadFiles: payload.files, dependencyGraph: graph, dependencyGraphSha256: sha256(JSON.stringify(graph)), declaredDependencyClosureOnly: true };
    fs.writeFileSync(path.join(staging, 'runtime-manifest.json'), JSON.stringify(manifest));
    const inspected = await executeBackendRuntime({ action: 'inspect', moduleKey: input.moduleKey, versionTag: input.versionTag, versionDirectory: staging });
    fs.renameSync(staging, destination);
    return { ...inspected, action: 'capture-checkpoint', directory: destination, sourceVersion: input.sourceVersion, sourceDistSha256: distBefore.sha256, sourceDistFiles: distBefore.files, packages: graph.length, packageBytes: totalBytes, dependencyGraphSha256: manifest.dependencyGraphSha256, gitCommit: null, declaredDependencyClosureOnly: true };
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
