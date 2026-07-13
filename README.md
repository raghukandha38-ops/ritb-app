# RITB — Reading Habit Portal

A real, standalone web app: students and faculty sign up once with an email and
password, then log in with the same credentials from then on. Students log
their reading; faculty/admin see the whole roster.

No Claude account or download is needed to use it — this runs as an ordinary
website once deployed.

## What's inside

- `server.js` — Express backend (signup, login, reading logs, roster)
- `models/` — User and Log database schemas (MongoDB)
- `public/index.html` — the frontend (plain HTML/CSS/JS, no build step)
- Passwords are hashed with bcrypt before being stored. Sessions use a signed
  JWT stored in the browser, valid for 90 days.

## Step 1 — Create a free database (MongoDB Atlas)

1. Go to https://www.mongodb.com/cloud/atlas/register and create a free account.
2. Create a new **free (M0) cluster** — any provider/region is fine.
3. Under **Database Access**, add a database user with a username and password
   (save these — you'll need them).
4. Under **Network Access**, add IP address `0.0.0.0/0` (allow access from
   anywhere) so Render can reach it.
5. Click **Connect** on your cluster → **Drivers** → copy the connection
   string. It looks like:
   `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/ritb?retryWrites=true&w=majority`
   Replace `<username>` and `<password>` with the database user you created in
   step 3, and make sure a database name is in the path (e.g. `/ritb`).

## Step 2 — Put this code on GitHub

1. Create a new repository on GitHub (e.g. `ritb-app`).
2. Upload everything in this folder to that repository (drag-and-drop on
   GitHub's web UI works fine, or use `git push` if you're comfortable with
   git).

## Step 3 — Deploy on Render (free)

1. Go to https://render.com and sign up (you can sign in with GitHub).
2. Click **New +** → **Web Service** → connect the `ritb-app` repository.
3. Settings:
   - **Runtime**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free
4. Under **Environment Variables**, add:
   - `MONGODB_URI` = the connection string from Step 1
   - `JWT_SECRET` = any long random string (e.g. mash your keyboard for 40
     characters — this signs login sessions, keep it secret)
5. Click **Create Web Service**. Render will install dependencies and start
   the app. After a minute or two you'll get a live URL like:
   `https://ritb-app.onrender.com`

That URL is what you share with students — anyone can open it, sign up once,
and log back in with the same email and password afterward.

## Running it on your own computer first (optional, to test)

```
npm install
cp .env.example .env
# edit .env and paste in your MongoDB URI and a JWT secret
npm start
```

Then open http://localhost:3000

## Book library (admin uploads, students read)

Faculty/Admin accounts now see an **Upload a book** panel — title, author, and a
file picker (PDF, EPUB, DOC, DOCX, TXT). Uploaded files are stored inside your
MongoDB database itself (via GridFS), so there's no extra service to set up.

Every logged-in user (student or admin) sees a **Library** section listing all
uploaded books with a **Read** link that opens the file in a new tab. Admins
also get a **Remove** link to delete a book.

Limits to know:
- Each file is capped at 20MB.
- MongoDB Atlas's free (M0) tier gives you 512MB of total storage — plenty for
  a modest library of PDFs, but keep an eye on it if you're uploading many
  large scanned books. You can check usage under your cluster's **Metrics**
  tab in Atlas.

## Automatic reading tracking

For books uploaded as PDFs, students read them in a built-in page-by-page
viewer (powered by pdf.js) instead of a separate tab. While they read:

- **Pages are logged automatically.** Turning a page updates that day's
  reading log — no manual typing needed. Reopening a book later resumes from
  the last page reached.
- **Reading time is tracked per book**, and total time active in the app per
  day is tracked separately. Both show up on the admin roster as "Reading
  time" and "Active today."

This only works for PDFs read inside the app. Other file types (EPUB, DOC,
DOCX, TXT) still open in a new tab, and books read outside the library
(physical copies, other apps) still use the manual "Log today's reading"
form — which now includes a dropdown to auto-fill the title from the library.

No camera, microphone, or any device sensor is used — tracking is limited to
which page is open and whether the browser tab is visible and focused, the
same way any e-reader tracks reading progress.

## Three account types: Student, Faculty, Admin

- **Student** — reads books, tracked automatically, sees badges/leaderboard/progress
- **Faculty** — can upload and remove books in the library, sees the leaderboard,
  but does **not** see the student roster, admin accounts, or password-reset
  controls
- **Admin** — everything Faculty can do, plus the full student roster, the
  ability to reset any student's or admin's password, and the Admin accounts
  list

Both Faculty and Admin sign-up are locked behind separate invite codes, so
you control who gets each level of access independently.

**To open up Faculty sign-up**, add one more environment variable on Render:
- Key: `FACULTY_INVITE_CODE`
- Value: any word/phrase you choose, e.g. `RITB-Faculty-2026`

Share this code only with teaching staff. `ADMIN_INVITE_CODE` (set earlier)
continues to control who can register as a full Admin — keep that one more
tightly held since Admins can reset anyone's password.

If either variable isn't set, sign-up for that role is disabled entirely
(safer default) until you add it.

## Password management (no email required)

Since there's no domain set up for sending real emails, forgot-password works
through the people already in the app instead:

- **Change password** — anyone logged in (student or admin) can change their
  own password anytime from their dashboard.
- **Admin resets a student's password** — one click from the roster ("Reset
  password"), admin sets a new password and shares it with the student
  directly (in person, WhatsApp, whatever you already use).
- **Admins reset each other's passwords** — the admin dashboard has an
  "Admin accounts" list so one admin can help another who's locked out.

**Last-resort recovery** (for the rare case where there's only one admin and
they're locked out too): a hidden, secret-protected emergency reset. This is
not exposed anywhere in the app — it's an API call only you would use.

**To set it up:**
1. On Render → `ritb-app` → **Environment**, add:
   - Key: `SUPER_RESET_SECRET`
   - Value: a long random phrase only you know (treat it like a master key)
2. If you ever need it, run this from any terminal with internet access
   (replace the bracketed parts):

   ```
   curl -X POST https://ritb-app.onrender.com/api/auth/emergency-reset \
     -H "Content-Type: application/json" \
     -d "{\"email\":\"[locked-out admin's email]\",\"newPassword\":\"[a new password]\",\"secret\":\"[your SUPER_RESET_SECRET]\"}"
   ```

If you don't set `SUPER_RESET_SECRET`, this endpoint simply refuses to do
anything — it's opt-in and harmless to leave unset if you never expect to
need it.

## Click-to-define dictionary

While reading a book in the in-app viewer, students can **double-click any
word** to see its meaning in a small popup — part of speech and a short
definition, right where they're reading. No need to leave the page or search
elsewhere.

This uses the free, no-signup Dictionary API (dictionaryapi.dev). A few things
worth knowing:
- It only covers standard English words — names, made-up words, or heavily
  stylized text in a scanned PDF may come back as "No definition found."
- It requires an internet connection each time a word is looked up (nothing
  is stored or pre-downloaded).
- It's a free community-run service with no guaranteed uptime — if it's ever
  slow or down, the popup will say it couldn't reach the dictionary, but the
  rest of the reader keeps working normally.

## Making reading engaging (gamification)

**Badges** — students automatically earn badges for streaks (3, 7, 14, 30 days)
and page milestones (100, 500, 1000, 2500 pages). These show up right on the
student dashboard as they're earned, no admin setup needed.

**Leaderboard** — top 5 students by total pages read, visible to everyone
(students and admins). If a student isn't in the top 5, they still see their
own rank below the list, so there's always something to see.

**Currently reading** — a card per book-in-progress with a visual progress
bar (page X of Y, percent complete) and a "Continue reading" button that
drops them right back into the in-app reader at their last page.

**Reading chart** — a 14-day bar chart on the student dashboard showing pages
read per day, so progress (and gaps) are easy to see at a glance.

## Locking down Faculty/Admin sign-ups

By default, anyone could sign up choosing "Faculty/Admin" from the same
screen students use. That's now locked behind an invite code.

**To turn it on**, add one more environment variable on Render (same place
you added `MONGODB_URI` and `JWT_SECRET`):

- `ADMIN_INVITE_CODE` = any word or phrase you choose, e.g. `RITB-Faculty-2026`

Only share this code with actual faculty/admin staff. Anyone signing up as
Faculty/Admin without it (or with the wrong code) will be rejected. Students
signing up as Students are unaffected — no code needed for them.

If you don't set this variable at all, Faculty/Admin sign-up is disabled
entirely (safer default) until you add it.

## Notes and limits

- **Free Render tier sleeps** after 15 minutes of no traffic, so the first
  visit after a quiet period takes ~30–50 seconds to wake up. Fine for a
  college project; if that's a problem later, a paid Render instance removes
  the sleep.
- **Admin accounts**: anyone can currently sign up as "Faculty/Admin" from the
  sign-up screen. If you want to restrict who can register as admin, tell me
  and I'll add an approval step or a fixed admin invite code.
- **No password reset flow yet** — if someone forgets their password, there's
  currently no self-serve way to reset it. Happy to add an email-based reset
  if you want to wire up an email service (e.g. Resend, SendGrid).
- **Data is real and persistent** — unlike the earlier prototype, this is a
  genuine database. It will not reset when the server restarts or redeploys.
