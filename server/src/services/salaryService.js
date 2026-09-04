// ============================================================
// 薪资服务（核心）：按自然月按DM汇总
// 应发 = 底薪 + Σ(角色单场提成 × 场次) + 阶梯奖金 − 扣除
// 排班任何变动（锁卡/取消/补位/换人/移除/取消场次）都在【同一事务】内调 recalcMonth
// 保证不重不漏、明细可追溯；底薪/他人薪资仅管理员可读
// ============================================================
const pool = require('../config/db');

const LADDER_DEFAULT = [{ min: 20, pay: 800 }, { min: 30, pay: 1500 }, { min: 40, pay: 2400 }];

// 角色单场提成：优先取剧本roles中该角色的commission，未指定角色取剧本第一个角色
function roleCommission(scriptRoles, roleName) {
  try {
    const roles = typeof scriptRoles === 'string' ? JSON.parse(scriptRoles) : (scriptRoles || []);
    if (roleName) {
      const r = roles.find(x => x.name === roleName);
      if (r && r.commission != null) return +r.commission || 0;
    }
    return roles.length ? (+roles[0].commission || 0) : 0;
  } catch (e) { return 0; }
}

function monthOf(dateStr) { return String(dateStr).slice(0, 7); }

/**
 * 重算某DM某自然月薪资（事务内调用）
 * deduction 保留管理员手填的扣除项，不被重算覆盖；tenantId 限定品牌（奖金阶梯/薪资记录均按租户）
 */
async function recalcMonth(conn, dmId, month, tenantId = 1) {
  const [dms] = await conn.query(`SELECT base_salary FROM dm WHERE id=? AND tenant_id=?`, [dmId, tenantId]);
  if (!dms.length) return 0;
  const base = +dms[0].base_salary || 0;

  // 明细：本月该DM所有有效分配（排除已取消场次），逐场带出角色提成
  const [items] = await conn.query(
    `SELECT sd.role_name, s.work_date, s.slot, sc.name AS script_name, sc.roles
       FROM session_dm sd
       JOIN session s ON s.id = sd.session_id
       JOIN script sc ON sc.id = s.script_id
      WHERE sd.tenant_id=? AND sd.dm_id=? AND DATE_FORMAT(s.work_date,'%Y-%m')=? AND s.status <> 'cancelled'
      ORDER BY s.work_date, s.slot`,
    [tenantId, dmId, month]
  );

  let commission = 0;
  const detail = items.map(it => {
    const c = roleCommission(it.roles, it.role_name);
    commission += c;
    return {
      date: it.work_date,
      slot: it.slot === 'noon' ? '午场' : '晚场',
      script: it.script_name,
      role: it.role_name || '默认角色',
      commission: c
    };
  });

  // 阶梯奖金：按本月场次取满足的最高一档（按租户读设置）
  const [setRows] = await conn.query(`SELECT bonus_ladder FROM settings WHERE tenant_id=?`, [tenantId]);
  let ladder = LADDER_DEFAULT;
  if (setRows.length && setRows[0].bonus_ladder) {
    try {
      const l = typeof setRows[0].bonus_ladder === 'string'
        ? JSON.parse(setRows[0].bonus_ladder) : setRows[0].bonus_ladder;
      if (Array.isArray(l) && l.length) ladder = l;
    } catch (e) {}
  }
  const count = items.length;
  let bonus = 0;
  (Array.isArray(ladder) ? ladder : []).forEach(st => {
    // 取满足条件的最高一档，不依赖数组顺序（管理员乱序保存也算对）
    if (count >= +st.min) bonus = Math.max(bonus, +st.pay || 0);
  });

  // 保留已有扣除项
  const [old] = await conn.query(
    `SELECT deduction FROM salary_record WHERE tenant_id=? AND dm_id=? AND month=?`, [tenantId, dmId, month]);
  const deduction = old.length ? (+old[0].deduction || 0) : 0;

  const payable = +(base + commission + bonus - deduction).toFixed(2);

  await conn.query(
    `INSERT INTO salary_record(tenant_id, dm_id, month, base_salary, commission, bonus, deduction, payable, detail)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       base_salary=VALUES(base_salary), commission=VALUES(commission), bonus=VALUES(bonus),
       deduction=VALUES(deduction), payable=VALUES(payable), detail=VALUES(detail)`,
    [tenantId, dmId, month, base, commission, bonus, deduction, payable, JSON.stringify(detail)]
  );
  return payable;
}

module.exports = { recalcMonth, roleCommission, monthOf, pool };
