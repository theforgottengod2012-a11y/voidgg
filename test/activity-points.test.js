const test = require('node:test');
const assert = require('node:assert/strict');
const { activityPoints, activityTarget, meetsActivityTarget } = require('../src/utils/activity-points');

test('messages and voice minutes each earn one combined activity point', () => {
  assert.equal(activityPoints(100, 150), 250);
  assert.equal(activityPoints(300, 200), 500);
});

test('duplicate requirement settings do not add together', () => {
  assert.equal(activityTarget({ messageRequirement: 250, voiceRequirement: 250 }), 250);
});

test('the higher configured requirement is the shared target', () => {
  assert.equal(activityTarget({ messageRequirement: 100, voiceRequirement: 250 }), 250);
  assert.equal(activityTarget({ messageRequirement: 300, voiceRequirement: 250 }), 300);
});

test('activity above the target still counts and satisfies the target', () => {
  assert.equal(activityPoints(200, 150), 350);
  assert.equal(meetsActivityTarget(200, 150, 250), true);
  assert.equal(meetsActivityTarget(100, 149, 250), false);
});
