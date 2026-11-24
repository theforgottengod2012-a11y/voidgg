const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const featureSlash = [
  new SlashCommandBuilder().setName('staffactivity').setDescription('Weekly staff activity and CSV exports.')
    .addSubcommand(s => s.setName('week').setDescription('Show the last seven days of staff activity'))
    .addSubcommand(s => s.setName('export').setDescription('Export activity as CSV').addUserOption(o => o.setName('user').setDescription('Staff member (defaults to you)'))),
  new SlashCommandBuilder().setName('staffroster').setDescription('Show configured staff ranks and activity status.')
    .addRoleOption(o => o.setName('role').setDescription('Filter by a staff rank')),
  new SlashCommandBuilder().setName('staffnote').setDescription('Private manager-only staff notes.')
    .addSubcommand(s => s.setName('add').setDescription('Add a confidential note').addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption(o => o.setName('text').setDescription('Note (private to managers)').setMaxLength(1500).setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('Privately view notes').addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a note by its ID').addStringOption(o => o.setName('id').setDescription('Note ID').setRequired(true))),
  new SlashCommandBuilder().setName('remindme').setDescription('Schedule a personal reminder using a duration, e.g. 2h30m.')
    .addStringOption(o => o.setName('time').setDescription('Duration such as 20m, 2h, or 1d').setRequired(true).setMaxLength(40))
    .addStringOption(o => o.setName('message').setDescription('Reminder text').setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder().setName('roleinfo').setDescription('Inspect a server role.')
    .addRoleOption(o => o.setName('role').setDescription('Role to inspect').setRequired(true)),
  new SlashCommandBuilder().setName('audit').setDescription('Search recent bot-recorded administrative actions.')
    .addUserOption(o => o.setName('user').setDescription('Filter by target user')),
  new SlashCommandBuilder().setName('loa').setDescription('Request or manage staff leave of absence.')
    .addSubcommand(s => s.setName('start').setDescription('Request leave (YYYY-MM-DD)').addStringOption(o => o.setName('date').setDescription('Start date').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason (private to managers)').setMaxLength(500)))
    .addSubcommand(s => s.setName('end').setDescription('End your approved leave'))
    .addSubcommand(s => s.setName('approve').setDescription('Approve a pending leave request').addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true)))
    .addSubcommand(s => s.setName('reject').setDescription('Reject a pending leave request').addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('Privately list pending and approved leave')),
  new SlashCommandBuilder().setName('onboarding').setDescription('Track staff onboarding checklist items.')
    .addSubcommand(s => s.setName('list').setDescription('List checklist items').addUserOption(o => o.setName('user').setDescription('Staff member')))
    .addSubcommand(s => s.setName('check').setDescription('Mark an item complete').addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption(o => o.setName('item').setDescription('Checklist item').setMaxLength(80).setRequired(true)))
    .addSubcommand(s => s.setName('uncheck').setDescription('Remove a completed item').addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption(o => o.setName('item').setDescription('Checklist item').setMaxLength(80).setRequired(true))),
  new SlashCommandBuilder().setName('bulkrole').setDescription('Preview and confirm a bulk role change.')
    .addStringOption(o => o.setName('action').setDescription('Add or remove role').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }))
    .addRoleOption(o => o.setName('role').setDescription('Role to change').setRequired(true))
    .addStringOption(o => o.setName('members').setDescription('Member mentions or IDs separated by spaces').setRequired(true).setMaxLength(1800)),
  new SlashCommandBuilder().setName('setup').setDescription('Show the VOID setup checklist.'),
  new SlashCommandBuilder().setName('config').setDescription('Review or reset VOID server configuration.')
    .addSubcommand(s => s.setName('show').setDescription('Show current bot configuration'))
    .addSubcommand(s => s.setName('reset').setDescription('Reset bot configuration to defaults; requires confirmation').addBooleanOption(o => o.setName('confirm').setDescription('Confirm resetting configuration').setRequired(true))),
].map(command => command.toJSON());

module.exports = { featureSlash };
