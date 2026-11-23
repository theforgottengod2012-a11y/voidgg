## Tracking and data behavior

- Activity is isolated by guild. Only configured staff, text/voice channels, non-bot users, and non-webhook messages are counted. Message IDs are deduplicated.
- Each counted message earns 1 activity point. Each eligible voice minute earns 1 activity point.
- Completion uses a single combined target: `messages + voiceMinutes >= higherOf(messageRequirement, voiceRequirement)`. The two requirement settings are not added together.
- Extra points count as activity and remain visible; exceeding the target does not cap or discard points.
- Voice activity is written in bounded heartbeats and split at the user's local midnight. AFK and unconfigured channels are excluded. Downtime is not credited; eligible live sessions are rebuilt at startup.
- Daily records are retained across rollovers and resets. Timezone changes do not rewrite previous buckets; subsequent events use the new local day.
- MongoDB stores guild settings, preferences, daily activity, voice sessions, deduplication records, and audit entries.
