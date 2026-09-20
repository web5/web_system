const { DataSource } = require('typeorm');
const { SnakeNamingStrategy } = require('@web-system/shared');
const env = require('./dist/servers/deploy-console/src/entities/deploy-environment.entity.js');
const dep = require('./dist/servers/deploy-console/src/entities/deploy-deployment.entity.js');
const task = require('./dist/servers/deploy-console/src/entities/deploy-task.entity.js');
const ver = require('./dist/servers/deploy-console/src/entities/deploy-version.entity.js');
const audit = require('./dist/servers/deploy-console/src/entities/audit-log.entity.js');

const ds = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'web_system_deploy',
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
