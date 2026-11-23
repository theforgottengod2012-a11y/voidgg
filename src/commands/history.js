const { DailyActivity } = require('../models');
const { getConfig } = require('../utils/config');
const { getTimezone, localDate } = require('../utils/time');
const { activityPoints, activityTarget, meetsActivityTarget } = require('../utils/activity-points');
const { embed, failure } = require('../utils/embeds');
const { DateTime } = require('luxon');
const { PermissionFlagsBits } = require('discord.js');

function hasRole(member, roleIds) {
  return Boolean(member?.roles?.cache && roleIds.some(id => member.roles.cache.has(id)));
}
function isAdmin(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator)
    || member?.permissions?.has(PermissionFlagsBits.ManageGuild));
}
async function reply(ctx, payload) {
  if (ctx.interaction) {
    if (ctx.interaction.deferred || ctx.interaction.replied) return ctx.interaction.editReply(payload);
    return ctx.interaction.reply({ ...payload, ephemeral: true });
  }
  return ctx.message.reply(payload);
}
function requestedUser(ctx) {
  if (ctx.interaction) return ctx.interaction.options.getUser('user') || ctx.user;
  const raw = ctx.args[1] || '';
  const id = raw.replace(/[<@!>]/g, '');
  return /^\d{17,20}$/.test(id) ? { id } : ctx.user;
}

async function handleHistory(ctx) {
  const config = await getConfig(ctx.guild.id);
  const user = requestedUser(ctx);
  const member = ctx.guild.members.cache.get(user.id)
    || await ctx.guild.members.fetch(user.id).catch(() => null);
  if (!member) return reply(ctx, { embeds: [failure('That member could not be found in this server.')] });
  const viewerIsManager = hasRole(ctx.member, config.managerRoleIds);
  if (config.restrictStats && user.id !== ctx.user.id && !isAdmin(ctx.member) && !viewerIsManager) {
    return reply(ctx, { embeds: [failure('This server restricts staff activity views to authorized managers.')] });
  }
  if (!hasRole(member, config.staffRoleIds) && !isAdmin(ctx.member)) {
    return reply(ctx, { embeds: [failure('Statistics are available for configured staff members only.')] });
  }

  const timezone = await getTimezone(ctx.guild.id, user.id, config);
  const today = localDate(new Date(), timezone);
  const target = activityTarget(config);
  const start = DateTime.fromISO(today, { zone: timezone }).minus({ days: 13 }).toISODate();
  const records = await DailyActivity.find({
    guildId: ctx.guild.id,
    userId: user.id,
    localDate: { $gte: start, $lte: today },
  }).lean();
  const byDate = new Map(records.map(record => [record.localDate, record]));
  const lines = [];
  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    const date = DateTime.fromISO(today, { zone: timezone }).minus({ days: daysAgo }).toISODate();
    const record = byDate.get(date);
    const messages = record?.messages || 0;
    const voiceMinutes = record?.voiceMinutes || 0;
    const points = activityPoints(messages, voiceMinutes);
    const complete = meetsActivityTarget(messages, voiceMinutes, target);
    lines.push(`**${date}** · ${messages} messages · ${voiceMinutes} voice min · **${points}/${target} points** · ${complete ? '✅ Complete' : '⏳ Incomplete'}`);
  }
  return reply(ctx, { embeds: [embed(`14-Day Daily History // ${member.displayName}`, `Timezone: **${timezone}**\nDaily target: **${target} combined points**\nEach counted message and eligible voice minute earns 1 point.\n\n${lines.join('\n')}`)] });
}

module.exports = { handleHistory };
