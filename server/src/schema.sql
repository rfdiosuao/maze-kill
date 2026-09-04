-- ============================================================
-- 谜宫全息剧本杀 数据模型（MySQL 8 / InnoDB，事务保证排班与薪资准确）
-- 多租户/OEM贴牌：全部业务表带 tenant_id；tenant=品牌，tenant_theme=外观配置
-- ============================================================
CREATE DATABASE IF NOT EXISTS maze_kill DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci;
USE maze_kill;

-- 品牌/租户：code 用于小程序/后台请求头 X-Tenant 定位
CREATE TABLE IF NOT EXISTS tenant (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE COMMENT '租户码（X-Tenant）',
  name VARCHAR(50) NOT NULL COMMENT '品牌名称',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) COMMENT '品牌/租户';

-- 品牌主题（1:1）：贴牌外观——logo/名称/配色/背景图/遮罩
CREATE TABLE IF NOT EXISTS tenant_theme (
  tenant_id INT PRIMARY KEY,
  logo VARCHAR(500) DEFAULT '' COMMENT '品牌logo（/uploads/...）',
  brand_name VARCHAR(50) DEFAULT '' COMMENT '对外品牌名（导航标题）',
  colors JSON COMMENT '配色{primary,deep,gold,goldLight,bg,card,line,text,muted,dim}',
  bg_image VARCHAR(500) DEFAULT '' COMMENT '自定义背景图（/uploads/...）',
  bg_mode ENUM('cover','contain') NOT NULL DEFAULT 'cover' COMMENT '背景适配：铺满/完整显示',
  bg_overlay DECIMAL(2,1) NOT NULL DEFAULT 0.6 COMMENT '背景遮罩透明度0~1',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT '品牌主题';

-- 默认租户（现有红金主题），保证旧数据无缝归属
INSERT INTO tenant(id, code, name) VALUES(1, 'migong', '谜宫·全息') ON DUPLICATE KEY UPDATE id=id;
INSERT INTO tenant_theme(tenant_id, brand_name, colors) VALUES(1, '谜宫·全息演绎',
  '{"primary":"#C02027","deep":"#8B1418","gold":"#C9A063","goldLight":"#E0C48A","bg":"#100D0E","card":"#1C1618","line":"#332B2D","text":"#F4EBE9","muted":"#ABA0A0","dim":"#6F6668"}')
  ON DUPLICATE KEY UPDATE tenant_id=tenant_id;

-- 小程序用户表：每个客户微信一键登录即自动建档；可被管理员升级为DM（role=dm并绑DM档案）
-- 同一微信在不同品牌各自建档（uk_tenant_openid），会员卡/余额天然隔离
CREATE TABLE IF NOT EXISTS user (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  openid VARCHAR(64) NOT NULL,
  nickname VARCHAR(50) DEFAULT '',
  avatar VARCHAR(500) DEFAULT '' COMMENT '头像URL（/uploads/...）',
  phone VARCHAR(20) DEFAULT '',
  role ENUM('player','dm') NOT NULL DEFAULT 'player' COMMENT '玩家 / 被设为DM',
  status ENUM('active','banned') NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tenant_openid(tenant_id, openid),
  INDEX idx_role(role)
) COMMENT '小程序用户';

-- 账号表：员工(编号1~30)与超管(999，全局租户1)共用，角色严格隔离
CREATE TABLE IF NOT EXISTS account (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  staff_no INT COMMENT '员工编号1~30；超管用999',
  name VARCHAR(50) NOT NULL,
  phone VARCHAR(20) DEFAULT '',
  password_hash VARCHAR(128) NOT NULL,
  role ENUM('staff','admin') NOT NULL DEFAULT 'staff',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tenant_staffno(tenant_id, staff_no)
) COMMENT '账号';

-- DM档案（保密底薪仅管理员可读）：account_id=员工账号绑定，user_id=小程序客户升级绑定
CREATE TABLE IF NOT EXISTS dm (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  account_id INT UNIQUE DEFAULT NULL,
  user_id INT UNIQUE DEFAULT NULL COMMENT '绑定的小程序用户（客户被设为DM）',
  stage_name VARCHAR(50) NOT NULL COMMENT '花名（对外）',
  photo VARCHAR(255) DEFAULT '',
  tags VARCHAR(255) DEFAULT '' COMMENT '标签，逗号分隔',
  intro TEXT,
  status ENUM('active','inactive') DEFAULT 'active',
  base_salary DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '保密底薪',
  INDEX idx_status(status)
) COMMENT 'DM档案';

-- 剧本（468本，分页查询）
CREATE TABLE IF NOT EXISTS script (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  name VARCHAR(100) NOT NULL,
  cover VARCHAR(255) DEFAULT '',
  type VARCHAR(30) DEFAULT '推理',
  players_min TINYINT DEFAULT 4,
  players_max TINYINT DEFAULT 8,
  duration_min SMALLINT DEFAULT 240 COMMENT '时长(分钟)',
  price DECIMAL(10,2) DEFAULT 0 COMMENT '价格(可改，避4)',
  grade ENUM('12+','18+') DEFAULT '12+',
  intro TEXT,
  roles JSON COMMENT '角色清单[{name,commission}] commission=角色单场提成',
  status ENUM('on','off') DEFAULT 'on',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_grade(grade), INDEX idx_status(status), INDEX idx_type(type), INDEX idx_tenant(tenant_id)
) COMMENT '剧本';

-- DM技能矩阵：会哪些本/角色及熟练度，供自动补位与换人
CREATE TABLE IF NOT EXISTS dm_skill (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  dm_id INT NOT NULL,
  script_id INT NOT NULL,
  role_name VARCHAR(50) DEFAULT '',
  proficiency TINYINT DEFAULT 3 COMMENT '熟练度1~5',
  UNIQUE KEY uk_tenant_dm_script_role(tenant_id, dm_id, script_id, role_name),
  INDEX idx_script(script_id)
) COMMENT 'DM技能矩阵';

-- 场次：按日期+午/晚场+剧本建场
CREATE TABLE IF NOT EXISTS session (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  work_date DATE NOT NULL,
  slot ENUM('noon','night') NOT NULL COMMENT '午场/晚场',
  script_id INT NOT NULL,
  start_time TIME NOT NULL,
  required_dm TINYINT DEFAULT 3 COMMENT '所需DM数(3~4)',
  status ENUM('open','full','done','cancelled') DEFAULT 'open',
  warn TINYINT DEFAULT 0 COMMENT '缺人预警',
  UNIQUE KEY uk_tenant_date_slot_script(tenant_id, work_date, slot, script_id),
  INDEX idx_date(work_date)
) COMMENT '场次';

-- DM时间占用表：同时段一人一场【最高硬约束】的锚点（唯一键+行锁，按租户隔离）
CREATE TABLE IF NOT EXISTS availability (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  dm_id INT NOT NULL,
  work_date DATE NOT NULL,
  slot ENUM('noon','night') NOT NULL,
  status ENUM('free','busy','leave') DEFAULT 'free',
  UNIQUE KEY uk_tenant_dm_date_slot(tenant_id, dm_id, work_date, slot),
  INDEX idx_date_slot(work_date, slot)
) COMMENT 'DM时段占用';

-- 场次DM分配（排班结果）
CREATE TABLE IF NOT EXISTS session_dm (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  session_id INT NOT NULL,
  dm_id INT NOT NULL,
  source ENUM('locked','manual','auto') DEFAULT 'manual' COMMENT '锁卡/手动/自动补位',
  booking_id INT DEFAULT NULL,
  role_name VARCHAR(50) DEFAULT '',
  UNIQUE KEY uk_tenant_session_dm(tenant_id, session_id, dm_id),
  INDEX idx_dm(dm_id)
) COMMENT '场次DM分配';

-- 预约（玩家锁卡1名空闲DM）
CREATE TABLE IF NOT EXISTS booking (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  session_id INT NOT NULL,
  dm_id INT NOT NULL,
  openid VARCHAR(64) NOT NULL,
  name VARCHAR(50) DEFAULT '',
  phone VARCHAR(20) DEFAULT '',
  people TINYINT DEFAULT 4,
  status ENUM('locked','cancelled') DEFAULT 'locked',
  pay_type ENUM('card','store') DEFAULT 'store' COMMENT '会员卡扣/到店付',
  amount DECIMAL(10,2) DEFAULT 0,
  coupon_id INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_openid(openid), INDEX idx_session(session_id)
) COMMENT '预约';

-- 会员卡（只管理员加、系统扣、留流水；按租户隔离余额）
CREATE TABLE IF NOT EXISTS member_card (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  openid VARCHAR(64) NOT NULL,
  balance DECIMAL(10,2) DEFAULT 0,
  status ENUM('active','frozen') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tenant_openid(tenant_id, openid)
) COMMENT '会员卡';

CREATE TABLE IF NOT EXISTS coupon (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  openid VARCHAR(64) NOT NULL,
  name VARCHAR(50) DEFAULT '优惠券',
  value DECIMAL(10,2) DEFAULT 0,
  status ENUM('valid','used','expired') DEFAULT 'valid',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_openid(openid)
) COMMENT '优惠券';

CREATE TABLE IF NOT EXISTS card_flow (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  openid VARCHAR(64) NOT NULL,
  type ENUM('recharge','issue','consume','refund') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  remark VARCHAR(200) DEFAULT '',
  booking_id INT DEFAULT NULL,
  operator VARCHAR(50) DEFAULT 'system' COMMENT 'system=系统自动；否则为管理员',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_openid(openid)
) COMMENT '卡券流水';

-- 请假登记
CREATE TABLE IF NOT EXISTS leave_record (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  dm_id INT NOT NULL,
  work_date DATE NOT NULL,
  slot ENUM('noon','night','all') DEFAULT 'all',
  reason VARCHAR(200) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dm(dm_id)
) COMMENT '请假登记';

-- 薪资记录：应发=底薪+Σ(角色单场提成×场次)+阶梯奖金-扣除；仅本人与管理员可读
CREATE TABLE IF NOT EXISTS salary_record (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '所属品牌',
  dm_id INT NOT NULL,
  month CHAR(7) NOT NULL COMMENT 'YYYY-MM 自然月',
  base_salary DECIMAL(10,2) DEFAULT 0,
  commission DECIMAL(10,2) DEFAULT 0 COMMENT 'Σ角色单场提成×场次',
  bonus DECIMAL(10,2) DEFAULT 0 COMMENT '阶梯奖金',
  deduction DECIMAL(10,2) DEFAULT 0 COMMENT '扣除',
  payable DECIMAL(10,2) DEFAULT 0 COMMENT '应发',
  detail JSON COMMENT '明细可追溯',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tenant_dm_month(tenant_id, dm_id, month)
) COMMENT '薪资记录';

CREATE TABLE IF NOT EXISTS admin_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1 COMMENT '操作发生的品牌',
  admin_id INT,
  action VARCHAR(100),
  target VARCHAR(200),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) COMMENT '管理操作日志';

-- 系统设置：按租户各一份（场次时间/奖金阶梯/联系方式/坐标）
CREATE TABLE IF NOT EXISTS settings (
  tenant_id INT PRIMARY KEY,
  noon_start TIME DEFAULT '13:00:00',
  night_start TIME DEFAULT '19:00:00',
  dm_per_session TINYINT DEFAULT 3 COMMENT '每场DM数(默认3，可到4)',
  bonus_ladder JSON COMMENT '阶梯奖金[{min,pay}]按当月场次',
  phone VARCHAR(20) DEFAULT '',
  wechat VARCHAR(50) DEFAULT '',
  address VARCHAR(200) DEFAULT '',
  lat DECIMAL(10,6) DEFAULT 31.230000,
  lng DECIMAL(10,6) DEFAULT 121.470000
) COMMENT '系统设置（按租户）';

INSERT INTO settings(tenant_id) VALUES(1) ON DUPLICATE KEY UPDATE tenant_id=tenant_id;
