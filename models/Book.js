const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  author: { type: String, required: true, trim: true },
  filename: { type: String, required: true },
  contentType: { type: String, required: true },
  fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  size: { type: Number, default: 0 },
  uploadedBy: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Book', bookSchema);
