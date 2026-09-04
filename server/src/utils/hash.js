// 密码散列（scrypt，纯Node内置，避免原生依赖）
const crypto = require('crypto');

function hash(pw) {
  const salt = crypto.randomBytes(8).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return salt + ':' + h;
}

function verify(pw, stored) {
  try {
    const [salt, h] = String(stored).split(':');
    return crypto.scryptSync(String(pw), salt, 32).toString('hex') === h;
  } catch (e) { return false; }
}

module.exports = { hash, verify };
