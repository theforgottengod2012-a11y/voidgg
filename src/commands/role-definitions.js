const { SlashCommandBuilder } = require('discord.js');

const roleSlash = [
  new SlashCommandBuilder().setName('inrole').setDescription('List members who have a role.')
    .addRoleOption(o => o.setName('role').setDescription('Role to inspect').setRequired(true)),
  new SlashCommandBuilder().setName('roleposition').setDescription('Show a role’s position in the server hierarchy.')
    .addRoleOption(o => o.setName('role').setDescription('Role to inspect').setRequired(true)),
  new SlashCommandBuilder().setName('rolereposition').setDescription('Move a role to a requested hierarchy position.')
    .addRoleOption(o => o.setName('role').setDescription('Role to move').setRequired(true))
    .addIntegerOption(o => o.setName('position').setDescription('Requested role position (higher numbers are higher)').setMinValue(1).setRequired(true)),
].map(command => command.toJSON());

module.exports = { roleSlash };
