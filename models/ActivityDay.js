const mongoose = require('mongoose');

const activityDaySchema = new mongoose.Schema({
  userEmail: { type: String, required: true, lowercase: true, index: true },
  date: { type: String, required: true },
  minutes: { type: Number, default: 0 }
}, { timestamps: true });

activityDaySchema.index({ userEmail: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('ActivityDay', activityDaySchema);
