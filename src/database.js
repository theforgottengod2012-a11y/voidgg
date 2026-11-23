const mongoose = require('mongoose');

async function connectDatabase(uri) {
  if (!uri) throw new Error('MONGODB_URI is not configured.');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  mongoose.connection.on('error', (error) => console.error('[database] Connection error:', error.message));
  console.log('[database] Connected to MongoDB.');
}

module.exports = { connectDatabase };
