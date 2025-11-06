// Perbaikan untuk pklController.js dengan fitur alasan penolakan
const db = require('../db');
const path = require('path');
const fs = require('fs');

// Helper function to handle file uploads
const handleFileUpload = (file, uploadDir, fieldName) => {
  if (!file) return null;
  
  // Ensure upload directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const ext = path.extname(file.originalname);
  const filename = `${fieldName}-${Date.now()}${ext}`;
  const filepath = path.join(uploadDir, filename);

  // Move the file to upload directory
  fs.renameSync(file.path, filepath);

  return filename;
};

exports.daftarPKL = async (req, res) => {
  try {
    const uploadDir = path.join(__dirname, '../uploads/pkl');
    
    // Handle file uploads
    const surat_pengantar = handleFileUpload(req.files['surat_pengantar']?.[0], uploadDir, 'surat_pengantar');
    const cv = handleFileUpload(req.files['cv']?.[0], uploadDir, 'cv');
    const nilai_raport_transkrip = handleFileUpload(req.files['nilai_raport_transkrip']?.[0], uploadDir, 'nilai_raport');
    const kartu_pelajar = handleFileUpload(req.files['kartu_pelajar']?.[0], uploadDir, 'kartu_pelajar');
    const foto_id_card = handleFileUpload(req.files['foto_id_card']?.[0], uploadDir, 'foto_id');

    // Validate required files
    if (!surat_pengantar || !cv || !nilai_raport_transkrip || !kartu_pelajar || !foto_id_card) {
      return res.status(400).json({ message: 'Semua dokumen pendukung wajib diunggah' });
    }

    // Prepare data for database
    const pklData = {
      ...req.body,
      surat_pengantar,
      cv,
      nilai_raport_transkrip,
      kartu_pelajar,
      foto_id_card,
      status: 'pending'
    };

    // SQL query with all fields
    const sql = `
      INSERT INTO pkl (
        nama_lengkap, asal_instansi, nim_nisn, jurusan, no_hp, email,
        tanggal_mulai, tanggal_selesai, surat_pengantar, status, cv,
        nilai_raport_transkrip, kartu_pelajar, foto_id_card, portofolio_link,
        deskripsi_diri, unit_kerja, bulan_pkl, tempat_lahir, tanggal_lahir,
        jenjang_pendidikan, jangka_waktu, jangka_waktu_lainnya, alasan_pilih_tvri
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      pklData.nama_lengkap,
      pklData.asal_instansi,
      pklData.nim_nisn,
      pklData.jurusan,
      pklData.no_hp,
      pklData.email,
      pklData.tanggal_mulai,
      pklData.tanggal_selesai,
      pklData.surat_pengantar,
      pklData.status,
      pklData.cv,
      pklData.nilai_raport_transkrip,
      pklData.kartu_pelajar,
      pklData.foto_id_card,
      pklData.portofolio_link,
      pklData.deskripsi_diri,
      pklData.unit_kerja,
      pklData.bulan_pkl,
      pklData.tempat_lahir,
      pklData.tanggal_lahir,
      pklData.jenjang_pendidikan,
      pklData.jangka_waktu,
      pklData.jangka_waktu_lainnya || null,
      pklData.alasan_pilih_tvri
    ];

    // Execute query
    db.query(sql, values, (err, result) => {
      if (err) {
        console.error('Gagal menyimpan data PKL:', err);
        return res.status(500).json({ message: 'Gagal menyimpan data PKL', error: err.message });
      }

      // Emit notification if using socket.io
      if (req.io) {
        req.io.emit('notification', `Pengajuan PKL baru dari ${pklData.nama_lengkap}`);
      }

      res.status(201).json({ 
        message: 'Pendaftaran PKL berhasil',
        data: {
          id: result.insertId,
          nama: pklData.nama_lengkap,
          status: pklData.status
        }
      });
    });

  } catch (error) {
    console.error('Error in daftarPKL:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server', error: error.message });
  }
};

// Delete data
exports.deletePKL = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Validasi ID
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        message: 'ID PKL tidak valid',
        received: id
      });
    }

    // 2. Cek data dan ambil nama file-file yang perlu dihapus
    db.query('SELECT surat_pengantar, cv, nilai_raport_transkrip, kartu_pelajar, foto_id_card FROM pkl WHERE id = ?', 
    [id], (err, results) => {
      if (err) {
        console.error('Error fetching PKL files:', err);
        return res.status(500).json({ 
          message: 'Gagal memeriksa data PKL',
          error: err.message 
        });
      }
      
      if (results.length === 0) {
        return res.status(404).json({ 
          message: 'Data PKL tidak ditemukan' 
        });
      }

      const pklFiles = results[0];
      const filesToDelete = Object.values(pklFiles).filter(Boolean);

      // 3. Hapus data dari database
      db.query('DELETE FROM pkl WHERE id = ?', [id], (deleteErr, deleteResult) => {
        if (deleteErr) {
          console.error('Error deleting PKL:', deleteErr);
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

        // 4. Hapus file-file terkait dari sistem file
        const uploadDir = path.join(__dirname, '../uploads/pkl');
        let filesDeleted = 0;
        let filesFailed = 0;

        filesToDelete.forEach(filename => {
          const filePath = path.join(uploadDir, filename);
          
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error(`Gagal menghapus file ${filename}:`, unlinkErr);
              filesFailed++;
            } else {
              console.log(`Berhasil menghapus file ${filename}`);
              filesDeleted++;
            }
          });
        });

        // 5. Kirim notifikasi ke frontend jika menggunakan socket.io
        if (req.io) {
          req.io.emit('pkl-deleted', { id: parseInt(id) });
        }

        res.json({
          message: 'Data PKL berhasil dihapus',
          data: {
            id: parseInt(id),
            affectedRows: deleteResult.affectedRows,
            filesDeleted,
            filesFailed
          }
        });
      });
    });
  } catch (error) {
    console.error('Error in deletePKL:', error);
    res.status(500).json({ 
      message: 'Terjadi kesalahan server', 
      error: error.message 
    });
  }
};

// Get all PKL registrations
exports.getAllPKL = (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM pkl ORDER BY created_at DESC';
  let params = [];

  if (status) {
    sql = 'SELECT * FROM pkl WHERE status = ? ORDER BY created_at DESC';
    params = [status];
  }

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Gagal mengambil data PKL:', err);
      return res.status(500).json({ message: 'Gagal mengambil data PKL' });
    }
    res.json(results);
  });
};

// Update PKL status dengan alasan penolakan
exports.updateStatus = async (req, res) => {
  const { id } = req.params;
  const { status, alasan_penolakan } = req.body;

  // Validasi status
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ 
      message: 'Status tidak valid. Status yang diizinkan: pending, approved, rejected' 
    });
  }

  // Validasi alasan penolakan untuk status rejected
  if (status === 'rejected') {
    if (!alasan_penolakan || alasan_penolakan.trim().length < 10) {
      return res.status(400).json({ 
        message: 'Alasan penolakan harus diisi minimal 10 karakter' 
      });
    }
  }

  try {
    // Ambil data PKL untuk keperluan email/notifikasi
    db.query('SELECT nama_lengkap, email FROM pkl WHERE id = ?', [id], (err, results) => {
      if (err) {
        console.error('Error fetching PKL data:', err);
        return res.status(500).json({ 
          message: 'Gagal mengambil data PKL',
          error: err.message 
        });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: 'Data PKL tidak ditemukan' });
      }

      const pklData = results[0];
      
      // Tentukan SQL query berdasarkan status
      let sql, params;
      
      if (status === 'rejected') {
        sql = 'UPDATE pkl SET status = ?, alasan_penolakan = ? WHERE id = ?';
        params = [status, alasan_penolakan.trim(), id];
      } else {
        sql = 'UPDATE pkl SET status = ?, alasan_penolakan = NULL WHERE id = ?';
        params = [status, id];
      }

      console.log('Updating PKL status:', { id, status, sql, params });

      // Update database
      db.query(sql, params, async (updateErr, result) => {
        if (updateErr) {
          console.error('Gagal mengupdate status PKL:', updateErr);
          return res.status(500).json({ 
            message: 'Gagal mengupdate status PKL',
            error: updateErr.message 
          });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({ message: 'Data PKL tidak ditemukan' });
        }

        console.log('PKL status updated successfully:', { 
          id, 
          status, 
          affectedRows: result.affectedRows,
          alasan_penolakan: status === 'rejected' ? alasan_penolakan : null
        });

        // Kirim email notifikasi (opsional)
        try {
          await sendStatusUpdateEmail(pklData, status, alasan_penolakan);
        } catch (emailError) {
          console.error('Error sending email:', emailError);
          // Tidak return error karena update database sudah berhasil
        }

        // Emit notification jika menggunakan socket.io
        if (req.io) {
          req.io.emit('pkl-status-updated', { 
            id: parseInt(id), 
            status,
            nama: pklData.nama_lengkap,
            alasan_penolakan: status === 'rejected' ? alasan_penolakan : null
          });
        }

        res.json({ 
          message: `Status PKL berhasil diubah menjadi ${status}`,
          status: status,
          affectedRows: result.affectedRows,
          data: {
            id: parseInt(id),
            nama_lengkap: pklData.nama_lengkap,
            status: status,
            alasan_penolakan: status === 'rejected' ? alasan_penolakan : null
          }
        });
      });
    });
  } catch (error) {
    console.error('Error in updateStatus:', error);
    res.status(500).json({ 
      message: 'Terjadi kesalahan server', 
      error: error.message 
    });
  }
};

// Helper function untuk mengirim email notifikasi (opsional)
const sendStatusUpdateEmail = async (pklData, status, alasanPenolakan = null) => {
  // Import nodemailer jika diperlukan
  // const nodemailer = require('nodemailer');
  
  try {
    // Konfigurasi email (sesuaikan dengan setup Anda)
    /*
    const transporter = nodemailer.createTransporter({
      // Konfigurasi SMTP
    });

    let subject, htmlContent;

    if (status === 'approved') {
      subject = 'Pengajuan PKL Anda Diterima - TVRI';
      htmlContent = `
        <h2>Selamat! Pengajuan PKL Anda Diterima</h2>
        <p>Yth. ${pklData.nama_lengkap},</p>
        <p>Kami dengan senang hati memberitahukan bahwa pengajuan PKL Anda telah <strong>diterima</strong>.</p>
        <p>Tim kami akan segera menghubungi Anda untuk proses selanjutnya.</p>
        <br>
        <p>Terima kasih,<br>Tim TVRI</p>
      `;
    } else if (status === 'rejected') {
      subject = 'Pemberitahuan Pengajuan PKL - TVRI';
      htmlContent = `
        <h2>Pemberitahuan Pengajuan PKL</h2>
        <p>Yth. ${pklData.nama_lengkap},</p>
        <p>Terima kasih atas minat Anda untuk melakukan PKL di TVRI.</p>
        <p>Setelah melalui proses evaluasi, kami informasikan bahwa pengajuan PKL Anda belum dapat kami terima dengan alasan:</p>
        <div style="background-color: #fef2f2; border-left: 4px solid #f87171; padding: 12px; margin: 16px 0;">
          <p style="color: #7f1d1d; margin: 0;"><strong>Alasan:</strong></p>
          <p style="color: #7f1d1d; margin: 8px 0 0 0;">${alasanPenolakan}</p>
        </div>
        <p>Anda dapat memperbaiki hal-hal yang disebutkan di atas dan mengajukan kembali di masa mendatang.</p>
        <br>
        <p>Terima kasih atas pengertiannya,<br>Tim TVRI</p>
      `;
    }

    if (subject && htmlContent) {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || 'noreply@tvri.go.id',
        to: pklData.email,
        subject: subject,
        html: htmlContent
      });
      
      console.log(`Email notifikasi ${status} berhasil dikirim ke ${pklData.email}`);
    }
    */
    
    // Log notifikasi (sementara sampai email dikonfigurasi)
    console.log(`Status update notification: ${pklData.nama_lengkap} (${pklData.email}) - Status: ${status}`);
    if (status === 'rejected') {
      console.log(`Alasan penolakan: ${alasanPenolakan}`);
    }
    
  } catch (error) {
    console.error('Error sending status update email:', error);
    throw error;
  }
};

// Get single PKL registration
exports.getPKLById = (req, res) => {
  const { id } = req.params;

  db.query('SELECT * FROM pkl WHERE id = ?', [id], (err, results) => {
    if (err) {
      console.error('Gagal mengambil data PKL:', err);
      return res.status(500).json({ message: 'Gagal mengambil data PKL' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Data PKL tidak ditemukan' });
    }

    res.json(results[0]);
  });
};