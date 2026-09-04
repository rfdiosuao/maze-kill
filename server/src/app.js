// ============================================================
// 服务入口：Express + 定时自动补位（每10分钟）+ 统一错误处理
// ============================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { autoFill } = require('./services/scheduleService');
const { tenant } = require('./middleware/tenant');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // 玩家头像/品牌背景图以base64上传

// 头像/品牌素材等上传文件静态托管（目录不存在则自动创建）
const uploadDir = path.join(__dirname, '../uploads');
fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir, { maxAge: '7d' }));

// 租户解析：X-Tenant → req.tenantId（所有/api请求先过这里）
app.use('/api', tenant());

app.use('/api/public', require('./routes/public'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/admin', require('./routes/admin'));

// 健康检查
app.get('/api/health', (req, res) => res.json({ code: 0, msg: 'ok' }));

// 统一错误处理：冲突类错误明确提示，其余500
app.use((err, req, res, next) => {
  if (err.code === 'CONFLICT') return res.status(400).json({ code: 400, msg: err.message });
  console.error(err);
  res.status(500).json({ code: 500, msg: '服务异常，请稍后再试' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`谜宫全息剧本杀 后端已启动: http://127.0.0.1:${PORT}`);
  try { await autoFill(); } catch (e) { console.error('启动补位失败(可忽略):', e.message); }
  // 开场前72h自动补位：每10分钟巡检一次
  setInterval(() => autoFill().catch(e => console.error('自动补位异常:', e.message)), 10 * 60 * 1000);
});
