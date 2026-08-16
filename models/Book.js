const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  author: { type: String, required: true, trim: true },
  filename: { type: String, default: '' },
  contentType: { type: String, default: '' },
  fileId: { type: mongoose.Schema.Types.ObjectId },
  size: { type: Number, default: 0 },
  totalPages: { type: Number, default: 0 },
  uploadedBy: { type: String, required: true },
  sourceType: { type: String, enum: ['upload', 'link'], default: 'upload' },
  externalUrl: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Book', bookSchema);
