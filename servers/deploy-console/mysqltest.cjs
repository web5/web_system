const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({ host:'127.0.0.1', port:3306, user:'root', password:'KedouLocal@2026', database:'web_system_deploy' });
  const [m] = await conn.query("SELECT @@sql_mode AS sm, @@explicit_defaults_for_timestamp AS edt");
  console.log('sql_mode =', m[0].sm);
  console.log('explicit_defaults_for_timestamp =', m[0].edt);
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS _t1 (id int, created_at datetime(3) DEFAULT CURRENT_TIMESTAMP(3))",
    "CREATE TABLE IF NOT EXISTS _t2 (id int, created_at datetime DEFAULT CURRENT_TIMESTAMP(3))",
    "CREATE TABLE IF NOT EXISTS _t3 (id int, created_at datetime(6) DEFAULT CURRENT_TIMESTAMP)",
  ]) {
    try { await conn.query(sql); console.log('OK  :', sql); await conn.query(sql.replace('CREATE TABLE','DROP TABLE')); }
    catch(e){ console.log('FAIL:', sql, '=>', e.message); }
  }
  await conn.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
