const { AttachmentBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { DateTime } = require('luxon');
const { DailyActivity, AuditLog } = require('../models');
const { StaffNote, Reminder, StaffPreference, LeaveRequest, OnboardingItem, FeatureState } = require('../models/features');
const { getConfig, logAction } = require('../utils/config');
const { getTimezone, validTimezone } = require('../utils/time');
const { activityTarget, activityPoints } = require('../utils/activity-points');
const { embed, success, failure, warning } = require('../utils/embeds');

function opt(ctx, name) { return ctx.interaction?.options.get(name)?.value; }
function sub(ctx) { return ctx.interaction ? ctx.interaction.options.getSubcommand() : ctx.args?.[0]?.toLowerCase(); }
function memberId(raw = '') { return raw.replace(/[<@!>]/g, ''); }
function hasManage(ctx, config) {
  return Boolean(ctx.member?.permissions?.has(PermissionFlagsBits.Administrator)
    || ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    || ctx.member?.roles?.cache && config.managerRoleIds.some(id => ctx.member.roles.cache.has(id)));
}
function reply(ctx, payload) {
  if (ctx.interaction) {
    if (ctx.interaction.deferred || ctx.interaction.replied) return ctx.interaction.editReply(payload);
    return ctx.interaction.reply({ ...payload, ephemeral: true });
  }
  return ctx.message.reply(payload);
}
async function privateReply(ctx, payload) {
  if (ctx.interaction) return reply(ctx, payload);
  try {
    await ctx.user.send(payload);
    return ctx.message.reply('I sent you a private response.');
  } catch {
    return ctx.message.reply('I could not DM you. Enable DMs from this server and try again.');
  }
}
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function durationMs(input) {
  const match = input.match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/i);
  if (!match || !match[0] || !match[1] && !match[2] && !match[3]) return null;
  const ms = (Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60) * 1000;
  return ms >= 60_000 && ms <= 365 * 86400_000 ? ms : null;
}

