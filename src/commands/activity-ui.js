const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { DateTime } = require('luxon');
const { DailyActivity } = require('../models');
const { getConfig } = require('../utils/config');
const { getTimezone, localDate } = require('../utils/time');
const { activityPoints, activityTarget } = require('../utils/activity-points');
const { embed, failure } = require('../utils/embeds');

const PERIODS = ['today', '7d', '14d', 'all'];
const PERIOD_LABELS = { today: 'Today', '7d': 'Last 7 days', '14d': 'Last 14 days', all: 'All time' };

function memberHasRole(member, roleIds = []) {
  return Boolean(member?.roles?.cache && roleIds.some(id => member.roles.cache.has(id)));
}

function isManager(ctx, config) {
  return Boolean(
    ctx.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    memberHasRole(ctx.member, config.managerRoleIds)
  );
}

function commandOptions(ctx) {
  if (ctx.interaction) return { operation: ctx.interaction.options.getSubcommand(), user: ctx.interaction.options.getUser('user') };
  const args = [...(ctx.args || [])];
  const operation = args[0]?.toLowerCase();
  const rawUser = args[1];
  const id = rawUser?.replace(/[<@!>]/g, '');
  return { operation, user: id && /^\d{17,20}$/.test(id) ? { id, username: id } : null };
}

async function send(ctx, payload) {
  if (ctx.interaction) {
    if (ctx.interaction.deferred || ctx.interaction.replied) return ctx.interaction.editReply(payload);
    return ctx.interaction.reply({ ...payload, ephemeral: true });
  }
  return ctx.message.reply(payload);
}

async function handleDailyHistory(ctx) {
  const config = await getConfig(ctx.guild.id);
  const { user: requestedUser } = commandOptions(ctx);
  const user = requestedUser || ctx.user;
  const staff = ctx.guild.members.cache.get(user.id) || await ctx.guild.members.fetch(user.id).catch(() => null);
  if (!staff) return send(ctx, { embeds: [failure('That member could not be found in this server.')] });
  const manager = isManager(ctx, config);
  if (config.restrictStats && user.id !== ctx.user.id && !manager) {
    return send(ctx, { embeds: [failure('This server restricts staff activity statistics to authorized managers.')] });
  }
  if (!memberHasRole(staff, config.staffRoleIds) && !ctx.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return send(ctx, { embeds: [failure('Statistics are available for configured staff members only.')] });
  }

  const timezone = await getTimezone(ctx.guild.id, user.id, config);
  const today = localDate(new Date(), timezone);
  const firstDay = DateTime.fromISO(today, { zone: timezone }).minus({ days: 13 }).toISODate();
  const records = await DailyActivity.find({
    guildId: ctx.guild.id,
    userId: user.id,
    localDate: { $gte: firstDay, $lte: today }
  }).lean();
  const byDate = new Map(records.map(record => [record.localDate, record]));
  const target = activityTarget(config);
  const lines = [];
  for (let offset = 13; offset >= 0; offset--) {
    const date = DateTime.fromISO(today, { zone: timezone }).minus({ days: offset }).toISODate();
    const record = byDate.get(date);
    const messages = record?.messages || 0;
    const voice = record?.voiceMinutes || 0;
    const points = activityPoints(messages, voice);
    const status = points >= target ? '✅ target met' : `${Math.max(0, target - points)} to go`;
    lines.push(`**${date}** · ${messages} messages · ${voice} voice min · **${points} pts** · ${status}`);
  }
  const card = embed(`Daily activity // ${staff.displayName} · last 14 days`, `Timezone: **${timezone}**\nDaily target: **${target} combined points**\n\n${lines.join('\n')}`);
  return send(ctx, { embeds: [card] });
}

function periodRow(period, ownerId) {
  return new ActionRowBuilder().addComponents(...PERIODS.map(key =>
    new ButtonBuilder()
      .setCustomId(`bulkrole:lb:${key}:${ownerId}`)
      .setLabel(PERIOD_LABELS[key])
      .setStyle(key === period ? ButtonStyle.Primary : ButtonStyle.Secondary)
  ));
}

