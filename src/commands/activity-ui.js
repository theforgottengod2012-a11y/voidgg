const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require('discord.js');
const { DateTime } = require('luxon');
const { DailyActivity, UserTimezone } = require('../models');
const { getConfig } = require('../utils/config');
const { localDate, validTimezone } = require('../utils/time');
const { activityPoints, activityTarget } = require('../utils/activity-points');
const { embed, failure } = require('../utils/embeds');

const PERIOD_LABELS = { today: 'Today', '7d': 'Last 7 days', '14d': 'Last 14 days', all: 'All time' };
const PERIOD_DAYS = { today: 1, '7d': 7, '14d': 14 };
const CUSTOM_MODAL_PREFIX = 'leaderboard-modal:';

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
  return ctx.interaction ? ctx.interaction.options.getSubcommand() : ctx.args?.[0]?.toLowerCase();
}

function getRequestedUser(ctx) {
  if (ctx.interaction) return ctx.interaction.options.getUser('user');
  const id = ctx.args?.[1]?.replace(/[<@!>]/g, '');
  return id && /^\d{17,20}$/.test(id) ? { id, username: id } : null;
}

async function send(ctx, payload) {
  if (ctx.interaction) {
    if (ctx.interaction.deferred || ctx.interaction.replied) return ctx.interaction.editReply(payload);
    return ctx.interaction.reply({ ...payload, ephemeral: true });
  }
  return ctx.message.reply(payload);
}

async function getMemberTimezone(guildId, userId, fallback = 'UTC') {
  const preference = await UserTimezone.findOne({ guildId, userId }).select({ timezone: 1 }).lean();
  const zone = preference?.timezone || fallback || 'UTC';
  return validTimezone(zone) ? zone : 'UTC';
}

function targetStatus(points, target) {
  if (!target) return '⚪ target not configured';
  return points >= target ? '✅ target met' : '❌ target not met';
}

function formatHistoryDate(date, timezone) {
  return DateTime.fromISO(date, { zone: timezone }).toFormat('LLL dd');
}

// `$modstats view` keeps today's activity prominent in the original compact
// card style, then adds a 14-day check/cross tracker and lifetime totals.
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

  const timezone = await getMemberTimezone(ctx.guild.id, user.id, config.defaultTimezone);
  const today = localDate(new Date(), timezone);
  const firstDay = DateTime.fromISO(today, { zone: timezone }).minus({ days: 13 }).toISODate();
  const [records, lifetimeRows] = await Promise.all([
    DailyActivity.find({
      guildId: ctx.guild.id,
      userId: user.id,
      localDate: { $gte: firstDay, $lte: today }
    }).select({ localDate: 1, messages: 1, voiceMinutes: 1 }).lean(),
    DailyActivity.aggregate([
      { $match: { guildId: ctx.guild.id, userId: user.id } },
      { $group: {
        _id: null,
        messages: { $sum: '$messages' },
        voiceMinutes: { $sum: '$voiceMinutes' }
      } }
    ])
  ]);

  const byDate = new Map(records.map(record => [record.localDate, record]));
  const target = activityTarget(config);
  const todayRecord = byDate.get(today);
  const todayMessages = todayRecord?.messages || 0;
  const todayVoice = todayRecord?.voiceMinutes || 0;
  const todayPoints = activityPoints(todayMessages, todayVoice);
  const lifetime = lifetimeRows[0] || { messages: 0, voiceMinutes: 0 };
  const lifetimeMessages = lifetime.messages || 0;
  const lifetimeVoice = lifetime.voiceMinutes || 0;
  const lifetimePoints = activityPoints(lifetimeMessages, lifetimeVoice);

  const history = [];
  for (let offset = 13; offset >= 0; offset--) {
    const date = DateTime.fromISO(today, { zone: timezone }).minus({ days: offset }).toISODate();
    const record = byDate.get(date);
    const points = activityPoints(record?.messages || 0, record?.voiceMinutes || 0);
    history.push({ date, points, icon: !target ? '⚪' : points >= target ? '✅' : '❌' });
  }

  if (getOperation(ctx) === 'history') {
    const lines = history.map(({ date, points, icon }) => {
      const record = byDate.get(date);
      return `**${date}** · ${record?.messages || 0} messages · ${record?.voiceMinutes || 0} min · **${points} pts** ${icon}`;
    });
    const card = embed(`14-Day Record // ${staff.displayName}`, `Timezone: **${timezone}**\nDaily activity target: **${target || 'not configured'} combined points**\n\n${lines.join('\n')}\n\n**All-time totals**\n${lifetimeMessages} messages · ${lifetimeVoice} voice minutes · **${lifetimePoints} points**`);
    return send(ctx, { embeds: [card] });
  }

  const historyRows = [history.slice(0, 7), history.slice(7, 14)].map(row =>
    row.map(day => `${formatHistoryDate(day.date, timezone)} ${day.icon}`).join('  ·  ')
  ).join('\n');
  const requirement = !target
    ? 'Not configured'
    : todayPoints >= target
      ? `✅ Met · ${todayPoints - target} points over`
      : `❌ In progress · ${target - todayPoints} points to go`;
  const description = [
    `Local day: **${today}** · ${timezone}`,
    '',
    `**Messages:** ${todayMessages} · ${todayMessages} points`,
    `**Voice activity:** ${todayVoice} min · ${todayVoice} points`,
    '',
    `**Combined activity:** ${todayPoints} / ${target} points`,
    `**Requirement status:** ${requirement}`,
    '',
    '**Last 14 days**  ·  ✅ met  ❌ not met',
    historyRows,
    '',
    `**All-time totals:** ${lifetimeMessages} messages · ${lifetimeVoice} voice minutes · **${lifetimePoints} points**`,
    '',
    '**Daily activity target**',
    `**${target} combined points**`,
    'Each message = 1 point · Each voice minute = 1 point'
  ].join('\n');
  return send(ctx, { embeds: [embed(`Activity // ${staff.displayName}`, description)] });
}

