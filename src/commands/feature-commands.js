const { PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('../utils/config');
const { embed, failure } = require('../utils/embeds');

const CORE_COMMANDS = new Set([
  'help',
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
