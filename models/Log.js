const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, lowercase: true, index: true },
  book: { type: String, required: true },
  pages: { type: Number, required: true },
  date: { type: String, required: true },
  auto: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Log', logSchema);
