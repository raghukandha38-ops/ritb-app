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
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Faculty/admin access only.' });
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
    const role = req.body.role === 'admin' ? 'admin' : 'student';
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
        return res.status(403).json({ error: 'Faculty/Admin sign-up is not open right now. Contact your site administrator.' });
      }
      if ((req.body.adminCode || '').trim() !== inviteCode) {
        return res.status(403).json({ error: 'Incorrect admin invite code.' });
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

app.post('/api/books', authMiddleware, adminOnly, upload.single('file'), async (req, res) => {
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
        uploadedBy: req.user.email
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

app.get('/api/books', authMiddleware, async (req, res) => {
  const books = await Book.find().sort({ createdAt: -1 });
  res.json({
    books: books.map(b => ({
      id: b._id, title: b.title, author: b.author, filename: b.filename,
      size: b.size, createdAt: b.createdAt, uploadedBy: b.uploadedBy
    }))
  });
});

app.get('/api/books/:id/file', authMiddleware, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found.' });
    res.set('Content-Type', book.contentType);
    res.set('Content-Disposition', 'inline; filename="' + book.filename.replace(/"/g, '') + '"');
    gfsBucket.openDownloadStream(book.fileId)
      .on('error', () => res.status(404).end())
      .pipe(res);
  } catch (e) {
    res.status(400).json({ error: 'Could not open that file.' });
  }
});

app.delete('/api/books/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found.' });
    await gfsBucket.delete(book.fileId).catch(() => {});
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

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log('RITB server running on port ' + PORT));
