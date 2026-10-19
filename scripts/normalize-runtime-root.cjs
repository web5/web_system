const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function statPath(location) {
  try { return fs.lstatSync(location); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function physicalPath(location) {
  let current = path.resolve(location);
  const suffix = [];
  while (!statPath(current)) { suffix.unshift(path.basename(current)); current = path.dirname(current); }
  return path.join(fs.realpathSync(current), ...suffix);
}

function rootSnapshot(location) {
  const stat = statPath(location);
  if (!stat) return { exists: false };
  if (!stat.isDirectory() && !stat.isSymbolicLink()) throw new Error('Runtime root is not a directory');
  const realPath = fs.realpathSync(location);
  if (!fs.existsSync(path.join(realPath, 'package.json')) || !fs.existsSync(path.join(realPath, 'servers'))) throw new Error('Runtime root is not a recognized project tree');
  if (statPath(path.join(realPath, '.git'))?.isFile()) throw new Error('External Git worktree metadata requires manual migration');
  const entries = [];
  const walk = relative => {
    const file = path.join(realPath, relative);
    const item = statPath(file);
    if (!item) return;
    if (item.isSymbolicLink()) entries.push([relative, 'link:' + fs.readlinkSync(file)]);
    else if (item.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(path.join(relative, name));
    else if (item.isFile()) entries.push([relative, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
  };
  for (const relative of ['package.json', 'pnpm-lock.yaml', '.env', '.env.production', 'ecosystem.config.js', 'ecosystem.config.cjs', '.git/HEAD', '.git/packed-refs', '.git/config']) walk(relative);
  const headFile = path.join(realPath, '.git/HEAD');
  if (fs.existsSync(headFile)) {
    const reference = /^ref:\s*(refs\/[A-Za-z0-9_./-]+)\s*$/.exec(fs.readFileSync(headFile, 'utf8'))?.[1];
    if (reference && !reference.split('/').includes('..')) walk(path.join('.git', reference));
  }
  for (const name of fs.readdirSync(path.join(realPath, 'servers')).sort()) {
    const service = path.join(realPath, 'servers', name);
    if (!fs.statSync(service).isDirectory()) continue;
    for (const item of ['.env', '.env.generated', 'dist']) walk(path.join('servers', name, item));
  }
  return { exists: true, inode: stat.ino, device: stat.dev, symlink: stat.isSymbolicLink(), realPath, payloadSha256: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex'), observedFiles: entries.length };
}

function readProcesses() {
  const home = process.env.PM2_HOME || path.join(os.homedir(), '.pm2');
  const pidFile = path.join(home, 'pm2.pid');
  if (!fs.existsSync(pidFile) || !fs.existsSync(path.join(home, 'rpc.sock'))) return [];
  process.kill(Number(fs.readFileSync(pidFile, 'utf8').trim()), 0);
  return JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] })).map(row => ({ name: row.name, pid: row.pid, status: row.pm2_env.status, cwd: row.pm2_env.pm_cwd, script: row.pm2_env.pm_exec_path }));
}

function externalProcesses(roots) {
  if (!fs.existsSync('/proc')) return [];
  const matches = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      const cwd = fs.readlinkSync('/proc/' + entry + '/cwd');
      const command = fs.readFileSync('/proc/' + entry + '/cmdline', 'utf8');
      if (roots.some(root => inside(root, cwd) || command.split('\0').some(argument => argument.startsWith(root + '/')))) matches.push({ pid: Number(entry), cwd });
    } catch {}
  }
  return matches;
}

