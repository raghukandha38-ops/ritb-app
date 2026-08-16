require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const User = require('./models/User');
const Log = require('./models/Log');
const Book = require('./models/Book');
const Progress = require('./models/Progress');
const ActivityDay = require('./models/ActivityDay');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-before-deploying';
const PORT = process.env.PORT || 3000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

let gfsBucket;

if (!process.env.MONGODB_URI) {
  console.warn('Warning: MONGODB_URI is not set. The server will not be able to reach a database.');
} else {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err.message));

  mongoose.connection.once('open', () => {
    gfsBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'books' });
    console.log('Book file storage ready');
  });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const headerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = headerToken || req.query.token;
  if (!token) return res.status(401).json({ error: 'Log in to continue.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Your session expired. Log in again.' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only.' });
  next();
}

function facultyOrAdmin(req, res, next) {
  if (req.user.role !== 'faculty' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Faculty or Admin access only.' });
  }
  next();
}

function computeStreak(dates) {
  const set = new Set(dates);
  let streak = 0;
  const d = new Date();
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (set.has(key)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '90d' }
  );
}

function publicUser(user) {
  return { name: user.name, email: user.email, role: user.role, cls: user.cls };
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const confirm = req.body.confirm || '';
    const roleInput = req.body.role;
    const role = ['faculty', 'admin'].includes(roleInput) ? roleInput : 'student';
    const cls = (req.body.cls || '').trim();

    if (!name || !email || !password || !confirm) {
      return res.status(400).json({ error: 'Fill in every required field.' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password needs at least 6 characters.' });
    }
    if (password !== confirm) {
      return res.status(400).json({ error: "Passwords don't match." });
    }
    if (role === 'admin') {
      const inviteCode = process.env.ADMIN_INVITE_CODE;
      if (!inviteCode) {
        return res.status(403).json({ error: 'Admin sign-up is not open right now. Contact your site administrator.' });
      }
      if ((req.body.adminCode || '').trim() !== inviteCode) {
        return res.status(403).json({ error: 'Incorrect admin invite code.' });
      }
    }
    if (role === 'faculty') {
      const inviteCode = process.env.FACULTY_INVITE_CODE;
      if (!inviteCode) {
        return res.status(403).json({ error: 'Faculty sign-up is not open right now. Contact your site administrator.' });
      }
      if ((req.body.facultyCode || '').trim() !== inviteCode) {
        return res.status(403).json({ error: 'Incorrect faculty invite code.' });
      }
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'That email is already registered. Log in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash, role, cls });
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong creating the account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    if (!email || !password) {
      return res.status(400).json({ error: 'Enter both email and password.' });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'No account with that email yet. Sign up first.' });
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed. Try again.' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const currentPassword = req.body.currentPassword || '';
    const newPassword = req.body.newPassword || '';
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password needs at least 6 characters.' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not change the password.' });
  }
});

app.get('/api/admins', authMiddleware, adminOnly, async (req, res) => {
  const admins = await User.find({ role: 'admin', email: { $ne: req.user.email } });
  res.json({ admins: admins.map(a => ({ name: a.name, email: a.email })) });
});

app.post('/api/admin/reset-password', authMiddleware, adminOnly, async (req, res) => {
  try {
    const targetEmail = (req.body.targetEmail || '').trim().toLowerCase();
    const newPassword = req.body.newPassword || '';
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password needs at least 6 characters.' });
    }
    const target = await User.findOne({ email: targetEmail });
    if (!target) return res.status(404).json({ error: 'No account with that email.' });
    target.passwordHash = await bcrypt.hash(newPassword, 10);
    await target.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not reset that password.' });
  }
});

app.post('/api/auth/emergency-reset', async (req, res) => {
  try {
    const secret = process.env.SUPER_RESET_SECRET;
    if (!secret) return res.status(403).json({ error: 'Emergency reset is not configured on this server.' });
    if ((req.body.secret || '') !== secret) return res.status(403).json({ error: 'Incorrect secret.' });
    const email = (req.body.email || '').trim().toLowerCase();
    const newPassword = req.body.newPassword || '';
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password needs at least 6 characters.' });
    }
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'No account with that email.' });
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Emergency reset failed.' });
  }
});

