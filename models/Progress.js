const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, lowercase: true, index: true },
  bookId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  bookTitle: { type: String, required: true },
  bookAuthor: { type: String, default: '' },
  maxPage: { type: Number, default: 0 },
  totalPages: { type: Number, default: 0 },
  minutesReading: { type: Number, default: 0 },
  lastReadAt: { type: Date }
}, { timestamps: true });

progressSchema.index({ userEmail: 1, bookId: 1 }, { unique: true });

module.exports = mongoose.model('Progress', progressSchema);
