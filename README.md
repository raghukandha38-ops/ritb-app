# RITB — Reading Habit Portal

A real, standalone web app: students and faculty sign up once with an email
and password, then log in with the same credentials from then on. Students
log their reading; faculty/admin manage the library and roster.

No Claude account or download is needed to use it — this runs as an ordinary
website once deployed.

## What's inside

- `server.js` — Express backend (auth, books, reading tracking, chatbot)
- `models/` — Mongoose schemas (User, Log, Book, Progress, ActivityDay)
- `public/index.html` — the frontend (plain HTML/CSS/JS, no build step)
- Passwords are hashed with bcrypt. Sessions use a signed JWT stored in the
  browser, valid for 90 days.

## Step 1 — Create a free database (MongoDB Atlas)

1. Go to https://www.mongodb.com/cloud/atlas/register and create a free account.
2. Create a new **free (M0) cluster**.
3. Under **Database Access**, add a database user (username + password without
   special characters like `@ / : ?`, to keep the connection string simple).
4. Under **Network Access**, add `0.0.0.0/0` (allow access from anywhere).
5. Click **Connect** → **Drivers** → copy the connection string, e.g.
   `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/ritb?retryWrites=true&w=majority`
   Fill in your real username/password and make sure `/ritb` is in the path.

## Step 2 — Put this code on GitHub

Create a repo (e.g. `ritb-app`) and upload everything in this folder to it.

## Step 3 — Deploy on Render (free)

1. Go to https://render.com, sign in with GitHub.
2. **New +** → **Web Service** → connect your repo.
3. Settings: Runtime **Node**, Build command `npm install`, Start command
   `node server.js`, Instance type **Free**.
4. Add environment variables (see below), then **Create Web Service**.

You'll get a live URL like `https://ritb-app.onrender.com` to share with
students.

## Environment variables

| Key | Required? | What it does |
|---|---|---|
| `MONGODB_URI` | Yes | Your database connection string |
| `JWT_SECRET` | Yes | Any long random string, signs login sessions |
| `ADMIN_INVITE_CODE` | Optional | Lets people sign up as Admin with this code |
| `FACULTY_INVITE_CODE` | Optional | Lets people sign up as Faculty with this code |
| `SUPER_RESET_SECRET` | Optional | Enables emergency password recovery (see below) |
| `ANTHROPIC_API_KEY` | Optional | Enables the AI chatbot fallback (see below) |

Anything marked optional simply stays turned off if you don't set it — the
app works fine without them, just without that specific feature.

## RITB Assistant (chatbot)

Every logged-in user sees a chat bubble in the bottom-right corner. It works
in two layers:

1. **Free, built-in FAQ** — answers common questions (signing up, uploading
   books, using the reader, the dictionary, badges, the leaderboard,
   password resets) using simple keyword matching. No cost, no setup, always
   on.
2. **Optional AI fallback** — if a question doesn't match the FAQ *and*
   `ANTHROPIC_API_KEY` is set, the question is sent to Claude for a real
   conversational answer. If the key isn't set, unmatched questions get a
   friendly "I don't have an answer for that yet" message instead, pointing
   back to what the FAQ *can* help with.

**To enable the AI fallback**, add `ANTHROPIC_API_KEY` on Render (get one at
https://console.anthropic.com — this is a paid, metered service, same
consideration as before: check https://www.anthropic.com/pricing). Each
unmatched question costs a small fraction of a cent with the fast model
used here. Totally fine to leave this unset — the FAQ layer covers the most
common questions for free.

## Two ways to add books: upload a file, or link to one online

Faculty and Admin can either upload a file, or **add a book as an external
link** — useful for free books hosted on sites like NDLI, OpenStax, or
e-Gyankosh, where you'd rather point to the original than re-host it.

- **Uploaded files** get the full RITB experience: in-app reader, automatic
  page/time tracking, click-to-define dictionary.
- **External links** open on the original site in a new tab. They show an
  "External" tag in the library, but won't have in-app page tracking.

A reminder on sourcing free books: legitimate sources include NDLI
(ndl.iitkgp.ac.in), e-Gyankosh (IGNOU), SWAYAM/NPTEL, e-PG Pathshala,
OpenStax, LibreTexts, and the Open Textbook Library — all either open-licensed
or explicitly free to share. Avoid sites like PDF Drive, Z-Library, or
Library Genesis, which host copyrighted material without permission.

## Three account types: Student, Faculty, Admin

- **Student** — reads books, tracked automatically, sees badges/leaderboard/progress
- **Faculty** — can upload/remove books, sees the leaderboard, but not the
  student roster or admin controls
- **Admin** — everything Faculty can do, plus the full student roster,
  resetting anyone's password, and the Admin accounts list

Both Faculty and Admin sign-up are locked behind separate invite codes
(`FACULTY_INVITE_CODE` and `ADMIN_INVITE_CODE`), so you control who gets
each level of access independently.

## Password management (no email required)

- **Change password** — anyone logged in can change their own password.
- **Admin resets a student's password** — one click from the roster.
- **Admins reset each other's passwords** — via the Admin accounts list.
- **Emergency recovery** — a hidden, secret-protected last resort if there's
  only one admin and they're locked out. Set `SUPER_RESET_SECRET`, then run:

  ```
  curl -X POST https://ritb-app.onrender.com/api/auth/emergency-reset \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"[email]\",\"newPassword\":\"[new password]\",\"secret\":\"[your secret]\"}"
  ```

## Click-to-define dictionary

While reading a PDF in-app, double-click any word to see its meaning via the
free Dictionary API (dictionaryapi.dev) — no signup, no cost.

## Automatic reading tracking

For PDFs read in-app, pages and time are logged automatically as students
read — no manual entry. Resuming a book picks up where they left off.

## Making reading engaging (gamification)

- **Badges** for streaks (3/7/14/30 days) and page milestones (100/500/1000/2500)
- **Leaderboard** — top 5 readers by pages, shown as a gold/silver/bronze podium
- **Currently reading** cards with progress bars
- **14-day reading chart** on the student dashboard

## Notes and limits

- **Free Render tier sleeps** after 15 minutes of no traffic — first visit
  after a quiet period takes 30–50 seconds to wake up.
- File uploads are capped at 20MB each; MongoDB Atlas's free tier gives you
  512MB of total storage.
- Data is real and persistent — a genuine database, not reset on restarts.
