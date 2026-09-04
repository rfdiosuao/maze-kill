// ============================================================
// 排班分配服务（核心）：锁卡 / 取消 / 手动排班 / 换人 / 移除 / 取消场次
// 全部走数据库事务：先校验冲突 → 再改占用 → 联动薪资重算，保证不重不漏
// 多租户：所有查询/写入都带 tenantId，不同品牌的占用/预约/会员卡互不影响
// ============================================================
const { ConflictError, assertDmFree, markBusy, markFree } = require('./conflictService');
const salaryService = require('./salaryService');
const pool = require('../config/db');

/** 事务模板 */
async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** 玩家锁卡预约：锁1名空闲DM → 占用时段 → 建预约 → 会员卡系统自动扣款 → 重算薪资（同事务） */
async function lockBooking({ sessionId, dmId, openid, name, phone, people, payType, useCoupon, tenantId = 1 }) {
  return withTx(async conn => {
    const [ses] = await conn.query(
      `SELECT s.*, sc.price, sc.name AS script_name FROM session s
        JOIN script sc ON sc.id=s.script_id WHERE s.id=? AND s.tenant_id=? FOR UPDATE`, [sessionId, tenantId]);
    if (!ses.length) throw new ConflictError('场次不存在');
    const S = ses[0];
    if (S.status === 'cancelled') throw new ConflictError('该场次已取消');
    // 本地时区日期（toISOString是UTC，早8点前会错判成昨天，导致可约已过期场次）
    const _n = new Date();
    const today = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, '0')}-${String(_n.getDate()).padStart(2, '0')}`;
    if (String(S.work_date) < today) throw new ConflictError('该场次已开始或过期');

    const [cnt] = await conn.query(
      `SELECT COUNT(*) n FROM session_dm WHERE session_id=? AND tenant_id=?`, [sessionId, tenantId]);
    if (cnt[0].n >= S.required_dm) throw new ConflictError('该场次DM已满');

    // 最高硬约束：同时段一人一场（行锁校验 + 占用）
    await assertDmFree(conn, dmId, S.work_date, S.slot, tenantId);
    await markBusy(conn, dmId, S.work_date, S.slot, tenantId);

    const [bk] = await conn.query(
      `INSERT INTO booking(tenant_id, session_id, dm_id, openid, name, phone, people, status, pay_type, amount)
       VALUES(?,?,?,?,?,?,?, 'locked', ?, 0)`,
      [tenantId, sessionId, dmId, openid, name || '', phone || '', people || 4, payType === 'card' ? 'card' : 'store']);
    await conn.query(
      `INSERT INTO session_dm(tenant_id, session_id, dm_id, source, booking_id) VALUES(?,?,?,'locked',?)`,
      [tenantId, sessionId, dmId, bk.insertId]);
    if (cnt[0].n + 1 >= S.required_dm) {
      await conn.query(`UPDATE session SET status='full', warn=0 WHERE id=?`, [sessionId]);
    }

    // 会员卡消费：只由系统自动扣（员工无扣款入口），留流水
    let amount = +S.price || 0, couponId = null, cardPay = false;
    if (payType === 'card') {
      const [cards] = await conn.query(
        `SELECT * FROM member_card WHERE tenant_id=? AND openid=? FOR UPDATE`, [tenantId, openid]);
      if (cards.length && cards[0].status === 'active' && +cards[0].balance >= amount) {
        if (useCoupon) {
          const [cps] = await conn.query(
            `SELECT * FROM coupon WHERE tenant_id=? AND openid=? AND status='valid' AND value>0 ORDER BY id LIMIT 1 FOR UPDATE`,
            [tenantId, openid]);
          if (cps.length) {
            couponId = cps[0].id;
            amount = Math.max(0, amount - +cps[0].value);
            await conn.query(`UPDATE coupon SET status='used' WHERE id=?`, [couponId]);
          }
        }
        await conn.query(`UPDATE member_card SET balance=balance-? WHERE tenant_id=? AND openid=?`,
          [amount, tenantId, openid]);
        await conn.query(
          `INSERT INTO card_flow(tenant_id, openid, type, amount, remark, booking_id, operator)
           VALUES(?,?,?,?,?,?,?)`,
          [tenantId, openid, 'consume', amount,
           `预约《${S.script_name}》${S.work_date} ${S.slot === 'noon' ? '午场' : '晚场'}`,
           bk.insertId, 'system']);
        await conn.query(`UPDATE booking SET amount=?, coupon_id=? WHERE id=?`, [amount, couponId, bk.insertId]);
        cardPay = true; // 余额不足时静默转为到店支付
      }
    }

    // 排班变动 → 自动重算当月薪资（同一事务内）
    await salaryService.recalcMonth(conn, dmId, salaryService.monthOf(S.work_date), tenantId);
    return { bookingId: bk.insertId, amount, cardPay, couponId };
  });
}

/** 取消预约：释放DM占用 + 删分配 + 系统退款流水 + 重算薪资 */
async function cancelBooking(bookingId, openid, tenantId = 1) {
  return withTx(async conn => {
    const [bks] = await conn.query(
      `SELECT b.*, s.work_date, s.slot FROM booking b
        JOIN session s ON s.id=b.session_id WHERE b.id=? AND b.tenant_id=? FOR UPDATE`, [bookingId, tenantId]);
    if (!bks.length) throw new ConflictError('预约不存在');
    const b = bks[0];
    if (openid && b.openid !== openid) throw new ConflictError('只能取消本人预约'); // 权限隔离
    if (b.status !== 'locked') throw new ConflictError('该预约已取消');

    await markFree(conn, b.dm_id, b.work_date, b.slot, tenantId);
    await conn.query(`DELETE FROM session_dm WHERE session_id=? AND dm_id=? AND tenant_id=?`,
      [b.session_id, b.dm_id, tenantId]);
    await conn.query(`UPDATE session SET status='open' WHERE id=? AND status='full'`, [b.session_id]);

    if (b.pay_type === 'card' && b.amount > 0) { // 系统原路退回
      await conn.query(`UPDATE member_card SET balance=balance+? WHERE tenant_id=? AND openid=?`,
        [b.amount, tenantId, b.openid]);
      await conn.query(
        `INSERT INTO card_flow(tenant_id, openid, type, amount, remark, booking_id, operator)
         VALUES(?,?,?,?,?,?,?)`, [tenantId, b.openid, 'refund', b.amount, '取消预约退款', b.id, 'system']);
    }
    if (b.coupon_id) await conn.query(`UPDATE coupon SET status='valid' WHERE id=?`, [b.coupon_id]);
    await conn.query(`UPDATE booking SET status='cancelled' WHERE id=?`, [b.id]);
    await salaryService.recalcMonth(conn, b.dm_id, salaryService.monthOf(b.work_date), tenantId);
    return true;
  });
}

/** 管理端手动排DM（source: manual/auto），自动补位也走这里 */
async function manualAssign({ sessionId, dmId, roleName, source, tenantId = 1 }) {
  return withTx(async conn => {
    const [ses] = await conn.query(
      `SELECT * FROM session WHERE id=? AND tenant_id=? FOR UPDATE`, [sessionId, tenantId]);
    if (!ses.length) throw new ConflictError('场次不存在');
    const S = ses[0];
    if (S.status === 'cancelled') throw new ConflictError('场次已取消');
    const [dup] = await conn.query(
      `SELECT id FROM session_dm WHERE session_id=? AND dm_id=? AND tenant_id=?`, [sessionId, dmId, tenantId]);
    if (dup.length) throw new ConflictError('该DM已在本场');
    const [cnt] = await conn.query(
      `SELECT COUNT(*) n FROM session_dm WHERE session_id=? AND tenant_id=?`, [sessionId, tenantId]);
    if (cnt[0].n >= S.required_dm) throw new ConflictError('本场DM已满');

    await assertDmFree(conn, dmId, S.work_date, S.slot, tenantId);
    await markBusy(conn, dmId, S.work_date, S.slot, tenantId);
    await conn.query(
      `INSERT INTO session_dm(tenant_id, session_id, dm_id, source, role_name) VALUES(?,?,?,?,?)`,
      [tenantId, sessionId, dmId, source === 'auto' ? 'auto' : 'manual', roleName || '']);
    if (cnt[0].n + 1 >= S.required_dm) {
      await conn.query(`UPDATE session SET status='full', warn=0 WHERE id=?`, [sessionId]);
    }
    await salaryService.recalcMonth(conn, dmId, salaryService.monthOf(S.work_date), tenantId);
    return true;
  });
}

/** 换人：先校验新DM无冲突 → 再换占用 → 重算两人薪资（事务） */
async function swapDm({ sessionId, fromDm, toDm, roleName, tenantId = 1 }) {
  return withTx(async conn => {
    const [ses] = await conn.query(
      `SELECT * FROM session WHERE id=? AND tenant_id=? FOR UPDATE`, [sessionId, tenantId]);
    if (!ses.length) throw new ConflictError('场次不存在');
    const S = ses[0];
    const [rows] = await conn.query(
      `SELECT * FROM session_dm WHERE session_id=? AND dm_id=? AND tenant_id=? FOR UPDATE`,
      [sessionId, fromDm, tenantId]);
    if (!rows.length) throw new ConflictError('原DM不在本场');

    await assertDmFree(conn, toDm, S.work_date, S.slot, tenantId); // 先校验
    await markBusy(conn, toDm, S.work_date, S.slot, tenantId);     // 再占用
    await markFree(conn, fromDm, S.work_date, S.slot, tenantId);   // 释放原DM
    await conn.query(
      `UPDATE session_dm SET dm_id=?, source='manual', role_name=COALESCE(?, role_name)
        WHERE session_id=? AND dm_id=? AND tenant_id=?`,
      [toDm, roleName || null, sessionId, fromDm, tenantId]);
    // 原DM若有玩家锁卡预约，同步转移绑定（流水可追溯）
    const [bks] = await conn.query(
      `SELECT id FROM booking WHERE session_id=? AND dm_id=? AND status='locked' AND tenant_id=?`,
      [sessionId, fromDm, tenantId]);
    if (bks.length) await conn.query(`UPDATE booking SET dm_id=? WHERE id=?`, [toDm, bks[0].id]);

    await salaryService.recalcMonth(conn, fromDm, salaryService.monthOf(S.work_date), tenantId);
    await salaryService.recalcMonth(conn, toDm, salaryService.monthOf(S.work_date), tenantId);
    return true;
  });
}

/** 管理端移除DM：释放占用，若带锁卡预约则同步取消并退款 */
async function removeDm({ sessionId, dmId, tenantId = 1 }) {
  return withTx(async conn => {
    const [ses] = await conn.query(
      `SELECT * FROM session WHERE id=? AND tenant_id=? FOR UPDATE`, [sessionId, tenantId]);
    if (!ses.length) throw new ConflictError('场次不存在');
    const S = ses[0];
    const [rows] = await conn.query(
      `SELECT id FROM session_dm WHERE session_id=? AND dm_id=? AND tenant_id=?`, [sessionId, dmId, tenantId]);
    if (!rows.length) throw new ConflictError('该DM不在本场');

    await markFree(conn, dmId, S.work_date, S.slot, tenantId);
    await conn.query(`DELETE FROM session_dm WHERE session_id=? AND dm_id=? AND tenant_id=?`,
      [sessionId, dmId, tenantId]);
    await conn.query(`UPDATE session SET status='open' WHERE id=? AND status='full'`, [sessionId]);

    const [bks] = await conn.query(
      `SELECT * FROM booking WHERE session_id=? AND dm_id=? AND status='locked' AND tenant_id=?`,
      [sessionId, dmId, tenantId]);
    for (const b of bks) {
      if (b.pay_type === 'card' && b.amount > 0) {
        await conn.query(`UPDATE member_card SET balance=balance+? WHERE tenant_id=? AND openid=?`,
          [b.amount, tenantId, b.openid]);
        await conn.query(
          `INSERT INTO card_flow(tenant_id, openid, type, amount, remark, booking_id, operator)
           VALUES(?,?,?,?,?,?,?)`, [tenantId, b.openid, 'refund', b.amount, '场次调整退款', b.id, 'system']);
      }
      if (b.coupon_id) await conn.query(`UPDATE coupon SET status='valid' WHERE id=?`, [b.coupon_id]);
      await conn.query(`UPDATE booking SET status='cancelled' WHERE id=?`, [b.id]);
    }
    await salaryService.recalcMonth(conn, dmId, salaryService.monthOf(S.work_date), tenantId);
    return true;
  });
}

/** 管理端取消整场：释放全部DM + 全部预约退款 + 重算 */
async function cancelSession(sessionId, tenantId = 1) {
  return withTx(async conn => {
    const [ses] = await conn.query(
      `SELECT * FROM session WHERE id=? AND tenant_id=? FOR UPDATE`, [sessionId, tenantId]);
    if (!ses.length) throw new ConflictError('场次不存在');
    const S = ses[0];
    const [dms] = await conn.query(
      `SELECT dm_id FROM session_dm WHERE session_id=? AND tenant_id=?`, [sessionId, tenantId]);
    for (const d of dms) await markFree(conn, d.dm_id, S.work_date, S.slot, tenantId);

    const [bks] = await conn.query(
      `SELECT * FROM booking WHERE session_id=? AND status='locked' AND tenant_id=?`, [sessionId, tenantId]);
    for (const b of bks) {
      if (b.pay_type === 'card' && b.amount > 0) {
        await conn.query(`UPDATE member_card SET balance=balance+? WHERE tenant_id=? AND openid=?`,
          [b.amount, tenantId, b.openid]);
        await conn.query(
          `INSERT INTO card_flow(tenant_id, openid, type, amount, remark, booking_id, operator)
           VALUES(?,?,?,?,?,?,?)`, [tenantId, b.openid, 'refund', b.amount, '场次取消退款', b.id, 'system']);
      }
      if (b.coupon_id) await conn.query(`UPDATE coupon SET status='valid' WHERE id=?`, [b.coupon_id]);
      await conn.query(`UPDATE booking SET status='cancelled' WHERE id=?`, [b.id]);
    }
    await conn.query(`DELETE FROM session_dm WHERE session_id=? AND tenant_id=?`, [sessionId, tenantId]);
    await conn.query(`UPDATE session SET status='cancelled', warn=0 WHERE id=?`, [sessionId]);
    for (const d of dms) await salaryService.recalcMonth(conn, d.dm_id, salaryService.monthOf(S.work_date), tenantId);
    return true;
  });
}

module.exports = { withTx, lockBooking, cancelBooking, manualAssign, swapDm, removeDm, cancelSession };
