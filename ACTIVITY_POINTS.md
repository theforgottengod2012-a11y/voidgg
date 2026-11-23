# Combined activity points

Each counted message and each eligible voice minute contributes **1 point**.

```text
combined points = messages + voiceMinutes
```

The configured message and voice requirement values set one shared target. They are **not added together**. The higher configured value is the shared target:

- `messages 250`, `voice 250` → target **250 points**
- `messages 100`, `voice 250` → target **250 points**
- `messages 300`, `voice 250` → target **300 points**

`$modstats history [@user]` displays each of the last 14 local days separately: message count, voice minutes, points, and whether that day's target was met. It does not show a combined 14-day total.

Promotion uses the staff hierarchy configured with `$staffrole`. If someone holds multiple configured rank roles, the bot treats their highest rank as their current rank and promotes them to the next role, removing any other configured rank roles during the confirmed change.
