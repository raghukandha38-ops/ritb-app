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

app.get('/api/roster', authMiddleware, adminOnly, async (req, res) => {
  const students = await User.find({ role: 'student' });
  const results = [];
  let totalPages = 0;
  let totalSessions = 0;

  for (const s of students) {
    const logs = await Log.find({ userEmail: s.email });
    const pages = logs.reduce((sum, l) => sum + l.pages, 0);
    totalPages += pages;
    totalSessions += logs.length;
    results.push({
      name: s.name,
      email: s.email,
      cls: s.cls,
      streak: computeStreak(logs.map(l => l.date)),
      sessions: logs.length,
      pages
    });
  }

  results.sort((a, b) => b.pages - a.pages);
  res.json({ students: results, totalStudents: students.length, totalPages, totalSessions });
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

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log('RITB server running on port ' + PORT));
