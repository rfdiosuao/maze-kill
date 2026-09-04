// ============================================================
// 租户解析中间件：请求头 X-Tenant（品牌code）→ req.tenantId / req.tenant
// 未带头时回落默认租户1（谜宫·全息），旧版本客户端无缝兼容
// 租户清单带60s内存缓存；后台改品牌后调 invalidate() 立即生效
// ============================================================
const pool = require('../config/db');

let cache = { at: 0, byCode: new Map(), byId: new Map() };
const TTL = 60 * 1000;

async function refresh() {
  if (Date.now() - cache.at < TTL && cache.byCode.size) return;
  try {
    const [rows] = await pool.query(`SELECT id, code, name, status FROM tenant`);
    const byCode = new Map(), byId = new Map();
    rows.forEach(r => { byCode.set(r.code, r); byId.set(r.id, r); });
    cache = { at: Date.now(), byCode, byId };
  } catch (e) { /* tenant表未迁移时降级：全部按租户1处理 */ }
}

function invalidate() { cache.at = 0; }

function tenant() {
  return async (req, res, next) => {
    const code = String(req.headers['x-tenant'] || '').trim();
    await refresh();
    if (code) {
      const t = cache.byCode.get(code);
      if (!t || t.status !== 'active') {
        return res.status(404).json({ code: 404, msg: '品牌不存在或已停用' });
      }
      req.tenantId = t.id;
      req.tenant = t;
    } else {
      req.tenantId = 1;
      req.tenant = cache.byId.get(1) || { id: 1, code: 'migong', name: '谜宫·全息' };
    }
    next();
  };
}

module.exports = { tenant, invalidate };
