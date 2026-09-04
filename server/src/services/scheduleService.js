// ============================================================
// 场次排班服务：开场前72h自动补位
// 候选 = 在职 + 该时段空闲 + 会该剧本（技能矩阵匹配），按熟练度排序
// 补满3~4名标"自动补位"，缺人标预警；服务端定时跑 + 管理端可手动触发
// 多租户：autoFill(tenantId) 只补该品牌；autoFill() 无参时遍历全部生效品牌（定时任务用）
// ============================================================
const pool = require('../config/db');
const assignService = require('./assignService');

async function autoFillTenant(tenantId) {
  let filled = 0;
  const warnings = [];

  // 未来72小时内开场且未满员的场次
  const [sessions] = await pool.query(
    `SELECT * FROM session
      WHERE tenant_id=? AND status='open'
        AND TIMESTAMPDIFF(HOUR, NOW(), CONCAT(work_date,' ',start_time)) BETWEEN 0 AND 72`,
    [tenantId]
  );

  for (const S of sessions) {
    const [cnt] = await pool.query(
      `SELECT COUNT(*) n FROM session_dm WHERE session_id=? AND tenant_id=?`, [S.id, tenantId]);
    let need = S.required_dm - cnt[0].n;
    if (need <= 0) {
      await pool.query(`UPDATE session SET status='full', warn=0 WHERE id=?`, [S.id]);
      continue;
    }

    // 候选：在职 + 该时段空闲 + 技能矩阵会该剧本，排除已在场者，熟练度优先
    const [cands] = await pool.query(
      `SELECT d.id, MAX(sk.proficiency) p
         FROM dm d
         JOIN availability a ON a.dm_id=d.id AND a.tenant_id=? AND a.work_date=? AND a.slot=? AND a.status='free'
         JOIN dm_skill sk ON sk.dm_id=d.id AND sk.tenant_id=? AND sk.script_id=?
        WHERE d.status='active' AND d.tenant_id=?
          AND d.id NOT IN (SELECT dm_id FROM session_dm WHERE session_id=? AND tenant_id=?)
        GROUP BY d.id ORDER BY p DESC, d.id LIMIT ?`,
      [tenantId, S.work_date, S.slot, tenantId, S.script_id, tenantId, S.id, tenantId, need]
    );

    for (const c of cands) {
      try {
        await assignService.manualAssign({ sessionId: S.id, dmId: c.id, source: 'auto', tenantId });
        filled++; need--;
      } catch (e) { /* 单个候选冲突（如并发占用）跳过，绝不重复排班 */ }
    }

    const [cnt2] = await pool.query(
      `SELECT COUNT(*) n FROM session_dm WHERE session_id=? AND tenant_id=?`, [S.id, tenantId]);
    const lack = S.required_dm - cnt2[0].n;
    await pool.query(`UPDATE session SET warn=? WHERE id=?`, [lack > 0 ? 1 : 0, S.id]);
    if (lack > 0) warnings.push({ sessionId: S.id, date: S.work_date, slot: S.slot, lack });
  }
  return { filled, warnings };
}

/** 无参：遍历全部生效品牌逐个补位（定时任务/种子初始化用） */
async function autoFill(tenantId) {
  if (tenantId) return autoFillTenant(tenantId);
  let tenantRows = [{ id: 1 }];
  try {
    const [rows] = await pool.query(`SELECT id FROM tenant WHERE status='active'`);
    if (rows.length) tenantRows = rows;
  } catch (e) { /* tenant表未迁移时只补默认租户 */ }
  const total = { filled: 0, warnings: [] };
  for (const t of tenantRows) {
    const r = await autoFillTenant(t.id);
    total.filled += r.filled;
    total.warnings.push(...r.warnings);
  }
  return total;
}

module.exports = { autoFill, pool };
