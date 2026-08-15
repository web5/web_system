const { DataSource } = require('typeorm');
const { SnakeNamingStrategy } = require('@web-system/shared');
const env = require('./dist/entities/deploy-environment.entity.js');
const dep = require('./dist/entities/deploy-deployment.entity.js');
const task = require('./dist/entities/deploy-task.entity.js');
const ver = require('./dist/entities/deploy-version.entity.js');
const audit = require('./dist/entities/audit-log.entity.js');
const ds = new DataSource({ type:'mysql', host:'127.0.0.1', port:3306, username:'root', password:'KedouLocal@2026', database:'web_system_deploy', namingStrategy: new SnakeNamingStrategy(), entities:[env.DeployEnvironmentEntity, dep.DeployDeploymentEntity, task.DeployTaskEntity, ver.DeployVersionEntity, audit.AuditLogEntity] });
(async () => { await ds.initialize(); const sql = await ds.driver.createSchemaBuilder().log();
  for (const q of sql.upQueries) { if (/CREATE TABLE/i.test(q.query)) console.log(q.query.slice(0,160)+'...'); }
  await ds.destroy(); })().catch(e=>{console.error('ERR',e.message);process.exit(1);});
