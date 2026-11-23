const { GuildConfig, AuditLog } = require('../models');
async function getConfig(guildId) {
  return GuildConfig.findOneAndUpdate({ guildId }, { $setOnInsert: { guildId } }, { upsert: true, new: true });
}
async function logAction(guild, actorId, targetId, action, details = {}) {
  await AuditLog.create({ guildId: guild.id, actorId, targetId, action, details });
  const config = await getConfig(guild.id);
  if (config.auditChannelId) {
    const channel = await guild.channels.fetch(config.auditChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      const { embed } = require('./embeds');
      await channel.send({ embeds: [embed(`Audit // ${action}`, `**Actor:** <@${actorId}>\n**Target:** ${targetId ? `<@${targetId}>` : '—'}\n**Details:** ${JSON.stringify(details).slice(0, 900)}`)] }).catch(() => {});
    }
  }
}
module.exports = { getConfig, logAction };
