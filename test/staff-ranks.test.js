const test = require('node:test');
const assert = require('node:assert/strict');
const { getRankTransition } = require('../src/utils/staff-ranks');

const ranks = ['trial-mod', 'mod', 'senior-mod', 'admin'];

test('promotion advances from the highest rank held when a member has stacked ranks', () => {
  assert.deepEqual(getRankTransition(ranks, ['trial-mod', 'mod'], 'promote'), {
    remove: ['trial-mod', 'mod'], add: ['senior-mod'], error: null,
  });
});

test('promotion from one rank assigns exactly the next rank', () => {
  assert.deepEqual(getRankTransition(ranks, ['mod'], 'promote'), {
    remove: ['mod'], add: ['senior-mod'], error: null,
  });
});

test('a member with no configured rank starts at the lowest rank when promoted', () => {
  assert.deepEqual(getRankTransition(ranks, [], 'promote'), {
    remove: [], add: ['trial-mod'], error: null,
  });
});

test('promotion at the highest configured rank is rejected', () => {
  assert.equal(getRankTransition(ranks, ['admin'], 'promote').error, 'already-highest');
});

test('demotion from stacked ranks goes down one level and removes stale rank roles', () => {
  assert.deepEqual(getRankTransition(ranks, ['trial-mod', 'mod'], 'demote'), {
    remove: ['trial-mod', 'mod'], add: ['trial-mod'], error: null,
  });
});

test('demotion from the lowest rank is rejected', () => {
  assert.equal(getRankTransition(ranks, ['trial-mod'], 'demote').error, 'no-lower-rank');
});
