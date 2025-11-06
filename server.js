const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const db = require('./db');
const multer = require('multer');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Import routes
const adminRoutes = require('./routes/admin');
const kunjunganRoutes = require('./routes/kunjungan'); // TAMBAHAN BARU

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:8080', 
    'http://127.0.0.1:8080', 
    'http://192.168.18.155:8080'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Use admin routes
app.use('/api/admin', adminRoutes);

// TAMBAHAN BARU - Mount kunjungan routes dengan Socket.IO
app.use('/api/kunjungan', kunjunganRoutes(io));

// Import controller functions
const { getAllUsers, createUser, updateUser, deleteUser, toggleUserStatus } = require('./controllers/adminController');

// Alias routes for frontend compatibility
app.get('/api/users', getAllUsers);
app.post('/api/users', createUser);
app.put('/api/users/:id', updateUser);
app.delete('/api/users/:id', deleteUser);
app.patch('/api/users/:id/toggle-status', toggleUserStatus);

let notifications = [];

// Socket.IO
function fetchAllNotifications(socket) {
  const sqlPkl = "SELECT id, nama_lengkap, tanggal_mulai FROM pkl WHERE status = 'pending' ORDER BY tanggal_mulai DESC";
  const sqlKunjungan = "SELECT id, kontak_person, nama_instansi, tanggal_kunjungan, waktu FROM kunjungan WHERE status = 'pending' ORDER BY tanggal_kunjungan DESC";

  db.query(sqlPkl, (errPkl, resultsPkl) => {
    if (errPkl) return console.error(errPkl);

    db.query(sqlKunjungan, (errKunj, resultsKunj) => {
      if (errKunj) return console.error(errKunj);

      const notifPkl = (resultsPkl || []).map(row => ({
        id: `pkl-${row.id}`,
        pesan: `Pengajuan PKL dari ${row.nama_lengkap} mulai ${row.tanggal_mulai.toISOString().slice(0,10)}`,
        waktu: new Date().toISOString()
      }));

      const notifKunjungan = (resultsKunj || []).map(row => {
        const waktuSesi = row.waktu ? ` (${row.waktu})` : '';
        return {
          id: `kunjungan-${row.id}`,
          pesan: `Pengajuan Kunjungan dari ${row.kontak_person || row.nama_instansi} pada ${row.tanggal_kunjungan.toISOString().slice(0,10)}${waktuSesi}`,
          waktu: new Date().toISOString()
        };
      });

      notifications = [...notifPkl, ...notifKunjungan];
      notifications.sort((a,b) => new Date(b.waktu) - new Date(a.waktu));

      socket.emit('init-notifikasi', notifications);
    });
  });
}

io.on('connection', (socket) => {
  fetchAllNotifications(socket);
  
  socket.on('disconnect', () => {
    // Connection closed
  });
});

// Multer configuration for PKL
const uploadDirPkl = path.join(__dirname, 'uploads/pkl');
if (!fs.existsSync(uploadDirPkl)) fs.mkdirSync(uploadDirPkl, { recursive: true });

const storagePkl = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDirPkl),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
  }
});

const uploadPkl = multer({ 
  storage: storagePkl,
  limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
  { name: 'surat_pengantar', maxCount: 1 },
  { name: 'cv', maxCount: 1 },
  { name: 'nilai_raport_transkrip', maxCount: 1 },
  { name: 'kartu_pelajar', maxCount: 1 },
  { name: 'foto_id_card', maxCount: 1 }
]);

// Multer configuration for Kunjungan
const uploadDirKunjungan = path.join(__dirname, 'uploads/surat_pengantar');
const uploadDirSuratBalasan = path.join(__dirname, 'uploads/surat_balasan');

if (!fs.existsSync(uploadDirKunjungan)) fs.mkdirSync(uploadDirKunjungan, { recursive: true });
if (!fs.existsSync(uploadDirSuratBalasan)) fs.mkdirSync(uploadDirSuratBalasan, { recursive: true });

const storageKunjungan = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDirKunjungan),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
  }
});

const uploadKunjungan = multer({ 
  storage: storageKunjungan,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Express-fileupload middleware
const fileUploadMiddleware = fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 },
  abortOnLimit: true,
  useTempFiles: true,
  tempFileDir: '/tmp/',
  createParentPath: true,
  safeFileNames: true,
  preserveExtension: 4
});

