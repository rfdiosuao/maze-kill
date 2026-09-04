// ============================================================
// 演示数据种子：跑通全流程
// 超管账号 / 12名员工+DM / 468本剧本 / 未来30天午晚场 / 技能矩阵 /
// 时段占用表 / 演示会员卡与两笔锁卡预约（含系统扣款流水与薪资重算）
// 用法：npm run seed（自动建库建表，可重复执行=重置演示数据）
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { hash } = require('../utils/hash');
const assignService = require('../services/assignService');

// 价格池：数字尽量避"4"
const PRICES = [128, 168, 188, 258, 288, 368, 388, 528, 588, 688];
const TYPES = ['推理', '机制', '情感', '阵营', '还原', '欢乐', '微恐', '跑团'];
const ROLE_POOL = ['侦探', '法医', '记者', '富商', '医生', '教师', '管家', '秘书', '司机', '老板', '画家', '歌手', '侍女', '船长', '神父', '护士'];
const COMMISSIONS = [20, 25, 30, 35, 50, 60, 80];
const PREFIX = ['古', '迷', '雾', '幽', '长', '夜', '灯', '影', '镜', '纸', '雀', '鹤', '鲤', '舟', '山', '海', '城', '街', '巷', '桥'];
const CORES = ['谜案', '疑云', '暗涌', '回响', '遗书', '请柬', '筵席', '残卷', '旧梦', '新章', '谜途', '心证', '孤岛', '迷局', '暗号', '告解', '遗珍', '夜行', '谜面', '局中局', '谜踪', '破晓', '棋局', '归途'];
const DMS = ['影月', '烛岚', '雾川', '霜烬', '鸦澜', '萤火', '星河', '陌笙', '惊蛰', '白鹿', '青梧', '江离'];

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

