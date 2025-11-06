const db = require('../db');
const fs = require('fs');
const path = require('path');

// GET /api/kunjungan/check-availability/:date - Check session availability for a specific date
exports.checkAvailability = (req, res) => {
  console.log(`🔍 checkAvailability called for date: ${req.params.date}`);
  
  const { date } = req.params;
  
  // Validasi format tanggal
  if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    console.log('❌ Invalid date format:', date);
    return res.status(400).json({ 
      message: 'Format tanggal tidak valid. Gunakan format YYYY-MM-DD',
      received: date
    });
  }
  
  // Validasi tanggal tidak boleh hari yang sudah lewat
  const selectedDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (selectedDate < today) {
    console.log('❌ Date is in the past:', date);
    return res.status(400).json({ 
      message: 'Tidak dapat memeriksa ketersediaan untuk tanggal yang sudah lewat',
      date: date
    });
  }
  
  // Validasi hari kerja (Senin-Jumat)
  const dayOfWeek = selectedDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) { // 0 = Minggu, 6 = Sabtu
    console.log('❌ Weekend selected:', date, 'Day:', dayOfWeek);
    return res.status(400).json({ 
      message: 'Kunjungan hanya dapat dilakukan pada hari Senin - Jumat',
      date: date,
      dayOfWeek: dayOfWeek === 0 ? 'Minggu' : 'Sabtu'
    });
  }
  
  // Query untuk cek berapa banyak kunjungan yang sudah terdaftar per sesi
  const sql = `
    SELECT 
      waktu,
      COUNT(*) as jumlah_terdaftar
    FROM kunjungan 
    WHERE tanggal_kunjungan = ? 
    AND status IN ('pending', 'diterima')
    GROUP BY waktu
  `;
  
  console.log('🔍 Executing SQL:', sql, 'with date:', date);
  
  db.query(sql, [date], (err, results) => {
    if (err) {
      console.error('❌ Error in checkAvailability:', err);
      return res.status(500).json({ 
        message: 'Gagal memeriksa ketersediaan sesi',
        error: err.message 
      });
    }
    
    console.log('✅ Raw SQL Results:', results);
    
    // Default session status
    const sessionStatus = {
      sesi1: {
        count: 0,
        isFull: false
      },
      sesi2: {
        count: 0,
        isFull: false
      }
    };
    
    // Update dengan data dari database
    results.forEach(row => {
      console.log(`📊 Processing row: waktu=${row.waktu}, count=${row.jumlah_terdaftar}`);
      if (row.waktu === 'sesi1' || row.waktu === 'sesi2') {
        const count = parseInt(row.jumlah_terdaftar);
        sessionStatus[row.waktu].count = count;
        // Anggap penuh jika sudah ada 1 atau lebih kunjungan per sesi
        sessionStatus[row.waktu].isFull = count >= 1;
        console.log(`📊 Updated ${row.waktu}: count=${count}, isFull=${sessionStatus[row.waktu].isFull}`);
      }
    });
    
    const isFullyBooked = sessionStatus.sesi1.isFull && sessionStatus.sesi2.isFull;
    
    console.log(`✅ Final availability check for ${date}:`, JSON.stringify(sessionStatus, null, 2));
    console.log(`🏁 Is fully booked: ${isFullyBooked}`);
    
    res.status(200).json({
      date: date,
      sessionStatus: sessionStatus,
      isFullyBooked: isFullyBooked,
      debug: {
        rawQueryResults: results,
        sqlQuery: sql,
        parameters: [date]
      },
      message: isFullyBooked 
        ? 'Kedua sesi sudah penuh untuk tanggal ini'
        : 'Masih ada sesi yang tersedia'
    });
  });
};

// GET /api/kunjungan - Get all visits (untuk dashboard admin)
exports.getAllKunjungan = (req, res) => {
  console.log('🔍 getAllKunjungan called');
  
  const sql = `SELECT * FROM kunjungan ORDER BY created_at DESC`;
  
  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ Error in getAllKunjungan:', err);
      console.error('❌ SQL Error details:', {
        code: err.code,
        sqlState: err.sqlState,
        sqlMessage: err.sqlMessage
      });
      return res.status(500).json({ 
        message: 'Gagal mengambil data kunjungan',
        error: err.message 
      });
    }
    
    console.log(`✅ Found ${results.length} kunjungan records`);
    res.status(200).json(results);
  });
};

