const { EmbedBuilder } = require('discord.js');
const COLORS = { base: 0x20232b, success: 0x7183a6, warning: 0xb69b68, error: 0x9b626d, accent: 0x7271a8 };
const BRAND = 'VOID // STAFF SYSTEM';
function embed(title, description, color = COLORS.base) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description || '\u200b').setFooter({ text: BRAND }).setTimestamp();
}
function success(title, description) { return embed(title, description, COLORS.success); }
function warning(title, description) { return embed(title, description, COLORS.warning); }
function failure(description) { return embed('Request unavailable', description, COLORS.error); }
function progress(value, goal, size = 10) {
  if (!goal) return 'Not configured';
  const filled = Math.min(size, Math.floor((value / goal) * size));
  return `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)} ${Math.min(value, goal)}/${goal}`;
}
module.exports = { COLORS, embed, success, warning, failure, progress };