// Helper function untuk status message
function getStatusMessage(status, type) {
  const typeLabel = type === 'pkl' ? 'PKL' : 'kunjungan';
  
  switch (status) {
    case 'pending':
      return `Pengajuan ${typeLabel} Anda sedang dalam proses review. Mohon tunggu konfirmasi lebih lanjut.`;
    case 'approved':
    case 'diterima':
      return `Selamat! Pengajuan ${typeLabel} Anda telah diterima. Tim kami akan menghubungi Anda untuk proses selanjutnya.`;
    case 'rejected':
    case 'ditolak':
      return `Pengajuan ${typeLabel} Anda belum dapat kami terima. Silakan lihat detail alasan di bawah.`;
    default:
      return `Status pengajuan ${typeLabel} Anda: ${status}`;
  }
}

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ 
      message: 'Username dan password wajib diisi' 
    });
  }

  const sql = 'SELECT id, username, password, role FROM admin WHERE username = ?';
  
  db.query(sql, [username], async (err, results) => {
    if (err) {
      return res.status(500).json({ 
        message: 'Gagal memeriksa data admin', 
        error: err.message 
      });
    }

    if (results.length === 0) {
      return res.status(401).json({ 
        message: 'Username atau password salah' 
      });
    }

    const admin = results[0];

    try {
      const isValidPassword = await bcrypt.compare(password, admin.password);
      
      if (!isValidPassword) {
        return res.status(401).json({ 
          message: 'Username atau password salah' 
        });
      }

      res.json({
        message: 'Login berhasil',
        user: {
          id: admin.id,
          username: admin.username,
          nama: admin.username,
          email: `${admin.username}@admin.com`,
          role: admin.role,
          loginTime: new Date().toISOString()
        },
        token: `admin-token-${admin.id}-${Date.now()}`
      });

    } catch (bcryptError) {
      return res.status(500).json({ 
        message: 'Gagal memverifikasi password',
        error: bcryptError.message 
      });
    }
  });
});

// Admin verify token
app.get('/api/admin/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      message: 'Token tidak valid' 
    });
  }

  const token = authHeader.split(' ')[1];
  
  if (token && token.startsWith('admin-token-')) {
    const adminId = token.split('-')[2];
    
    const sql = 'SELECT id, username, role FROM admin WHERE id = ?';
    
    db.query(sql, [adminId], (err, results) => {
      if (err || results.length === 0) {
        return res.status(401).json({ 
          message: 'Token tidak valid' 
        });
      }

      const admin = results[0];
      res.json({
        message: 'Token valid',
        user: {
          id: admin.id,
          username: admin.username,
          role: admin.role
        }
      });
    });
  } else {
    res.status(401).json({ 
      message: 'Format token tidak valid' 
    });
  }
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  res.json({ 
    message: 'Logout berhasil' 
  });
});

// Cek status endpoint - UPDATED dengan alasan penolakan
app.post('/api/cek-status', (req, res) => {
  const { type, keyword } = req.body;

  if (!type || !keyword) {
    return res.status(400).json({ 
      message: 'Jenis permohonan dan kata kunci wajib diisi' 
    });
  }

  let sql, params;

  if (type === 'pkl') {
    sql = `SELECT 
            id, nama_lengkap as nama, email, nim_nisn, 
            tanggal_mulai, tanggal_selesai, status,
            asal_instansi, alasan_penolakan, unit_kerja,
            jurusan, no_hp, created_at, updated_at
          FROM pkl 
          WHERE email = ? OR nim_nisn = ?
          ORDER BY id DESC
          LIMIT 1`;
    params = [keyword, keyword];
  } else if (type === 'kunjungan') {
    sql = `SELECT 
            id, nama_instansi as nama, email, kontak_person,
            tanggal_kunjungan, status, jumlah_peserta, alasan_penolakan, waktu,
            surat_balasan, created_at, updated_at
          FROM kunjungan
          WHERE email = ? OR kontak_person LIKE ?
          ORDER BY id DESC
          LIMIT 1`;
    params = [keyword, `%${keyword}%`];
  } else {
    return res.status(400).json({ 
      message: 'Jenis permohonan tidak valid. Pilih antara "pkl" atau "kunjungan"' 
    });
  }

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Error checking status:', err);
      return res.status(500).json({ 
        message: 'Gagal memeriksa status. Silakan coba lagi.',
        error: err.message 
      });
    }

    if (results.length === 0) {
      return res.status(404).json({ 
        message: `Data ${type === 'pkl' ? 'PKL' : 'kunjungan'} dengan kata kunci "${keyword}" tidak ditemukan.`,
        suggestion: 'Pastikan email, NIM, atau NISN yang Anda masukkan sudah benar dan sesuai dengan data yang terdaftar.'
      });
    }

    const result = results[0];

    res.json({
      status: result.status,
      message: getStatusMessage(result.status, type),
      data: {
        id: result.id,
        nama: result.nama,
        email: result.email,
        nim_nisn: result.nim_nisn || null,
        tanggal_mulai: result.tanggal_mulai || null,
        tanggal_selesai: result.tanggal_selesai || null,
        tanggal_kunjungan: result.tanggal_kunjungan || null,
        waktu: result.waktu || null,
        asal_instansi: result.asal_instansi || null,
        unit_kerja: result.unit_kerja || null,
        jumlah_peserta: result.jumlah_peserta || null,
        kontak_person: result.kontak_person || null,
        alasan_penolakan: result.alasan_penolakan || null,
        surat_balasan: result.surat_balasan || null,
        jurusan: result.jurusan || null,
        no_hp: result.no_hp || null,
        created_at: result.created_at,
        updated_at: result.updated_at
      }
    });
  });
});

