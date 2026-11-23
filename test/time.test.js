const test = require('node:test');
const assert = require('node:assert/strict');
const { validTimezone, localDate } = require('../src/utils/time');

test('validates IANA timezone identifiers', () => {
  assert.equal(validTimezone('Asia/Dhaka'), true);
  assert.equal(validTimezone('Not/AZone'), false);
});

test('computes local dates independently of host timezone', () => {
  const instant = new Date('2025-01-01T01:00:00.000Z');
  assert.equal(localDate(instant, 'America/Los_Angeles'), '2024-12-31');
  assert.equal(localDate(instant, 'Asia/Dhaka'), '2025-01-01');
});
