const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { connectDatabase } = require('./database');
const { onMessage, onVoiceState, heartbeat, recoverSessions } = require('./services/tracking');
const { handleModstats, handleTimezone, handleStaffRole, staffAction, executeStaffConfirmation, handleHelp } = require('./commands/handlers');
require('dotenv').config();

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN is required. Copy .env.example to .env and configure it.');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates], partials: [Partials.Channel] });
client.pending = new Map();

async function dispatch(ctx, name) {
  try {
    if (name === 'help') return await handleHelp(ctx);
    if (name === 'modstats') return await handleModstats(ctx);
    if (name === 'tz') return await handleTimezone(ctx);
    if (name === 'staffrole') return await handleStaffRole(ctx);
    if (['promote', 'demote', 'strip'].includes(name)) return await staffAction(ctx, name);
    return null;
  } catch (error) {
    console.error(`[command:${name}]`, error);
    const payload = { embeds: [require('./utils/embeds').failure('The request could not be completed. Please verify the configuration and try again.')] };
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
  const prefix = process.env.PREFIX || '$';
  if (!message.content.startsWith(prefix)) return;
  const parts = message.content.slice(prefix.length).trim().split(/\s+/);
  const name = (parts.shift() || '').toLowerCase();
  if (!name) return;
  const ctx = { client, guild: message.guild, member: message.member, user: message.author, message, args: parts, interaction: null };
  void dispatch(ctx, name);
});
client.on(Events.VoiceStateUpdate, (oldState, newState) => onVoiceState(oldState, newState).catch(error => console.error('[tracking] voice state:', error.message)));
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton() && interaction.customId.startsWith('staffconfirm:')) return executeStaffConfirmation(interaction);
  if (!interaction.isChatInputCommand()) return;
  const ctx = { client, guild: interaction.guild, member: interaction.member, user: interaction.user, interaction, args: [] };
  if (interaction.commandName === 'modstats') {
    const sub = interaction.options.getSubcommand();
    // Slash `subcommand` access is preserved for the shared handler.
    ctx.args = [sub];
  }
  if (interaction.commandName === 'staffrole') ctx.args = [interaction.options.getSubcommand()];
  await dispatch(ctx, interaction.commandName);
});
client.on(Events.Error, error => console.error('[client] Discord client error:', error.message));
process.on('unhandledRejection', error => console.error('[process] Unhandled rejection:', error));
(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await client.login(token);
})().catch(error => { console.error('[startup] Failed:', error.message); process.exit(1); });
