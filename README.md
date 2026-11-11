# Tempo

A small static day planner: task list, focus timer, Friday checklist, optional accounts via Supabase.

## Timer features

- Pomodoro with focus, short break and long break (long break every N sessions)
- Stopwatch with laps
- Accurate in background tabs and after a reload (it works from the clock, not from counting ticks)
- Auto-start for breaks and focus, chime (made with the Web Audio API, no audio files), optional browser notification
- Pick which task you're working on; sessions are logged against it
- Focus history: today, last 7 days, streak, 7-day bar chart, CSV download
- Keyboard shortcuts: Space, R, S, L, F, 1-4
- Fullscreen mode, custom lengths, everything remembered in the browser

Without an account everything is stored in the browser, so the site works as soon as it's uploaded.

## Put it on GitHub Pages

1. Unzip and upload the files to the root of your repository.
2. Repository Settings → Pages → deploy from the `main` branch, `/ (root)`.
3. Open `https://<your-username>.github.io/<repo-name>/`.

## Turn on accounts (optional)

1. Create a Supabase project.
2. Run `supabase-schema.sql` in the SQL Editor.
3. Authentication → enable Email and Google.
4. Create a Google OAuth web client and add the Supabase callback URL.
5. Put your project URL and **anon/public** key in `config.js`.
6. In Supabase Authentication → URL Configuration, add your Pages URL as the site URL and a redirect URL.

## Keep secret

Never put a service-role key, Google client secret, database password or any token in these files. Leave row level security on.

## Contact

ferdinamaeybinu@gmail.com
