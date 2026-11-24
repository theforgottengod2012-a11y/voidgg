const mongoose = require('mongoose');

const staffNoteSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  authorId: { type: String, required: true },
  text: { type: String, required: true, maxlength: 1500 },
}, { timestamps: true });
staffNoteSchema.index({ guildId: 1, userId: 1, createdAt: -1 });

const reminderSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  text: { type: String, required: true, maxlength: 1000 },
  dueAt: { type: Date, required: true, index: true },
  sentAt: { type: Date, default: null },
}, { timestamps: true });
reminderSchema.index({ dueAt: 1, sentAt: 1 });

const staffPreferenceSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  activityReminders: { type: Boolean, default: true },
  lastActivityReminderDate: { type: String, default: null },
}, { timestamps: true });
staffPreferenceSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const leaveSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  startDate: { type: String, required: true },
  endDate: { type: String, default: null },
  reason: { type: String, maxlength: 500, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'ended'], default: 'pending' },
  reviewedBy: { type: String, default: null },
}, { timestamps: true });
leaveSchema.index({ guildId: 1, userId: 1, status: 1 });

const onboardingSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  item: { type: String, required: true, maxlength: 80 },
  completedBy: { type: String, required: true },
}, { timestamps: true });
onboardingSchema.index({ guildId: 1, userId: 1, item: 1 }, { unique: true });

const featureStateSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  lastWeeklyReport: { type: String, default: null },
}, { timestamps: true });

module.exports = {
  StaffNote: mongoose.models.StaffNote || mongoose.model('StaffNote', staffNoteSchema),
  Reminder: mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema),
  StaffPreference: mongoose.models.StaffPreference || mongoose.model('StaffPreference', staffPreferenceSchema),
  LeaveRequest: mongoose.models.LeaveRequest || mongoose.model('LeaveRequest', leaveSchema),
  OnboardingItem: mongoose.models.OnboardingItem || mongoose.model('OnboardingItem', onboardingSchema),
  FeatureState: mongoose.models.FeatureState || mongoose.model('FeatureState', featureStateSchema),
};
