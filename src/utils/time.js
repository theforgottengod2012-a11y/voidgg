const { DateTime, IANAZone } = require('luxon');
const { UserTimezone } = require('../models');
function validTimezone(zone) { return typeof zone === 'string' && IANAZone.isValidZone(zone); }
async function getTimezone(guildId, userId, config) {
  const pref = await UserTimezone.findOne({ guildId, userId }).lean();
  return pref?.timezone || config?.defaultTimezone || 'UTC';
}
function localDate(date, zone) { return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(zone).toISODate(); }
function localTime(date, zone) { return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(zone).toFormat("cccc, LLLL d, yyyy 'at' h:mm a ZZZZ"); }
module.exports = { validTimezone, getTimezone, localDate, localTime };
