// ============================================================
// 冲突校验服务（最高硬约束：同一DM同一时段只能出现在一场）
// 依赖 availability 表 UNIQUE KEY(tenant_id, dm_id, work_date, slot) + 事务行锁 FOR UPDATE
// 前端置灰只是体验层，这里才是强校验兜底，绝不重复排班；不同品牌占用互不影响
// ============================================================
const pool = require('../config/db');

class ConflictError extends Error {
  constructor(msg) { super(msg); this.code = 'CONFLICT'; }
}

/**
 * 校验DM某日期+时段是否空闲（必须在事务内调用）
 * 无记录则自动补一条 free（保证手动排班可用）
 */
async function assertDmFree(conn, dmId, workDate, slot, tenantId = 1) {
  const [rows] = await conn.query(
    `SELECT id, status FROM availability
      WHERE tenant_id=? AND dm_id=? AND work_date=? AND slot=? FOR UPDATE`,
    [tenantId, dmId, workDate, slot]
  );
  if (!rows.length) {
    await conn.query(
      `INSERT INTO availability(tenant_id, dm_id, work_date, slot, status) VALUES(?,?,?,?,'free')`,
      [tenantId, dmId, workDate, slot]
    );
    return true;
  }
  if (rows[0].status === 'busy') {
    throw new ConflictError('冲突：该DM此时间段已被其他场次占用（同时段一人一场）');
  }
  if (rows[0].status === 'leave') {
    throw new ConflictError('冲突：该DM此时间段已登记请假');
  }
  return true;
}

/** 占用（须先通过 assertDmFree） */
async function markBusy(conn, dmId, workDate, slot, tenantId = 1) {
  await conn.query(
    `UPDATE availability SET status='busy' WHERE tenant_id=? AND dm_id=? AND work_date=? AND slot=?`,
    [tenantId, dmId, workDate, slot]
  );
}

/** 释放占用 */
async function markFree(conn, dmId, workDate, slot, tenantId = 1) {
  await conn.query(
    `UPDATE availability SET status='free' WHERE tenant_id=? AND dm_id=? AND work_date=? AND slot=?`,
    [tenantId, dmId, workDate, slot]
  );
}

module.exports = { ConflictError, assertDmFree, markBusy, markFree, pool };
