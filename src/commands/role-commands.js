const { PermissionFlagsBits } = require('discord.js');
const { getConfig, logAction } = require('../utils/config');
const { success, failure, embed } = require('../utils/embeds');

function reply(ctx, payload) {
  if (ctx.interaction) {
    if (ctx.interaction.deferred || ctx.interaction.replied) return ctx.interaction.editReply(payload);
    return ctx.interaction.reply({ ...payload, ephemeral: true });
  }
  return ctx.message.reply(payload);
}

function requestedRole(ctx) {
  if (ctx.interaction) return ctx.interaction.options.getRole('role');
  const id = (ctx.args[0] || '').replace(/[<@&>]/g, '');
  return ctx.guild.roles.cache.get(id) || null;
}

function canManage(ctx, config) {
  return Boolean(
    ctx.member?.permissions?.has(PermissionFlagsBits.Administrator)
    || ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    || ctx.member?.roles?.cache && config.managerRoleIds.some(id => ctx.member.roles.cache.has(id))
  );
}

async function sendRoleMemberList(ctx, role, members) {
  const matching = [...members.values()].filter(member => member.roles.cache.has(role.id));
  if (!matching.length) {
    return reply(ctx, { embeds: [embed(`Members in ${role.name}`, 'No members currently have this role.')] });
  }

  // Keep each embed below Discord's description limit and group no more than 10 embeds per message.
  const pages = [];
  let lines = [];
  let length = 0;
  for (const member of matching) {
    const line = `• <@${member.id}> — ${member.displayName.replace(/[\r\n]/g, ' ')}`;
    if (lines.length && (lines.length >= 35 || length + line.length + 1 > 3800)) {
      pages.push(lines.join('\n'));
      lines = [];
      length = 0;
    }
    lines.push(line);
    length += line.length + 1;
  }
  if (lines.length) pages.push(lines.join('\n'));

  const batches = [];
  for (let i = 0; i < pages.length; i += 10) {
    batches.push(pages.slice(i, i + 10).map((description, index) => {
      const page = i + index + 1;
      return embed(`Members in ${role.name} · ${page}/${pages.length}`, `${description}\n\n**Total:** ${matching.length}`);
    }));
  }

  if (ctx.interaction) {
    await ctx.interaction.reply({ embeds: batches[0], ephemeral: true });
    for (const batch of batches.slice(1)) await ctx.interaction.followUp({ embeds: batch, ephemeral: true });
  } else {
    await ctx.message.reply({ embeds: batches[0] });
    for (const batch of batches.slice(1)) await ctx.message.channel.send({ embeds: batch });
  }
}

async function handleInRole(ctx) {
  const role = requestedRole(ctx);
  if (!role) return reply(ctx, { embeds: [failure('Provide a valid server role mention or ID. Usage: `$inrole @role`.')] });
  const members = await ctx.guild.members.fetch();
  return sendRoleMemberList(ctx, role, members);
}

async function handleRolePosition(ctx) {
  const role = requestedRole(ctx);
  if (!role) return reply(ctx, { embeds: [failure('Provide a valid server role mention or ID. Usage: `$roleposition @role`.')] });
  return reply(ctx, { embeds: [embed(`Role position // ${role.name}`, `<@&${role.id}> is at position **${role.position}**. Higher numbers appear higher in the server role list.`)] });
}

async function handleRoleReposition(ctx) {
  const role = requestedRole(ctx);
  const rawPosition = ctx.interaction
    ? ctx.interaction.options.getInteger('position')
    : Number(ctx.args[1]);
  if (!role || !Number.isInteger(rawPosition) || rawPosition < 1) {
    return reply(ctx, { embeds: [failure('Provide a role and a whole-number position greater than 0. Usage: `$rolereposition @role <position>`.')] });
  }

  const config = await getConfig(ctx.guild.id);
  if (!canManage(ctx, config) || !ctx.member?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return reply(ctx, { embeds: [failure('You need Manage Roles permission and server-manager access to reposition roles.')] });
  }
  if (role.id === ctx.guild.id || role.managed) {
    return reply(ctx, { embeds: [failure('The @everyone role and integration-managed roles cannot be repositioned.')] });
  }

  const botMember = ctx.guild.members.me || await ctx.guild.members.fetchMe();
  const botHighest = botMember.roles.highest;
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return reply(ctx, { embeds: [failure('I need the Manage Roles permission to reposition roles.')] });
  }
  const isAdmin = ctx.member.permissions.has(PermissionFlagsBits.Administrator);
  if (role.position >= botHighest.position || (!isAdmin && role.position >= ctx.member.roles.highest.position)) {
    return reply(ctx, { embeds: [failure('Role hierarchy prevents this change. Your highest role and my highest role must be above the role being moved.')] });
  }
  if (rawPosition >= botHighest.position) {
    return reply(ctx, { embeds: [failure(`Choose a position below my highest role (maximum allowed: ${Math.max(1, botHighest.position - 1)}).`)] });
  }

  const previousPosition = role.position;
  await role.setPosition(rawPosition, { reason: `Role repositioned by ${ctx.user.tag || ctx.user.username}` });
  await logAction(ctx.guild, ctx.user.id, null, 'role.reposition', { roleId: role.id, previousPosition, position: rawPosition });
  return reply(ctx, { embeds: [success('Role repositioned', `<@&${role.id}> moved from position **${previousPosition}** to **${role.position}**.`)] });
}

module.exports = { handleInRole, handleRolePosition, handleRoleReposition };