async function computeStudentStats() {
  const students = await User.find({ role: 'student' });
  const today = new Date().toISOString().slice(0, 10);
  const results = [];

  for (const s of students) {
    const logs = await Log.find({ userEmail: s.email });
    const pages = logs.reduce((sum, l) => sum + l.pages, 0);
    const progresses = await Progress.find({ userEmail: s.email });
    const readingMinutes = progresses.reduce((sum, p) => sum + p.minutesReading, 0);
    const activity = await ActivityDay.findOne({ userEmail: s.email, date: today });

    results.push({
      name: s.name,
      email: s.email,
      cls: s.cls,
      streak: computeStreak(logs.map(l => l.date)),
      sessions: logs.length,
      pages,
      readingMinutes: Math.round(readingMinutes),
      activeMinutesToday: activity ? Math.round(activity.minutes) : 0
    });
  }

  results.sort((a, b) => b.pages - a.pages);
  return results;
}

app.get('/api/roster', authMiddleware, adminOnly, async (req, res) => {
  const stats = await computeStudentStats();
  const totalPages = stats.reduce((sum, s) => sum + s.pages, 0);
  const totalSessions = stats.reduce((sum, s) => sum + s.sessions, 0);
  res.json({ students: stats, totalStudents: stats.length, totalPages, totalSessions });
});

app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  const stats = await computeStudentStats();
  const top5 = stats.slice(0, 5).map((s, i) => ({
    rank: i + 1, name: s.name, cls: s.cls, pages: s.pages, streak: s.streak
  }));
  let mine = null;
  if (req.user.role === 'student') {
    const idx = stats.findIndex(s => s.email === req.user.email);
    if (idx >= 0) mine = { rank: idx + 1, pages: stats[idx].pages, streak: stats[idx].streak };
  }
  res.json({ top5, mine });
});

app.get('/api/logs', authMiddleware, async (req, res) => {
  const logs = await Log.find({ userEmail: req.user.email }).sort({ date: -1 });
  res.json({ logs });
});

app.post('/api/logs', authMiddleware, async (req, res) => {
  const book = (req.body.book || '').trim();
  const pages = Number(req.body.pages);
  const date = (req.body.date || '').trim() || new Date().toISOString().slice(0, 10);

  if (!book || !pages || isNaN(pages) || pages <= 0) {
    return res.status(400).json({ error: 'Enter a book title and a valid page count.' });
  }
  const log = await Log.create({ userEmail: req.user.email, book, pages, date });
  res.json({ log });
});

app.post('/api/books', authMiddleware, facultyOrAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!gfsBucket) return res.status(503).json({ error: 'Storage is not ready yet. Try again in a moment.' });
    const title = (req.body.title || '').trim();
    const author = (req.body.author || '').trim();
    if (!title || !author) {
      return res.status(400).json({ error: 'Enter both a book title and an author.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Choose a file to upload.' });
    }

    const uploadStream = gfsBucket.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype
    });
    uploadStream.end(req.file.buffer);

    uploadStream.on('finish', async () => {
      const book = await Book.create({
        title,
        author,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        fileId: uploadStream.id,
        size: req.file.size,
        uploadedBy: req.user.email,
        sourceType: 'upload'
      });
      res.json({ book: { id: book._id, title: book.title, author: book.author, filename: book.filename, size: book.size, createdAt: book.createdAt } });
    });

    uploadStream.on('error', () => {
      res.status(500).json({ error: 'Upload failed. Try again.' });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed. Try again.' });
  }
});

app.post('/api/books/link', authMiddleware, facultyOrAdmin, async (req, res) => {
  try {
    const title = (req.body.title || '').trim();
    const author = (req.body.author || '').trim();
    const url = (req.body.url || '').trim();
    if (!title || !author || !url) {
      return res.status(400).json({ error: 'Enter a title, author, and link.' });
    }
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Link must start with http:// or https://' });
    }
    const book = await Book.create({
      title, author, uploadedBy: req.user.email,
      sourceType: 'link', externalUrl: url
    });
    res.json({ book: { id: book._id, title: book.title, author: book.author, createdAt: book.createdAt } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not add that link.' });
  }
});

app.get('/api/books', authMiddleware, async (req, res) => {
  const books = await Book.find().sort({ createdAt: -1 });
  res.json({
    books: books.map(b => ({
      id: b._id, title: b.title, author: b.author, filename: b.filename,
      size: b.size, createdAt: b.createdAt, uploadedBy: b.uploadedBy,
      sourceType: b.sourceType, externalUrl: b.externalUrl
    }))
  });
});

app.get('/api/books/:id/file', authMiddleware, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found.' });
    if (book.sourceType === 'link') return res.status(400).json({ error: 'This book is an external link, not a stored file.' });
    res.set('Content-Type', book.contentType);
    res.set('Content-Disposition', 'inline; filename="' + book.filename.replace(/"/g, '') + '"');
    gfsBucket.openDownloadStream(book.fileId)
      .on('error', () => res.status(404).end())
      .pipe(res);
  } catch (e) {
    res.status(400).json({ error: 'Could not open that file.' });
  }
});

app.delete('/api/books/:id', authMiddleware, facultyOrAdmin, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found.' });
    if (book.sourceType === 'upload' && book.fileId) {
      await gfsBucket.delete(book.fileId).catch(() => {});
    }
    await book.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete that book.' });
  }
});

