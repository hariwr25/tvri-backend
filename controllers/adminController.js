const db = require('../db');
const bcrypt = require('bcrypt');

// 🔐 Login Admin (sudah ada)
exports.loginAdmin = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username dan password wajib diisi.' });
  }

  const sql = 'SELECT * FROM admin WHERE username = ?';
  db.query(sql, [username], async (err, results) => {
    if (err) {
      console.error('❌ Query error:', err);
      return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: 'Username tidak ditemukan.' });
    }

    const admin = results[0];

    try {
      const isMatch = await bcrypt.compare(password, admin.password);

      if (!isMatch) {
        return res.status(401).json({ message: 'Password salah.' });
      }

      // ✅ Login berhasil
      return res.status(200).json({
        message: 'Login berhasil.',
        user: {
          id: admin.id,
          username: admin.username,
          nama: admin.nama,
          email: admin.email,
          role: admin.role
        }
      });
    } catch (compareError) {
      console.error('❌ Error bcrypt:', compareError);
      return res.status(500).json({ message: 'Gagal membandingkan password.' });
    }
  });
};

// 📋 Get All Users
exports.getAllUsers = async (req, res) => {
  try {
    console.log('🔥 getAllUsers dipanggil');
    
    // Query sesuai struktur tabel existing: id, username, password, role
    const sql = 'SELECT id, username, role FROM admin ORDER BY id DESC';
    
    db.query(sql, (err, results) => {
      if (err) {
        console.error('❌ Query error:', err);
        return res.status(500).json({ message: 'Gagal mengambil data user.' });
      }

      console.log(`✅ Found ${results.length} users`);

      // Format data sesuai kebutuhan frontend
      const users = results.map(user => ({
        id: user.id,
        nama: user.username, // Gunakan username sebagai nama
        username: user.username,
        email: `${user.username}@admin.com`, // Generate email dummy
        role: user.role,
        aktif: true // Default aktif karena tidak ada kolom aktif
      }));

      return res.status(200).json(users);
    });
  } catch (error) {
    console.error('❌ Error getAllUsers:', error);
    return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
};

// ➕ Create New User
exports.createUser = async (req, res) => {
  try {
    console.log('🔥 createUser dipanggil dengan data:', req.body);
    
    const { nama, username, email, role, password, aktif = true } = req.body;

    // Validasi input (sesuaikan dengan kolom yang ada)
    if (!username || !role || !password) {
      return res.status(400).json({ message: 'Username, role, dan password wajib diisi.' });
    }

    // Validasi role
    const validRoles = ['superadmin', 'adminpkl', 'adminkunjungan'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Role tidak valid.' });
    }

    // Cek apakah username sudah ada
    const checkUsernameSql = 'SELECT id FROM admin WHERE username = ?';
    db.query(checkUsernameSql, [username], async (err, results) => {
      if (err) {
        console.error('❌ Query error:', err);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
      }

      if (results.length > 0) {
        return res.status(400).json({ message: 'Username sudah digunakan.' });
      }

      try {
        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert user baru (sertakan semua kolom yang NOT NULL)
        const nama = username; // Gunakan username sebagai nama
        const email = `${username}@admin.com`; // Generate email dari username
        
        const insertSql = 'INSERT INTO admin (nama, username, password, email, role, aktif) VALUES (?, ?, ?, ?, ?, ?)';
        console.log('🔥 SQL Query:', insertSql);
        console.log('🔥 SQL Values:', [nama, username, 'HASHED_PASSWORD', email, role, aktif ? 1 : 0]);
        
        db.query(insertSql, [nama, username, hashedPassword, email, role, aktif ? 1 : 0], (insertErr, result) => {
          if (insertErr) {
            console.error('❌ Insert error:', insertErr);
            console.error('❌ Insert error code:', insertErr.code);
            console.error('❌ Insert error message:', insertErr.message);
            return res.status(500).json({ message: 'Gagal menambahkan user.' });
          }

          console.log('✅ User created dengan ID:', result.insertId);

          return res.status(201).json({
            message: 'User berhasil ditambahkan.',
            user: {
              id: result.insertId,
              nama: username,
              username: username,
              email: `${username}@admin.com`,
              role: role,
              aktif: true
            }
          });
        });
      } catch (hashError) {
        console.error('❌ Hash error:', hashError);
        return res.status(500).json({ message: 'Gagal mengenkripsi password.' });
      }
    });
  } catch (error) {
    console.error('❌ Error createUser:', error);
    return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
};

// ✏️ Update User
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, username, email, role, password, aktif } = req.body;

    // Validasi input
    if (!nama || !username || !email || !role) {
      return res.status(400).json({ message: 'Nama, username, email, dan role wajib diisi.' });
    }

    // Validasi role
    const validRoles = ['superadmin', 'adminpkl', 'adminkunjungan'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Role tidak valid.' });
    }

    // Cek apakah user exist
    const checkUserSql = 'SELECT id FROM admin WHERE id = ?';
    db.query(checkUserSql, [id], (err, results) => {
      if (err) {
        console.error('❌ Query error:', err);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: 'User tidak ditemukan.' });
      }

      // Cek duplikasi username (kecuali user ini sendiri)
      const checkDuplicateSql = 'SELECT id FROM admin WHERE (username = ? OR email = ?) AND id != ?';
      db.query(checkDuplicateSql, [username, email, id], async (checkErr, duplicateResults) => {
        if (checkErr) {
          console.error('❌ Query error:', checkErr);
          return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
        }

        if (duplicateResults.length > 0) {
          return res.status(400).json({ message: 'Username atau email sudah digunakan.' });
        }

        try {
          let updateSql, updateParams;

          if (password) {
            // Jika password diubah
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            updateSql = 'UPDATE admin SET nama = ?, username = ?, email = ?, role = ?, password = ?, aktif = ? WHERE id = ?';
            updateParams = [nama, username, email, role, hashedPassword, aktif ? 1 : 0, id];
          } else {
            // Jika password tidak diubah
            updateSql = 'UPDATE admin SET nama = ?, username = ?, email = ?, role = ?, aktif = ? WHERE id = ?';
            updateParams = [nama, username, email, role, aktif ? 1 : 0, id];
          }

          db.query(updateSql, updateParams, (updateErr) => {
            if (updateErr) {
              console.error('❌ Update error:', updateErr);
              return res.status(500).json({ message: 'Gagal mengupdate user.' });
            }

            return res.status(200).json({
              message: 'User berhasil diupdate.',
              user: {
                id: parseInt(id),
                nama,
                username,
                email,
                role,
                aktif: Boolean(aktif)
              }
            });
          });
        } catch (hashError) {
          console.error('❌ Hash error:', hashError);
          return res.status(500).json({ message: 'Gagal mengenkripsi password.' });
        }
      });
    });
  } catch (error) {
    console.error('❌ Error updateUser:', error);
    return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
};

