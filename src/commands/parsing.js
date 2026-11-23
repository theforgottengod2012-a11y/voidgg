function parsePrefixArguments(content, prefix = '$') {
  if (typeof content !== 'string' || !content.startsWith(prefix)) return null;
  const tokens = content.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  return { name: (tokens.shift() || '').toLowerCase(), args: tokens };
}

function mentionId(value) {
  const match = typeof value === 'string' && value.match(/^<@!?([0-9]{17,20})>$/);
  return match?.[1] || null;
}

function parseTimezoneInput(args = []) {
  const first = args[0];
  if (!first) return { action: 'show' };
  if (first.toLowerCase() === 'reset') return { action: 'reset' };
  if (first.toLowerCase() === 'list') return { action: 'list' };
  const userId = mentionId(first);
  if (userId) return { action: 'show', userId };
  return { action: 'set', timezone: first };
}

module.exports = { parsePrefixArguments, mentionId, parseTimezoneInput };
