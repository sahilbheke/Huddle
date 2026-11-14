# Huddle

Spaces where friends, classes and teams keep each other going. Members log a daily activity with the fields the space's admin requires, chat in the group, and see streaks, records and a leaderboard. Every number is calculated from what people log.

Built with Expo (React Native, TypeScript, Expo Router) and Supabase (Postgres, Auth, Realtime, Storage).

## Status

Milestones 1–5 done; milestone 6 (notifications) in progress.

- [x] Database schema with row-level security
- [x] Rules engine in Postgres: required fields, hourly post limit (0 = off), rest days, day closing, streaks, records
- [x] Phone number sign-in with a one-time code, and profile setup
- [x] Create and join spaces (milestone 2)
- [x] Check-ins and the feed, with live updates (milestone 3)
- [x] Board: streaks, last 21 days, personal bests (milestone 4)
- [x] Admin settings: rules, activities, what members see, admin access (milestone 5)
- [x] Notifications: daily reminders, and a push when someone posts (milestone 6a)
- [ ] Find friends via contacts, direct messages, owner reports

## Run it

1. Install dependencies: `npm install`
2. Create a Supabase project at [supabase.com](https://supabase.com), then apply the schema. Either paste each file in `supabase/migrations/` into the SQL editor, oldest first, or with the Supabase CLI run `supabase link` and `supabase db push`.
3. In the Supabase dashboard, open Authentication > Sign In / Providers > Phone and turn it on. Without an SMS provider yet, add a test number such as `919800000001=123456` under "Test Phone Numbers and OTPs".
4. Copy `.env.example` to `.env` and fill in the project URL and publishable key from Project Settings > API.
5. Start the app with `npx expo start` and open it in Expo Go on your phone.

To run everything locally instead, `supabase start` uses `supabase/config.toml`, which already has test numbers.

## Notifications (milestone 6a)

In-app live updates (new messages and check-ins appearing in the feed) work with no extra setup. Push notifications — the daily reminder and the "someone posted" alert when the app is closed — need a standalone build and a one-time backend setup:

1. **Build with EAS** so the app has a push-capable project id and Android (FCM) credentials: `npx eas-cli@latest init` then `eas build --profile preview --platform android`. Expo Go cannot receive remote push.
2. **Deploy the two edge functions:**
   ```bash
   supabase functions deploy notify
   supabase functions deploy send-reminders
   ```
   `notify` is called by the app when someone posts. `send-reminders` is run on a schedule.
3. **Schedule the daily reminders** to run hourly (it only sends to spaces whose reminder hour matches the current local hour). In the Supabase dashboard, add a scheduled job (pg_cron + pg_net, or the Integrations → Cron UI) that calls the `send-reminders` function every hour with the service-role key.

Until EAS is set up, the app still runs and the live feed works; the "Send me a test notification" button in Admin reports that no device is registered.

## Checks

```bash
npm run typecheck   # TypeScript
npx eslint .        # lint
npm run db:test     # schema + rules engine tests on a throwaway local Postgres (needs psql)
```

## Layout

- `src/app/` screens (Expo Router). `sign-in`, `profile-setup`, and the `(tabs)` group.
- `src/lib/` Supabase client and the auth provider.
- `supabase/migrations/` the database: tables, security policies and the rules engine functions.
- `supabase/tests/` SQL tests for the rules engine.
