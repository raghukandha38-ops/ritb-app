const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  bookId: { type: mongoose.Schema.Types.ObjectId, required: true },
  bookTitle: { type: String, required: true },
  author: { type: String, required: true },
  uploadedByName: { type: String, required: true },
  uploadedByEmail: { type: String, required: true },
  targetClass: { type: String, default: 'All' }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