// 🗑️ Delete User
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Cek apakah user exist
    const checkUserSql = 'SELECT id, username FROM admin WHERE id = ?';
    db.query(checkUserSql, [id], (err, results) => {
      if (err) {
        console.error('❌ Query error:', err);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: 'User tidak ditemukan.' });
      }

      // Hapus user
      const deleteSql = 'DELETE FROM admin WHERE id = ?';
      db.query(deleteSql, [id], (deleteErr) => {
        if (deleteErr) {
          console.error('❌ Delete error:', deleteErr);
          return res.status(500).json({ message: 'Gagal menghapus user.' });
        }

        return res.status(200).json({ message: 'User berhasil dihapus.' });
      });
    });
  } catch (error) {
    console.error('❌ Error deleteUser:', error);
    return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
};

// 🔄 Toggle User Status
exports.toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    // Cek user dan ambil status saat ini
    const checkUserSql = 'SELECT id, aktif, nama FROM admin WHERE id = ?';
    db.query(checkUserSql, [id], (err, results) => {
      if (err) {
        console.error('❌ Query error:', err);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: 'User tidak ditemukan.' });
      }

      const user = results[0];
      const newStatus = user.aktif ? 0 : 1;

      // Update status
      const updateSql = 'UPDATE admin SET aktif = ? WHERE id = ?';
      db.query(updateSql, [newStatus, id], (updateErr) => {
        if (updateErr) {
          console.error('❌ Update error:', updateErr);
          return res.status(500).json({ message: 'Gagal mengubah status user.' });
        }

        return res.status(200).json({
          message: `Status user ${user.nama} berhasil ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}.`,
          user: {
            id: parseInt(id),
            aktif: Boolean(newStatus)
          }
        });
      });
    });
  } catch (error) {
    console.error('❌ Error toggleUserStatus:', error);
    return res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
};

// 🔑 CHANGE PASSWORD - METHOD BARU
exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    
    console.log('🔐 Change Password Request Received:', {
      current_password: current_password ? '***' : 'MISSING',
      new_password: new_password ? '***' : 'MISSING', 
      confirm_password: confirm_password ? '***' : 'MISSING'
    });

    // VALIDASI INPUT - HANYA UNTUK PASSWORD
    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ 
        success: false,
        message: 'Current password, new password, dan confirm password harus diisi' 
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ 
        success: false,
        message: 'Password baru minimal 6 karakter' 
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ 
        success: false,
        message: 'Password baru dan konfirmasi password tidak cocok' 
      });
    }

    // NOTE: Karena ini Node.js/Express tanpa JWT, kita perlu cara lain
    // untuk mengetahui user yang sedang login. Untuk sementara,
    // kita akan menggunakan username dari body atau headers
    
    const username = req.body.username || req.headers.username;
    
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username tidak ditemukan. Silakan login ulang.'
      });
    }

    console.log('👤 Changing password for user:', username);

    // Cari user di database
    const findUserSql = 'SELECT * FROM admin WHERE username = ?';
    db.query(findUserSql, [username], async (err, results) => {
      if (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({
          success: false,
          message: 'Terjadi kesalahan pada server.'
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User tidak ditemukan.'
        });
      }

      const user = results[0];

      // Verifikasi password lama
      try {
        const isCurrentPasswordValid = await bcrypt.compare(current_password, user.password);
        
        if (!isCurrentPasswordValid) {
          return res.status(401).json({
            success: false,
            message: 'Password saat ini salah'
          });
        }

        // Hash password baru
        const saltRounds = 10;
        const hashedNewPassword = await bcrypt.hash(new_password, saltRounds);

        // Update password di database
        const updateSql = 'UPDATE admin SET password = ? WHERE username = ?';
        db.query(updateSql, [hashedNewPassword, username], (updateErr) => {
          if (updateErr) {
            console.error('❌ Update password error:', updateErr);
            return res.status(500).json({
              success: false,
              message: 'Gagal mengupdate password.'
            });
          }

          console.log('✅ Password berhasil diubah untuk user:', username);

          return res.status(200).json({
            success: true,
            message: 'Password berhasil diubah!'
          });
        });

      } catch (bcryptError) {
        console.error('❌ Bcrypt error:', bcryptError);
        return res.status(500).json({
          success: false,
          message: 'Gagal memverifikasi password.'
        });
      }
    });

  } catch (error) {
    console.error('❌ Error changePassword:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server.'
    });
  }
};