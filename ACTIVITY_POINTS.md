# Combined activity points

Each counted message and each eligible voice minute contributes **1 point**.

```text
combined points = messages + voiceMinutes
```

The configured message and voice requirement values set one shared target. They are **not added together**. The bot uses the higher configured value:

- `messages 250`, `voice 250` → shared target **250 points**
- `messages 100`, `voice 250` → shared target **250 points**
- `messages 300`, `voice 250` → shared target **300 points**

Examples:

- 100 messages + 150 voice minutes = 250 points and completes a 250-point target
- 200 messages + 150 voice minutes = 350 points and remains complete with 100 extra points
- 100 messages + 149 voice minutes = 249 points and remains incomplete

Run `npm test` before deploying.
