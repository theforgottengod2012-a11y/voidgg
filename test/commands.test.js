const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrefixArguments, parseTimezoneInput, mentionId } = require('../src/commands/parsing');

test('prefix parser handles command and arguments consistently', () => {
  assert.deepEqual(parsePrefixArguments('$modstats view <@12345678901234567>'), { name: 'modstats', args: ['view', '<@12345678901234567>'] });
  assert.deepEqual(parsePrefixArguments('!tz list', '!'), { name: 'tz', args: ['list'] });
  assert.equal(parsePrefixArguments('not a command'), null);
});

test('timezone prefix forms resolve to distinct actions', () => {
  assert.deepEqual(parseTimezoneInput([]), { action: 'show' });
  assert.deepEqual(parseTimezoneInput(['reset']), { action: 'reset' });
  assert.deepEqual(parseTimezoneInput(['list']), { action: 'list' });
  assert.deepEqual(parseTimezoneInput(['Asia/Dhaka']), { action: 'set', timezone: 'Asia/Dhaka' });
  assert.deepEqual(parseTimezoneInput(['<@!12345678901234567>']), { action: 'show', userId: '12345678901234567' });
  assert.equal(mentionId('<@12345678901234567>'), '12345678901234567');
});