// PKL endpoints

// GET all PKL
app.get('/api/pkl', (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM pkl ORDER BY tanggal_mulai DESC';
  let params = [];

  if (status) {
    sql = 'SELECT * FROM pkl WHERE status = ? ORDER BY tanggal_mulai DESC';
    params = [status];
  }

  db.query(sql, params, (err, result) => {
    if (err) {
      return res.status(500).json({ message: 'Gagal mengambil data PKL', error: err.message });
    }
    res.json(result);
  });
});

// GET PKL by ID
app.get('/api/pkl/:id', (req, res) => {
  const { id } = req.params;
  
  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'ID PKL tidak valid' });
  }
  
  const sql = 'SELECT * FROM pkl WHERE id = ?';
  
  db.query(sql, [id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: 'Gagal mengambil detail PKL', error: err.message });
    }
    
    if (result.length === 0) {
      return res.status(404).json({ message: 'Data PKL tidak ditemukan' });
    }
    
    res.json(result[0]);
  });
});

// PUT update PKL status - UPDATED dengan alasan penolakan
app.put('/api/pkl/:id', (req, res) => {
  const { id } = req.params;
  const { status, alasan_penolakan } = req.body;

  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'ID PKL tidak valid' });
  }

  const allowedStatuses = ['pending', 'approved', 'rejected'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ 
      message: 'Status tidak valid. Status yang diizinkan: pending, approved, rejected',
      received: status,
      allowed: allowedStatuses
    });
  }

  // Validasi alasan penolakan untuk status rejected
  if (status === 'rejected') {
    if (!alasan_penolakan || alasan_penolakan.trim().length < 10) {
      return res.status(400).json({ 
        message: 'Alasan penolakan harus diisi minimal 10 karakter untuk menolak pengajuan' 
      });
    }
  }

  // Cek data PKL terlebih dahulu
  const checkSql = 'SELECT id, status, nama_lengkap, email FROM pkl WHERE id = ?';
  
  db.query(checkSql, [id], (checkErr, checkResult) => {
    if (checkErr) {
      return res.status(500).json({ 
        message: 'Gagal memeriksa data PKL',
        error: checkErr.message 
      });
    }
    
    if (checkResult.length === 0) {
      return res.status(404).json({ message: 'Data PKL tidak ditemukan' });
    }
    
    const pklData = checkResult[0];
    let updateSql, updateParams;
    
    if (status === 'rejected') {
      // Update dengan alasan penolakan
      updateSql = 'UPDATE pkl SET status = ?, alasan_penolakan = ? WHERE id = ?';
      updateParams = [status, alasan_penolakan.trim(), id];
    } else if (status === 'approved') {
      // Reset alasan penolakan jika disetujui
      updateSql = 'UPDATE pkl SET status = ?, alasan_penolakan = NULL WHERE id = ?';
      updateParams = [status, id];
    } else {
      // Status pending atau lainnya
      updateSql = 'UPDATE pkl SET status = ?, alasan_penolakan = NULL WHERE id = ?';
      updateParams = [status, id];
    }

    console.log('Updating PKL status:', { id, status, hasAlasan: !!alasan_penolakan });

    db.query(updateSql, updateParams, (updateErr, updateResult) => {
      if (updateErr) {
        console.error('Error updating PKL status:', updateErr);
        return res.status(500).json({ 
          message: 'Gagal mengupdate status PKL',
          error: updateErr.message 
        });
      }
      
      if (updateResult.affectedRows === 0) {
        return res.status(500).json({ message: 'Gagal mengupdate status PKL' });
      }

      // Remove notification if status changed from pending
      if (status !== 'pending') {
        notifications = notifications.filter(notif => notif.id !== `pkl-${id}`);
        io.emit('init-notifikasi', notifications);
      }

      // Emit status update notification
      io.emit('pkl-status-updated', { 
        id: parseInt(id), 
        status,
        nama_lengkap: pklData.nama_lengkap,
        alasan_penolakan: status === 'rejected' ? alasan_penolakan : null
      });

      // Log untuk email notification (implementasi email bisa ditambahkan nanti)
      if (status === 'rejected') {
        console.log(`PKL Rejection - ID: ${id}, Email: ${pklData.email}, Reason: ${alasan_penolakan}`);
        // TODO: Implement email notification
      } else if (status === 'approved') {
        console.log(`PKL Approval - ID: ${id}, Email: ${pklData.email}`);
        // TODO: Implement email notification
      }

      res.json({
        message: `Status PKL berhasil diubah menjadi ${status}`,
        data: {
          id: parseInt(id),
          status: status,
          affectedRows: updateResult.affectedRows,
          previousStatus: pklData.status,
          nama_lengkap: pklData.nama_lengkap,
          alasan_penolakan: status === 'rejected' ? alasan_penolakan.trim() : null
        }
      });
    });
  });
});

