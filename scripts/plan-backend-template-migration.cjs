const fs = require('node:fs');
const path = require('node:path');

function createReadinessReport(input, inspect) {
  if (input.schema !== 1 || !Array.isArray(input.modules) || !input.modules.length) throw new Error('Nonempty schema-1 module snapshot required');
  const identities = new Set();
  const modules = input.modules.map(module => {
    const identity = `${module.moduleKey}@${module.environment}`;
    if (identities.has(identity)) throw new Error('Duplicate module/environment snapshot');
    identities.add(identity);
    return inspect(module);
  });
  const blockerCounts = {};
  for (const module of modules) for (const blocker of module.blockers) blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
  return { schema: 1, readOnly: true, canPublish: false, modules, summary: { modules: modules.length, standardTemplates: modules.filter(module => module.templateShape === 'standard-five-action').length, customTemplates: modules.filter(module => module.templateShape !== 'standard-five-action').length, blockerCounts } };
}

function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!['--input', '--output'].includes(option) || options[option] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Only --input and optional --output are supported');
    options[option] = args[index + 1];
  }
  if (!options['--input']) throw new Error('Private input file required');
  const { inspectBackendTemplateReadiness } = require(path.join(__dirname, '../servers/deploy-console/dist/pipeline/backend-template-readiness.js'));
  const report = createReadinessReport(JSON.parse(fs.readFileSync(options['--input'], 'utf8')), inspectBackendTemplateReadiness);
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (options['--output']) fs.writeFileSync(options['--output'], serialized, { flag: 'wx', mode: 0o600 });
  else process.stdout.write(serialized);
}

module.exports = { createReadinessReport, main };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Backend template readiness failed; check arguments, private input, local Console build, and output-file availability.'); process.exitCode = 1; }
}
