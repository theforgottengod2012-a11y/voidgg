const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const slash = [
  new SlashCommandBuilder().setName('help').setDescription('Open the command directory.'),
  new SlashCommandBuilder().setName('tz').setDescription('View or set your IANA timezone.')
    .addStringOption(o => o.setName('timezone').setDescription('IANA zone, e.g. Asia/Dhaka').setMaxLength(80))
    .addUserOption(o => o.setName('user').setDescription('User whose timezone to inspect'))
    .addBooleanOption(o => o.setName('reset').setDescription('Reset to the server default timezone'))
    .addBooleanOption(o => o.setName('list').setDescription('Show popular timezone identifiers')),
  new SlashCommandBuilder().setName('modstats').setDescription('Staff activity and system configuration.')
    .addSubcommand(s => s.setName('view').setDescription('View activity statistics').addUserOption(o => o.setName('user').setDescription('Staff member')))
    .addSubcommand(s => s.setName('history').setDescription('View 14-day history').addUserOption(o => o.setName('user').setDescription('Staff member')))
    .addSubcommand(s => s.setName('leaderboard').setDescription('View today’s staff activity'))
    .addSubcommand(s => s.setName('setup').setDescription('Show setup status and guidance'))
    .addSubcommand(s => s.setName('channel').setDescription('Configure counted text channels').addStringOption(o => o.setName('action').setDescription('add, remove, or list').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' })).addChannelOption(o => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('voicechannel').setDescription('Configure counted voice channels').addStringOption(o => o.setName('action').setDescription('add, remove, or list').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' })).addChannelOption(o => o.setName('channel').setDescription('Voice channel').addChannelTypes(ChannelType.GuildVoice)))
    .addSubcommand(s => s.setName('afk').setDescription('Set or disable the AFK voice channel').addChannelOption(o => o.setName('channel').setDescription('AFK voice channel').addChannelTypes(ChannelType.GuildVoice)).addBooleanOption(o => o.setName('disable').setDescription('Disable AFK exclusion')))
    .addSubcommand(s => s.setName('requirement').setDescription('Set daily requirements').addStringOption(o => o.setName('type').setDescription('messages or voice').setRequired(true).addChoices({ name: 'messages', value: 'messages' }, { name: 'voice', value: 'voice' })).addIntegerOption(o => o.setName('amount').setDescription('Daily target (voice is minutes)').setRequired(true).setMinValue(0)))
    .addSubcommand(s => s.setName('reset').setDescription('Reset current-day activity counters').addUserOption(o => o.setName('user').setDescription('Staff member')).addBooleanOption(o => o.setName('all').setDescription('Reset all configured staff')))
    .addSubcommand(s => s.setName('defaulttimezone').setDescription('Set server default timezone').addStringOption(o => o.setName('timezone').setDescription('IANA timezone').setRequired(true)))
    .addSubcommand(s => s.setName('audit').setDescription('Set audit log channel').addChannelOption(o => o.setName('channel').setDescription('Log destination').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('permissions').setDescription('Add or remove staff manager roles').addStringOption(o => o.setName('action').setDescription('add/remove').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' })).addRoleOption(o => o.setName('role').setDescription('Manager role').setRequired(true)))
    .addSubcommand(s => s.setName('restrict').setDescription('Toggle staff-only statistics visibility').addBooleanOption(o => o.setName('enabled').setDescription('Enable restriction').setRequired(true))),
  new SlashCommandBuilder().setName('staffrole').setDescription('Configure the explicit promotion hierarchy.')
    .addSubcommand(s => s.setName('add').setDescription('Add a role to the bottom of the hierarchy').addRoleOption(o => o.setName('role').setDescription('Staff role').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a role from the hierarchy').addRoleOption(o => o.setName('role').setDescription('Staff role').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('Show configured hierarchy'))
    .addSubcommand(s => s.setName('setorder').setDescription('Set rank order, lowest to highest').addStringOption(o => o.setName('roles').setDescription('Role IDs or mentions separated by spaces').setRequired(true)))
    .addSubcommand(s => s.setName('config').setDescription('Show role-management configuration')),
  ...['promote', 'demote', 'strip'].map(name => new SlashCommandBuilder().setName(name).setDescription(`${name[0].toUpperCase()}${name.slice(1)} a staff member.`).addUserOption(o => o.setName('user').setDescription('Target member').setRequired(true))),
].map(c => c.toJSON());
module.exports = { slash };