async function leaderboardData(guild, config, period) {
  const members = await guild.members.fetch();
  const staff = [...members.values()].filter(member => !member.user.bot && memberHasRole(member, config.staffRoleIds));
  if (!staff.length) return { rows: [], target: activityTarget(config) };

  const users = staff.map(member => member.id);
  const dateByUser = new Map();
  let earliest = null;
  for (const member of staff) {
    const zone = await getTimezone(guild.id, member.id, config);
    const today = localDate(new Date(), zone);
    const days = period === '7d' ? 7 : period === '14d' ? 14 : 1;
    const from = DateTime.fromISO(today, { zone }).minus({ days: days - 1 }).toISODate();
    dateByUser.set(member.id, { today, from });
    if (!earliest || from < earliest) earliest = from;
  }

  const query = { guildId: guild.id, userId: { $in: users } };
  if (period !== 'all') query.localDate = { $gte: earliest };
  const records = await DailyActivity.find(query).select({ userId: 1, localDate: 1, messages: 1, voiceMinutes: 1 }).lean();
  const totals = new Map(users.map(id => [id, { messages: 0, voice: 0 }]));
  for (const record of records) {
    const bounds = dateByUser.get(record.userId);
    if (!bounds || (period !== 'all' && (record.localDate < bounds.from || record.localDate > bounds.today))) continue;
    const total = totals.get(record.userId);
    total.messages += record.messages || 0;
    total.voice += record.voiceMinutes || 0;
  }

  const rows = staff.map(member => {
    const total = totals.get(member.id);
    return {
      id: member.id,
      name: member.displayName,
      messages: total.messages,
      voice: total.voice,
      points: activityPoints(total.messages, total.voice)
    };
  }).sort((a, b) => b.points - a.points || b.messages - a.messages || b.voice - a.voice || a.name.localeCompare(b.name));
  return { rows, target: activityTarget(config) };
}

async function leaderboardPayload(guild, period, ownerId) {
  const config = await getConfig(guild.id);
  const { rows, target } = await leaderboardData(guild, config, period);
  const body = rows.slice(0, 15).map((row, index) =>
    `**${String(index + 1).padStart(2, '0')}.** <@${row.id}> — **${row.points} pts** (${row.messages} messages · ${row.voice} voice min)`
  ).join('\n') || 'No configured staff activity found for this period.';
  const description = `Period: **${PERIOD_LABELS[period]}** · target: **${target} combined points/day**\n\n${body}`;
  return { embeds: [embed(`Staff activity leaderboard // ${PERIOD_LABELS[period]}`, description)], components: [periodRow(period, ownerId)] };
}

async function handleLeaderboard(ctx) {
  const period = 'today';
  if (ctx.interaction && !ctx.interaction.deferred && !ctx.interaction.replied) {
    await ctx.interaction.deferReply({ ephemeral: true });
  }
  const payload = await leaderboardPayload(ctx.guild, period, ctx.user.id);
  if (ctx.interaction) return ctx.interaction.editReply(payload);
  return ctx.message.reply(payload);
}

async function handleLeaderboardButton(interaction) {
  const [, marker, period, ownerId] = interaction.customId.split(':');
  if (marker !== 'lb' || !PERIODS.includes(period)) {
    return interaction.reply({ embeds: [failure('That leaderboard control is invalid. Run `$modstats leaderboard` again.')], ephemeral: true });
  }
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ embeds: [failure('Only the person who opened this leaderboard can change its period.')], ephemeral: true });
  }
  try {
    const payload = await leaderboardPayload(interaction.guild, period, ownerId);
    return interaction.update(payload);
  } catch (error) {
    console.error('[leaderboard] Failed to refresh:', error?.message || error);
    return interaction.update({ embeds: [failure('Could not refresh the leaderboard. Check the database connection and try again.')], components: [] });
  }
}

module.exports = { commandOptions, handleDailyHistory, handleLeaderboard, handleLeaderboardButton };
