const { DailyActivity } = require('../models');
const { getConfig } = require('../utils/config');
const { getTimezone, localDate } = require('../utils/time');
const { activityPoints, activityTarget, meetsActivityTarget } = require('../utils/activity-points');
const { embed, failure } = require('../utils/embeds');
const { DateTime } = require('luxon');
const { PermissionFlagsBits } = require('discord.js');

function isAdmin(ctx) {
  return Boolean(ctx.member?.permissions?.has(PermissionFlagsBits.Administrator)
    || ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild));
}

function hasRole(member, roleIds) {
  return Boolean(member?.roles?.cache && roleIds.some(id => member.roles.cache.has(id)));
}

async function send(ctx, response) {
  if (ctx.interaction) {
    if (ctx.interaction.deferred || ctx.interaction.replied) return ctx.interaction.editReply(response);
    return ctx.interaction.reply({ ...response, ephemeral: true });
  }
  return ctx.message.reply(response);
}

function requestedUser(ctx) {
  if (ctx.interaction) return ctx.interaction.options.getUser('user') || ctx.user;
  const raw = ctx.args[1] || '';
  const id = raw.replace(/[<@!>]/g, '');
  return /^\d{17,20}$/.test(id) ? { id, username: id } : ctx.user;
}

async function activityForDay(guildId, userId, timezone, date) {
  const record = await DailyActivity.findOne({ guildId, userId, localDate: date }).lean();
  const messages = record?.messages || 0;
  const voiceMinutes = record?.voiceMinutes || 0;
  return { date, messages, voiceMinutes, points: activityPoints(messages, voiceMinutes) };
}

async function dailyRecords(guildId, userId, timezone) {
  const today = localDate(new Date(), timezone);
  const firstDay = DateTime.fromISO(today, { zone: timezone }).minus({ days: 13 }).toISODate();
  const records = await DailyActivity.find({ guildId, userId, localDate: { $gte: firstDay, $lte: today } }).lean();
  const byDate = new Map(records.map(record => [record.localDate, record]));
  return Array.from({ length: 14 }, (_, index) => {
    const date = DateTime.fromISO(today, { zone: timezone }).minus({ days: 13 - index }).toISODate();
    const record = byDate.get(date);
    const messages = record?.messages || 0;
    const voiceMinutes = record?.voiceMinutes || 0;
    return { date, messages, voiceMinutes, points: activityPoints(messages, voiceMinutes) };
  });
}

function requirementLabel(config, target) {
  return `**${target} points** (message setting: ${config.messageRequirement}; voice setting: ${config.voiceRequirement}; the higher setting is the shared target)`;
}