function createPlan(options = {}, processes = readProcesses()) {
  const root = path.resolve(options.root || '/data/web_system');
  const legacy = path.resolve(options.legacy || '/data/web_system_git');
  const backupRoot = physicalPath(options.backupRoot || path.join(path.dirname(root), 'web_system_backups'));
  if (path.basename(root) !== 'web_system' || path.basename(legacy) !== 'web_system_git' || path.dirname(root) !== path.dirname(legacy)) throw new Error('Only sibling web_system_git to web_system normalization is supported');
  if ([root, legacy, physicalPath(root), physicalPath(legacy)].some(directory => inside(directory, backupRoot) || inside(backupRoot, directory))) throw new Error('Backup root must be outside both runtime trees');
  const target = rootSnapshot(root);
  const source = rootSnapshot(legacy);
  const references = processes.filter(row => [root, legacy].some(directory => inside(directory, row.script || '') || inside(directory, row.cwd || ''))).map(row => ({ name: row.name, cwd: row.cwd, script: row.script, status: row.status, pid: row.pid }));
  const legacyReferences = references.filter(row => inside(legacy, row.script || ''));
  const targetReferences = references.filter(row => inside(root, row.script || ''));
  let mode;
  if (target.exists && source.exists && source.symlink && source.realPath === root && !target.symlink) mode = 'already-normalized';
  else if (!source.exists) mode = target.exists && !target.symlink ? 'already-normalized' : 'blocked-no-source';
  else if (source.symlink) mode = 'blocked-unexpected-legacy-link';
  else if (legacyReferences.length && !targetReferences.length) mode = 'promote-legacy-tree';
  else mode = 'blocked-ambiguous-process-roots';
  const identity = { schema: 1, root, legacy, backupRoot, target, source, mode, references: references.map(({ name, cwd, script }) => ({ name, cwd, script })).sort((left, right) => left.name.localeCompare(right.name)) };
  const planId = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const active = references.filter(row => !['stopped', 'errored'].includes(row.status));
  return { ...identity, planId, readOnly: true, activeProcesses: active, blockers: mode.startsWith('blocked-') ? [mode] : [], intendedMoves: mode === 'promote-legacy-tree' ? ['preserve-existing-web_system', 'rename-web_system_git-to-web_system', 'retain-legacy-compatibility-symlink'] : [], restartPerformed: false, staticRootMoved: false, buildWorkspaceMoved: false };
}

function assertOffline(plan, processes) {
  const current = createPlan(plan, processes);
  if (current.planId !== plan.planId) throw new Error('Runtime trees or process references changed after planning');
  if (current.activeProcesses.length) throw new Error('Maintenance window required: stop referenced processes before changing runtime directories');
  if (externalProcesses([plan.root, plan.legacy, current.target.realPath, current.source.realPath].filter(Boolean)).length) throw new Error('Processes still hold runtime paths; directory cutover refused');
  return current;
}