function periodRow(period, ownerId) {
  const presets = ['today', '7d', '14d', 'all'];
  const rows = [new ActionRowBuilder().addComponents(...presets.map(key =>
    new ButtonBuilder()
      .setCustomId(`leaderboard:${key}:${ownerId}`)
      .setLabel(PERIOD_LABELS[key])
      .setStyle(period === key ? ButtonStyle.Primary : ButtonStyle.Secondary)
  ))];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`leaderboard:custom:${ownerId}`)
      .setLabel(typeof period === 'number' ? `Custom · ${period} days` : 'Custom range…')
      .setStyle(typeof period === 'number' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  ));
  return rows;
}

function normalizePeriod(period) {
  if (period === 'all' || Object.hasOwn(PERIOD_DAYS, period)) return period;
  const customDays = typeof period === 'number' ? period : Number(String(period).replace(/^custom-/, ''));
  if (Number.isInteger(customDays) && customDays >= 1 && customDays <= 365) return customDays;
  throw new Error('Invalid leaderboard period');
}

function periodDays(period) {
  return typeof period === 'number' ? period : PERIOD_DAYS[period];
}

function periodName(period) {
  return typeof period === 'number' ? `Last ${period} days` : PERIOD_LABELS[period];
}

async function leaderboardData(guild, config, period) {
  const members = await guild.members.fetch();
  const staff = [...members.values()].filter(member => !member.user.bot && memberHasRole(member, config.staffRoleIds));
  if (!staff.length) return { rows: [], target: activityTarget(config) };

  const userIds = staff.map(member => member.id);
  const preferences = await UserTimezone.find({ guildId: guild.id, userId: { $in: userIds } })
    .select({ userId: 1, timezone: 1 })
    .lean();
  const timezoneByUser = new Map(preferences.map(item => [item.userId, validTimezone(item.timezone) ? item.timezone : 'UTC']));
  const dateByUser = new Map();
  const days = periodDays(period);

  for (const member of staff) {
    const timezone = timezoneByUser.get(member.id) || (validTimezone(config.defaultTimezone) ? config.defaultTimezone : 'UTC');
    const today = localDate(new Date(), timezone);
    const from = period === 'all' ? null : DateTime.fromISO(today, { zone: timezone }).minus({ days: days - 1 }).toISODate();
    dateByUser.set(member.id, { today, from });
  }

  let match;
  if (period === 'all') {
    match = { guildId: guild.id, userId: { $in: userIds } };
  } else {
    match = {
      guildId: guild.id,
      $or: userIds.map(userId => {
        const range = dateByUser.get(userId);
        return { userId, localDate: { $gte: range.from, $lte: range.today } };
      })
    };
  }

  const totals = await DailyActivity.aggregate([
    { $match: match },
    { $group: {
      _id: '$userId',
      messages: { $sum: '$messages' },
      voice: { $sum: '$voiceMinutes' }
    } }
  ]);
  const totalByUser = new Map(totals.map(item => [item._id, { messages: item.messages || 0, voice: item.voice || 0 }]));
  const rows = staff.map(member => {
    const total = totalByUser.get(member.id) || { messages: 0, voice: 0 };
    return { id: member.id, name: member.displayName, messages: total.messages, voice: total.voice, points: activityPoints(total.messages, total.voice) };
  }).sort((a, b) => b.points - a.points || b.messages - a.messages || b.voice - a.voice || a.name.localeCompare(b.name));
  return { rows, target: activityTarget(config) };
}