// POST create PKL
app.post('/api/pkl', (req, res) => {
  uploadPkl(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Ukuran file terlalu besar, maksimal 5MB' });
      }
      return res.status(500).json({ message: 'Gagal mengunggah file', error: err.message });
    }

    const {
      nama_lengkap, asal_instansi, nim_nisn, jurusan, no_hp, email,
      tanggal_mulai, tanggal_selesai, deskripsi_diri, unit_kerja, bulan_pkl,
      tempat_lahir, tanggal_lahir, jenjang_pendidikan, jangka_waktu,
      jangka_waktu_lainnya, alasan_pilih_tvri, portofolio_link
    } = req.body;

    const files = req.files;
    const status = 'pending';

    if (!files || !files.surat_pengantar || !files.cv || !files.nilai_raport_transkrip || 
        !files.kartu_pelajar || !files.foto_id_card) {
      return res.status(400).json({ message: 'Semua dokumen pendukung wajib diunggah' });
    }

    const sql = `INSERT INTO pkl (
      nama_lengkap, asal_instansi, nim_nisn, jurusan, no_hp, email,
      tanggal_mulai, tanggal_selesai, surat_pengantar, status, cv,
      nilai_raport_transkrip, kartu_pelajar, foto_id_card, portofolio_link,
      deskripsi_diri, unit_kerja, bulan_pkl, tempat_lahir, tanggal_lahir,
      jenjang_pendidikan, jangka_waktu, jangka_waktu_lainnya, alasan_pilih_tvri
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      nama_lengkap, asal_instansi, nim_nisn, jurusan, no_hp, email,
      tanggal_mulai, tanggal_selesai, files.surat_pengantar[0].filename,
      status, files.cv[0].filename, files.nilai_raport_transkrip[0].filename,
      files.kartu_pelajar[0].filename, files.foto_id_card[0].filename,
      portofolio_link || null, deskripsi_diri, unit_kerja, bulan_pkl,
      tempat_lahir, tanggal_lahir, jenjang_pendidikan, jangka_waktu,
      jangka_waktu_lainnya || null, alasan_pilih_tvri
    ];

    db.query(sql, values, (err, result) => {
      if (err) {
        return res.status(500).json({ message: 'Gagal menyimpan data PKL', error: err.message });
      }

      const newNotif = {
        id: `pkl-${result.insertId}`,
        pesan: `Pengajuan PKL dari ${nama_lengkap} mulai ${tanggal_mulai}`,
        waktu: new Date().toISOString()
      };

      notifications.unshift(newNotif);
      io.emit('notifikasi-baru', newNotif);

      res.status(201).json({ 
        message: 'Pendaftaran PKL berhasil',
        data: { id: result.insertId, nama: nama_lengkap, status: status }
      });
    });
  });
});

// DELETE PKL
app.delete('/api/pkl/:id', (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      message: 'ID PKL tidak valid',
      received: id
    });
  }

  // Get file names first
  const getSql = 'SELECT surat_pengantar, cv, nilai_raport_transkrip, kartu_pelajar, foto_id_card FROM pkl WHERE id = ?';
  
  db.query(getSql, [id], (getErr, getResult) => {
    if (getErr) {
      return res.status(500).json({ 
        message: 'Gagal memeriksa data PKL',
        error: getErr.message 
      });
    }
    
    if (getResult.length === 0) {
      return res.status(404).json({ 
        message: 'Data PKL tidak ditemukan' 
      });
    }

    const pklFiles = getResult[0];
    const filesToDelete = Object.values(pklFiles).filter(Boolean);

    // Delete from database
    const deleteSql = 'DELETE FROM pkl WHERE id = ?';
    
    db.query(deleteSql, [id], (deleteErr, deleteResult) => {
      if (deleteErr) {
        return res.status(500).json({ 
          message: 'Gagal menghapus data PKL',
          error: deleteErr.message 
        });
      }
      
      if (deleteResult.affectedRows === 0) {
        return res.status(404).json({ 
          message: 'Data PKL tidak ditemukan' 
        });
      }

      // Delete files
      const uploadDir = path.join(__dirname, 'uploads/pkl');
      filesToDelete.forEach(filename => {
        const filePath = path.join(uploadDir, filename);
        fs.unlink(filePath, () => {});
      });

      // Remove notification
      notifications = notifications.filter(notif => notif.id !== `pkl-${id}`);
      io.emit('init-notifikasi', notifications);

      res.json({
        message: 'Data PKL berhasil dihapus',
        data: {
          id: parseInt(id),
          affectedRows: deleteResult.affectedRows
        }
      });
    });
  });
});

// Download PKL files endpoint
app.get('/api/pkl/:id/download/:fileType', (req, res) => {
  const { id, fileType } = req.params;
  
  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'ID PKL tidak valid' });
  }

  const allowedFileTypes = [
    'surat_pengantar', 'cv', 'nilai_raport_transkrip', 
    'kartu_pelajar', 'foto_id_card'
  ];
  
  if (!allowedFileTypes.includes(fileType)) {
    return res.status(400).json({ 
      message: 'Jenis file tidak valid',
      allowed: allowedFileTypes
    });
  }

  const sql = `SELECT ${fileType} as filename FROM pkl WHERE id = ?`;
  
  db.query(sql, [id], (err, results) => {
    if (err) {
      return res.status(500).json({ 
        message: 'Gagal mengambil data file',
        error: err.message 
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ message: 'Data PKL tidak ditemukan' });
    }
    
    const fileName = results[0].filename;
    if (!fileName) {
      return res.status(404).json({ message: `File ${fileType} tidak ada` });
    }
    
    const filePath = path.join(__dirname, 'uploads/pkl', fileName);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File tidak ditemukan di server' });
    }
    
    // Determine content type
    const ext = path.extname(fileName).toLowerCase();
    let contentType = 'application/octet-stream';
    
    switch (ext) {
      case '.pdf': 
        contentType = 'application/pdf'; 
        break;
      case '.jpg':
      case '.jpeg': 
        contentType = 'image/jpeg'; 
        break;
      case '.png': 
        contentType = 'image/png'; 
        break;
      case '.doc': 
        contentType = 'application/msword'; 
        break;
      case '.docx': 
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; 
        break;
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      console.error('File stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Gagal mengunduh file' });
      }
    });
  });
});

// Kunjungan endpoints - DIPERTAHANKAN untuk backward compatibility

// GET all kunjungan (OLD - KEPT FOR COMPATIBILITY)
app.get('/api/kunjungan-old', (req, res) => {
  const sql = 'SELECT * FROM kunjungan ORDER BY created_at DESC';
  
  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ 
        message: 'Gagal mengambil data kunjungan',
        error: err.message
      });
    }
    
    res.json(results);
  });
});

// POST create kunjungan (OLD - KEPT FOR COMPATIBILITY)
app.post('/api/kunjungan-old', uploadKunjungan.single('surat_pengantar'), (req, res) => {
  const { nama_instansi, kontak_person, no_hp, email, tanggal_kunjungan, jumlah_peserta, nama_lengkap, asal_instansi, waktu } = req.body;
  
  const finalNamaInstansi = nama_instansi || asal_instansi;
  const finalKontakPerson = kontak_person || nama_lengkap;
  
  const surat_pengantar = req.file ? req.file.filename : null;
  const status = 'pending';

  if (!finalNamaInstansi || !finalKontakPerson || !email || !tanggal_kunjungan) {
    return res.status(400).json({ message: 'Data wajib tidak lengkap' });
  }

  // Validate waktu
  if (waktu && !['sesi1', 'sesi2'].includes(waktu)) {
    return res.status(400).json({ 
      message: 'Waktu sesi tidak valid. Pilih "sesi1" atau "sesi2"' 
    });
  }

  const sql = `INSERT INTO kunjungan (nama_instansi, kontak_person, no_hp, email, tanggal_kunjungan, jumlah_peserta, surat_pengantar, status, waktu)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = [finalNamaInstansi, finalKontakPerson, no_hp, email, tanggal_kunjungan, jumlah_peserta, surat_pengantar, status, waktu || null];

  db.query(sql, values, (err, result) => {
    if (err) {
      return res.status(500).json({ message: 'Gagal menyimpan data kunjungan', error: err.message });
    }

    const waktuSesi = waktu ? ` (${waktu})` : '';
    const newNotif = {
      id: `kunjungan-${result.insertId}`,
      pesan: `Pengajuan Kunjungan dari ${finalKontakPerson || finalNamaInstansi} pada ${tanggal_kunjungan}${waktuSesi}`,
      waktu: new Date().toISOString()
    };
    notifications.unshift(newNotif);
    io.emit('notifikasi-baru', newNotif);

    res.status(201).json({ 
      message: 'Pendaftaran kunjungan berhasil', 
      id: result.insertId 
    });
  });
});

