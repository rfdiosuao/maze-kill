// 数据库连接池（dateStrings 保证 DATE/TIME 以字符串返回，避免时区偏移）
const mysql = require('mysql2/promise');

// 云托管 MySQL 会自动注入 MYSQL_ADDRESS(host:port)/MYSQL_USERNAME/MYSQL_PASSWORD/MYSQL_DATABASE
// 本地开发仍走 .env 的 DB_* 配置
const [cloudHost, cloudPort] = (process.env.MYSQL_ADDRESS || '').split(':');

const pool = mysql.createPool({
  host: cloudHost || process.env.DB_HOST || '127.0.0.1',
  port: +(cloudPort || process.env.DB_PORT || 3306),
  user: process.env.MYSQL_USERNAME || process.env.DB_USER || 'root',
  password: process.env.MYSQL_PASSWORD !== undefined ? process.env.MYSQL_PASSWORD : (process.env.DB_PASSWORD || ''),
  database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'maze_kill',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
});

module.exports = pool;
