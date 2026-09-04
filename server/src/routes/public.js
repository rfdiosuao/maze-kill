// ============================================================
// 玩家端公共接口（免登录凭openid识别；可登录建账号：昵称/头像/电话，被设为DM后进工作台）
// 多租户：req.tenantId 由 X-Tenant 解析；同一微信在不同品牌各自建档、卡券余额互不影响
// ============================================================
const router = require('express').Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const assignService = require('../services/assignService');
const { sign } = require('../middleware/auth');

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  if (e.code === 'CONFLICT') return res.status(400).json({ code: 400, msg: e.message });
  console.error(e);
  res.status(500).json({ code: 500, msg: '服务异常，请稍后再试' });
});

// ---------- 品牌主题（贴牌外观：logo/名称/配色/背景图） ----------
router.get('/tenant/theme', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.id, t.code, t.name, th.logo, th.brand_name, th.colors, th.bg_image, th.bg_mode, th.bg_overlay
       FROM tenant t LEFT JOIN tenant_theme th ON th.tenant_id=t.id WHERE t.id=? AND t.status='active'`,
    [req.tenantId]);
  if (!rows.length) return res.status(404).json({ code: 404, msg: '品牌不存在' });
  const t = rows[0];
  let colors = t.colors;
  try { colors = typeof colors === 'string' ? JSON.parse(colors) : (colors || {}); } catch (e) { colors = {}; }
  res.json({ code: 0, data: {
    id: t.id, code: t.code, name: t.name,
    logo: t.logo || '', brandName: t.brand_name || t.name,
    colors, bgImage: t.bg_image || '',
    bgMode: t.bg_mode || 'cover', bgOverlay: t.bg_overlay != null ? +t.bg_overlay : 0.6
  } });
}));

// 登录：code换openid（配置APPID走微信，否则演示降级）→ 查/建user档案（按租户）→ 签发玩家JWT
// 被管理员设为DM的用户，token 带 dm_id，可直接进DM工作台
router.post('/login', wrap(async (req, res) => {
  const code = (req.body || {}).code || '';
  let openid = '';
  const appid = process.env.WECHAT_APPID, secret = process.env.WECHAT_SECRET;
  if (appid && secret && code) {
    try {
      const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
      const r = await fetch(url); const j = await r.json();
      if (j.openid) openid = j.openid;
    } catch (e) { /* 降级用演示openid */ }
  }
  if (!openid) {
    // 演示模式：优先沿用客户端缓存的openid，保证会员卡/预约等历史数据连续
    const cached = String((req.body || {}).openid || '');
    openid = /^dev_[0-9a-f]{12}$/.test(cached)
      ? cached
      : 'dev_' + crypto.createHash('md5').update(code || String(Date.now())).digest('hex').slice(0, 12);
  }
  const tid = req.tenantId;
  // 查/建用户档案（首次登录自动注册；按租户隔离）
  let [rows] = await pool.query(
    `SELECT u.*, d.id dm_id, d.stage_name FROM user u
       LEFT JOIN dm d ON d.user_id=u.id AND d.status='active'
      WHERE u.tenant_id=? AND u.openid=?`, [tid, openid]);
  if (!rows.length) {
    await pool.query(`INSERT INTO user(tenant_id, openid, nickname) VALUES(?,?,?)`,
      [tid, openid, '玩家' + openid.slice(-4).toUpperCase()]);
    [rows] = await pool.query(
      `SELECT u.*, d.id dm_id, d.stage_name FROM user u
         LEFT JOIN dm d ON d.user_id=u.id AND d.status='active'
        WHERE u.tenant_id=? AND u.openid=?`, [tid, openid]);
  }
  const u = rows[0];
  if (u.status === 'banned') return res.status(403).json({ code: 403, msg: '账号已被封禁，请联系店家' });
  const token = sign({ id: u.id, role: u.role, openid: u.openid, dm_id: u.dm_id || null, name: u.nickname, tenant_id: tid });
  res.json({ code: 0, data: {
    openid, token,
    user: { id: u.id, nickname: u.nickname, avatar: u.avatar, phone: u.phone, role: u.role, dm_id: u.dm_id || null, stage_name: u.stage_name || '' }
  } });
}));

// 本人资料：管理员设为DM后实时生效（前端据此刷新角色与工作台入口）
router.get('/profile', wrap(async (req, res) => {
  const openid = req.headers['x-openid'];
  if (!openid) return res.status(401).json({ code: 401, msg: '请先登录' });
  const [rows] = await pool.query(
    `SELECT u.id, u.openid, u.nickname, u.avatar, u.phone, u.role, u.created_at,
            d.id dm_id, d.stage_name
       FROM user u LEFT JOIN dm d ON d.user_id=u.id AND d.status='active'
      WHERE u.tenant_id=? AND u.openid=?`, [req.tenantId, openid]);
  if (!rows.length) return res.status(404).json({ code: 404, msg: '用户不存在' });
  res.json({ code: 0, data: rows[0] });
}));

// 改本人资料（昵称/电话）
router.put('/profile', wrap(async (req, res) => {
  const openid = req.headers['x-openid'];
  if (!openid) return res.status(401).json({ code: 401, msg: '请先登录' });
  const { nickname, phone } = req.body || {};
  if (nickname != null) {
    await pool.query(`UPDATE user SET nickname=? WHERE tenant_id=? AND openid=?`,
      [String(nickname).trim().slice(0, 50) || '未命名玩家', req.tenantId, openid]);
  }
  if (phone != null) {
    await pool.query(`UPDATE user SET phone=? WHERE tenant_id=? AND openid=?`,
      [String(phone).slice(0, 20), req.tenantId, openid]);
  }
  res.json({ code: 0, msg: '已保存' });
}));

// 头像上传：base64 → server/uploads 持久化（微信chooseAvatar临时文件会失效）
router.post('/avatar', wrap(async (req, res) => {
  const openid = req.headers['x-openid'];
  if (!openid) return res.status(401).json({ code: 401, msg: '请先登录' });
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String((req.body || {}).base64 || ''));
  if (!m || m[2].length > 3 * 1024 * 1024) {
    return res.status(400).json({ code: 400, msg: '仅支持png/jpg/webp，且不超过2MB' });
  }
  const ext = m[1] === 'png' ? 'png' : (m[1] === 'webp' ? 'webp' : 'jpg');
  const dir = path.join(__dirname, '../../uploads');
  fs.mkdirSync(dir, { recursive: true });
  const name = `avatar_${openid.replace(/[^a-z0-9_]/gi, '')}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'));
  await pool.query(`UPDATE user SET avatar=? WHERE tenant_id=? AND openid=?`,
    [`/uploads/${name}`, req.tenantId, openid]);
  res.json({ code: 0, data: { url: `/uploads/${name}` } });
}));

