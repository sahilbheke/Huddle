# Huddle

Spaces where friends, classes and teams keep each other going. Members log a daily activity with the fields the space's admin requires, chat in the group, and see streaks, records and a leaderboard. Every number is calculated from what people log.

Built with Expo (React Native, TypeScript, Expo Router) and Supabase (Postgres, Auth, Realtime, Storage).

## Status

Milestone 1 of 6: foundation.

- [x] Database schema with row-level security
- [x] Rules engine in Postgres: required fields, hourly post limit (0 = off), rest days, day closing, streaks, records
- [x] Phone number sign-in with a one-time code, and profile setup
- [x] Spaces and Chats tabs (lists only)
- [x] Create and join spaces (milestone 2)
- [x] Check-ins and the feed (milestone 3)
- [ ] Rules in the app, the board and admin settings (milestones 4 and 5)
- [ ] Group chat, direct messages, contacts and push reminders (milestone 6)

## Run it

1. Install dependencies: `npm install`
2. Create a Supabase project at [supabase.com](https://supabase.com), then apply the schema. Either paste each file in `supabase/migrations/` into the SQL editor, oldest first, or with the Supabase CLI run `supabase link` and `supabase db push`.
3. In the Supabase dashboard, open Authentication > Sign In / Providers > Phone and turn it on. Without an SMS provider yet, add a test number such as `919800000001=123456` under "Test Phone Numbers and OTPs".
4. Copy `.env.example` to `.env` and fill in the project URL and publishable key from Project Settings > API.
5. Start the app with `npx expo start` and open it in Expo Go on your phone.

To run everything locally instead, `supabase start` uses `supabase/config.toml`, which already has test numbers.

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