// GET single kunjungan (OLD - KEPT FOR COMPATIBILITY)
app.get('/api/kunjungan-old/:id', (req, res) => {
  const { id } = req.params;
  
  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'ID tidak valid' });
  }
  
  const sql = 'SELECT * FROM kunjungan WHERE id = ?';
  
  db.query(sql, [id], (err, result) => {
    if (err) {
      return res.status(500).json({ 
        message: 'Gagal mengambil detail kunjungan',
        error: err.message 
      });
    }
    
    if (result.length === 0) {
      return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
    }
    
    res.json(result[0]);
  });
});

// PUT update kunjungan status (OLD - KEPT FOR COMPATIBILITY)
app.put('/api/kunjungan-old/:id', fileUploadMiddleware, (req, res) => {
  const { id } = req.params;
  
  let status, alasan_penolakan, waktu;
  
  if (req.body) {
    status = req.body.status;
    alasan_penolakan = req.body.alasan_penolakan;
    waktu = req.body.waktu;
  } else {
    return res.status(400).json({ message: 'Request body tidak valid' });
  }

  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'ID tidak valid' });
  }

  const allowedStatuses = ['pending', 'diterima', 'ditolak'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ 
      message: 'Status tidak valid',
      allowed: allowedStatuses,
      received: status
    });
  }

  // Validate waktu
  if (waktu && !['sesi1', 'sesi2'].includes(waktu)) {
    return res.status(400).json({ 
      message: 'Waktu sesi tidak valid. Pilih "sesi1" atau "sesi2"' 
    });
  }

  if (status === 'ditolak') {
    // Handle rejection
    if (!alasan_penolakan || !alasan_penolakan.trim()) {
      return res.status(400).json({ 
        message: 'Alasan penolakan diperlukan untuk menolak kunjungan' 
      });
    }
    
    let updateSql = 'UPDATE kunjungan SET status = ?, alasan_penolakan = ?, surat_balasan = NULL WHERE id = ?';
    let updateParams = [status, alasan_penolakan.trim(), id];
    
    if (waktu) {
      updateSql = 'UPDATE kunjungan SET status = ?, alasan_penolakan = ?, surat_balasan = NULL, waktu = ? WHERE id = ?';
      updateParams = [status, alasan_penolakan.trim(), waktu, id];
    }
    
    db.query(updateSql, updateParams, (err, result) => {
      if (err) {
        return res.status(500).json({ 
          message: 'Gagal update status',
          error: err.message 
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Data tidak ditemukan' });
      }

      // Remove notification
      if (status !== 'pending') {
        notifications = notifications.filter(notif => notif.id !== `kunjungan-${id}`);
        io.emit('init-notifikasi', notifications);
      }

      res.json({ 
        message: 'Kunjungan berhasil ditolak',
        status: status 
      });
    });
    
  } else if (status === 'diterima') {
    // Handle acceptance with file upload
    if (!req.files || !req.files.surat_balasan) {
      return res.status(400).json({ 
        message: 'File surat balasan diperlukan untuk menerima kunjungan' 
      });
    }

    const file = req.files.surat_balasan;
    
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ 
        message: 'Format file tidak valid. Hanya PDF, DOC, dan DOCX yang diizinkan',
        received: file.mimetype
      });
    }

    // Validate file size
    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ 
        message: 'Ukuran file terlalu besar. Maksimal 5MB',
        fileSize: `${(file.size / 1024 / 1024).toFixed(2)}MB`
      });
    }

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileExtension = path.extname(file.name);
    const fileName = `Surat_Balasan_${id}_${timestamp}${fileExtension}`;
    
    const filePath = path.join(uploadDirSuratBalasan, fileName);
    
    // Move uploaded file
    file.mv(filePath, (err) => {
      if (err) {
        return res.status(500).json({ 
          message: 'Gagal menyimpan file surat balasan',
          error: err.message 
        });
      }
      
      // Update database
      let updateSql = 'UPDATE kunjungan SET status = ?, surat_balasan = ?, alasan_penolakan = NULL WHERE id = ?';
      let updateParams = [status, fileName, id];
      
      if (waktu) {
        updateSql = 'UPDATE kunjungan SET status = ?, surat_balasan = ?, alasan_penolakan = NULL, waktu = ? WHERE id = ?';
        updateParams = [status, fileName, waktu, id];
      }
      
      db.query(updateSql, updateParams, (err, result) => {
        if (err) {
          fs.unlink(filePath, () => {});
          return res.status(500).json({ 
            message: 'Gagal mengupdate data kunjungan',
            error: err.message 
          });
        }
        
        if (result.affectedRows === 0) {
          fs.unlink(filePath, () => {});
          return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
        }

        // Remove notification
        notifications = notifications.filter(notif => notif.id !== `kunjungan-${id}`);
        io.emit('init-notifikasi', notifications);

        res.json({ 
          message: 'Kunjungan berhasil diterima',
          status: status,
          fileName: fileName
        });
      });
    });
    
  } else {
    // Handle other status updates
    let updateSql = 'UPDATE kunjungan SET status = ?, alasan_penolakan = NULL, surat_balasan = NULL WHERE id = ?';
    let updateParams = [status, id];
    
    if (waktu) {
      updateSql = 'UPDATE kunjungan SET status = ?, alasan_penolakan = NULL, surat_balasan = NULL, waktu = ? WHERE id = ?';
      updateParams = [status, waktu, id];
    }

    db.query(updateSql, updateParams, (err, result) => {
      if (err) {
        return res.status(500).json({ 
          message: 'Gagal update status',
          error: err.message 
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Data tidak ditemukan' });
      }

      // Remove notification
      if (status !== 'pending') {
        notifications = notifications.filter(notif => notif.id !== `kunjungan-${id}`);
        io.emit('init-notifikasi', notifications);
      }

      res.json({ 
        message: 'Status kunjungan berhasil diupdate',
        status: status 
      });
    });
  }
});