async function showMemberStats(ctx, config, targetUser, history, target) {
  const member = ctx.guild.members.cache.get(targetUser.id)
    || await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) return send(ctx, { embeds: [failure('That member could not be found in this server.')] });
  const manager = hasRole(ctx.member, config.managerRoleIds);
  if (config.restrictStats && targetUser.id !== ctx.user.id && !isAdmin(ctx) && !manager) {
    return send(ctx, { embeds: [failure('This server restricts staff activity views to authorized managers.')] });
  }
  if (!hasRole(member, config.staffRoleIds) && !isAdmin(ctx)) {
    return send(ctx, { embeds: [failure('Statistics are available for configured staff members only.')] });
  }

  const timezone = await getTimezone(ctx.guild.id, targetUser.id, config);
  const days = await dailyRecords(ctx.guild.id, targetUser.id, timezone);
  const today = days.at(-1);
  if (history) {
    const completed = days.filter(day => meetsActivityTarget(day.messages, day.voiceMinutes, target)).length;
    const lines = days.map(day => `\n**${day.date}** · ${day.messages} messages · ${day.voiceMinutes} voice min · **${day.points} points** · ${meetsActivityTarget(day.messages, day.voiceMinutes, target) ? 'Complete' : 'Incomplete'}`).join('');
    const messages14 = days.reduce((sum, day) => sum + day.messages, 0);
    const voice14 = days.reduce((sum, day) => sum + day.voiceMinutes, 0);
    const points14 = activityPoints(messages14, voice14);
    return send(ctx, { embeds: [embed(`14-Day Record // ${member.displayName}`, `Timezone: **${timezone}**${lines}\n\n**14-day totals**\nMessages: ${messages14} · Voice: ${voice14} min · **${points14} points**\nDaily average: ${(points14 / 14).toFixed(1)} points\nDays completed: ${completed} · Missed: ${14 - completed}\n\n**Daily target:** ${requirementLabel(config, target)}`)] });
  }

  const remaining = Math.max(0, target - today.points);
  const extra = Math.max(0, today.points - target);
  const status = meetsActivityTarget(today.messages, today.voiceMinutes, target) ? `Complete${extra ? ` · ${extra} extra points` : ''}` : `In progress · ${remaining} points to go`;
  return send(ctx, { embeds: [embed(`Activity // ${member.displayName}`, `Local day: **${today.date}** · ${timezone}\n\n**Messages:** ${today.messages} · **${today.messages} points**\n**Voice:** ${today.voiceMinutes} min · **${today.voiceMinutes} points**\n\n**Combined activity:** **${today.points} / ${target} points**${extra ? ` (+${extra} extra)` : ''}\n**Requirement status:** ${status}\n\n**Daily target:** ${requirementLabel(config, target)}\n\n14-day totals: **${days.reduce((sum, day) => sum + day.messages, 0)} messages** · **${days.reduce((sum, day) => sum + day.voiceMinutes, 0)} voice minutes** · **${days.reduce((sum, day) => sum + day.points, 0)} points**`)] });
}

async function showLeaderboard(ctx, config, target) {
  const members = await ctx.guild.members.fetch();
  const staff = members.filter(member => !member.user.bot && hasRole(member, config.staffRoleIds));
  const rows = [];
  for (const [, member] of staff) {
    const timezone = await getTimezone(ctx.guild.id, member.id, config);
    const date = localDate(new Date(), timezone);
    const day = await activityForDay(ctx.guild.id, member.id, timezone, date);
    rows.push({ name: member.displayName, ...day });
  }
  rows.sort((a, b) => b.points - a.points || b.messages - a.messages || b.voiceMinutes - a.voiceMinutes);
  const ranking = rows.slice(0, 15).map((row, index) => `**${String(index + 1).padStart(2, '0')}** ${row.name} — **${row.points} pts** (${row.messages} messages + ${row.voiceMinutes} voice min)`).join('\n');
  return send(ctx, { embeds: [embed('Staff activity // today', `Combined points · target: **${target}**\n${ranking || 'No configured staff activity yet.'}`)] });
}

async function handleActivityPoints(ctx) {
  const operation = ctx.interaction ? ctx.interaction.options.getSubcommand() : ctx.args[0]?.toLowerCase();
  if (!['view', 'history', 'leaderboard', 'setup'].includes(operation)) return false;

  const config = await getConfig(ctx.guild.id);
  const target = activityTarget(config);
  if (operation === 'setup') {
    return send(ctx, { embeds: [embed('System setup // status', `Staff ranks: ${config.staffRoleIds.length}\nMessage channels: ${config.messageChannels.length}\nVoice channels: ${config.voiceChannels.length}\nAFK channel: ${config.afkChannelId ? `<#${config.afkChannelId}>` : 'not set'}\nMessage requirement setting: ${config.messageRequirement}\nVoice requirement setting: ${config.voiceRequirement}\n**Shared activity-points target: ${target} points**\nDefault timezone: ${config.defaultTimezone}\nAudit log: ${config.auditChannelId ? `<#${config.auditChannelId}>` : 'not set'}\n\nEach counted message and each eligible voice minute earns 1 point. Requirements set the same combined target; they are not added together.`)] });
  }
  if (operation === 'leaderboard') return showLeaderboard(ctx, config, target);
  return showMemberStats(ctx, config, requestedUser(ctx), operation === 'history', target);
}

module.exports = { handleActivityPoints };
