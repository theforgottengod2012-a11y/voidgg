const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { connectDatabase } = require('./database');
const { onMessage, onVoiceState, heartbeat, recoverSessions } = require('./services/tracking');
const { handleModstats, handleTimezone, handleStaffRole, staffAction, executeStaffConfirmation, executeResetConfirmation, handleHelp } = require('./commands/handlers');
const { handleInRole, handleRolePosition, handleRoleReposition } = require('./commands/role-commands');

// dotenv is for local development only. Railway injects variables directly into process.env.
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch { /* dotenv is optional outside production */ }
}

const REQUIRED_ENV = ['BOT_TOKEN', 'CLIENT_ID', 'MONGODB_URI'];
const missing = REQUIRED_ENV.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.error(`[startup] Missing required environment variable(s): ${missing.join(', ')}.`);
  console.error('[startup] Set them in Railway Service → Variables or your local environment. Values are never logged.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates], partials: [Partials.Channel] });
client.pending = new Map();

async function dispatch(ctx, name) {
  try {
    if (name === 'help') return await handleHelp(ctx);
    if (name === 'modstats') return await handleModstats(ctx);
    if (name === 'tz') return await handleTimezone(ctx);
    if (name === 'staffrole') return await handleStaffRole(ctx);
    if (name === 'inrole') return await handleInRole(ctx);
    if (name === 'roleposition') return await handleRolePosition(ctx);
    if (name === 'rolereposition') return await handleRoleReposition(ctx);
    if (['promote', 'demote', 'strip'].includes(name)) return await staffAction(ctx, name);
  } catch (error) {
    console.error(`[command:${name}]`, error?.message || 'Unknown command error');
    const payload = { embeds: [require('./utils/embeds').failure('The request could not be completed. Check the configuration and try again.')] };
    if (ctx.interaction) {
      if (ctx.interaction.deferred || ctx.interaction.replied) await ctx.interaction.editReply(payload).catch(() => {});
      else await ctx.interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
    } else await ctx.message.reply(payload).catch(() => {});
  }
}
client.once(Events.ClientReady, async ready => {
  console.log(`[client] Online as ${ready.user.tag}`);
  await recoverSessions(client);
  setInterval(() => heartbeat(client).catch(error => console.error('[tracking] heartbeat:', error.message)), 60_000).unref();
});
client.on(Events.MessageCreate, message => {
  if (message.author.bot || !message.guild) return;
  onMessage(message).catch(error => console.error('[tracking] message:', error.message));
  const { parsePrefixArguments } = require('./commands/parsing');
  const parsed = parsePrefixArguments(message.content, process.env.PREFIX || '$');
  if (!parsed?.name) return;
  const ctx = { client, guild: message.guild, member: message.member, user: message.author, message, args: parsed.args, interaction: null };
  void dispatch(ctx, parsed.name);
});
client.on(Events.VoiceStateUpdate, (oldState, newState) => onVoiceState(oldState, newState).catch(error => console.error('[tracking] voice state:', error.message)));
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton() && interaction.customId.startsWith('staffconfirm:')) return executeStaffConfirmation(interaction);
  if (interaction.isButton() && interaction.customId.startsWith('resetconfirm:')) return executeResetConfirmation(interaction);
  if (!interaction.isChatInputCommand()) return;
  const ctx = { client, guild: interaction.guild, member: interaction.member, user: interaction.user, interaction, args: [] };
  await dispatch(ctx, interaction.commandName);
});
client.on(Events.Error, error => console.error('[client] Discord client error:', error.message));
process.on('unhandledRejection', error => console.error('[process] Unhandled rejection:', error?.message || 'Unknown rejection'));
(async () => {
  try {
    await connectDatabase(process.env.MONGODB_URI);
  } catch (error) {
    console.error('[startup] MongoDB connection failed. Verify MONGODB_URI and network access.');
    console.error(`[startup] ${error?.name || 'Error'}: ${error?.message || 'connection error'}`);
    process.exit(1);
  }
  await client.login(process.env.BOT_TOKEN);
})().catch(error => { console.error('[startup] Discord login failed. Verify BOT_TOKEN and application configuration.'); console.error(error?.message || 'Login error'); process.exit(1); });