async function leaderboardPayload(guild, period, ownerId) {
  period = normalizePeriod(period);
  const config = await getConfig(guild.id);
  const { rows, target } = await leaderboardData(guild, config, period);
  const body = rows.slice(0, 15).map((row, index) =>
    `**${String(index + 1).padStart(2, '0')}.** <@${row.id}> — **${row.points} pts** (${row.messages} messages · ${row.voice} voice min)`
  ).join('\n') || 'No configured staff activity found for this period.';
  const targetText = period === 'all' ? 'All-time totals · no daily target applies.' : `Daily target: **${target} combined points**`;
  return {
    embeds: [embed(`Staff activity leaderboard // ${periodName(period)}`, `${targetText}\n\n${body}`)],
    components: periodRow(period, ownerId)
  };
}

function customRangeModal(ownerId) {
  const input = new TextInputBuilder()
    .setCustomId('days')
    .setLabel('Number of days (1–365)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Example: 30')
    .setMinLength(1)
    .setMaxLength(3)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`${CUSTOM_MODAL_PREFIX}${ownerId}`)
    .setTitle('Custom leaderboard period')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function handleLeaderboard(ctx) {
  if (ctx.interaction && !ctx.interaction.deferred && !ctx.interaction.replied) {
    await ctx.interaction.deferReply({ ephemeral: true });
  }
  try {
    const payload = await leaderboardPayload(ctx.guild, 'today', ctx.user.id);
    if (ctx.interaction) return ctx.interaction.editReply(payload);
    return ctx.message.reply(payload);
  } catch (error) {
    console.error('[leaderboard] Initial render failed:', error?.stack || error?.message || error);
    const payload = { embeds: [failure('Could not load the leaderboard. Check Railway logs for the database or permissions error.')], components: [] };
    if (ctx.interaction) return ctx.interaction.editReply(payload);
    return ctx.message.reply(payload);
  }
}

async function handleLeaderboardButton(interaction) {
  const [, period, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ embeds: [failure('Only the person who opened this leaderboard can change its period.')], ephemeral: true });
  }
  if (period === 'custom') return interaction.showModal(customRangeModal(ownerId));

  try {
    const normalized = normalizePeriod(period);
    await interaction.deferUpdate();
    const payload = await leaderboardPayload(interaction.guild, normalized, ownerId);
    return interaction.editReply(payload);
  } catch (error) {
    console.error('[leaderboard] Button refresh failed:', error?.stack || error?.message || error);
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ embeds: [failure('Could not refresh the leaderboard. Check Railway logs for the exact database or permission error.')], components: [] }).catch(() => {});
    }
    return interaction.reply({ embeds: [failure('Could not refresh the leaderboard. Please run `$modstats leaderboard` again.')], ephemeral: true }).catch(() => {});
  }
}

async function handleLeaderboardModal(interaction) {
  const ownerId = interaction.customId.slice(CUSTOM_MODAL_PREFIX.length);
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ embeds: [failure('Only the person who opened this leaderboard can set its custom period.')], ephemeral: true });
  }
  const days = Number(interaction.fields.getTextInputValue('days'));
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return interaction.reply({ embeds: [failure('Enter a whole number from 1 to 365.')], ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    return interaction.editReply(await leaderboardPayload(interaction.guild, days, ownerId));
  } catch (error) {
    console.error('[leaderboard] Custom period failed:', error?.stack || error?.message || error);
    return interaction.editReply({ embeds: [failure('Could not load that custom period. Check Railway logs for the exact database or permissions error.')], components: [] });
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
    '`$modstats view [@user]` — today’s activity, last-14-day check/cross mini-history, and all-time totals',
    '`$modstats history [@user]` — detailed daily records for the last 14 days plus all-time totals',
    '`$modstats leaderboard` — Today, 7 days, 14 days, all time, or Custom range (1–365 days)',
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
  return send(ctx, { embeds: [embed('VOID // command directory', description)] });
}

module.exports = {
  handleActivityCommand,
  handleDailyHistory,
  handleLeaderboard,
  handleLeaderboardButton,
  handleLeaderboardModal,
  handleHelp
};
