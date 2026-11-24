const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { DateTime } = require('luxon');
const { DailyActivity, UserTimezone } = require('../models');
const { getConfig } = require('../utils/config');
const { localDate, validTimezone } = require('../utils/time');
const { activityPoints, activityTarget } = require('../utils/activity-points');
const { embed, failure } = require('../utils/embeds');

const PERIOD_LABELS = { today: 'Today', '7d': 'Last 7 days', '14d': 'Last 14 days', all: 'All time' };
const PERIOD_DAYS = { today: 1, '7d': 7, '14d': 14 };
const CUSTOM_MODAL_PREFIX = 'leaderboard-modal:';

function memberHasRole(member, roleIds = []) { return Boolean(member?.roles?.cache && roleIds.some(id => member.roles.cache.has(id))); }
function isManager(ctx, config) { return Boolean(ctx.member?.permissions?.has(PermissionFlagsBits.Administrator) || ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild) || memberHasRole(ctx.member, config.managerRoleIds)); }
function operation(ctx) { return ctx.interaction ? ctx.interaction.options.getSubcommand() : ctx.args?.[0]?.toLowerCase(); }
function requestedUser(ctx) {
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
async function timezone(guildId, userId, fallback) {
  const pref = await UserTimezone.findOne({ guildId, userId }).select({ timezone: 1 }).lean();
  return validTimezone(pref?.timezone) ? pref.timezone : validTimezone(fallback) ? fallback : 'UTC';
}

async function handleDailyHistory(ctx) {
  const config = await getConfig(ctx.guild.id);
  const user = requestedUser(ctx) || ctx.user;
  const staff = ctx.guild.members.cache.get(user.id) || await ctx.guild.members.fetch(user.id).catch(() => null);
  if (!staff) return send(ctx, { embeds: [failure('That member could not be found in this server.')] });
  const manager = isManager(ctx, config);
  if (config.restrictStats && user.id !== ctx.user.id && !manager) return send(ctx, { embeds: [failure('This server restricts staff activity statistics to authorized managers.')] });
  if (!memberHasRole(staff, config.staffRoleIds) && !ctx.member?.permissions?.has(PermissionFlagsBits.Administrator)) return send(ctx, { embeds: [failure('Statistics are available for configured staff members only.')] });

  const zone = await timezone(ctx.guild.id, user.id, config.defaultTimezone);
  const today = localDate(new Date(), zone);
  const start = DateTime.fromISO(today, { zone }).minus({ days: 13 }).toISODate();
  const [records, allTime] = await Promise.all([
    DailyActivity.find({ guildId: ctx.guild.id, userId: user.id, localDate: { $gte: start, $lte: today } }).select({ localDate: 1, messages: 1, voiceMinutes: 1 }).lean(),
    DailyActivity.aggregate([{ $match: { guildId: ctx.guild.id, userId: user.id } }, { $group: { _id: null, messages: { $sum: '$messages' }, voice: { $sum: '$voiceMinutes' } } }])
  ]);
  const byDate = new Map(records.map(row => [row.localDate, row]));
  const target = activityTarget(config);
  const days = [];
  for (let offset = 13; offset >= 0; offset--) {
    const date = DateTime.fromISO(today, { zone }).minus({ days: offset }).toISODate();
    const row = byDate.get(date) || {};
    const messages = row.messages || 0;
    const voice = row.voiceMinutes || 0;
    const points = activityPoints(messages, voice);
    days.push({ date, messages, voice, points, icon: !target ? '⚪' : points >= target ? '✅' : '❌' });
  }
  const totals = allTime[0] || { messages: 0, voice: 0 };
  const totalPoints = activityPoints(totals.messages, totals.voice);
  if (operation(ctx) === 'history') {
    const lines = days.map(day => `**${day.date}** · ${day.messages} messages · ${day.voice} min · **${day.points} pts** ${day.icon}`);
    return send(ctx, { embeds: [embed(`14-Day Record // ${staff.displayName}`, `Timezone: **${zone}**\nDaily activity target: **${target || 'not configured'} combined points**\n\n${lines.join('\n')}\n\n**All-time totals**\n${totals.messages} messages · ${totals.voice} voice minutes · **${totalPoints} points**`)] });
  }
  const todayRow = days.at(-1);
  const historyRows = [days.slice(0, 7), days.slice(7)].map(row => row.map(day => `${DateTime.fromISO(day.date).toFormat('LLL dd')} ${day.messages}m ${day.icon}`).join('  ·  ')).join('\n');
  const status = !target ? 'Not configured' : todayRow.points >= target ? `✅ Met · ${todayRow.points - target} points over` : `❌ In progress · ${target - todayRow.points} points to go`;
  const description = [`Local day: **${today}** · ${zone}`, '', `**Messages:** ${todayRow.messages} · ${todayRow.messages} points`, `**Voice activity:** ${todayRow.voice} min · ${todayRow.voice} points`, '', `**Combined activity:** ${todayRow.points} / ${target} points`, `**Requirement status:** ${status}`, '', '**Last 14 days**  ·  ✅ met  ❌ not met  ·  `Xm` = messages', historyRows, '', `**All-time totals:** ${totals.messages} messages · ${totals.voice} voice minutes · **${totalPoints} points**`, '', '**Daily activity target**', `**${target} combined points**`, 'Each message = 1 point · Each voice minute = 1 point'].join('\n');
  return send(ctx, { embeds: [embed(`Activity // ${staff.displayName}`, description)] });
}

function normalizePeriod(period) {
  if (period === 'all' || Object.hasOwn(PERIOD_DAYS, period)) return period;
  const days = Number(String(period).replace(/^custom-/, ''));
  if (Number.isInteger(days) && days >= 1 && days <= 365) return days;
  throw new Error('Invalid leaderboard period');
}
function periodDays(period) { return typeof period === 'number' ? period : PERIOD_DAYS[period]; }
function periodName(period) { return typeof period === 'number' ? `Last ${period} days` : PERIOD_LABELS[period]; }
function periodRow(period, ownerId) {
  const row = new ActionRowBuilder().addComponents(...['today', '7d', '14d', 'all'].map(key => new ButtonBuilder().setCustomId(`leaderboard:${key}:${ownerId}`).setLabel(PERIOD_LABELS[key]).setStyle(period === key ? ButtonStyle.Primary : ButtonStyle.Secondary)));
  const custom = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`leaderboard:custom:${ownerId}`).setLabel(typeof period === 'number' ? `Custom · ${period} days` : 'Custom range…').setStyle(typeof period === 'number' ? ButtonStyle.Primary : ButtonStyle.Secondary));
  return [row, custom];
}
async function leaderboardData(guild, config, period) {
  const members = await guild.members.fetch();
  const staff = [...members.values()].filter(member => !member.user.bot && memberHasRole(member, config.staffRoleIds));
  const ids = staff.map(member => member.id);
  const prefs = await UserTimezone.find({ guildId: guild.id, userId: { $in: ids } }).select({ userId: 1, timezone: 1 }).lean();
  const zones = new Map(prefs.map(row => [row.userId, validTimezone(row.timezone) ? row.timezone : 'UTC']));
  const ranges = new Map();
  for (const member of staff) {
    const zone = zones.get(member.id) || (validTimezone(config.defaultTimezone) ? config.defaultTimezone : 'UTC');
    const today = localDate(new Date(), zone);
    ranges.set(member.id, { today, from: period === 'all' ? null : DateTime.fromISO(today, { zone }).minus({ days: periodDays(period) - 1 }).toISODate() });
  }
  const match = period === 'all' ? { guildId: guild.id, userId: { $in: ids } } : { guildId: guild.id, $or: ids.map(userId => ({ userId, localDate: { $gte: ranges.get(userId).from, $lte: ranges.get(userId).today } })) };
  const totals = await DailyActivity.aggregate([{ $match: match }, { $group: { _id: '$userId', messages: { $sum: '$messages' }, voice: { $sum: '$voiceMinutes' } } }]);
  const byUser = new Map(totals.map(row => [row._id, row]));
  return staff.map(member => { const row = byUser.get(member.id) || {}; return { id: member.id, name: member.displayName, messages: row.messages || 0, voice: row.voice || 0, points: activityPoints(row.messages, row.voice) }; }).sort((a, b) => b.points - a.points || b.messages - a.messages || b.voice - a.voice || a.name.localeCompare(b.name));
}
async function leaderboardPayload(guild, period, ownerId) {
  period = normalizePeriod(period);
  const config = await getConfig(guild.id);
  const rows = await leaderboardData(guild, config, period);
  const body = rows.slice(0, 15).map((row, i) => `**${String(i + 1).padStart(2, '0')}.** <@${row.id}> — **${row.points} pts** (${row.messages} messages · ${row.voice} voice min)`).join('\n') || 'No configured staff activity found for this period.';
  return { embeds: [embed(`Staff activity leaderboard // ${periodName(period)}`, `${period === 'all' ? 'All-time totals · no daily target applies.' : `Daily target: **${activityTarget(config)} combined points**`}\n\n${body}`)], components: periodRow(period, ownerId) };
}
function customRangeModal(ownerId) { return new ModalBuilder().setCustomId(`leaderboard-modal:${ownerId}`).setTitle('Custom leaderboard period').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('days').setLabel('Number of days (1–365)').setStyle(TextInputStyle.Short).setPlaceholder('Example: 30').setMaxLength(3).setRequired(true)))); }
async function handleLeaderboard(ctx) { if (ctx.interaction && !ctx.interaction.deferred && !ctx.interaction.replied) await ctx.interaction.deferReply({ ephemeral: true }); try { const payload = await leaderboardPayload(ctx.guild, 'today', ctx.user.id); return ctx.interaction ? ctx.interaction.editReply(payload) : ctx.message.reply(payload); } catch (error) { console.error('[leaderboard]', error); return send(ctx, { embeds: [failure('Could not load the leaderboard. Check Railway logs for the database or permissions error.')], components: [] }); } }
async function handleLeaderboardButton(interaction) { const [, period, ownerId] = interaction.customId.split(':'); if (interaction.user.id !== ownerId) return interaction.reply({ embeds: [failure('Only the person who opened this leaderboard can change its period.')], ephemeral: true }); if (period === 'custom') return interaction.showModal(customRangeModal(ownerId)); try { await interaction.deferUpdate(); return interaction.editReply(await leaderboardPayload(interaction.guild, normalizePeriod(period), ownerId)); } catch (error) { console.error('[leaderboard button]', error); return interaction.editReply({ embeds: [failure('Could not refresh the leaderboard. Check Railway logs.')], components: [] }).catch(() => {}); } }
async function handleLeaderboardModal(interaction) { const ownerId = interaction.customId.slice('leaderboard-modal:'.length); if (interaction.user.id !== ownerId) return interaction.reply({ embeds: [failure('Only the person who opened this leaderboard can set its custom period.')], ephemeral: true }); const days = Number(interaction.fields.getTextInputValue('days')); if (!Number.isInteger(days) || days < 1 || days > 365) return interaction.reply({ embeds: [failure('Enter a whole number from 1 to 365.')], ephemeral: true }); await interaction.deferReply({ ephemeral: true }); return interaction.editReply(await leaderboardPayload(interaction.guild, days, ownerId)); }
async function handleActivityCommand(ctx, legacyHandler) { const op = operation(ctx); if (op === 'view' || op === 'history') return handleDailyHistory(ctx); if (op === 'leaderboard') return handleLeaderboard(ctx); return legacyHandler(ctx); }
async function handleHelp(ctx) { return send(ctx, { embeds: [embed('VOID // command directory', '`$modstats view [@user]` — today’s activity, last-14-day check/cross history with message counts, and all-time totals\n`$modstats history [@user]` — detailed daily records\n`$modstats leaderboard` — Today, 7 days, 14 days, all time, or custom range\n\n`$tz` · `$staffrole` · `$promote` · `$demote` · `$strip` · `$staffroster` · `$inrole` · `$roleposition` · `$rolereposition`')] }); }
module.exports = { handleActivityCommand, handleDailyHistory, handleLeaderboard, handleLeaderboardButton, handleLeaderboardModal, handleHelp };
