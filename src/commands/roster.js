const { PermissionFlagsBits } = require('discord.js');
const { DateTime } = require('luxon');
const { DailyActivity, UserTimezone } = require('../models');
const { LeaveRequest } = require('../models/features');
const { getConfig } = require('../utils/config');
const { activityTarget, activityPoints } = require('../utils/activity-points');
const { embed, failure } = require('../utils/embeds');

function hasManagerAccess(member, config) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator)
    || member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    || member?.roles?.cache && config.managerRoleIds.some(id => member.roles.cache.has(id)));
}

function getRoleFilter(ctx) {
  if (ctx.interaction) return ctx.interaction.options.getRole('role');
  const raw = ctx.args?.[0]?.replace(/[<@&>]/g, '');
  return raw ? ctx.guild.roles.cache.get(raw) || null : null;
}

async function sendRoster(ctx, pages, total, role) {
  const heading = `Staff roster${role ? ` // ${role.name}` : ''} · ${total} staff`;
  const embeds = pages.length
    ? pages.map((description, index) => embed(`${heading} · ${index + 1}/${pages.length}`, description))
    : [embed(heading, 'No configured staff members found.')];

  // Discord allows at most 10 embeds in one message. Continue in follow-ups for larger servers.
  for (let offset = 0; offset < embeds.length; offset += 10) {
    const batch = embeds.slice(offset, offset + 10);
    if (ctx.interaction) {
      if (offset === 0) {
        if (ctx.interaction.deferred || ctx.interaction.replied) await ctx.interaction.editReply({ embeds: batch });
        else await ctx.interaction.reply({ embeds: batch, ephemeral: true });
      } else {
        await ctx.interaction.followUp({ embeds: batch, ephemeral: true });
      }
    } else if (offset === 0) {
      await ctx.message.reply({ embeds: batch });
    } else {
      await ctx.message.channel.send({ embeds: batch });
    }
  }
}

async function handleRoster(ctx) {
  const config = await getConfig(ctx.guild.id);
  if (config.restrictStats && !hasManagerAccess(ctx.member, config)) {
    const error = failure('This server restricts staff statistics and rosters to authorized managers.');
    if (ctx.interaction) return ctx.interaction.reply({ embeds: [error], ephemeral: true });
    return ctx.message.reply({ embeds: [error] });
  }

  const role = getRoleFilter(ctx);
  if (ctx.interaction && !ctx.interaction.deferred && !ctx.interaction.replied) {
    await ctx.interaction.deferReply({ ephemeral: true });
  }
  if (role && !config.staffRoleIds.includes(role.id)) {
    const error = failure('That role is not in the configured staff hierarchy.');
    if (ctx.interaction) return ctx.interaction.editReply({ embeds: [error] });
    return ctx.message.reply({ embeds: [error] });
  }

  const members = await ctx.guild.members.fetch();
  const staff = [...members.values()]
    .filter(member => !member.user.bot
      && config.staffRoleIds.some(id => member.roles.cache.has(id))
      && (!role || member.roles.cache.has(role.id)))
    .sort((a, b) => {
      const aRank = Math.max(-1, ...config.staffRoleIds.map((id, index) => a.roles.cache.has(id) ? index : -1));
      const bRank = Math.max(-1, ...config.staffRoleIds.map((id, index) => b.roles.cache.has(id) ? index : -1));
      return bRank - aRank || a.displayName.localeCompare(b.displayName);
    });

  if (!staff.length) return sendRoster(ctx, [], 0, role);

  const userIds = staff.map(member => member.id);
  const zonesPromise = UserTimezone.find({ guildId: ctx.guild.id, userId: { $in: userIds } }).lean();
  const minimumDate = DateTime.utc().minus({ days: 9 }).toISODate();
  const activityPromise = DailyActivity.find({ guildId: ctx.guild.id, userId: { $in: userIds }, localDate: { $gte: minimumDate } }).lean();
  const leavesPromise = LeaveRequest.find({ guildId: ctx.guild.id, userId: { $in: userIds }, status: 'approved' }).lean();
  const [zones, activity, leaves] = await Promise.all([zonesPromise, activityPromise, leavesPromise]);

  const zoneByUser = new Map(zones.map(item => [item.userId, item.timezone]));
  const activityByUser = new Map();
  for (const record of activity) {
    if (!activityByUser.has(record.userId)) activityByUser.set(record.userId, new Map());
    activityByUser.get(record.userId).set(record.localDate, record);
  }
  const leaveByUser = new Map();
  for (const leave of leaves) {
    if (!leaveByUser.has(leave.userId)) leaveByUser.set(leave.userId, []);
    leaveByUser.get(leave.userId).push(leave);
  }

  const target = activityTarget(config);
  const lines = [];
  for (const member of staff) {
    const zone = zoneByUser.get(member.id) || config.defaultTimezone || 'UTC';
    const now = DateTime.now().setZone(zone);
    const today = now.toISODate();
    const weekStart = now.minus({ days: 6 }).toISODate();
    const records = activityByUser.get(member.id) || new Map();
    const todayRecord = records.get(today);
    const messages = todayRecord?.messages || 0;
    const voice = todayRecord?.voiceMinutes || 0;
    const points = activityPoints(messages, voice);
    let weekMessages = 0;
    let weekVoice = 0;
    let daysMet = 0;
    for (let day = 0; day < 7; day++) {
      const date = now.minus({ days: day }).toISODate();
      const record = records.get(date);
      const dayMessages = record?.messages || 0;
      const dayVoice = record?.voiceMinutes || 0;
      weekMessages += dayMessages;
      weekVoice += dayVoice;
      if (activityPoints(dayMessages, dayVoice) >= target) daysMet++;
    }

    const activeLeave = (leaveByUser.get(member.id) || []).find(item => item.startDate <= today && (!item.endDate || item.endDate >= today));
    const rankIds = config.staffRoleIds.filter(id => member.roles.cache.has(id));
    const highestRankId = rankIds.at(-1);
    const presence = member.presence?.status || 'unknown';
    const joined = member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:D>` : 'unknown';
    const status = activeLeave ? 'On approved leave' : points >= target ? 'Daily target met' : 'In progress';
    const name = member.displayName.replace(/[\r\n]/g, ' ').slice(0, 70);
    lines.push(`**${name}** (<@${member.id}>)\nRank: <@&${highestRankId}>${rankIds.length > 1 ? ` · also ${rankIds.length - 1} configured rank(s)` : ''} · Discord: **${presence}**\nToday (${today}): **${messages} msgs · ${voice} voice min · ${points}/${target} pts** · ${status}\nLast 7 days: **${weekMessages} msgs · ${weekVoice} voice min · ${activityPoints(weekMessages, weekVoice)} pts** · target met ${daysMet}/7 days\nTimezone: \`${zone}\` · Joined: ${joined}`);
  }

  const pages = [];
  let page = '';
  for (const line of lines) {
    if (page && (page.split('\n\n').length >= 5 || page.length + line.length + 2 > 3500)) {
      pages.push(page);
      page = '';
    }
    page += `${page ? '\n\n' : ''}${line}`;
  }
  if (page) pages.push(page);
  return sendRoster(ctx, pages, staff.length, role);
}

module.exports = { handleRoster };