// 首页信息：联系方式、导航坐标、午晚场时间（按租户）
router.get('/home', wrap(async (req, res) => {
  await pool.query(`INSERT IGNORE INTO settings(tenant_id) VALUES(?)`, [req.tenantId]);
  const [s] = await pool.query(`SELECT * FROM settings WHERE tenant_id=?`, [req.tenantId]);
  res.json({ code: 0, data: s[0] || {} });
}));

// 剧本列表：搜索/筛选/分页（全量468本，按租户）
router.get('/scripts', wrap(async (req, res) => {
  const { keyword = '', grade = '', type = '' } = req.query;
  const page = Math.max(1, +req.query.page || 1), size = Math.min(50, +req.query.size || 20);
  const where = [`status='on'`, `tenant_id=?`], params = [req.tenantId];
  if (keyword) { where.push(`name LIKE ?`); params.push(`%${keyword}%`); }
  if (grade) { where.push(`grade=?`); params.push(grade); }
  if (type) { where.push(`type=?`); params.push(type); }
  const sql = `FROM script WHERE ${where.join(' AND ')}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total ${sql}`, params);
  const [rows] = await pool.query(
    `SELECT id, name, cover, type, players_min, players_max, duration_min, price, grade ${sql}
      ORDER BY id LIMIT ? OFFSET ?`, [...params, size, (page - 1) * size]);
  res.json({ code: 0, data: { total, page, size, list: rows } });
}));

