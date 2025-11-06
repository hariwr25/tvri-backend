const mysql = require('mysql2');

// Gunakan koneksi dari environment Railway jika tersedia, jika tidak pakai lokal
const db = mysql.createConnection(
  process.env.MYSQL_URL || {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tvri_db',
  }
);

db.connect((err) => {
  if (err) {
    console.error('❌ Gagal konek ke database:', err);
  } else {
    console.log('✅ Terhubung ke database MySQL');
  }
});

module.exports = db;
