function getRankTransition(rankIds, memberRoleIds, action) {
  const heldRanks = rankIds.filter(id => memberRoleIds.includes(id));
  if (action === 'strip') {
    return heldRanks.length
      ? { remove: heldRanks, add: [], error: null }
      : { remove: [], add: [], error: 'no-ranks' };
  }
  if (!['promote', 'demote'].includes(action)) return { remove: [], add: [], error: 'invalid-action' };
  if (!rankIds.length) return { remove: [], add: [], error: 'no-hierarchy' };

  // A member may accidentally have several configured staff ranks. Treat their
  // highest rank as current, then normalize them to exactly the next rank.
  const highestHeldIndex = heldRanks.reduce((highest, id) => Math.max(highest, rankIds.indexOf(id)), -1);
  const nextIndex = highestHeldIndex + (action === 'promote' ? 1 : -1);
  if (action === 'promote' && nextIndex >= rankIds.length) return { remove: [], add: [], error: 'already-highest' };
  if (action === 'demote' && (highestHeldIndex < 0 || nextIndex < 0)) return { remove: [], add: [], error: 'no-lower-rank' };

  return {
    remove: heldRanks,
    add: [rankIds[nextIndex]],
    error: null,
  };
}

module.exports = { getRankTransition };
