const { PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('../utils/config');
const { embed, failure } = require('../utils/embeds');

const CORE_COMMANDS = new Set([
  'modstats',
  'tz',
  'staffrole',
  'promote',
  'demote',
  'strip',
  'inrole',
  'roleposition',
  'rolereposition',
  'staffroster'
]);

function reply(ctx, payload) {
  if (ctx.interaction) {
    if (ctx.interaction.deferred || ctx.interaction.replied) return ctx.interaction.editReply(payload);
    return ctx.interaction.reply({ ...payload, ephemeral: true });
  }
  return ctx.message.reply(payload);
}

function canManage(ctx) {
  return Boolean(
    ctx.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

async function handleFeature(ctx, name) {
  if (!ctx.guild) return false;

  // These commands have dedicated handlers in src/index.js. Let them run there;
  // swallowing them here makes valid commands look like successful deployments
  // while responding that every request is unavailable.
  if (CORE_COMMANDS.has(name)) return false;

  if (name === 'help') {
    const description = [
      '**STAFF ACTIVITY**',
      '`$modstats view [@user]` — today’s activity and all-time totals',
      '`$modstats history [@user]` — detailed daily records',
      '`$modstats leaderboard` — activity leaderboard and date ranges',
      '`$modstats setup` — tracking setup and requirement status',
      '`$modstats reset @user|all` — reset today’s counters (manager)',
      '',
      '**TRACKING CONFIGURATION** (manager)',
      '`$modstats channel add/remove/list #channel`',
      '`$modstats voicechannel add/remove/list #channel`',
      '`$modstats afk set #channel|disable`',
      '`$modstats requirement messages|voice <amount>`',
      '`$modstats defaulttimezone <IANA>`',
      '`$modstats audit #channel` · `$modstats permissions add/remove @role`',
      '`$modstats restrict on|off`',
      '',
      '**TIMEZONES**',
      '`$tz` — show your timezone and local time',
      '`$tz Asia/Dhaka` — set your timezone',
      '`$tz @user` — view another member’s timezone',
      '`$tz list` · `$tz reset`',
      '',
      '**STAFF ROLES** (manager)',
      '`$staffrole add @role` · `$staffrole remove @role`',
      '`$staffrole list` · `$staffrole config` · `$staffrole setorder @role...`',
      '`$promote @member` · `$demote @member` · `$strip @member`',
      '',
      '**ROLES & ROSTER**',
      '`$inrole @role` · `$roleposition @role`',
      '`$rolereposition @role <position>` (manager)',
      '`$staffroster [@role]`',
      '`$setup` · `$config` — setup/configuration status',
      '',
      'Equivalent slash commands are available.'
    ].join('\n');
    return reply(ctx, { embeds: [embed('VOID // command directory', description)] });
  }

  if (name === 'setup' || name === 'config') {
    const config = await getConfig(ctx.guild.id);
    if (!canManage(ctx)) {
      return reply(ctx, { embeds: [failure('This command is restricted to server managers.')] });
    }
    const description = [
      `Staff roles: ${config.staffRoleIds?.length || 0}`,
      `Manager roles: ${config.managerRoleIds?.length || 0}`,
      `Message channels: ${config.messageChannels?.length || 0}`,
      `Voice channels: ${config.voiceChannels?.length || 0}`,
      `Audit channel: ${config.auditChannelId ? `<#${config.auditChannelId}>` : 'not set'}`
    ].join('\n');
    return reply(ctx, { embeds: [embed(name === 'setup' ? 'VOID setup checklist' : 'VOID configuration', description)] });
  }

  // Do not claim unrelated commands: the main dispatcher may have a handler for them.
  return false;
}

async function executeBulkRole(interaction) {
  return interaction.reply({
    embeds: [failure('Bulk role changes are temporarily unavailable while the feature handler is restored.')],
    ephemeral: true
  });
}

async function runScheduledTasks() {
  // Scheduled feature work remains disabled until its handler is restored.
}

module.exports = { handleFeature, executeBulkRole, runScheduledTasks };