// DELETE kunjungan (OLD - KEPT FOR COMPATIBILITY)
app.delete('/api/kunjungan-old/:id', (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'ID tidak valid' });
  }

  // Check if exists and get file info
  const checkSql = 'SELECT id, surat_pengantar, surat_balasan FROM kunjungan WHERE id = ?';
  
  db.query(checkSql, [id], (checkErr, checkResult) => {
    if (checkErr) {
      return res.status(500).json({ 
        message: 'Gagal memeriksa data kunjungan',
        error: checkErr.message 
      });
    }
    
    if (checkResult.length === 0) {
      return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
    }

    const deleteSql = 'DELETE FROM kunjungan WHERE id = ?';
    
    db.query(deleteSql, [id], (deleteErr, deleteResult) => {
      if (deleteErr) {
        return res.status(500).json({ 
          message: 'Gagal menghapus data kunjungan',
          error: deleteErr.message 
        });
      }

      // Remove notification
      notifications = notifications.filter(notif => notif.id !== `kunjungan-${id}`);
      io.emit('init-notifikasi', notifications);

      // Delete files
      const record = checkResult[0];
      const filesToDelete = [];
      
      if (record.surat_pengantar) {
        filesToDelete.push({
          path: path.join(uploadDirKunjungan, record.surat_pengantar)
        });
      }
      
      if (record.surat_balasan) {
        filesToDelete.push({
          path: path.join(uploadDirSuratBalasan, record.surat_balasan)
        });
      }
      
      filesToDelete.forEach(file => {
        fs.unlink(file.path, () => {});
      });

      res.json({ 
        message: 'Data kunjungan berhasil dihapus'
      });
    });
  });
});

