// ============================================================
// 老库迁移脚本：升级为多租户（可重复执行，幂等）
// 1) 新建 tenant / tenant_theme 表并写入默认品牌「谜宫·全息」
// 2) 13 张业务表补 tenant_id（既有数据全部归属 tenant 1）
// 3) 唯一键重建为租户维度（旧唯一键删除，新复合唯一键建立）
// 4) settings 由 id=1 单行改为按租户（tenant_id 主键）
// 用法：npm run migrate
// ============================================================
require('dotenv').config();
const mysql = require('mysql2/promise');

const DB = process.env.DB_NAME || 'maze_kill';

// [表, 旧唯一键名, 新唯一键名, 新键列] —— 旧键为无名唯一键时按首列命名
const KEY_CHANGES = [
  ['user',         'openid',            'uk_tenant_openid',          '(tenant_id, openid)'],
  ['account',      'staff_no',          'uk_tenant_staffno',         '(tenant_id, staff_no)'],
  ['dm_skill',     'uk_dm_script_role', 'uk_tenant_dm_script_role',  '(tenant_id, dm_id, script_id, role_name)'],
  ['session',      'uk_date_slot_script','uk_tenant_date_slot_script','(tenant_id, work_date, slot, script_id)'],
  ['availability', 'uk_dm_date_slot',   'uk_tenant_dm_date_slot',    '(tenant_id, dm_id, work_date, slot)'],
  ['session_dm',   'uk_session_dm',     'uk_tenant_session_dm',      '(tenant_id, session_id, dm_id)'],
  ['member_card',  'openid',            'uk_tenant_openid',          '(tenant_id, openid)'],
  ['salary_record','uk_dm_month',       'uk_tenant_dm_month',        '(tenant_id, dm_id, month)']
];
const ALL_TABLES = ['user', 'account', 'dm', 'script', 'dm_skill', 'session', 'availability',
  'session_dm', 'booking', 'member_card', 'coupon', 'card_flow', 'leave_record', 'salary_record', 'admin_log'];

async function hasColumn(conn, table, col) {
  const [r] = await conn.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`, [DB, table, col]);
  return r[0].n > 0;
}
async function hasKey(conn, table, key) {
  const [r] = await conn.query(
    `SELECT COUNT(DISTINCT INDEX_NAME) n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?`, [DB, table, key]);
  return r[0].n > 0;
}
async function hasTable(conn, table) {
  const [r] = await conn.query(
    `SELECT COUNT(*) n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, [DB, table]);
  return r[0].n > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: DB,
    multipleStatements: true
  });

  // 1. 租户与主题表
  await conn.query(`CREATE TABLE IF NOT EXISTS tenant (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(50) NOT NULL,
    status ENUM('active','disabled') NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP) COMMENT '品牌/租户'`);
  await conn.query(`CREATE TABLE IF NOT EXISTS tenant_theme (
    tenant_id INT PRIMARY KEY,
    logo VARCHAR(500) DEFAULT '',
    brand_name VARCHAR(50) DEFAULT '',
    colors JSON,
    bg_image VARCHAR(500) DEFAULT '',
    bg_mode ENUM('cover','contain') NOT NULL DEFAULT 'cover',
    bg_overlay DECIMAL(2,1) NOT NULL DEFAULT 0.6,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) COMMENT '品牌主题'`);
  await conn.query(`INSERT INTO tenant(id, code, name) VALUES(1, 'migong', '谜宫·全息')
    ON DUPLICATE KEY UPDATE id=id`);
  await conn.query(`INSERT INTO tenant_theme(tenant_id, brand_name, colors) VALUES(1, '谜宫·全息演绎',
    '{"primary":"#C02027","deep":"#8B1418","gold":"#C9A063","goldLight":"#E0C48A","bg":"#100D0E","card":"#1C1618","line":"#332B2D","text":"#F4EBE9","muted":"#ABA0A0","dim":"#6F6668"}')
    ON DUPLICATE KEY UPDATE tenant_id=tenant_id`);
  console.log('✓ tenant / tenant_theme 就绪（默认品牌 migong）');

  // 2. 业务表补 tenant_id（既有行自动落 1）
  for (const t of ALL_TABLES) {
    if (!(await hasTable(conn, t))) { console.log(`- 跳过（表不存在）：${t}`); continue; }
    if (!(await hasColumn(conn, t, 'tenant_id'))) {
      await conn.query(`ALTER TABLE ${t} ADD COLUMN tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌' AFTER id`);
      console.log(`✓ ${t} 增加 tenant_id（旧数据归属 tenant 1）`);
    }
  }

  // 3. 唯一键重建为租户维度
  for (const [t, oldKey, newKey, cols] of KEY_CHANGES) {
    if (!(await hasTable(conn, t))) continue;
    if (await hasKey(conn, t, oldKey)) {
      await conn.query(`ALTER TABLE ${t} DROP INDEX \`${oldKey}\``);
      console.log(`✓ ${t} 删除旧唯一键 ${oldKey}`);
    }
    if (!(await hasKey(conn, t, newKey))) {
      await conn.query(`ALTER TABLE ${t} ADD UNIQUE KEY \`${newKey}\` ${cols}`);
      console.log(`✓ ${t} 建立新唯一键 ${newKey}`);
    }
  }

  // 4. settings 改按租户（id=1 → tenant_id=1）
  if (await hasTable(conn, 'settings') && !(await hasColumn(conn, 'settings', 'tenant_id'))) {
    await conn.query(`ALTER TABLE settings ADD COLUMN tenant_id INT DEFAULT NULL FIRST`);
    await conn.query(`UPDATE settings SET tenant_id=1 WHERE tenant_id IS NULL`);
    try { await conn.query(`ALTER TABLE settings MODIFY id INT`); } catch (e) {}
    try { await conn.query(`ALTER TABLE settings DROP PRIMARY KEY`); } catch (e) {}
    await conn.query(`ALTER TABLE settings ADD PRIMARY KEY(tenant_id)`);
    if (await hasColumn(conn, 'settings', 'id')) {
      await conn.query(`ALTER TABLE settings DROP COLUMN id`);
    }
    console.log('✓ settings 改为按租户主键');
  }
  await conn.query(`INSERT INTO settings(tenant_id) VALUES(1) ON DUPLICATE KEY UPDATE tenant_id=tenant_id`);

  await conn.end();
  console.log('==== 多租户迁移完成：全部旧数据归属 tenant 1（谜宫·全息），业务零变化 ====');
  process.exit(0);
}

main().catch(e => { console.error('迁移失败：', e.message); process.exit(1); });
