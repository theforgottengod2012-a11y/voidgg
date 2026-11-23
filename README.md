# VOID // Staff System

A configurable Discord staff-management bot built with discord.js v14 and MongoDB. It combines timezone-aware staff activity records, voice tracking, explicit rank administration, and a restrained dark interface.

## Requirements

- Node.js 20+
- MongoDB 6+ (local or managed)
- Discord application and bot with **Guilds**, **Guild Members**, **Guild Messages**, **Message Content**, and **Guild Voice States** intents enabled in the Developer Portal
- Bot permissions: View Channels, Send Messages, Embed Links, Read Message History, Manage Roles (for rank changes). Place the bot's highest role above all configured staff ranks.

## Installation

```bash
npm install
cp .env.example .env
```

Set `BOT_TOKEN`, `CLIENT_ID`, and `MONGODB_URI` in `.env`. Never commit `.env`. `GUILD_ID` is optional and registers commands to one development server; without it, commands register globally and propagation can take time. `PREFIX` defaults to `$`.

Configure the application in the Discord Developer Portal, enable the intents listed above, then install it with the `bot` and `applications.commands` scopes. Start MongoDB and run:

```bash
npm run deploy-commands
npm start
```

For development, set `GUILD_ID` to your test server and rerun `npm run deploy-commands` after changing slash command definitions.

## First-time setup

1. `$staffrole add @Trial Moderator`, then add each rank from lowest to highest. Or use `$staffrole setorder @Trial @Moderator @Senior @Admin`.
2. `$modstats channel add #staff-chat` and `$modstats voicechannel add #staff-voice`.
3. Set goals with `$modstats requirement messages 50` and `$modstats requirement voice 30` (voice goal is minutes per member-local day).
4. Optionally set `$modstats afk set #afk-voice`, `$modstats defaulttimezone Europe/London`, and `$modstats audit #staff-audit`.
5. Users can select their own IANA timezone using `$tz Asia/Dhaka`. A user's current local date determines the daily bucket.
6. Configure staff managers with `$modstats permissions add @Staff Manager` (server admins and members with Manage Server retain access).

Slash equivalents are provided for all top-level commands. Prefix commands use `$` unless `PREFIX` is set in the environment.

## Commands

- `$help` — command directory
- `$tz [IANA zone | @user | list | reset]` — timezone preference and local time
- `$modstats view [@user]`, `history [@user]`, `leaderboard`, `setup`
- `$modstats channel|voicechannel add|remove|list #channel`
- `$modstats afk set #channel` / `afk disable`
- `$modstats requirement messages|voice <count>`
- `$modstats defaulttimezone <IANA zone>`, `audit #channel`, `permissions add|remove @role`, `restrict on|off`
- `$modstats reset @user` / `$modstats reset all`
- `$staffrole add|remove @role`, `list`, `setorder @role...`, `config`
- `$promote @user`, `$demote @user`, `$strip @user`

All potentially sensitive staff-role changes use a confirmation button. Authorized managers are server administrators/Manage Server members or configured manager-role holders. `restrict on` makes views of other staff limited to authorized managers.

## Tracking and data behavior

- Only configured staff roles, channels, non-bot members, and non-webhook messages are counted. Message IDs are deduplicated and dedupe records expire after 14 days.
- Voice activity is written in bounded 60-second heartbeats and split at the user's local midnight. AFK and unconfigured channels are excluded. Existing voice sessions are closed at their last durable cursor during startup; downtime is never credited. On reconnect, live eligible voice participants are rebuilt as new sessions.
- Daily documents retain historical buckets. Timezone changes do not rewrite old records; future events use the newly selected local date and timezone. Changing zone can therefore create a new apparent daily boundary, intentionally without destructive migration.
- Manual resets zero only the current local-date bucket and write an audit entry; earlier daily buckets remain available.
- Statistics are isolated by guild. MongoDB unique indexes prevent duplicate daily buckets and message IDs.

## Hosting and operations

Use a process manager (systemd, Docker, PM2, or a managed Node host) with automatic restart. Supply environment variables through the host's secret manager, keep MongoDB network access restricted, and back up the database. Do not expose tokens or connection strings in logs. The bot logs startup and sanitized error messages; operational monitoring should alert on process exits and database availability.

## Development notes

Shared command handlers back prefix and slash interfaces. Run `npm test` for the Node test suite (currently reserved for service-level tests); run the bot against a private test guild before production and verify role hierarchy, permissions, tracking channels, and indexes. This application deliberately uses MongoDB as the authoritative persistence layer and avoids counting downtime as voice activity.
