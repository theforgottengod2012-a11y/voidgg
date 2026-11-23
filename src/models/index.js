const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  prefix: { type: String, default: '$' },
  defaultTimezone: { type: String, default: 'UTC' },
  messageChannels: { type: [String], default: [] },
  voiceChannels: { type: [String], default: [] },
  afkChannelId: { type: String, default: null },
  messageRequirement: { type: Number, default: 0, min: 0 },
  voiceRequirement: { type: Number, default: 0, min: 0 },
  staffRoleIds: { type: [String], default: [] },
  managerRoleIds: { type: [String], default: [] },
  auditChannelId: { type: String, default: null },
  restrictStats: { type: Boolean, default: false },
}, { timestamps: true });

const timezoneSchema = new mongoose.Schema({
  guildId: { type: String, required: true }, userId: { type: String, required: true },
  timezone: { type: String, required: true },
}, { timestamps: true });
timezoneSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const dailySchema = new mongoose.Schema({
  guildId: { type: String, required: true }, userId: { type: String, required: true },
  localDate: { type: String, required: true }, timezone: { type: String, required: true },
  messages: { type: Number, default: 0 }, voiceMinutes: { type: Number, default: 0 },
  resetAt: { type: Date, default: null },
}, { timestamps: true });
dailySchema.index({ guildId: 1, userId: 1, localDate: 1 }, { unique: true });
dailySchema.index({ guildId: 1, localDate: 1 });

const seenMessageSchema = new mongoose.Schema({ messageId: { type: String, required: true, unique: true }, createdAt: { type: Date, expires: 1209600, default: Date.now } });
const voiceSessionSchema = new mongoose.Schema({
  guildId: { type: String, required: true }, userId: { type: String, required: true },
  channelId: { type: String, required: true }, timezone: { type: String, required: true },
  cursorAt: { type: Date, required: true }, active: { type: Boolean, default: true },
}, { timestamps: true });
voiceSessionSchema.index({ guildId: 1, userId: 1, active: 1 });

const auditSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true }, actorId: String, targetId: String,
  action: { type: String, required: true }, details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });
auditSchema.index({ guildId: 1, createdAt: -1 });

module.exports = {
  GuildConfig: mongoose.model('GuildConfig', configSchema),
  UserTimezone: mongoose.model('UserTimezone', timezoneSchema),
  DailyActivity: mongoose.model('DailyActivity', dailySchema),
  SeenMessage: mongoose.model('SeenMessage', seenMessageSchema),
  VoiceSession: mongoose.model('VoiceSession', voiceSessionSchema),
  AuditLog: mongoose.model('AuditLog', auditSchema),
};