app.post('/api/reading/heartbeat', authMiddleware, async (req, res) => {
  try {
    const bookId = req.body.bookId;
    const currentPage = Math.max(1, Math.floor(Number(req.body.currentPage) || 1));
    const totalPages = Math.max(0, Math.floor(Number(req.body.totalPages) || 0));
    const seconds = Math.max(0, Math.min(120, Number(req.body.seconds) || 0));
    const book = await Book.findById(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found.' });

    if (totalPages > 0 && book.totalPages !== totalPages) {
      book.totalPages = totalPages;
      await book.save();
    }

    let progress = await Progress.findOne({ userEmail: req.user.email, bookId });
    if (!progress) {
      progress = new Progress({
        userEmail: req.user.email, bookId,
        bookTitle: book.title, bookAuthor: book.author,
        maxPage: 0, totalPages: book.totalPages, minutesReading: 0
      });
    }
    if (totalPages > 0) progress.totalPages = totalPages;
    const delta = currentPage > progress.maxPage ? currentPage - progress.maxPage : 0;
    progress.maxPage = Math.max(progress.maxPage, currentPage);
    progress.minutesReading += seconds / 60;
    progress.lastReadAt = new Date();
    await progress.save();

    if (delta > 0) {
      const date = new Date().toISOString().slice(0, 10);
      const existing = await Log.findOne({ userEmail: req.user.email, book: book.title, date, auto: true });
      if (existing) {
        existing.pages += delta;
        await existing.save();
      } else {
        await Log.create({ userEmail: req.user.email, book: book.title, pages: delta, date, auto: true });
      }
    }
    res.json({ ok: true, maxPage: progress.maxPage });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save reading progress.' });
  }
});

app.get('/api/reading/progress/:bookId', authMiddleware, async (req, res) => {
  const progress = await Progress.findOne({ userEmail: req.user.email, bookId: req.params.bookId });
  res.json({ maxPage: progress ? progress.maxPage : 0 });
});

app.get('/api/reading/mine', authMiddleware, async (req, res) => {
  const progresses = await Progress.find({ userEmail: req.user.email }).sort({ lastReadAt: -1 });
  res.json({
    items: progresses.map(p => ({
      bookId: p.bookId, title: p.bookTitle, author: p.bookAuthor,
      maxPage: p.maxPage, totalPages: p.totalPages
    }))
  });
});

app.post('/api/activity/heartbeat', authMiddleware, async (req, res) => {
  const seconds = Math.max(0, Math.min(120, Number(req.body.seconds) || 0));
  const date = new Date().toISOString().slice(0, 10);
  await ActivityDay.findOneAndUpdate(
    { userEmail: req.user.email, date },
    { $inc: { minutes: seconds / 60 } },
    { upsert: true }
  );
  res.json({ ok: true });
});

const CHATBOT_FAQ = [
  {
    keywords: ['sign up', 'signup', 'create account', 'register', 'registration'],
    answer: "To sign up, click 'Sign up' on the login screen, fill in your name, email, class/department, and a password. Students can sign up freely. Faculty and Admin need an invite code from the site administrator."
  },
  {
    keywords: ['password', 'forgot password', 'reset password', 'locked out', "can't log in", 'cant log in', 'lost my password', 'change password'],
    answer: "If you're logged in, you can change your password anytime from the 'Change your password' section on your dashboard. If you're locked out: students should ask their Faculty/Admin to reset it from their dashboard, and Admins can ask another Admin to reset theirs."
  },
  {
    keywords: ['upload', 'add a book', 'add book', 'new book'],
    answer: "Faculty and Admin accounts can upload a book from their dashboard: enter the title, author, and choose a file (PDF, EPUB, DOC, DOCX, or TXT). You can also add a book as a link to a free book hosted elsewhere instead of uploading a file."
  },
  {
    keywords: ['read', 'reader', 'open a book', 'open book', 'page', 'pages'],
    answer: "Click 'Read' on any book in the Library. PDFs open in the built-in reader with Previous/Next buttons, and it automatically remembers the last page you were on."
  },
  {
    keywords: ['dictionary', 'meaning', 'mean', 'define', 'definition', 'word meaning', 'look up a word'],
    answer: "While reading a PDF in the app, double-click any word to see its meaning in a small popup — no need to leave the page."
  },
  {
    keywords: ['badge', 'badges', 'streak', 'streaks', 'milestone', 'milestones'],
    answer: "You earn badges automatically for reading streaks (3, 7, 14, 30 days) and page milestones (100, 500, 1000, 2500 pages). Check your dashboard to see which ones you've unlocked."
  },
  {
    keywords: ['leaderboard', 'rank', 'ranking', 'top reader', 'top readers'],
    answer: "The leaderboard shows the top 5 readers by total pages read, with a podium for the top 3. If you're not in the top 5, your own rank still shows below the list."
  },
  {
    keywords: ['progress', 'currently reading'],
    answer: "Your 'Currently reading' section shows a progress bar for each book you've started, with a 'Continue reading' button that jumps back to your last page."
  },
  {
    keywords: ['faculty', 'admin', 'role', 'roles', 'student account', 'account type'],
    answer: "There are three account types: Student (reads and tracks progress), Faculty (can upload/manage books), and Admin (everything Faculty can do, plus managing the student roster and resetting passwords)."
  },
  {
    keywords: ['link', 'external', 'online book', 'ndli', 'openstax'],
    answer: "Faculty/Admin can add a book as a link to a free book hosted elsewhere (like NDLI or OpenStax) instead of uploading a file. It'll show an 'External' tag and open the original site when read."
  },
  {
    keywords: ['what can you do', 'help', 'what is ritb', 'about ritb'],
    answer: "I can help with things like: signing up and logging in, uploading books, using the in-app reader, the dictionary, badges and streaks, the leaderboard, and password resets. What would you like to know?"
  }
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Scores a keyword phrase against a message: every word in the phrase must
// appear as a whole word somewhere in the message (not necessarily adjacent,
// and not as a substring of a longer word - e.g. "word" must not match
// inside "password"). Longer, more specific phrases score higher.
function keywordScore(msg, keyword) {
  const words = keyword.split(' ');
  for (const w of words) {
    const re = new RegExp('\\b' + escapeRegex(w) + '\\b', 'i');
    if (!re.test(msg)) return 0;
  }
  return words.length;
}

function matchFAQ(message) {
  const msg = message.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const entry of CHATBOT_FAQ) {
    let score = 0;
    for (const kw of entry.keywords) {
      score += keywordScore(msg, kw);
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best ? best.answer : null;
}

app.post('/api/chatbot', authMiddleware, async (req, res) => {
  const message = (req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Type a message first.' });

  const faqAnswer = matchFAQ(message);
  if (faqAnswer) {
    return res.json({ reply: faqAnswer, source: 'faq' });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const history = Array.isArray(req.body.history) ? req.body.history.slice(-6) : [];
      const messages = history
        .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
        .map(h => ({ role: h.role, content: h.content.slice(0, 1000) }));
      messages.push({ role: 'user', content: message.slice(0, 1000) });

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: 'You are the RITB Reading Assistant, a friendly helper inside a college reading-habit app called RITB. ' +
            'Help students, faculty, and admins with questions about reading, books, study habits, or using the app. ' +
            'Keep answers short (2-4 sentences), warm, and practical. If asked something unrelated to reading, books, ' +
            'studying, or the app, gently redirect back to what you can help with.',
          messages
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        const textBlock = (data.content || []).find(c => c.type === 'text');
        if (textBlock && textBlock.text) {
          return res.json({ reply: textBlock.text.trim(), source: 'ai' });
        }
      } else {
        console.error('Anthropic API error status:', resp.status);
      }
    } catch (e) {
      console.error('Chatbot AI error:', e.message);
    }
  }

  return res.json({
    reply: "I don't have an answer for that yet. I can help with signing up, uploading books, the reader, the dictionary, badges, the leaderboard, or password resets. For anything else, please contact your Faculty/Admin.",
    source: 'fallback'
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log('RITB server running on port ' + PORT));