async function activityRows(ctx, days) {
  const config = await getConfig(ctx.guild.id);
  const members = await ctx.guild.members.fetch();
  const eligible = [...members.values()].filter(m => !m.user.bot && config.staffRoleIds.some(id => m.roles.cache.has(id)));
  const rows = [];
  for (const member of eligible) {
    const zone = await getTimezone(ctx.guild.id, member.id, config);
    const today = DateTime.now().setZone(zone).startOf('day');
    const from = today.minus({ days: days - 1 }).toISODate();
    const to = today.toISODate();
    const docs = await DailyActivity.find({ guildId: ctx.guild.id, userId: member.id, localDate: { $gte: from, $lte: to } }).lean();
    const messages = docs.reduce((sum, d) => sum + d.messages, 0);
    const voice = docs.reduce((sum, d) => sum + d.voiceMinutes, 0);
    rows.push({ member, messages, voice, points: activityPoints(messages, voice), days, from, to });
  }
  return { config, rows };
}
async function handleActivity(ctx, name) {
  const operation = name === 'staffactivity' ? sub(ctx) : ctx.args?.[0]?.toLowerCase();
  if (name === 'modstats' && !['week', 'export', 'reminders'].includes(operation)) return false;
  if (operation === 'week') {
    const { config, rows } = await activityRows(ctx, 7);
    rows.sort((a, b) => b.points - a.points || b.messages - a.messages);
    const body = rows.slice(0, 20).map((r, i) => `**${String(i + 1).padStart(2, '0')}.** ${r.member.displayName} — **${r.points} pts** (${r.messages} messages + ${r.voice} voice min)`).join('\n') || 'No configured staff activity found.';
    await reply(ctx, { embeds: [embed('Staff activity // last 7 days', `**Combined daily target:** ${activityTarget(config)} points\n${body}`)] });
    return true;
  }
  if (operation === 'export') {
    const config = await getConfig(ctx.guild.id);
    const user = ctx.interaction ? ctx.interaction.options.getUser('user') : (ctx.args[1] ? { id: memberId(ctx.args[1]) } : ctx.user);
    if (!hasManage(ctx, config) && user.id !== ctx.user.id) { await reply(ctx, { embeds: [failure('Only managers can export another member’s activity.')] }); return true; }
    if (!config.staffRoleIds.some(id => ctx.member?.roles?.cache?.has(id)) && user.id === ctx.user.id && !hasManage(ctx, config)) { await reply(ctx, { embeds: [failure('Activity exports are available to configured staff members and managers.')] }); return true; }
    const records = await DailyActivity.find({ guildId: ctx.guild.id, userId: user.id }).sort({ localDate: 1 }).lean();
    if (!records.length) { await reply(ctx, { embeds: [warning('No activity history', 'There are no recorded activity days to export.')] }); return true; }
    const lines = [['date', 'timezone', 'messages', 'voice_minutes', 'combined_points'].map(csvCell).join(','), ...records.map(r => [r.localDate, r.timezone, r.messages, r.voiceMinutes, activityPoints(r.messages, r.voiceMinutes)].map(csvCell).join(','))];
    const attachment = new AttachmentBuilder(Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8'), { name: `void-activity-${user.id}.csv` });
    if (ctx.interaction) await ctx.interaction.reply({ files: [attachment], ephemeral: true });
    else await ctx.message.author.send({ files: [attachment] }).then(() => ctx.message.reply('I sent the activity CSV to your DMs.')).catch(() => ctx.message.reply('I could not DM the export; enable DMs and try again.'));
    return true;
  }
  if (operation === 'reminders') {
    const config = await getConfig(ctx.guild.id);
    if (!config.staffRoleIds.some(id => ctx.member?.roles?.cache?.has(id))) { await reply(ctx, { embeds: [failure('Activity reminders are for configured staff members.')] }); return true; }
    const setting = (name === 'staffactivity' ? opt(ctx, 'enabled') : ctx.args?.[1]?.toLowerCase()) ?? ctx.args?.[1]?.toLowerCase();
    if (!['on', 'off', true, false].includes(setting)) { await reply(ctx, { embeds: [failure('Use `$modstats reminders on` or `$modstats reminders off`.')] }); return true; }
    const enabled = setting === 'on' || setting === true;
    await StaffPreference.findOneAndUpdate({ guildId: ctx.guild.id, userId: ctx.user.id }, { $set: { activityReminders: enabled }, $setOnInsert: { guildId: ctx.guild.id, userId: ctx.user.id } }, { upsert: true });
    await reply(ctx, { embeds: [success('Activity reminders updated', `Daily activity reminders are **${enabled ? 'on' : 'off'}**.`)] });
    return true;
  }
  return false;
}

async function handleRoster(ctx) {
  const config = await getConfig(ctx.guild.id);
  const role = ctx.interaction ? ctx.interaction.options.getRole('role') : (ctx.args?.[0] ? ctx.guild.roles.cache.get(memberId(ctx.args[0])) : null);
  if (role && !config.staffRoleIds.includes(role.id)) return reply(ctx, { embeds: [failure('That role is not in the configured staff hierarchy.')] });
  const members = await ctx.guild.members.fetch();
  const staff = [...members.values()].filter(m => !m.user.bot && config.staffRoleIds.some(id => m.roles.cache.has(id)) && (!role || m.roles.cache.has(role.id)));
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  for (const member of staff) {
    const rankId = [...config.staffRoleIds].reverse().find(id => member.roles.cache.has(id));
    const zone = await getTimezone(ctx.guild.id, member.id, config);
    const date = DateTime.now().setZone(zone).toISODate();
    const activity = await DailyActivity.findOne({ guildId: ctx.guild.id, userId: member.id, localDate: date }).lean();
    const leave = await LeaveRequest.findOne({ guildId: ctx.guild.id, userId: member.id, status: 'approved', startDate: { $lte: date }, $or: [{ endDate: null }, { endDate: { $gte: date } }] }).lean();
    const points = activityPoints(activity?.messages || 0, activity?.voiceMinutes || 0);
    const state = leave ? 'LOA' : points >= activityTarget(config) ? 'On target' : 'In progress';
    lines.push(`• **${member.displayName}** · <@&${rankId}> · ${points}/${activityTarget(config)} pts · ${state}`);
  }
  const pages = [];
  for (let i = 0; i < lines.length; i += 25) pages.push(lines.slice(i, i + 25).join('\n'));
  await reply(ctx, { embeds: [embed(`Staff roster${role ? ` // ${role.name}` : ''}`, pages[0] || 'No configured staff members found.'), ...(pages.length > 1 ? [embed('Roster // continued', pages[1])] : [])] });
}

async function handleStaffNote(ctx) {
  const config = await getConfig(ctx.guild.id);
  if (!hasManage(ctx, config)) return reply(ctx, { embeds: [failure('Staff notes are restricted to server managers.')] });
  const action = sub(ctx);
  const args = ctx.args || [];
  const user = ctx.interaction ? ctx.interaction.options.getUser('user') : null;
  if (action === 'add') {
    const target = user?.id || memberId(args[1] || '');
    const text = ctx.interaction ? opt(ctx, 'text') : args.slice(2).join(' ');
    if (!/^\d{17,20}$/.test(target || '') || !text?.trim()) return privateReply(ctx, { embeds: [failure('Usage: `$staffnote add @user <private note>`.')] });
    const note = await StaffNote.create({ guildId: ctx.guild.id, userId: target, authorId: ctx.user.id, text: text.trim() });
    await logAction(ctx.guild, ctx.user.id, target, 'staffnote.add', { noteId: note.id });
    return privateReply(ctx, { embeds: [success('Private staff note saved', `Note ID: \`${note.id}\`. Note content is not sent to public channels or the audit channel.`)] });
  }
  if (action === 'list') {
    const target = user?.id || memberId(args[1] || '');
    if (!/^\d{17,20}$/.test(target || '')) return privateReply(ctx, { embeds: [failure('Usage: `$staffnote list @user`.')] });
    const notes = await StaffNote.find({ guildId: ctx.guild.id, userId: target }).sort({ createdAt: -1 }).limit(20).lean();
    return privateReply(ctx, { embeds: [embed(`Confidential notes // ${target}`, notes.map(n => `\`${n._id}\` · <t:${Math.floor(n.createdAt.getTime() / 1000)}:d> · <@${n.authorId}>\n${n.text}`).join('\n\n') || 'No notes found.')] });
  }
  if (action === 'remove') {
    const id = ctx.interaction ? opt(ctx, 'id') : args[1];
    const note = await StaffNote.findOneAndDelete({ _id: id, guildId: ctx.guild.id });
    if (!note) return privateReply(ctx, { embeds: [failure('No matching note was found.')] });
    await logAction(ctx.guild, ctx.user.id, note.userId, 'staffnote.remove', { noteId: id });
    return privateReply(ctx, { embeds: [success('Private note removed', `Removed note \`${id}\`.`)] });
  }
  return privateReply(ctx, { embeds: [failure('Use `$staffnote add @user <note>`, `$staffnote list @user`, or `$staffnote remove <note-id>`.')] });
}

async function handleReminder(ctx) {
  const amount = ctx.interaction ? opt(ctx, 'time') : ctx.args?.[0];
  const text = ctx.interaction ? opt(ctx, 'message') : ctx.args?.slice(1).join(' ');
  const delay = durationMs(amount || '');
  if (!delay || !text?.trim()) return reply(ctx, { embeds: [failure('Use `$remindme <duration> <message>`; duration examples: `20m`, `2h`, `1d`, or `1d2h30m`. Maximum is 365 days.')] });
  const reminder = await Reminder.create({ guildId: ctx.guild.id, userId: ctx.user.id, text: text.trim(), dueAt: new Date(Date.now() + delay) });
  const config = await getConfig(ctx.guild.id);
  const zone = await getTimezone(ctx.guild.id, ctx.user.id, config);
  return reply(ctx, { embeds: [success('Reminder scheduled', `I’ll DM you <t:${Math.floor(reminder.dueAt.getTime() / 1000)}:R> (${zone}).`)] });
}

async function handleRoleInfo(ctx) {
  const role = ctx.interaction ? ctx.interaction.options.getRole('role') : ctx.guild.roles.cache.get(memberId(ctx.args?.[0] || ''));
  if (!role) return reply(ctx, { embeds: [failure('Provide a valid role mention or ID. Usage: `$roleinfo @role`.')] });
  const permissions = role.permissions.toArray().slice(0, 18).map(p => `\`${p}\``).join(', ') || 'No permissions';
  return reply(ctx, { embeds: [embed(`Role info // ${role.name}`, `**Position:** ${role.position}\n**Members:** ${role.members.size}\n**Managed:** ${role.managed ? 'Yes' : 'No'}\n**Mentionable:** ${role.mentionable ? 'Yes' : 'No'}\n**Color:** ${role.hexColor}\n**Permissions:** ${permissions}${role.permissions.toArray().length > 18 ? ', …' : ''}`)] });
}

async function handleAudit(ctx) {
  const config = await getConfig(ctx.guild.id);
  if (!hasManage(ctx, config)) return reply(ctx, { embeds: [failure('Audit search is restricted to server managers.')] });
  const user = ctx.interaction ? ctx.interaction.options.getUser('user')?.id : (ctx.args?.[0] ? memberId(ctx.args[0]) : null);
  const query = { guildId: ctx.guild.id };
  if (user) query.targetId = user;
  const rows = await AuditLog.find(query).sort({ createdAt: -1 }).limit(15).lean();
  return reply(ctx, { embeds: [embed(`Audit history${user ? ` // ${user}` : ''}`, rows.map(r => `<t:${Math.floor(r.createdAt.getTime() / 1000)}:R> · **${r.action}** · actor <@${r.actorId || '0'}>${r.targetId ? ` · target <@${r.targetId}>` : ''}\n${JSON.stringify(r.details || {}).slice(0, 180)}`).join('\n\n') || 'No matching actions found.')] });
}

async function handleLoa(ctx) {
  const config = await getConfig(ctx.guild.id);
  const action = sub(ctx); const args = ctx.args || [];
  const user = ctx.interaction ? ctx.interaction.options.getUser('user') : null;
  if (action === 'start') {
    const date = ctx.interaction ? opt(ctx, 'date') : args[1];
    const reason = ctx.interaction ? opt(ctx, 'reason') || '' : args.slice(2).join(' ');
    if (!DateTime.fromISO(date || '').isValid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return privateReply(ctx, { embeds: [failure('Use `$loa start YYYY-MM-DD <optional reason>` with a valid date.')] });
    const ongoing = await LeaveRequest.findOne({ guildId: ctx.guild.id, userId: ctx.user.id, status: { $in: ['pending', 'approved'] } });
    if (ongoing) return privateReply(ctx, { embeds: [warning('Leave already active', `You already have a ${ongoing.status} leave request.`)] });
    const request = await LeaveRequest.create({ guildId: ctx.guild.id, userId: ctx.user.id, startDate: date, reason, status: 'pending' });
    await logAction(ctx.guild, ctx.user.id, ctx.user.id, 'loa.request', { requestId: request.id, startDate: date });
    return privateReply(ctx, { embeds: [success('Leave request submitted', 'A server manager must approve it before it changes activity status. Your reason is private to managers.')] });
  }
  if (action === 'end') {
    const leave = await LeaveRequest.findOneAndUpdate({ guildId: ctx.guild.id, userId: ctx.user.id, status: 'approved' }, { $set: { status: 'ended', endDate: DateTime.utc().toISODate() } }, { new: true });
    if (!leave) return privateReply(ctx, { embeds: [failure('You have no approved leave to end.')] });
    await logAction(ctx.guild, ctx.user.id, ctx.user.id, 'loa.end', { requestId: leave.id });
    return privateReply(ctx, { embeds: [success('Leave ended', 'Your activity status is active again.')] });
  }
  if (action === 'approve' || action === 'reject') {
    if (!hasManage(ctx, config)) return reply(ctx, { embeds: [failure('Only managers can review leave requests.')] });
    const target = user?.id || memberId(args[1] || '');
    const leave = await LeaveRequest.findOneAndUpdate({ guildId: ctx.guild.id, userId: target, status: 'pending' }, { $set: { status: action === 'approve' ? 'approved' : 'rejected', reviewedBy: ctx.user.id } }, { new: true });
    if (!leave) return reply(ctx, { embeds: [failure('No pending leave request found for that member.')] });
    await logAction(ctx.guild, ctx.user.id, target, `loa.${action}`, { requestId: leave.id, startDate: leave.startDate });
    await ctx.guild.members.fetch(target).then(m => m.send(`Your leave request starting ${leave.startDate} was ${action}d.`)).catch(() => {});
    return reply(ctx, { embeds: [success(`Leave ${action}d`, `<@${target}>’s request was ${action}d.`)] });
  }
  if (action === 'list') {
    if (!hasManage(ctx, config)) return reply(ctx, { embeds: [failure('Only managers can view the leave roster.')] });
    const leaves = await LeaveRequest.find({ guildId: ctx.guild.id, status: { $in: ['pending', 'approved'] } }).sort({ startDate: 1 }).limit(40).lean();
    return privateReply(ctx, { embeds: [embed('Leave roster', leaves.map(l => `<@${l.userId}> · **${l.status}** · from ${l.startDate}${l.reason ? `\n${l.reason}` : ''}`).join('\n\n') || 'No pending or approved leave.')] });
  }
  return reply(ctx, { embeds: [failure('Use `$loa start YYYY-MM-DD [reason]`, `$loa end`, `$loa approve @user`, `$loa reject @user`, or `$loa list`.')] });
}

async function handleOnboarding(ctx) {
  const config = await getConfig(ctx.guild.id);
  if (!hasManage(ctx, config)) return reply(ctx, { embeds: [failure('Onboarding checklist access is restricted to managers.')] });
  const action = sub(ctx); const args = ctx.args || [];
  const user = ctx.interaction ? ctx.interaction.options.getUser('user') : null;
  if (action === 'list') {
    const target = user?.id || ctx.user.id;
    const rows = await OnboardingItem.find({ guildId: ctx.guild.id, userId: target }).sort({ item: 1 }).lean();
    return privateReply(ctx, { embeds: [embed(`Onboarding // ${target}`, rows.map(r => `✅ ${r.item} — <@${r.completedBy}>`).join('\n') || 'No checklist items completed yet.')] });
  }
  const target = user?.id || memberId(args[1] || '');
  const item = ctx.interaction ? opt(ctx, 'item') : args.slice(2).join(' ');
  if (!/^\d{17,20}$/.test(target || '') || !item?.trim()) return reply(ctx, { embeds: [failure('Select a member and provide a checklist item.')] });
  if (action === 'check') {
    await OnboardingItem.updateOne({ guildId: ctx.guild.id, userId: target, item: item.trim() }, { $set: { completedBy: ctx.user.id } }, { upsert: true });
  } else if (action === 'uncheck') await OnboardingItem.deleteOne({ guildId: ctx.guild.id, userId: target, item: item.trim() });
  else return reply(ctx, { embeds: [failure('Use onboarding list, check, or uncheck.')] });
  await logAction(ctx.guild, ctx.user.id, target, `onboarding.${action}`, { item: item.trim() });
  return reply(ctx, { embeds: [success('Checklist updated', `${action === 'check' ? 'Completed' : 'Removed'} **${item.trim()}** for <@${target}>.`)] });
}

async function handleBulkRole(ctx) {
  const action = ctx.interaction ? opt(ctx, 'action') : ctx.args?.[0]?.toLowerCase();
  const role = ctx.interaction ? ctx.interaction.options.getRole('role') : ctx.guild.roles.cache.get(memberId(ctx.args?.[1] || ''));
  const raw = ctx.interaction ? opt(ctx, 'members') : ctx.args?.slice(2).join(' ');
  const ids = [...new Set((raw || '').match(/\d{17,20}/g) || [])].slice(0, 25);
  const config = await getConfig(ctx.guild.id);
  if (!hasManage(ctx, config) || !ctx.member.permissions.has(PermissionFlagsBits.ManageRoles)) return reply(ctx, { embeds: [failure('You need Manage Roles permission and server-manager access.')] });
  if (!role || !['add', 'remove'].includes(action) || !ids.length) return reply(ctx, { embeds: [failure('Use `$bulkrole add|remove @role @member...` (up to 25 members).')] });
  const bot = ctx.guild.members.me || await ctx.guild.members.fetchMe();
  if (!bot.permissions.has(PermissionFlagsBits.ManageRoles) || role.managed || role.position >= bot.roles.highest.position || role.position >= ctx.member.roles.highest.position || role.id === ctx.guild.id) return reply(ctx, { embeds: [failure('Role hierarchy or permissions prevent this bulk change.')] });
  const members = await Promise.all(ids.map(id => ctx.guild.members.fetch(id).catch(() => null)));
  const valid = members.filter(Boolean);
  if (!valid.length) return reply(ctx, { embeds: [failure('No valid server members were found.')] });
  const token = Math.random().toString(36).slice(2, 12);
  ctx.client.pending.set(token, { type: 'bulk-role', actorId: ctx.user.id, guildId: ctx.guild.id, roleId: role.id, action, memberIds: valid.map(m => m.id), expires: Date.now() + 60_000 });
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bulkrole:${token}`).setLabel(`Confirm ${action} role`).setStyle(ButtonStyle.Danger));
  const payload = { embeds: [warning('Confirm bulk role change', `${action === 'add' ? 'Add' : 'Remove'} <@&${role.id}> ${action === 'add' ? 'to' : 'from'} **${valid.length}** members?\n${valid.slice(0, 15).map(m => `<@${m.id}>`).join(', ')}${valid.length > 15 ? ', …' : ''}\nExpires in 60 seconds.`)], components: [row] };
  if (ctx.interaction) return ctx.interaction.reply({ ...payload, ephemeral: true });
  return ctx.message.reply(payload);
}

async function handleSetup(ctx) {
  const config = await getConfig(ctx.guild.id);
  const bot = ctx.guild.members.me || await ctx.guild.members.fetchMe();
  const missingRoles = config.staffRoleIds.filter(id => !ctx.guild.roles.cache.has(id));
  const missingChannels = [...config.messageChannels, ...config.voiceChannels].filter(id => !ctx.guild.channels.cache.has(id));
  const checks = [
    `${bot.permissions.has(PermissionFlagsBits.ManageRoles) ? '✅' : '❌'} Bot Manage Roles permission`,
    `${config.staffRoleIds.length ? '✅' : '❌'} Staff hierarchy (${config.staffRoleIds.length} roles)`,
    `${config.messageChannels.length || config.voiceChannels.length ? '✅' : '⚠️'} Activity channels configured`,
    `${config.auditChannelId ? '✅' : '⚠️'} Audit channel ${config.auditChannelId ? `<#${config.auditChannelId}>` : 'not set'}`,
    `${missingRoles.length ? '❌' : '✅'} Role references valid${missingRoles.length ? ` (${missingRoles.length} missing)` : ''}`,
    `${missingChannels.length ? '❌' : '✅'} Channel references valid${missingChannels.length ? ` (${missingChannels.length} missing)` : ''}`,
  ];
  return reply(ctx, { embeds: [embed('VOID setup checklist', `${checks.join('\n')}\n\nNext: configure `$staffrole add @role`, `$modstats channel add #channel`, `$modstats voicechannel add #channel`, then `$modstats audit #channel`.`)] });
}

async function handleConfig(ctx) {
  const config = await getConfig(ctx.guild.id);
  if (!hasManage(ctx, config)) return reply(ctx, { embeds: [failure('Configuration is restricted to server managers.')] });
  const action = sub(ctx);
  if (action === 'show' || !action) return reply(ctx, { embeds: [embed('VOID configuration', `Staff roles: ${config.staffRoleIds.map(id => `<@&${id}>`).join(', ') || 'none'}\nManager roles: ${config.managerRoleIds.map(id => `<@&${id}>`).join(', ') || 'none'}\nMessage channels: ${config.messageChannels.map(id => `<#${id}>`).join(', ') || 'none'}\nVoice channels: ${config.voiceChannels.map(id => `<#${id}>`).join(', ') || 'none'}\nDaily message/voice settings: ${config.messageRequirement}/${config.voiceRequirement}\nDefault timezone: ${config.defaultTimezone}\nAudit channel: ${config.auditChannelId ? `<#${config.auditChannelId}>` : 'not set'}\nRestricted stats: ${config.restrictStats ? 'yes' : 'no'}`)] });
  const confirmed = ctx.interaction ? opt(ctx, 'confirm') : ctx.args?.[1]?.toLowerCase() === 'confirm';
  if (action !== 'reset' || !confirmed) return reply(ctx, { embeds: [failure('Reset requires explicit confirmation: `/config reset confirm:true` or `$config reset confirm`.')] });
  config.staffRoleIds = []; config.managerRoleIds = []; config.messageChannels = []; config.voiceChannels = []; config.afkChannelId = null; config.messageRequirement = 0; config.voiceRequirement = 0; config.auditChannelId = null; config.restrictStats = false; config.defaultTimezone = 'UTC';
  await config.save();
  await logAction(ctx.guild, ctx.user.id, null, 'config.reset', { resetToDefaults: true });
  return reply(ctx, { embeds: [success('Configuration reset', 'Server settings restored to defaults. Historical activity, notes, and audit records were preserved.')] });
}

async function executeBulkRole(interaction) {
  const token = interaction.customId.split(':')[1];
  const pending = interaction.client.pending.get(token);
  if (!pending || pending.type !== 'bulk-role' || pending.expires < Date.now()) return interaction.reply({ embeds: [failure('This confirmation expired. Run the command again.')], ephemeral: true });
  if (pending.actorId !== interaction.user.id) return interaction.reply({ embeds: [failure('Only the requester can confirm this change.')], ephemeral: true });
  interaction.client.pending.delete(token);
  const role = interaction.guild.roles.cache.get(pending.roleId);
  if (!role || role.managed) return interaction.update({ embeds: [failure('The role is no longer available or is managed.')], components: [] });
  let changed = 0; let failed = 0;
  for (const id of pending.memberIds) {
    const member = await interaction.guild.members.fetch(id).catch(() => null);
    if (!member) { failed++; continue; }
    try {
      if (pending.action === 'add') await member.roles.add(role, `VOID bulk role update by ${interaction.user.tag}`);
      else await member.roles.remove(role, `VOID bulk role update by ${interaction.user.tag}`);
      changed++;
    } catch { failed++; }
  }
  await logAction(interaction.guild, interaction.user.id, null, `bulkrole.${pending.action}`, { roleId: role.id, affected: changed, failed });
  return interaction.update({ embeds: [success('Bulk role update complete', `Updated **${changed}** members; **${failed}** failed.`)], components: [] });
}

async function runScheduledTasks(client) {
  const now = new Date();
  const due = await Reminder.find({ dueAt: { $lte: now }, sentAt: null }).limit(50);
  for (const reminder of due) {
    reminder.sentAt = now;
    await reminder.save();
    const guild = client.guilds.cache.get(reminder.guildId);
    const user = await client.users.fetch(reminder.userId).catch(() => null);
    if (user) await user.send({ embeds: [embed('Your reminder', reminder.text)] }).catch(() => {});
    if (!guild) continue;
  }

  for (const guild of client.guilds.cache.values()) {
    const config = await getConfig(guild.id);
    const members = await guild.members.fetch().catch(() => null);
    if (!members) continue;
    for (const member of members.values()) {
      if (member.user.bot || !config.staffRoleIds.some(id => member.roles.cache.has(id))) continue;
      const zone = await getTimezone(guild.id, member.id, config);
      const local = DateTime.now().setZone(zone);
      if (local.hour !== 18 || local.minute > 2) continue;
      const date = local.toISODate();
      const pref = await StaffPreference.findOne({ guildId: guild.id, userId: member.id }).lean();
      if (pref?.activityReminders === false || pref?.lastActivityReminderDate === date) continue;
      const onLeave = await LeaveRequest.exists({ guildId: guild.id, userId: member.id, status: 'approved', startDate: { $lte: date }, $or: [{ endDate: null }, { endDate: { $gte: date } }] });
      if (onLeave) continue;
      const record = await DailyActivity.findOne({ guildId: guild.id, userId: member.id, localDate: date }).lean();
      const points = activityPoints(record?.messages || 0, record?.voiceMinutes || 0);
      const target = activityTarget(config);
      await StaffPreference.findOneAndUpdate({ guildId: guild.id, userId: member.id }, { $set: { lastActivityReminderDate: date }, $setOnInsert: { guildId: guild.id, userId: member.id } }, { upsert: true });
      if (points < target) await member.send({ embeds: [embed('Daily activity reminder', `Today: **${points}/${target} points**. You can turn these DMs off with  modstats reminders off .`)] }).catch(() => {});
    }

    const monday = DateTime.utc().startOf('day').weekday === 1;
    const weekKey = DateTime.utc().startOf('day').toISODate();
    if (monday && config.auditChannelId) {
      const state = await FeatureState.findOne({ guildId: guild.id }).lean();
      if (state?.lastWeeklyReport !== weekKey) {
        const channel = await guild.channels.fetch(config.auditChannelId).catch(() => null);
        if (channel?.isTextBased()) {
          const { rows } = await activityRows({ guild }, 7);
          rows.sort((a, b) => b.points - a.points);
          await channel.send({ embeds: [embed('Weekly staff activity report', rows.slice(0, 15).map((r, i) => `**${i + 1}.** ${r.member.displayName} — ${r.points} pts (${r.messages} messages, ${r.voice} voice min)`).join('\n') || 'No activity recorded this week.')] }).catch(() => {});
          await FeatureState.findOneAndUpdate({ guildId: guild.id }, { $set: { lastWeeklyReport: weekKey } }, { upsert: true });
        }
      }
    }
  }
}

async function handleFeature(ctx, name) {
  if (name === 'modstats' || name === 'staffactivity') return handleActivity(ctx, name);
  if (name === 'staffroster') return handleRoster(ctx);
  if (name === 'staffnote') return handleStaffNote(ctx);
  if (name === 'remindme') return handleReminder(ctx);
  if (name === 'roleinfo') return handleRoleInfo(ctx);
  if (name === 'audit') return handleAudit(ctx);
  if (name === 'loa') return handleLoa(ctx);
  if (name === 'onboarding') return handleOnboarding(ctx);
  if (name === 'bulkrole') return handleBulkRole(ctx);
  if (name === 'setup') return handleSetup(ctx);
  if (name === 'config') return handleConfig(ctx);
  return false;
}

module.exports = { handleFeature, executeBulkRole, runScheduledTasks };
