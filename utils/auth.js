const { isAdmin } = require('../database/db');
function adminOnly(ctx, fn) {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ Admins only.');
  }
  return fn();
}
module.exports = { adminOnly };
