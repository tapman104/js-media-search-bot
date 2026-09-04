const { isAdmin } = require('../database/db');
function adminOnly(ctx, fn) {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ Admins only.');
  }
  return fn();
}
module.exports = { adminOnly };