function writeReceipt(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

function applyPlan(plan, options = {}, processes = readProcesses()) {
  if (options.confirmRoot !== plan.root) throw new Error('Explicit --confirm-root is required');
  const current = assertOffline(plan, processes);
  if (current.mode === 'already-normalized') return { status: 'unchanged', root: plan.root };
  if (current.mode !== 'promote-legacy-tree') throw new Error('Blocked plan cannot be applied');
  const parentDevice = fs.statSync(path.dirname(plan.root)).dev;
  if (current.source.device !== parentDevice || (current.target.exists && current.target.device !== parentDevice)) throw new Error('Runtime roots must support same-filesystem rename');
  fs.mkdirSync(plan.backupRoot, { recursive: true, mode: 0o700 });
  if (fs.statSync(plan.backupRoot).dev !== parentDevice) throw new Error('Backup root is on another filesystem');
  const backup = fs.mkdtempSync(path.join(plan.backupRoot, 'runtime-root-'));
  fs.chmodSync(backup, 0o700);
  const previous = path.join(backup, 'web_system.before');
  const receiptFile = path.join(backup, 'receipt.json');
  const receipt = { schema: 1, plan, backup, previous, receiptFile, status: 'preparing', restartPerformed: false, staticRootMoved: false };
  writeReceipt(receiptFile, receipt);
  let movedTarget = false;
  let movedSource = false;
  let linked = false;
  try {
    if (current.target.exists) {
      fs.renameSync(plan.root, previous); movedTarget = true;
      receipt.phase = 'original-target-preserved'; writeReceipt(receiptFile, receipt);
    }
    fs.renameSync(plan.legacy, plan.root); movedSource = true;
    receipt.phase = 'legacy-promoted'; writeReceipt(receiptFile, receipt);
    fs.symlinkSync(plan.root, plan.legacy, 'dir'); linked = true;
    receipt.phase = 'compatibility-linked';
    receipt.status = 'directory-normalized-offline-pending-service-validation';
    writeReceipt(receiptFile, receipt);
    return receipt;
  } catch (error) {
    if (linked) {
      if (!statPath(plan.legacy)?.isSymbolicLink() || fs.readlinkSync(plan.legacy) !== plan.root) throw new Error('Legacy path changed during failure recovery; inspect retained receipt');
      fs.unlinkSync(plan.legacy);
    }
    if (movedSource) fs.renameSync(plan.root, plan.legacy);
    if (movedTarget) fs.renameSync(previous, plan.root);
    receipt.status = 'restored-after-failure'; receipt.error = error.message;
    writeReceipt(receiptFile, receipt);
    throw error;
  }
}

function rollbackMigration(receipt, options = {}, processes = readProcesses()) {
  const plan = receipt.plan;
  if (options.confirmRoot !== plan.root) throw new Error('Explicit --confirm-root is required');
  if (receipt.status === 'rolled-back') return { status: 'unchanged', receiptFile: receipt.receiptFile };
  if (receipt.status !== 'directory-normalized-offline-pending-service-validation') throw new Error('Receipt is not a completed directory cutover');
  const current = createPlan(plan, processes);
  if (!inside(plan.backupRoot, receipt.backup) || path.basename(receipt.backup).indexOf('runtime-root-') !== 0 || receipt.previous !== path.join(receipt.backup, 'web_system.before') || receipt.receiptFile !== path.join(receipt.backup, 'receipt.json')) throw new Error('Invalid migration receipt paths');
  if (JSON.stringify(current.references) !== JSON.stringify(plan.references)) throw new Error('Restore original stopped PM2 references before directory rollback');
  if (current.activeProcesses.length || externalProcesses([plan.root, plan.legacy, current.target.realPath, current.source.realPath].filter(Boolean)).length) throw new Error('Maintenance window required for directory rollback');
  const rootIdentity = fs.lstatSync(plan.root);
  if (!statPath(plan.legacy)?.isSymbolicLink() || fs.readlinkSync(plan.legacy) !== plan.root || !rootIdentity.isDirectory() || rootIdentity.ino !== plan.source.inode || rootIdentity.dev !== plan.source.device) throw new Error('Runtime identities changed; rollback refused');
  if (plan.target.exists && fs.lstatSync(receipt.previous).ino !== plan.target.inode) throw new Error('Original target backup identity changed');
  fs.unlinkSync(plan.legacy);
  fs.renameSync(plan.root, plan.legacy);
  if (plan.target.exists) fs.renameSync(receipt.previous, plan.root);
  receipt.status = 'rolled-back';
  writeReceipt(receipt.receiptFile, receipt);
  return receipt;
}

function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--plan') { options.plan = true; continue; }
    const keys = { '--root': 'root', '--legacy': 'legacy', '--backup-root': 'backupRoot', '--output': 'output', '--apply': 'apply', '--rollback': 'rollback', '--confirm-root': 'confirmRoot' };
    if (!keys[argument] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Unknown or incomplete argument: ' + argument);
    options[keys[argument]] = args[++index];
  }
  if (options.apply && options.rollback) throw new Error('Choose apply or rollback, not both');
  if (options.plan && (options.apply || options.rollback)) throw new Error('Read-only plan cannot be combined with apply or rollback');
  const result = options.apply ? applyPlan(JSON.parse(fs.readFileSync(options.apply, 'utf8')), options) : options.rollback ? rollbackMigration(JSON.parse(fs.readFileSync(options.rollback, 'utf8')), options) : createPlan(options);
  const output = JSON.stringify(result, null, 2) + '\n';
  if (options.output) fs.writeFileSync(options.output, output, { mode: 0o600, flag: 'wx' });
  else process.stdout.write(output);
}

module.exports = { createPlan, applyPlan, rollbackMigration, readProcesses };
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