// POST /api/kunjungan - Create new visit (dari form publik)
exports.daftarKunjungan = (req, res) => {
  console.log('🔍 daftarKunjungan called');
  console.log('📄 Request body:', req.body);
  
  const {
    nama_instansi,
    kontak_person,
    email,
    no_hp,
    jumlah_peserta,
    tanggal_kunjungan,
    waktu,
    surat_pengantar
  } = req.body;

  const status = 'pending'; // Default status

  // Validasi input yang diperlukan
  if (!nama_instansi || !kontak_person || !email || !tanggal_kunjungan || !waktu) {
    return res.status(400).json({ 
      message: 'Data wajib tidak lengkap: nama_instansi, kontak_person, email, tanggal_kunjungan, waktu diperlukan' 
    });
  }

  // Validasi nilai waktu yang sesuai
  const allowedWaktu = ['sesi1', 'sesi2'];
  if (!allowedWaktu.includes(waktu)) {
    return res.status(400).json({ 
      message: 'Waktu tidak valid. Pilihan: sesi1 atau sesi2',
      received: waktu,
      allowed: allowedWaktu
    });
  }

  // Validasi tanggal tidak boleh hari yang sudah lewat
  const selectedDate = new Date(tanggal_kunjungan);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (selectedDate < today) {
    return res.status(400).json({ 
      message: 'Tidak dapat mendaftar untuk tanggal yang sudah lewat',
      tanggal: tanggal_kunjungan
    });
  }

  // Validasi hari kerja
  const dayOfWeek = selectedDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return res.status(400).json({ 
      message: 'Kunjungan hanya dapat dilakukan pada hari Senin - Jumat',
      tanggal: tanggal_kunjungan,
      hari: dayOfWeek === 0 ? 'Minggu' : 'Sabtu'
    });
  }

  // Cek apakah sesi sudah penuh
  const checkAvailabilitySql = `
    SELECT COUNT(*) as count 
    FROM kunjungan 
    WHERE tanggal_kunjungan = ? 
    AND waktu = ? 
    AND status IN ('pending', 'diterima')
  `;

  console.log('🔍 Checking availability with SQL:', checkAvailabilitySql);
  console.log('🔍 Parameters:', [tanggal_kunjungan, waktu]);

  db.query(checkAvailabilitySql, [tanggal_kunjungan, waktu], (err, results) => {
    if (err) {
      console.error('❌ Error checking availability:', err);
      return res.status(500).json({ 
        message: 'Gagal memeriksa ketersediaan sesi',
        error: err.message 
      });
    }

    const currentBookings = results[0].count;
    console.log(`📊 Current bookings for ${tanggal_kunjungan} ${waktu}: ${currentBookings}`);
    
    if (currentBookings >= 1) { // Asumsi maksimal 1 kunjungan per sesi
      console.log('❌ Session is full, rejecting booking');
      return res.status(409).json({ 
        message: `Sesi ${waktu} pada tanggal ${tanggal_kunjungan} sudah penuh. Silahkan pilih sesi lain atau tanggal lain.`,
        tanggal: tanggal_kunjungan,
        sesi: waktu,
        currentBookings: currentBookings,
        suggested_action: 'Pilih sesi lain atau tanggal lain'
      });
    }

    console.log('✅ Session is available, proceeding with booking');
    // Lanjutkan dengan insert jika sesi masih tersedia
    const sql = `
      INSERT INTO kunjungan 
      (nama_instansi, kontak_person, email, no_hp, jumlah_peserta, tanggal_kunjungan, waktu, surat_pengantar, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
      nama_instansi, kontak_person, email, no_hp, jumlah_peserta, tanggal_kunjungan, waktu, surat_pengantar, status
    ], (err, result) => {
      if (err) {
        console.error('❌ Error in daftarKunjungan:', err);
        return res.status(500).json({ 
          message: 'Gagal menyimpan data kunjungan',
          error: err.message 
        });
      }
      
      console.log('✅ Kunjungan created with ID:', result.insertId);
      res.status(201).json({ 
        message: 'Pendaftaran kunjungan berhasil',
        id: result.insertId,
        tanggal: tanggal_kunjungan,
        sesi: waktu
      });
    });
  });
};

// PUT /api/kunjungan/:id - Update visit status with file upload support
exports.updateKunjungan = (req, res) => {
  console.log(`🔍 updateKunjungan called for ID: ${req.params.id}`);
  console.log('📄 Request body:', req.body);
  console.log('📁 Files:', req.files);
  
  const { id } = req.params;
  const { status, alasan_penolakan } = req.body;

  // Validasi ID
  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'ID kunjungan tidak valid' });
  }

  // Validasi status yang benar
  const allowedStatuses = ['pending', 'diterima', 'ditolak'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ 
      message: 'Status tidak valid. Status yang diizinkan: pending, diterima, ditolak',
      received: status,
      allowed: allowedStatuses
    });
  }

  let sql, params;

  if (status === 'ditolak') {
    // Handle rejection with reason
    if (!alasan_penolakan || !alasan_penolakan.trim()) {
      return res.status(400).json({ 
        message: 'Alasan penolakan diperlukan untuk menolak kunjungan' 
      });
    }
    
    sql = `UPDATE kunjungan SET status = ?, alasan_penolakan = ?, surat_balasan = NULL, updated_at = NOW() WHERE id = ?`;
    params = [status, alasan_penolakan.trim(), id];
    
    executeUpdate();
    
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

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ 
        message: 'Ukuran file terlalu besar. Maksimal 5MB',
        fileSize: `${(file.size / 1024 / 1024).toFixed(2)}MB`
      });
    }

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileExtension = path.extname(file.name);
    const fileName = `Surat_Balasan_${id}_${timestamp}${fileExtension}`;
    
    // Ensure upload directory exists
    const uploadDir = path.join(__dirname, '../uploads/surat_balasan');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log('✅ Created surat_balasan directory');
    }
    
    const filePath = path.join(uploadDir, fileName);
    
    // Move uploaded file
    file.mv(filePath, (err) => {
      if (err) {
        console.error('❌ Error moving file:', err);
        return res.status(500).json({ 
          message: 'Gagal menyimpan file surat balasan',
          error: err.message 
        });
      }
      
      console.log('✅ File saved:', fileName);
      
      // Update database with filename
      sql = `UPDATE kunjungan SET status = ?, surat_balasan = ?, alasan_penolakan = NULL, updated_at = NOW() WHERE id = ?`;
      params = [status, fileName, id];
      
      executeUpdate(fileName);
    });
    
  } else {
    // Handle other status updates
    sql = `UPDATE kunjungan SET status = ?, alasan_penolakan = NULL, surat_balasan = NULL, updated_at = NOW() WHERE id = ?`;
    params = [status, id];
    
    executeUpdate();
  }

  function executeUpdate(uploadedFileName = null) {
    db.query(sql, params, (err, result) => {
      if (err) {
        console.error('❌ Error in updateKunjungan:', err);
        
        // If file was uploaded but DB update failed, remove the file
        if (uploadedFileName) {
          const filePath = path.join(__dirname, '../uploads/surat_balasan', uploadedFileName);
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error('❌ Failed to cleanup uploaded file:', unlinkErr);
            } else {
              console.log('✅ Cleaned up uploaded file after DB error');
            }
          });
        }
        
        return res.status(500).json({ 
          message: 'Gagal mengupdate data kunjungan',
          error: err.message 
        });
      }
      
      if (result.affectedRows === 0) {
        // If record not found and file was uploaded, remove the file
        if (uploadedFileName) {
          const filePath = path.join(__dirname, '../uploads/surat_balasan', uploadedFileName);
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error('❌ Failed to cleanup uploaded file:', unlinkErr);
            } else {
              console.log('✅ Cleaned up uploaded file after record not found');
            }
          });
        }
        
        return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
      }
      
      const responseMessage = status === 'diterima' 
        ? 'Kunjungan berhasil diterima dan surat balasan telah disimpan'
        : status === 'ditolak'
        ? 'Kunjungan berhasil ditolak dengan alasan yang diberikan'
        : 'Status kunjungan berhasil diupdate';
      
      console.log('✅ Kunjungan status updated to:', status);
      res.status(200).json({ 
        message: responseMessage,
        status: status,
        ...(uploadedFileName && { fileName: uploadedFileName })
      });
    });
  }
};

// DELETE /api/kunjungan/:id - Delete visit
exports.deleteKunjungan = (req, res) => {
  console.log(`🔍 deleteKunjungan called for ID: ${req.params.id}`);
  
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'ID kunjungan tidak valid' });
  }

  const checkSql = `SELECT id, surat_pengantar, surat_balasan FROM kunjungan WHERE id = ?`;
  
  db.query(checkSql, [id], (err, results) => {
    if (err) {
      console.error('❌ Error checking kunjungan:', err);
      return res.status(500).json({ 
        message: 'Gagal memeriksa data kunjungan',
        error: err.message 
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
    }

    const deleteSql = `DELETE FROM kunjungan WHERE id = ?`;
    
    db.query(deleteSql, [id], (err, result) => {
      if (err) {
        console.error('❌ Error in deleteKunjungan:', err);
        return res.status(500).json({ 
          message: 'Gagal menghapus data kunjungan',
          error: err.message 
        });
      }
      
      // Clean up files
      const record = results[0];
      const filesToDelete = [];
      
      if (record.surat_pengantar) {
        filesToDelete.push({
          path: path.join(__dirname, '../uploads/surat_pengantar/', record.surat_pengantar),
          name: record.surat_pengantar,
          type: 'surat_pengantar'
        });
      }
      
      if (record.surat_balasan) {
        filesToDelete.push({
          path: path.join(__dirname, '../uploads/surat_balasan/', record.surat_balasan),
          name: record.surat_balasan,
          type: 'surat_balasan'
        });
      }
      
      // Delete files
      filesToDelete.forEach(file => {
        fs.unlink(file.path, (unlinkErr) => {
          if (unlinkErr) {
            console.log(`⚠️ File ${file.type} tidak ditemukan atau sudah terhapus:`, file.name);
          } else {
            console.log(`✅ File ${file.type} berhasil dihapus:`, file.name);
          }
        });
      });
      
      console.log('✅ Kunjungan deleted successfully');
      res.status(200).json({ message: 'Data kunjungan berhasil dihapus' });
    });
  });
};

// GET /api/kunjungan/:id - Get single visit detail
exports.getKunjunganById = (req, res) => {
  console.log(`🔍 getKunjunganById called for ID: ${req.params.id}`);
  
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'ID kunjungan tidak valid' });
  }

  const sql = `SELECT * FROM kunjungan WHERE id = ?`;
  
  db.query(sql, [id], (err, results) => {
    if (err) {
      console.error('❌ Error in getKunjunganById:', err);
      return res.status(500).json({ 
        message: 'Gagal mengambil data kunjungan',
        error: err.message 
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
    }
    
    console.log('✅ Kunjungan detail retrieved');
    res.status(200).json(results[0]);
  });
};

// GET /api/kunjungan/status/:status - Filter by status
exports.getKunjunganByStatus = (req, res) => {
  console.log(`🔍 getKunjunganByStatus called for status: ${req.params.status}`);
  
  const { status } = req.params;
  
  const allowedStatuses = ['pending', 'diterima', 'ditolak'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ 
      message: 'Status tidak valid',
      received: status,
      allowed: allowedStatuses
    });
  }
  
  const sql = `SELECT * FROM kunjungan WHERE status = ? ORDER BY created_at DESC`;
  
  db.query(sql, [status], (err, results) => {
    if (err) {
      console.error('❌ Error in getKunjunganByStatus:', err);
      return res.status(500).json({ 
        message: 'Gagal mengambil data kunjungan berdasarkan status',
        error: err.message 
      });
    }
    
    console.log(`✅ Found ${results.length} kunjungan with status: ${status}`);
    res.status(200).json(results);
  });
};