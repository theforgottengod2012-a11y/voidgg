const { DailyActivity, SeenMessage, VoiceSession } = require('../models');
const { getTimezone, localDate } = require('../utils/time');
const { getConfig } = require('../utils/config');
const { DateTime } = require('luxon');

async function addActivity(guildId, userId, date, timezone, field, amount = 1) {
  await DailyActivity.findOneAndUpdate(
    { guildId, userId, localDate: date },
    { $setOnInsert: { guildId, userId, localDate: date, timezone }, $inc: { [field]: amount } },
    { upsert: true, new: true },
  );
}
async function onMessage(message) {
  if (!message.guild || message.author.bot || message.webhookId || message.system) return;
  const config = await getConfig(message.guild.id);
  if (!config.messageChannels.includes(message.channelId)) return;
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member || !config.staffRoleIds.some(id => member.roles.cache.has(id))) return;
  try {
    await SeenMessage.create({ messageId: message.id });
  } catch (error) { if (error.code === 11000) return; throw error; }
  const timezone = await getTimezone(message.guild.id, message.author.id, config);
  await addActivity(message.guild.id, message.author.id, localDate(message.createdAt, timezone), timezone, 'messages', 1);
}

async function creditInterval(session, endAt) {
  const zone = session.timezone;
  let cursor = DateTime.fromJSDate(session.cursorAt, { zone: 'utc' });
  const end = DateTime.fromJSDate(endAt, { zone: 'utc' });
  while (cursor < end) {
    const nextMidnight = cursor.setZone(zone).plus({ days: 1 }).startOf('day').toUTC();
    const segmentEnd = nextMidnight < end ? nextMidnight : end;
    const minutes = Math.floor(segmentEnd.diff(cursor, 'minutes').minutes);
    if (minutes > 0) await addActivity(session.guildId, session.userId, localDate(cursor.toJSDate(), zone), zone, 'voiceMinutes', minutes);
    cursor = segmentEnd;
  }
  session.cursorAt = endAt;
  await session.save();
}
async function onVoiceState(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  const userId = newState.id;
  if (!guild || newState.member?.user.bot) return;
  const config = await getConfig(guild.id);
  const eligible = (channelId) => Boolean(channelId && config.voiceChannels.includes(channelId) && channelId !== config.afkChannelId);
  const wasEligible = eligible(oldState.channelId);
  const isEligible = eligible(newState.channelId);
  if (wasEligible && oldState.channelId === newState.channelId) return;
  const session = await VoiceSession.findOne({ guildId: guild.id, userId, active: true });
  if (session) {
    await creditInterval(session, new Date());
    if (!isEligible) { session.active = false; await session.save(); }
    else { session.channelId = newState.channelId; session.cursorAt = new Date(); await session.save(); }
  } else if (isEligible && newState.member && config.staffRoleIds.some(id => newState.member.roles.cache.has(id))) {
    const timezone = await getTimezone(guild.id, userId, config);
    await VoiceSession.create({ guildId: guild.id, userId, channelId: newState.channelId, timezone, cursorAt: new Date(), active: true });
  }
}
async function heartbeat(client) {
  const sessions = await VoiceSession.find({ active: true });
  const now = new Date();
  for (const session of sessions) {
    const guild = client.guilds.cache.get(session.guildId);
    const member = guild && await guild.members.fetch(session.userId).catch(() => null);
    const config = guild && await getConfig(guild.id);
    const stillEligible = member && config?.staffRoleIds.some(id => member.roles.cache.has(id)) && member.voice.channelId === session.channelId && config.voiceChannels.includes(session.channelId) && session.channelId !== config.afkChannelId;
    if (!stillEligible) { await creditInterval(session, session.cursorAt); session.active = false; await session.save(); continue; }
    // Heartbeats bound unobserved accrual after a crash. Only credit the bounded interval.
    const cutoff = new Date(Math.min(now.getTime(), session.cursorAt.getTime() + 60_000));
    if (cutoff > session.cursorAt) await creditInterval(session, cutoff);
  }
}
async function recoverSessions(client) {
  // Never count downtime: close persisted sessions at their last durable cursor, then rebuild from live voice state.
  const sessions = await VoiceSession.find({ active: true });
  for (const session of sessions) { session.active = false; await session.save(); }
  for (const guild of client.guilds.cache.values()) {
    const config = await getConfig(guild.id);
    for (const [, member] of guild.members.cache) {
      if (member.user.bot || !member.voice.channelId || !config.voiceChannels.includes(member.voice.channelId) || member.voice.channelId === config.afkChannelId || !config.staffRoleIds.some(id => member.roles.cache.has(id))) continue;
      const timezone = await getTimezone(guild.id, member.id, config);
      await VoiceSession.create({ guildId: guild.id, userId: member.id, channelId: member.voice.channelId, timezone, cursorAt: new Date(), active: true });
    }
  }
}
module.exports = { onMessage, onVoiceState, heartbeat, recoverSessions, addActivity };
