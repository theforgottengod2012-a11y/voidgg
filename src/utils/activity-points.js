function activityPoints(messages = 0, voiceMinutes = 0) {
  return Math.max(0, Number(messages) || 0) + Math.max(0, Number(voiceMinutes) || 0);
}

// Both configured values describe the same combined-points target. They must
// not be added together: when both are 250, the target remains 250 points.
function activityTarget(config) {
  return Math.max(0, Number(config.messageRequirement) || 0, Number(config.voiceRequirement) || 0);
}

function meetsActivityTarget(messages, voiceMinutes, target) {
  return activityPoints(messages, voiceMinutes) >= target;
}

module.exports = { activityPoints, activityTarget, meetsActivityTarget };
