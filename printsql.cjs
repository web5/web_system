const { DataSource } = require('typeorm');
const { SnakeNamingStrategy } = require('@web-system/shared');
const env = require('./dist/servers/deploy-console/src/entities/deploy-environment.entity.js');
const dep = require('./dist/servers/deploy-console/src/entities/deploy-deployment.entity.js');
const task = require('./dist/servers/deploy-console/src/entities/deploy-task.entity.js');
const ver = require('./dist/servers/deploy-console/src/entities/deploy-version.entity.js');
const audit = require('./dist/servers/deploy-console/src/entities/audit-log.entity.js');

const ds = new DataSource({
  type: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  password: 'KedouLocal@2026',
  database: 'web_system_deploy',
  namingStrategy: new SnakeNamingStrategy(),
  entities: [env.DeployEnvironmentEntity, dep.DeployDeploymentEntity, task.DeployTaskEntity, ver.DeployVersionEntity, audit.AuditLogEntity],
});

(async () => {
  await ds.initialize();
  const builder = ds.driver.createSchemaBuilder();
  const sqlInMemory = await builder.log();
  for (const up of sqlInMemory.upQueries) {
    if (/created_at|updated_at|datetime/i.test(up.query)) console.log(up.query + ';');
  }
  await ds.destroy();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
