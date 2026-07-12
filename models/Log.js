const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, lowercase: true, index: true },
  book: { type: String, required: true },
  pages: { type: Number, required: true },
  date: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Log', logSchema);