router.get('/scripts/:id', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, cover, type, players_min, players_max, duration_min, price, grade, intro, roles
      FROM script WHERE id=? AND tenant_id=? AND status='on'`, [req.params.id, req.tenantId]);
  if (!rows.length) return res.status(404).json({ code: 404, msg: '剧本不存在' });
  const s = rows[0];
  s.roles = typeof s.roles === 'string' ? JSON.parse(s.roles || '[]') : (s.roles || []);
  res.json({ code: 0, data: s });
}));

// DM列表：仅公开字段（花名/形象照/标签/简介）；客户升级的DM头像自动兜底
router.get('/dms', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.id, d.stage_name, COALESCE(NULLIF(d.photo,''), u.avatar) AS photo, d.tags, d.intro
       FROM dm d LEFT JOIN user u ON u.id=d.user_id
      WHERE d.status='active' AND d.tenant_id=? ORDER BY d.id`, [req.tenantId]);
  res.json({ code: 0, data: rows });
}));

// 某日某时段的可约场次（含剧本信息与已排DM数）
router.get('/sessions', wrap(async (req, res) => {
  const { date, slot } = req.query;
  if (!date) return res.status(400).json({ code: 400, msg: '缺少日期' });
  const where = [`s.work_date=?`, `s.tenant_id=?`, `s.status<>'cancelled'`, `s.work_date >= CURDATE()`];
  const params = [date, req.tenantId];
  if (slot) { where.push(`s.slot=?`); params.push(slot); }
  const [rows] = await pool.query(
    `SELECT s.id, s.work_date, s.slot, s.start_time, s.required_dm, s.status, s.script_id,
            sc.name AS script_name, sc.type, sc.grade, sc.duration_min, sc.price,
            (SELECT COUNT(*) FROM session_dm sd WHERE sd.session_id=s.id AND sd.tenant_id=s.tenant_id) assigned
       FROM session s JOIN script sc ON sc.id=s.script_id
      WHERE ${where.join(' AND ')} ORDER BY s.slot, s.start_time`, params);
  res.json({ code: 0, data: rows });
}));

// 场次DM详情：已排DM + 可锁DM池（busy/leave 由前端置灰，后端强校验）
router.get('/sessions/:id/dms', wrap(async (req, res) => {
  const sid = req.params.id;
  const [ses] = await pool.query(
    `SELECT s.*, sc.name AS script_name, sc.price FROM session s JOIN script sc ON sc.id=s.script_id
      WHERE s.id=? AND s.tenant_id=? AND s.status<>'cancelled'`, [sid, req.tenantId]);
  if (!ses.length) return res.status(404).json({ code: 404, msg: '场次不存在或已取消' });
  const S = ses[0];
  const [assigned] = await pool.query(
    `SELECT sd.dm_id, sd.source, sd.role_name, d.stage_name, d.photo
       FROM session_dm sd JOIN dm d ON d.id=sd.dm_id WHERE sd.session_id=? AND sd.tenant_id=?`, [sid, req.tenantId]);
  const [poolDms] = await pool.query(
    `SELECT d.id, d.stage_name, d.photo,
            COALESCE(a.status,'free') AS av,
            EXISTS(SELECT 1 FROM dm_skill sk WHERE sk.dm_id=d.id AND sk.script_id=? AND sk.tenant_id=?) AS has_skill
       FROM dm d
       LEFT JOIN availability a ON a.dm_id=d.id AND a.tenant_id=? AND a.work_date=? AND a.slot=?
      WHERE d.status='active' AND d.tenant_id=?
        AND d.id NOT IN (SELECT dm_id FROM session_dm WHERE session_id=? AND tenant_id=?)
      ORDER BY has_skill DESC, CONVERT(d.stage_name USING gbk)`,
    [S.script_id, req.tenantId, req.tenantId, S.work_date, S.slot, req.tenantId, sid, req.tenantId]);
  const dmPool = poolDms.map(d => ({
    ...d,
    can_lock: d.av === 'free' && assigned.length < S.required_dm,
    reason: d.av === 'busy' ? '此时段已排其他场次' : d.av === 'leave' ? '已请假' : (assigned.length >= S.required_dm ? '本场DM已满' : '')
  }));
  res.json({ code: 0, data: { session: S, assigned, pool: dmPool } });
}));

