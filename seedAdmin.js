// seedAdmin.js
const bcrypt = require('bcrypt');
const db = require('./db'); // koneksi MySQL dari db.js

async function seedAdmin() {
  const admins = [
    {
      username: 'superadmin',
      password: 'super123',
      role: 'superadmin',
    },
    {
      username: 'adminpkl',
      password: 'pkl123',
      role: 'adminpkl',
    },
    {
      username: 'adminkunjungan',
      password: 'kunjungan123',
      role: 'adminkunjungan',
    },
  ];

  for (const admin of admins) {
    // Hash password
    const hashedPassword = await bcrypt.hash(admin.password, 10);

    // Insert to database
    db.query(
      'INSERT INTO admin (username, password, role) VALUES (?, ?, ?)',
      [admin.username, hashedPassword, admin.role],
      (err, result) => {
        if (err) {
          console.error(`Gagal insert ${admin.username}:`, err.message);
        } else {
          console.log(`Admin ${admin.username} berhasil ditambahkan.`);
        }
      }
    );
  }
}

seedAdmin();
