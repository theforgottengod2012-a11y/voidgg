# VOID // Staff System

A configurable Discord staff-management bot built with discord.js v14 and MongoDB. Railway runs it as a persistent Node.js worker; it does not open a web server or require a public domain.

## Railway deployment

1. Create a Railway project and deploy this repository as a service.
2. In **Service → Variables**, add these required variables (values come from your Discord app and MongoDB provider):
   - `BOT_TOKEN` — Discord bot token.
   - `CLIENT_ID` — Discord application ID.
   - `MONGODB_URI` — MongoDB connection URI supplied by your MongoDB host/Railway MongoDB service.
3. Optional variables:
   - `GUILD_ID` — a test server ID for faster development slash-command registration. Leave unset for global registration.
   - `PREFIX` — command prefix; defaults to `$`.
4. Railway builds with Nixpacks and starts the persistent worker with `npm start` (configured in `railway.json`). No `.env` upload, web server, port, or domain is needed. Railway injects variables into `process.env`; `.env.example` is only a local-development template.
5. Check deployment logs for `[database] Connected to MongoDB.` and `[client] Online as ...`. Missing required variable names are reported safely; variable values and tokens are never printed.

For Railway-hosted MongoDB, attach/provision the database and use the exact connection URI exposed by that service. Ensure the URI's credentials/database name are valid and that the deployment can reach the database. For external MongoDB, allowlist the necessary network access per provider instructions. The app passes `MONGODB_URI` directly to Mongoose.

## Slash-command registration

Slash commands are intentionally **not** registered on every bot restart. After the first deployment, or whenever slash command definitions change, run the one-off command from the service's Railway shell:

```bash
npm run deploy-commands
```

This requires `BOT_TOKEN` and `CLIENT_ID`. If `GUILD_ID` is set, registration is scoped to that server for quick testing. Remove `GUILD_ID` and run the command again to register globally (global updates can take time to appear). Routine service restarts only log in and run the bot; they do not call the registration API.

## Local development

- Node.js 20+ and MongoDB 6+.
- Run `npm install`, copy `.env.example` to `.env`, and set the variables for your local environment. `dotenv` is loaded only outside production; no `.env` file is expected on Railway.
- Enable **Guilds**, **Guild Members**, **Guild Messages**, **Message Content**, and **Guild Voice States** intents in the Discord Developer Portal.
- Invite the application with `bot` and `applications.commands` scopes. Permissions: View Channels, Send Messages, Embed Links, Read Message History, and Manage Roles (rank actions). Put the bot's highest role above all configured staff ranks.
- Run `npm run deploy-commands` and `npm start`. For development, set `GUILD_ID` to your test guild before registration.

## First-time setup

1. `$staffrole add @Trial Moderator`, then add each rank from lowest to highest. Or use `$staffrole setorder @Trial @Moderator @Senior @Admin`.
2. `$modstats channel add #staff-chat` and `$modstats voicechannel add #staff-voice`.
3. Set goals with `$modstats requirement messages 50` and `$modstats requirement voice 30` (voice goal is minutes per member-local day).
4. Optionally set `$modstats afk set #afk-voice`, `$modstats defaulttimezone Europe/London`, and `$modstats audit #staff-audit`.
5. Users can select an IANA timezone using `$tz Asia/Dhaka`; unset users use the server default.
6. Configure managers with `$modstats permissions add @StaffManager`. Server admins and members with Manage Server retain access.

## Commands

- `$help` — command directory.
- `$tz [IANA zone | @user | list | reset]` — view/set timezone, inspect another member, list common zones, or reset to the server default.
- `$modstats view [@user]`, `history [@user]`, `leaderboard`, `setup`.
- `$modstats channel|voicechannel add|remove|list #channel`.
- `$modstats afk set #channel` / `afk disable`.
- `$modstats requirement messages|voice <count>`.
- `$modstats defaulttimezone <IANA zone>`, `audit #channel`, `permissions add|remove @role`, `restrict on|off`.
- `$modstats reset @user` / `$modstats reset all` (bulk reset requires a confirmation button).
- `$staffrole add|remove @role`, `list`, `setorder @role...`, `config`.
- `$promote @user`, `$demote @user`, `$strip @user` (confirmed role changes).

Slash-command equivalents are available for the command set. Configure ranks and tracked channels before relying on activity records.

## Tracking and data behavior

- Activity is isolated by guild. Only configured staff, text/voice channels, non-bot users, and non-webhook messages are counted. Message IDs are deduplicated.
- Voice activity is written in bounded heartbeats and split at the user's local midnight. AFK and unconfigured channels are excluded. Downtime is not credited; eligible live sessions are rebuilt at startup.
- Daily records are retained across rollovers and resets. Timezone changes do not rewrite previous buckets; subsequent events use the new local day.
- MongoDB stores guild settings, preferences, daily activity, voice sessions, deduplication records, and audit entries.

## Tests

Run `npm test` locally or in CI. The suite validates prefix command argument parsing, timezone command forms, IANA timezone validation, and local-date calculations. End-to-end Discord/MongoDB behavior requires credentials and a private test guild; do not use production credentials in a test environment.

## Operations and security

Use Railway Variables for secrets and keep MongoDB network access restricted. Do not commit `.env` or print credentials. Back up MongoDB. Bot logs contain operational status and sanitized errors. Railway automatically restarts the worker after failures as configured in `railway.json`.