// Download endpoints (OLD - KEPT FOR COMPATIBILITY)
app.get('/api/kunjungan-old/:id/download/surat-pengantar', (req, res) => {
  const { id } = req.params;
  
  const sql = 'SELECT surat_pengantar FROM kunjungan WHERE id = ?';
  
  db.query(sql, [id], (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Gagal mengambil data file' });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
    }
    
    const fileName = results[0].surat_pengantar;
    if (!fileName) {
      return res.status(404).json({ message: 'File surat pengantar tidak ada' });
    }
    
    const filePath = path.join(uploadDirKunjungan, fileName);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File tidak ditemukan di server' });
    }
    
    const ext = path.extname(fileName).toLowerCase();
    let contentType = 'application/octet-stream';
    
    switch (ext) {
      case '.pdf': contentType = 'application/pdf'; break;
      case '.doc': contentType = 'application/msword'; break;
      case '.docx': contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; break;
      case '.jpg':
      case '.jpeg': contentType = 'image/jpeg'; break;
      case '.png': contentType = 'image/png'; break;
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Gagal mengunduh file' });
      }
    });
  });
});

app.get('/api/kunjungan-old/:id/download/surat-balasan', (req, res) => {
  const { id } = req.params;
  
  const sql = 'SELECT surat_balasan FROM kunjungan WHERE id = ?';
  
  db.query(sql, [id], (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Gagal mengambil data file' });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
    }
    
    const fileName = results[0].surat_balasan;
    if (!fileName) {
      return res.status(404).json({ message: 'File surat balasan tidak ada' });
    }
    
    const filePath = path.join(uploadDirSuratBalasan, fileName);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File tidak ditemukan di server' });
    }
    
    const ext = path.extname(fileName).toLowerCase();
    let contentType = 'application/octet-stream';
    
    switch (ext) {
      case '.pdf': contentType = 'application/pdf'; break;
      case '.doc': contentType = 'application/msword'; break;
      case '.docx': contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; break;
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Gagal mengunduh file' });
      }
    });
  });
});