async function main() {
  // 1. 建库建表
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });
  const schema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
  await conn.query(schema);
  await conn.query(`USE ${process.env.DB_NAME || 'maze_kill'}`);

  // 兼容旧库：dm 表补 user_id 列（新库 schema 已含，已存在则忽略）
  try {
    await conn.query(`ALTER TABLE dm ADD COLUMN user_id INT UNIQUE DEFAULT NULL COMMENT '绑定的小程序用户' AFTER account_id`);
  } catch (e) { /* 列已存在 */ }

  // 2. 清空旧数据（重置演示）
  await conn.query(`SET FOREIGN_KEY_CHECKS=0`);
  for (const t of ['account', 'dm', 'user', 'script', 'dm_skill', 'session', 'availability', 'session_dm',
    'booking', 'member_card', 'coupon', 'card_flow', 'leave_record', 'salary_record', 'admin_log', 'settings',
    'tenant', 'tenant_theme']) {
    await conn.query(`TRUNCATE TABLE ${t}`);
  }
  await conn.query(`SET FOREIGN_KEY_CHECKS=1`);

  // 2b. 默认品牌「谜宫·全息」+ 红金主题 + 租户设置
  await conn.query(`INSERT INTO tenant(id, code, name) VALUES(1, 'migong', '谜宫·全息')`);
  await conn.query(`INSERT INTO tenant_theme(tenant_id, brand_name, colors) VALUES(1, '谜宫·全息演绎', ?)`,
    [JSON.stringify({ primary: '#C02027', deep: '#8B1418', gold: '#C9A063', goldLight: '#E0C48A',
      bg: '#100D0E', card: '#1C1618', line: '#332B2D', text: '#F4EBE9', muted: '#ABA0A0', dim: '#6F6668' })]);
  await conn.query(`INSERT INTO settings(tenant_id, bonus_ladder, phone, wechat, address) VALUES(1, ?, ?, ?, ?)`,
    [JSON.stringify([{ min: 20, pay: 800 }, { min: 30, pay: 1500 }, { min: 40, pay: 2400 }]),
     '021-6688-6688', 'miguangame', '上海市黄浦区谜宫大厅1号']);

  // 3. 超管 + 员工账号(编号1~12) + DM档案（保密底薪）
  await conn.query(`INSERT INTO account(staff_no, name, phone, password_hash, role) VALUES(999, '超级管理员', '', ?, 'admin')`,
    [hash(process.env.ADMIN_PASSWORD || 'admin888')]);
  const dmIds = [];
  for (let i = 0; i < DMS.length; i++) {
    const name = DMS[i];
    const [r] = await conn.query(
      `INSERT INTO account(staff_no, name, phone, password_hash, role) VALUES(?,?,?,?,'staff')`,
      [i + 1, name, `138${pad(i + 1)}${pad(i * 7 + 13)}${pad(i * 11 + 7)}`.slice(0, 11), hash('123456')]);
    const [d] = await conn.query(
      `INSERT INTO dm(account_id, stage_name, tags, intro, base_salary) VALUES(?,?,?,?,?)`,
      [r.insertId, name, rnd(['金牌DM', '推理控', '气氛王', '细节狂魔', '老玩家']) + ',' + rnd(['情感本专精', '硬核推理', '恐怖本扛把子', '新手友好']),
       `${name}，从业${2 + i % 5}年，擅长${rnd(TYPES)}类剧本，控场稳、代入感强。`, 3500 + (i % 4) * 500]);
    dmIds.push(d.insertId);
  }

  // 4. 468本剧本（角色带单场提成）
  const scriptIds = [];
  for (const p of PREFIX) {
    for (const c of CORES) {
      if (scriptIds.length >= 468) break;
      const roles = [];
      const rn = 6 + Math.floor(Math.random() * 3);
      const picked = [...ROLE_POOL].sort(() => Math.random() - 0.5).slice(0, rn);
      picked.forEach(rn2 => roles.push({ name: rn2, commission: rnd(COMMISSIONS) }));
      const [r] = await conn.query(
        `INSERT INTO script(name, type, players_min, players_max, duration_min, price, grade, intro, roles)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [`${p}之${c}`, rnd(TYPES), 3 + Math.floor(Math.random() * 3), 6 + Math.floor(Math.random() * 5),
         rnd([180, 210, 240, 260, 300]), rnd(PRICES), Math.random() < 0.3 ? '18+' : '12+',
         `全息沉浸式剧本《${p}之${c}》：${rnd(['都市怪谈', '民国往事', '科幻悬疑', '古风权谋', '西式庄园', '校园青春'])}题材，${roles.length}人本，全息实景+机关联动，沉浸感拉满。`,
         JSON.stringify(roles)]);
      scriptIds.push(r.insertId);
    }
    if (scriptIds.length >= 468) break;
  }

  // 5. 技能矩阵：每DM随机会约60本（熟练度2~5）
  for (const dmId of dmIds) {
    const picked = [...scriptIds].sort(() => Math.random() - 0.5).slice(0, 60);
    const vals = picked.map(sid => [dmId, sid, '', 2 + Math.floor(Math.random() * 4)]);
    await conn.query(`INSERT INTO dm_skill(dm_id, script_id, role_name, proficiency) VALUES ?`, [vals]);
  }

  // 6. 未来30天午/晚场：每天各时段2个剧本场，required_dm=3
  const sessionIds = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const wd = dateStr(d);
    for (const [slot, st] of [['noon', '13:00:00'], ['night', '19:00:00']]) {
      const picked = [...scriptIds].sort(() => Math.random() - 0.5).slice(0, 2);
      for (const sid of picked) {
        const [r] = await conn.query(
          `INSERT INTO session(work_date, slot, script_id, start_time, required_dm) VALUES(?,?,?,?,3)`,
          [wd, slot, sid, st]);
        sessionIds.push(r.insertId);
      }
    }
  }

  // 7. 时段占用表：全部DM未来30天午晚默认空闲
  const avVals = [];
  for (const dmId of dmIds) {
    for (let i = 0; i < 30; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      avVals.push([dmId, dateStr(d), 'noon', 'free'], [dmId, dateStr(d), 'night', 'free']);
    }
  }
  await conn.query(`INSERT INTO availability(dm_id, work_date, slot, status) VALUES ?`, [avVals]);

  await conn.end();

  // 8. 演示会员卡 + 两笔锁卡预约（走真实服务：扣款流水+薪资重算）
  const pool = require('../config/db');
  // 8. 演示小程序用户：普通玩家（演示openid，配会员卡）+ 客户升级的DM（体验"设为DM"效果）
  await pool.query(
    `INSERT INTO user(openid, nickname, phone, role) VALUES('dev_demo','演示玩家','13800001234','player')`);
  const [dmUser] = await pool.query(
    `INSERT INTO user(openid, nickname, phone, role) VALUES('dev_dm_001','阿荧','13900001111','dm')`);
  await pool.query(
    `INSERT INTO dm(user_id, stage_name, tags, intro, base_salary) VALUES(?,?,?,?,?)`,
    [dmUser.insertId, '阿荧', '金牌DM,情感本专精', '阿荧，资深玩家转正的DM，共情力强、氛围拉满。', 3000]);

  await pool.query(`INSERT INTO member_card(openid, balance) VALUES('dev_demo', 520.00)`);
  await pool.query(`INSERT INTO coupon(openid, name, value) VALUES('dev_demo', '新客立减券', 50)`);
  const pool2 = pool;
  for (let k = 0; k < 2; k++) {
    // 挑最近未满且有空闲DM的场次
    const [ses] = await pool2.query(
      `SELECT s.id FROM session s WHERE s.status='open' AND s.work_date>=CURDATE()
        ORDER BY s.work_date LIMIT 1 OFFSET ${k}`);
    if (!ses.length) continue;
    const [freeDm] = await pool2.query(
      `SELECT d.id FROM dm d
        JOIN session s ON s.id=?
        LEFT JOIN availability a ON a.dm_id=d.id AND a.work_date=s.work_date AND a.slot=s.slot AND a.status='free'
       WHERE d.status='active' AND a.id IS NOT NULL
         AND d.id NOT IN (SELECT dm_id FROM session_dm WHERE session_id=?) LIMIT 1`, [ses[0].id, ses[0].id]);
    if (!freeDm.length) continue;
    await assignService.lockBooking({
      sessionId: ses[0].id, dmId: freeDm[0].id, openid: 'dev_demo',
      name: '演示玩家', phone: '13800001234', people: 6,
      payType: k === 0 ? 'card' : 'store', useCoupon: false
    });
  }

  // 9. 触发一次自动补位（72h内场次补满）
  const { autoFill } = require('../services/scheduleService');
  const out = await autoFill();

  console.log('==== 演示数据就绪 ====');
  console.log(`剧本：${scriptIds.length} 本；员工/DM：${DMS.length} 名；场次：未来30天午晚各2场`);
  console.log(`自动补位：已补 ${out.filled} 个席位，缺人预警 ${out.warnings.length} 场`);
  console.log('超管后台登录：编号 999 / 密码 admin888');
  console.log('员工小程序登录：编号 1~12 / 密码 123456（花名见列表）');
  console.log('演示玩家openid：dev_demo（余额520，含1张50元券，已有预约）');
  console.log('演示小程序用户：dev_demo(玩家) / dev_dm_001(已被设为DM的客户，后台「小程序用户」页可管理)');
  process.exit(0);
}

main().catch(e => { console.error('种子失败：', e.message); process.exit(1); });
