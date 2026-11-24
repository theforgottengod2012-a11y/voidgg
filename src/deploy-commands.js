const { Routes, REST } = require('discord.js');
const { slash } = require('./commands/definitions');
const { roleSlash } = require('./commands/role-definitions');
const { featureSlash } = require('./commands/feature-definitions');
require('dotenv').config();
if (!process.env.BOT_TOKEN || !process.env.CLIENT_ID) throw new Error('BOT_TOKEN and CLIENT_ID are required.');
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
(async () => {
  const route = process.env.GUILD_ID ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID) : Routes.applicationCommands(process.env.CLIENT_ID);
  const commands = [...slash, ...roleSlash, ...featureSlash];
  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} slash commands${process.env.GUILD_ID ? ` in ${process.env.GUILD_ID}` : ' globally'}.`);
})().catch(error => { console.error('Command registration failed:', error.message); process.exit(1); });
