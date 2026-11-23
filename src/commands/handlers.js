const { DailyActivity, GuildConfig, UserTimezone } = require('../models');
const { getConfig, logAction } = require('../utils/config');
const { getTimezone, localDate, validTimezone } = require('../utils/time');
const { success, warning, failure, embed, progress } = require('../utils/embeds');
const { DateTime } = require('luxon');
const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function option(ctx, name) { return ctx.interaction?.options.get(name)?.value; }
function subcommand(ctx) { return ctx.interaction ? ctx.interaction.options.getSubcommand() : ctx.args.shift()?.toLowerCase(); }
function memberHasRole(member, ids) { return Boolean(member?.roles?.cache && ids.some(id => member.roles.cache.has(id))); }
function admin(ctx) { return Boolean(ctx.member?.permissions?.has(PermissionFlagsBits.Administrator) || ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)); }
function canManage(ctx, config) { return admin(ctx) || memberHasRole(ctx.member, config.managerRoleIds); }
async function reply(ctx, payload) {
  if (ctx.interaction) {
    if (ctx.interaction.deferred || ctx.interaction.replied) return ctx.interaction.editReply(payload);
    return ctx.interaction.reply({ ...payload, ephemeral: true });
  }
  return ctx.message.reply(payload);
}
function target(ctx, arg) {
  if (ctx.interaction) return ctx.interaction.options.getUser('user') || ctx.interaction.options.getUser('target');
  const id = (arg || ctx.args?.[0] || '').replace(/[<@!>]/g, '');
  return /^\d{17,20}$/.test(id) ? { id, username: id } : null;
}
async function getTargetMember(ctx, user) {
  if (ctx.guild.members.cache.has(user.id)) return ctx.guild.members.cache.get(user.id);
  return ctx.guild.members.fetch(user.id).catch(() => null);
}
async function getStats(guildId, userId, timezone) {
  const today = localDate(new Date(), timezone);
  const start = DateTime.fromISO(today, { zone: timezone }).minus({ days: 13 }).toISODate();
  const docs = await DailyActivity.find({ guildId, userId, localDate: { $gte: start, $lte: today } }).lean();
  const byDate = new Map(docs.map(d => [d.localDate, d]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const date = DateTime.fromISO(today, { zone: timezone }).minus({ days: i }).toISODate();
    const doc = byDate.get(date);
    days.push({ date, messages: doc?.messages || 0, voiceMinutes: doc?.voiceMinutes || 0 });
  }
  return { today, days, messages14: days.reduce((n, d) => n + d.messages, 0), voice14: days.reduce((n, d) => n + d.voiceMinutes, 0) };
}
async function showStats(ctx, user, history = false) {
  const config = await getConfig(ctx.guild.id);
  const staff = await getTargetMember(ctx, user);
  if (!staff) return reply(ctx, { embeds: [failure('That member could not be found in this server.')] });
  if (config.restrictStats && user.id !== ctx.user.id && !admin(ctx) && !memberHasRole(ctx.member, config.managerRoleIds)) return reply(ctx, { embeds: [failure('This server restricts staff activity views to authorized managers.')] });
  if (!memberHasRole(staff, config.staffRoleIds) && !admin(ctx)) return reply(ctx, { embeds: [failure('Statistics are available for configured staff members only.')] });
  const timezone = await getTimezone(ctx.guild.id, user.id, config);
  const stats = await getStats(ctx.guild.id, user.id, timezone);
  const today = stats.days.at(-1);
  const dailyOk = today.messages >= config.messageRequirement && today.voiceMinutes >= config.voiceRequirement;
  const lines = history ? stats.days.map(d => `\n**${d.date}** · ${d.messages} messages · ${d.voiceMinutes} min · ${d.messages >= config.messageRequirement && d.voiceMinutes >= config.voiceRequirement ? 'Complete' : 'Incomplete'}`).join('') : '';
  const completed = stats.days.filter(d => d.messages >= config.messageRequirement && d.voiceMinutes >= config.voiceRequirement).length;
  const card = embed(history ? `14-Day Record // ${staff.displayName}` : `Activity // ${staff.displayName}`, history ? `Timezone: **${timezone}**${lines}\n\n**14-day totals**\nMessages: ${stats.messages14} · Voice: ${stats.voice14} min\nDaily averages: ${(stats.messages14 / 14).toFixed(1)} messages · ${(stats.voice14 / 14).toFixed(1)} min\nDays completed: ${completed} · Missed: ${14 - completed}` : `Local day: **${stats.today}** · ${timezone}\n\n**Messages**\n${progress(today.messages, config.messageRequirement)}\n\n**Voice activity**\n${progress(today.voiceMinutes, config.voiceRequirement)} min\n\n**Requirement status:** ${dailyOk ? 'Complete' : 'In progress'}\n\n14-day totals: **${stats.messages14} messages** · **${stats.voice14} voice minutes**`);
  card.addFields({ name: 'Daily requirements', value: `${config.messageRequirement} messages · ${config.voiceRequirement} voice minutes`, inline: true });
  return reply(ctx, { embeds: [card] });
}
async function resetCounters(guild, config, userId = null) {
  const now = new Date();
  if (userId) {
    const zone = await getTimezone(guild.id, userId, config);
    const date = localDate(now, zone);
    await DailyActivity.findOneAndUpdate({ guildId: guild.id, userId, localDate: date }, { $set: { messages: 0, voiceMinutes: 0, resetAt: now }, $setOnInsert: { guildId: guild.id, userId, localDate: date, timezone: zone } }, { upsert: true });
    return 1;
  }
  const members = await guild.members.fetch();
  let count = 0;
  for (const [, member] of members) {
    if (member.user.bot || !memberHasRole(member, config.staffRoleIds)) continue;
    const zone = await getTimezone(guild.id, member.id, config);
    const date = localDate(now, zone);
    await DailyActivity.findOneAndUpdate({ guildId: guild.id, userId: member.id, localDate: date }, { $set: { messages: 0, voiceMinutes: 0, resetAt: now }, $setOnInsert: { guildId: guild.id, userId: member.id, localDate: date, timezone: zone } }, { upsert: true });
    count++;
  }
  return count;
}
async function handleModstats(ctx) {
  const config = await getConfig(ctx.guild.id);
  const op = subcommand(ctx);
  if (['view', 'history'].includes(op)) {
    const user = target(ctx);
    return showStats(ctx, user || ctx.user, op === 'history');
  }
  if (op === 'leaderboard') {
    const members = await ctx.guild.members.fetch();
    const eligible = members.filter(m => !m.user.bot && memberHasRole(m, config.staffRoleIds));
    const rows = [];
    for (const [, m] of eligible) {
      const zone = await getTimezone(ctx.guild.id, m.id, config);
      const date = localDate(new Date(), zone);
      const s = await DailyActivity.findOne({ guildId: ctx.guild.id, userId: m.id, localDate: date }).lean();
      rows.push({ name: m.displayName, messages: s?.messages || 0, voice: s?.voiceMinutes || 0 });
    }
    rows.sort((a, b) => b.messages - a.messages || b.voice - a.voice);
    return reply(ctx, { embeds: [embed('Staff activity // today', rows.slice(0, 15).map((r, i) => `**${String(i + 1).padStart(2, '0')}** ${r.name} — ${r.messages} messages · ${r.voice} min`).join('\n') || 'No configured staff activity yet.')] });
  }
  if (op === 'setup') return reply(ctx, { embeds: [embed('System setup // status', `Staff ranks: ${config.staffRoleIds.length}\nMessage channels: ${config.messageChannels.length}\nVoice channels: ${config.voiceChannels.length}\nAFK channel: ${config.afkChannelId ? `<#${config.afkChannelId}>` : 'not set'}\nDaily targets: ${config.messageRequirement} messages · ${config.voiceRequirement} voice minutes\nDefault timezone: ${config.defaultTimezone}\nAudit log: ${config.auditChannelId ? `<#${config.auditChannelId}>` : 'not set'}\n\nConfigure with $staffrole and $modstats commands.`)] });
  if (!canManage(ctx, config)) return reply(ctx, { embeds: [failure('You need Manage Server permission or a configured staff-manager role.')] });
  if (op === 'channel' || op === 'voicechannel') {
    const action = ctx.interaction ? option(ctx, 'action') : (ctx.args.shift() || '').toLowerCase();
    const raw = ctx.interaction ? ctx.interaction.options.getChannel('channel')?.id : ctx.args.shift();
    if (action === 'list') return reply(ctx, { embeds: [embed(`${op} // configuration`, (op === 'channel' ? config.messageChannels : config.voiceChannels).map(id => `<#${id}>`).join('\n') || 'No channels configured.')] });
    const id = (raw || '').replace(/[<#>]/g, '');
    if (!id || !['add', 'remove'].includes(action)) return reply(ctx, { embeds: [failure(`Usage: $modstats ${op} add/remove #channel or list`)] });
    const field = op === 'channel' ? 'messageChannels' : 'voiceChannels';
    config[field] = action === 'add' ? [...new Set([...config[field], id])] : config[field].filter(x => x !== id);
    await config.save(); await logAction(ctx.guild, ctx.user.id, null, `modstats.${op}.${action}`, { channelId: id });
    return reply(ctx, { embeds: [success('Configuration updated', `${action === 'add' ? 'Added' : 'Removed'} <#${id}> ${action === 'add' ? 'to' : 'from'} ${op} tracking.`)] });
  }
  if (op === 'afk') {
    const arg = ctx.interaction ? null : (ctx.args[0]?.toLowerCase() === 'set' ? ctx.args[1] : ctx.args[0]);
    const disable = ctx.interaction ? option(ctx, 'disable') : ctx.args[0]?.toLowerCase() === 'disable';
    const channel = ctx.interaction ? ctx.interaction.options.getChannel('channel') : null;
    const id = disable ? null : (channel?.id || (arg || '').replace(/[<#>]/g, ''));
    if (!id && !disable) return reply(ctx, { embeds: [failure('Provide a voice channel or use `$modstats afk disable`.')] });
    config.afkChannelId = id; await config.save(); await logAction(ctx.guild, ctx.user.id, null, 'modstats.afk', { channelId: id });
    return reply(ctx, { embeds: [success('AFK exclusion updated', id ? `<#${id}> will not accrue voice time.` : 'AFK exclusion disabled.')] });
  }
  if (op === 'requirement') {
    const type = ctx.interaction ? option(ctx, 'type') : ctx.args.shift();
    const amount = Number(ctx.interaction ? option(ctx, 'amount') : ctx.args.shift());
    if (!['messages', 'voice'].includes(type) || !Number.isInteger(amount) || amount < 0) return reply(ctx, { embeds: [failure('Use `requirement messages <count>` or `requirement voice <minutes>` with a non-negative integer.')] });
    config[type === 'messages' ? 'messageRequirement' : 'voiceRequirement'] = amount; await config.save();
    await logAction(ctx.guild, ctx.user.id, null, 'modstats.requirement', { type, amount });
    return reply(ctx, { embeds: [success('Daily target updated', `${type === 'voice' ? 'Voice' : 'Message'} requirement set to **${amount}**${type === 'voice' ? ' minutes' : ' messages'}.`)] });
  }
  if (op === 'defaulttimezone') {
    const zone = ctx.interaction ? option(ctx, 'timezone') : ctx.args[0];
    if (!validTimezone(zone)) return reply(ctx, { embeds: [failure('Provide a valid IANA timezone, e.g. `Europe/London`.')] });
    config.defaultTimezone = zone; await config.save(); await logAction(ctx.guild, ctx.user.id, null, 'modstats.defaultTimezone', { timezone: zone });
    return reply(ctx, { embeds: [success('Default timezone updated', `New unset preferences use **${zone}**. Existing activity remains unchanged.`)] });
  }
  if (op === 'audit') {
    const channel = ctx.interaction ? ctx.interaction.options.getChannel('channel') : ctx.args[0]?.replace(/[<#>]/g, '');
    if (!channel) return reply(ctx, { embeds: [failure('Provide a text channel.')] });
    config.auditChannelId = channel.id || channel; await config.save();
    await logAction(ctx.guild, ctx.user.id, null, 'modstats.audit', { channelId: config.auditChannelId });
    return reply(ctx, { embeds: [success('Audit destination updated', `Administrative actions will be recorded in <#${config.auditChannelId}>.`)] });
  }
  if (op === 'permissions') {
    const action = ctx.interaction ? option(ctx, 'action') : ctx.args.shift();
    const role = ctx.interaction ? ctx.interaction.options.getRole('role')?.id : ctx.args.shift()?.replace(/[<@&>]/g, '');
    if (!role || !['add', 'remove'].includes(action)) return reply(ctx, { embeds: [failure('Use `permissions add @role` or `permissions remove @role`.')] });
    config.managerRoleIds = action === 'add' ? [...new Set([...config.managerRoleIds, role])] : config.managerRoleIds.filter(id => id !== role);
    await config.save(); await logAction(ctx.guild, ctx.user.id, null, 'modstats.managerRole', { action, roleId: role });
    return reply(ctx, { embeds: [success('Manager access updated', `${action === 'add' ? 'Added' : 'Removed'} <@&${role}>.`)] });
  }
  if (op === 'restrict') {
    config.restrictStats = ctx.interaction ? option(ctx, 'enabled') : ctx.args[0] === 'on'; await config.save();
    await logAction(ctx.guild, ctx.user.id, null, 'modstats.restrict', { enabled: config.restrictStats });
    return reply(ctx, { embeds: [success('Visibility policy updated', `Restricted staff statistics ${config.restrictStats ? 'enabled' : 'disabled'}.`)] });
  }
  if (op === 'reset') {
    if (!canManage(ctx, config)) return reply(ctx, { embeds: [failure('You are not authorized to reset staff activity.')] });
    const all = ctx.interaction ? option(ctx, 'all') : ctx.args[0]?.toLowerCase() === 'all';
    const user = all ? null : target(ctx, ctx.args[0]);
    if (!all && !user) return reply(ctx, { embeds: [failure('Specify a member or `all`.')] });
    if (all) {
      const token = Math.random().toString(36).slice(2, 12);
      ctx.client.pending.set(token, { type: 'bulk-reset', guildId: ctx.guild.id, actorId: ctx.user.id, expires: Date.now() + 60_000 });
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`resetconfirm:${token}`).setLabel('Confirm bulk reset').setStyle(ButtonStyle.Danger));
      const payload = { embeds: [warning('Confirm bulk reset', 'Reset today’s counters for every configured staff member? Historical records are retained. This confirmation expires in 60 seconds.')], components: [row] };
      if (ctx.interaction) return ctx.interaction.reply({ ...payload, ephemeral: true });
      return ctx.message.reply(payload);
    }
    await resetCounters(ctx.guild, config, user.id);
    await logAction(ctx.guild, ctx.user.id, user.id, 'modstats.reset', { all: false });
    return reply(ctx, { embeds: [success('Current-day counters reset', 'Historical daily records were retained.')] });
  }
  return reply(ctx, { embeds: [failure('Unknown ModStats option. Use `$help` for available commands.')] });
}
async function executeResetConfirmation(interaction) {
  const token = interaction.customId.split(':')[1];
  const pending = interaction.client.pending.get(token);
  if (!pending || pending.type !== 'bulk-reset' || pending.expires < Date.now()) return interaction.reply({ embeds: [failure('This confirmation expired. Run the command again.')], ephemeral: true });
  if (pending.actorId !== interaction.user.id) return interaction.reply({ embeds: [failure('Only the command requester can confirm this reset.')], ephemeral: true });
  interaction.client.pending.delete(token);
  try {
    const config = await getConfig(interaction.guild.id);
    const count = await resetCounters(interaction.guild, config);
    await logAction(interaction.guild, interaction.user.id, null, 'modstats.reset', { all: true, affectedStaff: count });
    return interaction.update({ embeds: [success('Bulk reset complete', `Reset current-day activity for **${count}** configured staff members. Historical records were retained.`)], components: [] });
  } catch (error) {
    console.error('[bulk-reset] Failed:', error.message);
    return interaction.update({ embeds: [failure('The bulk reset could not be completed. No credentials were exposed; check database and bot permissions.')], components: [] });
  }
}
async function handleTimezone(ctx) {
  const config = await getConfig(ctx.guild.id);
  let action; let zone; let other;
  if (ctx.interaction) {
    zone = option(ctx, 'timezone');
    if (zone) action = 'set';
    else if (option(ctx, 'reset')) action = 'reset';
    else if (option(ctx, 'list')) action = 'list';
    else { action = 'show'; other = ctx.interaction.options.getUser('user'); }
  } else {
    const input = require('./parsing').parseTimezoneInput(ctx.args);
    action = input.action; zone = input.timezone;
    if (input.userId) other = await ctx.guild.members.fetch(input.userId).then(m => m.user).catch(() => ({ id: input.userId, username: input.userId }));
  }
  if (action === 'list') return reply(ctx, { embeds: [embed('Timezone directory', '`UTC` · `Asia/Dhaka` · `Asia/Tokyo` · `Europe/London` · `Europe/Paris` · `America/New_York` · `America/Chicago` · `America/Denver` · `America/Los_Angeles` · `Australia/Sydney`\n\nAny valid IANA timezone identifier is accepted.')] });
  if (action === 'set') {
    if (!validTimezone(zone)) return reply(ctx, { embeds: [failure('Invalid timezone. Use an IANA identifier such as `Asia/Dhaka` or `America/New_York`.')] });
    await UserTimezone.findOneAndUpdate({ guildId: ctx.guild.id, userId: ctx.user.id }, { $set: { timezone: zone }, $setOnInsert: { guildId: ctx.guild.id, userId: ctx.user.id } }, { upsert: true });
    await logAction(ctx.guild, ctx.user.id, ctx.user.id, 'timezone.set', { timezone: zone });
    return reply(ctx, { embeds: [success('Timezone preference saved', `Your timezone is now **${zone}**. Existing activity records are preserved; future activity uses your new local day.`)] });
  }
  if (action === 'reset') {
    await UserTimezone.deleteOne({ guildId: ctx.guild.id, userId: ctx.user.id });
    await logAction(ctx.guild, ctx.user.id, ctx.user.id, 'timezone.reset', { timezone: config.defaultTimezone });
    return reply(ctx, { embeds: [success('Timezone reset', `Your server default is **${config.defaultTimezone}**.`)] });
  }
  const who = other || ctx.user;
  const currentZone = await getTimezone(ctx.guild.id, who.id, config);
  const now = DateTime.utc().setZone(currentZone).toFormat('cccc, LLLL d · h:mm:ss a ZZZZ');
  return reply(ctx, { embeds: [embed(`Timezone // ${who.username}`, `**Zone:** ${currentZone}\n**Local time:** ${now}`)] });
}
async function handleStaffRole(ctx) {
  const config = await getConfig(ctx.guild.id);
  if (!canManage(ctx, config)) return reply(ctx, { embeds: [failure('You need Manage Server permission or a configured staff-manager role.')] });
  const op = subcommand(ctx);
  const getRole = () => ctx.interaction ? ctx.interaction.options.getRole('role')?.id : ctx.args.shift()?.replace(/[<@&>]/g, '');
  if (op === 'list' || op === 'config') return reply(ctx, { embeds: [embed('Promotion hierarchy // lowest to highest', config.staffRoleIds.map((id, i) => `**${i + 1}.** <@&${id}>`).join('\n') || 'No staff roles configured. Add roles using `$staffrole add @role`.')] });
  let ids = [...config.staffRoleIds];
  if (op === 'add' || op === 'remove') {
    const id = getRole(); if (!id) return reply(ctx, { embeds: [failure('Provide a server role.')] });
    if (op === 'add') ids = [...new Set([...ids, id])]; else ids = ids.filter(x => x !== id);
  } else if (op === 'setorder') {
    const raw = ctx.interaction ? option(ctx, 'roles') : ctx.args.join(' ');
    ids = raw.match(/\d{17,20}/g) || [];
    if (ids.length < 1 || new Set(ids).size !== ids.length) return reply(ctx, { embeds: [failure('Provide unique role mentions or IDs ordered from lowest to highest.')] });
    const invalid = ids.filter(id => !ctx.guild.roles.cache.has(id));
    if (invalid.length) return reply(ctx, { embeds: [failure(`Unknown role ID(s): ${invalid.join(', ')}`)] });
  } else return reply(ctx, { embeds: [failure('Use add, remove, list, setorder, or config.')] });
  config.staffRoleIds = ids; await config.save(); await logAction(ctx.guild, ctx.user.id, null, `staffrole.${op}`, { roles: ids });
  return reply(ctx, { embeds: [success('Hierarchy saved', ids.map((id, i) => `${i + 1}. <@&${id}>`).join('\n') || 'No staff ranks configured.')] });
}
async function staffAction(ctx, action) {
  const config = await getConfig(ctx.guild.id);
  const memberId = ctx.interaction ? ctx.interaction.options.getUser('user')?.id : ctx.args[0]?.replace(/[<@!>]/g, '');
  if (!memberId) return reply(ctx, { embeds: [failure(`Usage: $${action} @member`)] });
  if (memberId === ctx.user.id && !admin(ctx)) return reply(ctx, { embeds: [failure('Self role changes are not permitted.')] });
  if (!canManage(ctx, config)) return reply(ctx, { embeds: [failure('You need Manage Server permission or a configured staff-manager role.')] });
  const targetMember = await ctx.guild.members.fetch(memberId).catch(() => null);
  if (!targetMember || targetMember.user.bot) return reply(ctx, { embeds: [failure('Select a valid non-bot server member.')] });
  const botMember = ctx.guild.members.me || await ctx.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return reply(ctx, { embeds: [failure('I need the Manage Roles permission to change staff roles.')] });
  const current = config.staffRoleIds.find(id => targetMember.roles.cache.has(id));
  if (action !== 'strip' && !config.staffRoleIds.length) return reply(ctx, { embeds: [failure('No staff hierarchy is configured. Use `$staffrole add @role` first.')] });
  let remove = []; let add = []; let description = '';
  if (action === 'strip') {
    remove = config.staffRoleIds.filter(id => targetMember.roles.cache.has(id));
    if (!remove.length) return reply(ctx, { embeds: [warning('No staff ranks found', 'The target has no configured staff roles.')] });
    description = `Remove ${remove.map(id => `<@&${id}>`).join(', ')} from **${targetMember.displayName}**? Confirm with the button below.`;
  } else {
    const index = current ? config.staffRoleIds.indexOf(current) : (action === 'promote' ? -1 : 0);
    const nextIndex = index + (action === 'promote' ? 1 : -1);
    if (action === 'promote' && nextIndex >= config.staffRoleIds.length) return reply(ctx, { embeds: [failure('This member is already at the highest configured rank.')] });
    if (action === 'demote' && (!current || nextIndex < 0)) return reply(ctx, { embeds: [failure('This member has no lower configured rank.')] });
    const next = config.staffRoleIds[nextIndex];
    remove = current ? [current] : []; add = [next];
    description = `Change **${targetMember.displayName}** from ${current ? `<@&${current}>` : 'no configured rank'} to <@&${next}>?`;
  }
  const unmanageable = [...remove, ...add].map(id => ctx.guild.roles.cache.get(id)).filter(role => !role || role.managed || role.position >= botMember.roles.highest.position || (role.position >= ctx.member.roles.highest.position && !admin(ctx)));
  if (unmanageable.length) return reply(ctx, { embeds: [failure('Role hierarchy prevents this change. Move my highest role above every configured staff role, and ensure your role is above the target roles.')] });
  const token = Math.random().toString(36).slice(2, 9);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`staffconfirm:${token}`).setLabel(action === 'strip' ? 'Confirm strip' : `Confirm ${action}`).setStyle(ButtonStyle.Danger));
  ctx.client.pending.set(token, { guildId: ctx.guild.id, actorId: ctx.user.id, targetId: memberId, action, remove, add, expires: Date.now() + 60_000 });
  const response = { embeds: [warning(`Confirm // ${action}`, description)], components: [row] };
  if (ctx.interaction) return ctx.interaction.reply({ ...response, ephemeral: true });
  return ctx.message.reply(response);
}
async function executeStaffConfirmation(interaction) {
  const token = interaction.customId.split(':')[1]; const pending = interaction.client.pending.get(token);
  if (!pending || pending.expires < Date.now()) return interaction.reply({ embeds: [failure('This confirmation expired. Run the command again.')], ephemeral: true });
  if (pending.actorId !== interaction.user.id) return interaction.reply({ embeds: [failure('Only the command requester can confirm this action.')], ephemeral: true });
  interaction.client.pending.delete(token);
  const guild = interaction.guild; const member = await guild.members.fetch(pending.targetId).catch(() => null);
  if (!member) return interaction.update({ embeds: [failure('Target member is no longer available.')], components: [] });
  try {
    if (pending.remove.length) await member.roles.remove(pending.remove, `VOID staff action by ${interaction.user.tag}`);
    if (pending.add.length) await member.roles.add(pending.add, `VOID staff action by ${interaction.user.tag}`);
    await logAction(guild, interaction.user.id, member.id, `staff.${pending.action}`, { removed: pending.remove, added: pending.add });
    return interaction.update({ embeds: [success(`${pending.action} completed`, `Updated **${member.displayName}**.\nRemoved: ${pending.remove.map(id => `<@&${id}>`).join(', ') || 'none'}\nAdded: ${pending.add.map(id => `<@&${id}>`).join(', ') || 'none'}`)], components: [] });
  } catch (error) {
    console.error('[staff-role] Discord role update failed:', error.message);
    return interaction.update({ embeds: [failure('Discord rejected the role change. Check bot permissions and role hierarchy.')], components: [] });
  }
}
async function handleHelp(ctx) {
  return reply(ctx, { embeds: [embed('VOID // command directory', '**STAFF ACTIVITY**\n`$modstats view [@user]` · `$modstats history [@user]` · `$modstats leaderboard`\n`$modstats setup` · `$modstats reset @user|all`\n\n**CONFIGURATION**\n`$modstats channel add/remove/list #channel` · `$modstats voicechannel add/remove/list #channel`\n`$modstats requirement messages|voice <amount>` · `$modstats afk set #channel|disable`\n`$modstats defaulttimezone <IANA>` · `$modstats audit #channel` · `$modstats permissions add/remove @role`\n\n**TIMEZONES**\n`$tz` · `$tz Asia/Dhaka` · `$tz @user` · `$tz list` · `$tz reset`\n\n**STAFF ROLES**\n`$staffrole add/remove/list/setorder/config` · `$promote @user` · `$demote @user` · `$strip @user`\n\nEquivalent slash commands are available.')] });
}
module.exports = { handleModstats, handleTimezone, handleStaffRole, staffAction, executeStaffConfirmation, executeResetConfirmation, handleHelp, reply, subcommand, target };
