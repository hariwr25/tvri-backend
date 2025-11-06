const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root', // sesuaikan dengan user MySQL kamu
  password: '', // kosongkan jika root tanpa password
  database: 'tvri_db' // pastikan ini nama database kamu
});

db.connect(err => {
  if (err) {
    console.error('Gagal konek ke database:', err);
  } else {
    console.log('✅ Terhubung ke database MySQL');
  }
});

module.exports = db;
