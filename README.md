# 迷宫全息剧本杀 · 小程序 + 管理后台

玩家/员工用微信小程序 + 超管网页后台，数据共通。第一版优先保证：**排班不冲突、薪资算得准、权限不串**。

## 一、目录结构

```
后台管理小程序设计/
├── miniprogram/                 # 微信原生小程序（玩家免登录 + 员工独立登录）
│   ├── app.js / app.json / app.wxss        黑红主题（#B11218/#7A0E13/#0D0B0C/#D4AF37）
│   ├── utils/request.js                    请求封装：玩家一键登录(openid+JWT)、员工凭JWT
│   └── pages/
│       ├── index/            首页（品牌页+导航/电话/客服+我的/员工入口）
│       ├── scripts/          剧本列表（搜索/筛选/分页468本）+ 详情
│       ├── dms/              DM列表（仅公开字段）
│       ├── booking/          预约锁卡（30天日历→午晚场→剧本→锁1名空闲DM）
│       ├── member/           会员卡（余额/券/流水）+ 我的预约（取消释放）
│       ├── user/             我的·账户（微信一键登录/头像昵称/角色徽章/DM工作台入口）
│       └── staff/            员工登录 + 工作台（排班/薪资/提成表/资料；DM玩家可进）
├── admin-web/                   # Vue3 + Element Plus 管理后台
│   └── src/views/  Login·Dashboard(总览)·Sessions(场次排班)·Staff(账号+DM+技能)
│                   Scripts(剧本)·Salary(薪资)·Cards(会员卡)·Settings(设置)
└── server/                      # Node.js + Express + MySQL
    ├── src/schema.sql           数据模型（建库建表）
    ├── src/seed/seed.js         演示数据（可重复执行=重置）
    ├── src/middleware/auth.js   JWT鉴权 + 角色隔离（越权403）
    ├── src/services/            ★ 核心服务（独立封装，中文注释）
    │   ├── conflictService.js   同时段一人一场硬约束（行锁+唯一键）
    │   ├── assignService.js     锁卡/取消/排人/换人/移除/取消场次（事务联动）
    │   ├── salaryService.js     薪资重算（底薪+Σ角色提成+阶梯奖金-扣除）
    │   └── scheduleService.js   72h自动补位（在职+空闲+技能匹配）
    └── src/routes/  public(玩家)·staff(员工)·admin(超管)
```

## 二、数据模型（15张表）

| 表 | 说明 |
|---|---|
| user | 小程序用户（微信一键登录自动建档，role=player/dm，可被后台设为DM） |
| account | 员工编号1~30 + 超管(999)，角色隔离 |
| dm | DM档案，**base_salary保密底薪仅管理员可读**；account_id=员工、user_id=客户升级 |
| script | 468本，分级18+/12+，roles JSON含**角色单场提成** |
| dm_skill | 技能矩阵（会哪些本/角色+熟练度），供补位 |
| session | 场次：日期+午/晚场+剧本，所需DM 3~4名 |
| availability | **硬约束锚点**：UNIQUE(dm,date,slot) + 行锁 |
| session_dm | 排班结果：来源=锁卡/手动/自动补位 |
| booking | 预约：锁1名DM、会员卡扣/到店付 |
| member_card / coupon / card_flow | 会员卡、券、流水（只管理员加、系统扣） |
| leave_record | 请假登记 |
| salary_record | 月度薪资+明细JSON（仅本人与管理员可读） |
| admin_log / settings | 操作日志、系统设置 |

## 三、启动步骤

### 0. 准备
- Node.js ≥ 18、MySQL ≥ 5.7（建议8.0）
- 复制 `server/.env.example` 为 `server/.env`，按需改数据库密码

### 1. 后端（初始化+种子+启动）
```bash
cd server
npm install
npm run seed     # 自动建库建表 + 写入演示数据（可重复执行=重置）
npm start        # http://127.0.0.1:3000  启动时自动补位+每10分钟巡检
```

### 2. 管理后台
```bash
cd admin-web
npm install
npm run dev      # http://localhost:5173 （已代理 /api 到后端3000）
```

### 3. 小程序
1. 微信开发者工具打开**本项目根目录**（project.config.json 已配置 miniprogramRoot=miniprogram/）
2. 详情→本地设置→勾选「不校验合法域名」（后端为 http://127.0.0.1:3000）
3. 编译即可；上线前把 `miniprogram/utils/request.js` 的 BASE 改为 https 域名，并在 server/.env 填正式 APPID/SECRET

## 四、演示账号

| 端 | 账号 | 说明 |
|---|---|---|
| 后台 | 编号 `999` / 密码 `admin888` | 超级管理员，总控全部数据 |
| 员工 | 编号 `1~12` / 密码 `123456` | 花名：影月/烛岚/雾川…，各含保密底薪 |
| 玩家 | 小程序一键登录 | 微信登录即建档；演示openid `dev_demo`：余额¥520、1张¥50券、已有2笔预约 |
| DM用户 | 演示openid `dev_dm_001`（阿荧） | 已被后台「小程序用户」页设为DM：我的页有DM工作台入口 |

内置演示数据：468本剧本、12名DM（技能矩阵每人约60本）、未来30天午/晚场各2场、72h内场次已自动补位。

## 五、核心机制验证路径（走通全流程）

1. **排班不冲突**：预约页锁同一DM同一时段第二次会提示「已被其他场次占用」；后台手动排DM界面 busy/leave 一律置灰不可选；后端 `availability` 行锁兜底并发。
2. **薪资算得准**：后台薪资页按月汇总，任意锁卡/取消/换人/补位都在同一事务内自动重算；「明细」可逐场追溯角色提成；导出CSV。
3. **权限不串**：员工端接口强制按登录账号过滤（看不了他人薪资）；后端 admin 接口对员工token一律403；底薪字段永不出现在员工接口。
3b. **客户账号体系**：玩家小程序一键登录即建档（user表，头像昵称可编辑）；后台「小程序用户」页可把任意客户**设为DM**（自动建DM档案并授权工作台）或撤销；DM玩家凭带dm_id的JWT进工作台，仍只能看本人数据。
4. **自动补位**：后台「执行自动补位」或等定时任务：候选=在职+空闲+会该本（技能矩阵），补满标「自动补位」，缺人挂黄色预警进总览。
5. **换人事务**：后台场次→换人：先校验新DM空闲→占用→释放原DM→重算两人薪资，失败自动回滚。
6. **会员卡**：只管理员充值/发券；预约用卡支付由系统自动扣并记流水；取消/场次取消自动原路退回。

## 六、上线注意

- 修改 `JWT_SECRET`；数据库账号最小权限
- 后端部署建议 PM2：`pm2 start src/app.js --name maze-server`
- 小程序 request 合法域名需 ICP 备案 + HTTPS