// Statistics endpoint
app.get('/api/statistics', (req, res) => {
  const queries = {
    pkl_total: 'SELECT COUNT(*) as total FROM pkl',
    pkl_pending: "SELECT COUNT(*) as total FROM pkl WHERE status = 'pending'",
    pkl_approved: "SELECT COUNT(*) as total FROM pkl WHERE status = 'approved'",
    pkl_rejected: "SELECT COUNT(*) as total FROM pkl WHERE status = 'rejected'",
    kunjungan_total: 'SELECT COUNT(*) as total FROM kunjungan',
    kunjungan_pending: "SELECT COUNT(*) as total FROM kunjungan WHERE status = 'pending'",
    kunjungan_approved: "SELECT COUNT(*) as total FROM kunjungan WHERE status = 'diterima'",
    kunjungan_rejected: "SELECT COUNT(*) as total FROM kunjungan WHERE status = 'ditolak'"
  };

  const results = {};
  let completed = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    db.query(query, (err, result) => {
      if (err) {
        results[key] = 0;
      } else {
        results[key] = result[0].total;
      }
      
      completed++;
      if (completed === totalQueries) {
        res.json(results);
      }
    });
  });
});

// Error handling
app.use((err, req, res, next) => {
  res.status(500).json({ 
    message: 'Terjadi kesalahan server', 
    error: err.message 
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    message: 'Endpoint tidak ditemukan',
    method: req.method,
    path: req.path
  });
});

// Start server
const PORT = 5050;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  
  // Test database connection
  db.query('SELECT 1 as test', (err, result) => {
    if (err) {
      console.error('Database connection failed:', err);
    } else {
      console.log('Database connected successfully');
    }
  });
});