// 锁卡预约（核心）
router.post('/bookings', wrap(async (req, res) => {
  const openid = req.headers['x-openid'];
  if (!openid) return res.status(401).json({ code: 401, msg: '请重新进入小程序' });
  const b = req.body || {};
  if (!b.session_id || !b.dm_id) return res.status(400).json({ code: 400, msg: '请选择场次和DM' });
  const out = await assignService.lockBooking({
    sessionId: +b.session_id, dmId: +b.dm_id, openid,
    name: b.name, phone: b.phone, people: +b.people || 4,
    payType: b.pay_type, useCoupon: !!b.use_coupon, tenantId: req.tenantId
  });
  res.json({ code: 0, msg: '锁卡成功', data: out });
}));

// 本人预约列表
router.get('/my/bookings', wrap(async (req, res) => {
  const openid = req.headers['x-openid'];
  if (!openid) return res.status(401).json({ code: 401, msg: '请重新进入小程序' });
  const [rows] = await pool.query(
    `SELECT b.id, b.status, b.people, b.pay_type, b.amount, b.created_at,
            s.work_date, s.slot, s.start_time, sc.name AS script_name, d.stage_name AS dm_name
       FROM booking b
       JOIN session s ON s.id=b.session_id
       JOIN script sc ON sc.id=s.script_id
       JOIN dm d ON d.id=b.dm_id
      WHERE b.openid=? AND b.tenant_id=? ORDER BY b.id DESC LIMIT 100`, [openid, req.tenantId]);
  res.json({ code: 0, data: rows });
}));

// 取消预约（释放DM占用）
router.post('/bookings/:id/cancel', wrap(async (req, res) => {
  const openid = req.headers['x-openid'];
  if (!openid) return res.status(401).json({ code: 401, msg: '请重新进入小程序' });
  await assignService.cancelBooking(+req.params.id, openid, req.tenantId);
  res.json({ code: 0, msg: '已取消，DM时段已释放' });
}));

// 会员卡：余额/券/流水（只管理员加、系统扣；按租户隔离）
router.get('/member', wrap(async (req, res) => {
  const openid = req.headers['x-openid'];
  if (!openid) return res.status(401).json({ code: 401, msg: '请重新进入小程序' });
  const [[card]] = await pool.query(
    `SELECT * FROM member_card WHERE tenant_id=? AND openid=?`, [req.tenantId, openid]);
  const [coupons] = await pool.query(
    `SELECT * FROM coupon WHERE tenant_id=? AND openid=? ORDER BY status='valid' DESC, id DESC LIMIT 50`,
    [req.tenantId, openid]);
  const [flows] = await pool.query(
    `SELECT id, type, amount, remark, operator, created_at FROM card_flow
      WHERE tenant_id=? AND openid=? ORDER BY id DESC LIMIT 50`, [req.tenantId, openid]);
  res.json({ code: 0, data: { card: card || null, coupons, flows } });
}));

module.exports = router;
