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

function getOperation(ctx) {
  return ctx.interaction
    ? ctx.interaction.options.getSubcommand()
    : ctx.args?.[0]?.toLowerCase();
}

function getRequestedUser(ctx) {
  if (ctx.interaction) return ctx.interaction.options.getUser('user');
  const raw = ctx.args?.[1];
  const id = raw?.replace(/[<@!>]/g, '');
  return id && /^\d{17,20}$/.test(id) ? { id, username: id } : null;
}

async function send(ctx, payload) {
  if (ctx.interaction) {
    if (ctx.interaction.deferred || ctx.interaction.replied) return ctx.interaction.editReply(payload);
    return ctx.interaction.reply({ ...payload, ephemeral: true });
  }
  return ctx.message.reply(payload);
}

// Both `view` and `history` show each local calendar day separately. Avoid
// collapsing the requested 14-day record into a misleading aggregate total.
async function handleDailyHistory(ctx) {
  const config = await getConfig(ctx.guild.id);
  const user = getRequestedUser(ctx) || ctx.user;
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
  }).select({ localDate: 1, messages: 1, voiceMinutes: 1 }).lean();
  const byDate = new Map(records.map(record => [record.localDate, record]));
  const target = activityTarget(config);
  const lines = [];
  for (let offset = 13; offset >= 0; offset--) {
    const date = DateTime.fromISO(today, { zone: timezone }).minus({ days: offset }).toISODate();
    const record = byDate.get(date);
    const messages = record?.messages || 0;
    const voice = record?.voiceMinutes || 0;
    const points = activityPoints(messages, voice);
    const status = points >= target ? '✅ target met' : `${Math.max(0, target - points)} points to go`;
    lines.push(`**${date}** · ${messages} messages · ${voice} voice min · **${points} pts** · ${status}`);
  }

  const card = embed(
    `Daily activity // ${staff.displayName} · last 14 days`,
    `Timezone: **${timezone}**\nDaily target: **${target} combined points**\n\n${lines.join('\n')}`
  );
  return send(ctx, { embeds: [card] });
}

function periodRow(period, ownerId) {
  return new ActionRowBuilder().addComponents(...PERIODS.map(key =>
    new ButtonBuilder()
      .setCustomId(`leaderboard:${key}:${ownerId}`)
      .setLabel(PERIOD_LABELS[key])
      .setStyle(key === period ? ButtonStyle.Primary : ButtonStyle.Secondary)
  ));
}

async function leaderboardData(guild, config, period) {
  const members = await guild.members.fetch();
  const staff = [...members.values()].filter(member => !member.user.bot && memberHasRole(member, config.staffRoleIds));
  if (!staff.length) return { rows: [], target: activityTarget(config) };

  const users = staff.map(member => member.id);
  const datesByUser = new Map();
  let earliestDate = null;
  for (const member of staff) {
    const timezone = await getTimezone(guild.id, member.id, config);
    const today = localDate(new Date(), timezone);
    const numberOfDays = period === '7d' ? 7 : period === '14d' ? 14 : 1;
    const from = DateTime.fromISO(today, { zone: timezone }).minus({ days: numberOfDays - 1 }).toISODate();
    datesByUser.set(member.id, { today, from });
    if (!earliestDate || from < earliestDate) earliestDate = from;
  }

  const query = { guildId: guild.id, userId: { $in: users } };
  if (period !== 'all') query.localDate = { $gte: earliestDate };
  const records = await DailyActivity.find(query)
    .select({ userId: 1, localDate: 1, messages: 1, voiceMinutes: 1 })
    .lean();
  const totals = new Map(users.map(id => [id, { messages: 0, voice: 0 }]));
  for (const record of records) {
    const range = datesByUser.get(record.userId);
    if (!range || (period !== 'all' && (record.localDate < range.from || record.localDate > range.today))) continue;
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
  const targetText = period === 'all' ? 'No daily target applies to the all-time total.' : `Daily target: **${target} combined points**`;
  return {
    embeds: [embed(`Staff activity leaderboard // ${PERIOD_LABELS[period]}`, `${targetText}\n\n${body}`)],
    components: [periodRow(period, ownerId)]
  };
}

async function handleLeaderboard(ctx) {
  if (ctx.interaction && !ctx.interaction.deferred && !ctx.interaction.replied) {
    await ctx.interaction.deferReply({ ephemeral: true });
  }
  const payload = await leaderboardPayload(ctx.guild, 'today', ctx.user.id);
  if (ctx.interaction) return ctx.interaction.editReply(payload);
  return ctx.message.reply(payload);
}

async function handleLeaderboardButton(interaction) {
  const [, period, ownerId] = interaction.customId.split(':');
  if (!PERIODS.includes(period)) {
    return interaction.reply({ embeds: [failure('That leaderboard control is invalid. Run `$modstats leaderboard` again.')], ephemeral: true });
  }
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ embeds: [failure('Only the person who opened this leaderboard can change its period.')], ephemeral: true });
  }
  try {
    return interaction.update(await leaderboardPayload(interaction.guild, period, ownerId));
  } catch (error) {
    console.error('[leaderboard] Failed to refresh:', error?.message || error);
    return interaction.update({ embeds: [failure('Could not refresh the leaderboard. Check the database connection and try again.')], components: [] });
  }
}

async function handleActivityCommand(ctx, legacyHandler) {
  const operation = getOperation(ctx);
  if (operation === 'view' || operation === 'history') return handleDailyHistory(ctx);
  if (operation === 'leaderboard') return handleLeaderboard(ctx);
  return legacyHandler(ctx);
}

async function handleHelp(ctx) {
  const description = [
    '**STAFF ACTIVITY**',
    '`$modstats view [@user]` · `$modstats history [@user]` — per-day activity for each of the last 14 days',
    '`$modstats leaderboard` — switch between Today, 7 days, 14 days, and all time with the buttons',
    '`$modstats setup` · `$modstats channel add/remove/list #channel` · `$modstats voicechannel add/remove/list #channel`',
    '`$modstats requirement messages <count>` · `$modstats requirement voice <minutes>` · `$modstats defaulttimezone <IANA zone>`',
    '`$modstats afk #voice-channel|disable` · `$modstats audit #channel` · `$modstats permissions add/remove @role` · `$modstats restrict on/off`',
    '`$modstats reset @user|all` — manager only; bulk reset asks for confirmation',
    '',
    '**STAFF MANAGEMENT**',
    '`$staffrole add/remove/list/config` · `$staffrole setorder @role...`',
    '`$promote @user` · `$demote @user` · `$strip @user`',
    '`$staffroster [@role]` · `$inrole @role` · `$roleposition @role` · `$rolereposition @role <position>`',
    '',
    '**PERSONAL**',
    '`$tz` · `$tz list` · `$tz reset` · `$tz <IANA zone>` · `$tz @user`'
  ].join('\n');
  const payload = { embeds: [embed('VOID // command directory', description)] };
  if (ctx.interaction) {
    if (ctx.interaction.deferred || ctx.interaction.replied) return ctx.interaction.editReply(payload);
    return ctx.interaction.reply({ ...payload, ephemeral: true });
  }
  return ctx.message.reply(payload);
}

module.exports = { handleActivityCommand, handleDailyHistory, handleLeaderboard, handleLeaderboardButton, handleHelp };
