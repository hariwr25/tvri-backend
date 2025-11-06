const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const kunjunganController = require('../controllers/kunjunganController');

module.exports = function(io) {
  const router = express.Router();

  // Configure express-fileupload middleware
  router.use(fileUpload({
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    abortOnLimit: true,
    useTempFiles: true,
    tempFileDir: '/tmp/',
    createParentPath: true,
    safeFileNames: true,
    preserveExtension: 4
  }));

  // Middleware untuk menambahkan io ke request
  router.use((req, res, next) => {
    req.io = io;
    next();
  });

  // ===== ROUTES - URUTAN SANGAT PENTING =====

  // DEBUGGING: Test route untuk memastikan routes berfungsi
  router.get('/test', (req, res) => {
    res.json({ message: 'Kunjungan routes is working!', timestamp: new Date() });
  });

  // GET /api/kunjungan/check-availability/:date - HARUS PALING ATAS
  router.get('/check-availability/:date', (req, res) => {
    console.log('🔍 Route check-availability called with date:', req.params.date);
    kunjunganController.checkAvailability(req, res);
  });

  // GET /api/kunjungan/status/:status - Route kedua
  router.get('/status/:status', kunjunganController.getKunjunganByStatus);

  // GET /api/kunjungan - Get all visits (untuk dashboard admin)
  router.get('/', kunjunganController.getAllKunjungan);

  // POST /api/kunjungan - Create new visit (dengan file upload)
  router.post('/', (req, res, next) => {
    console.log('POST route called with file:', req.files ? Object.keys(req.files) : 'no files');
    console.log('POST route body:', req.body);
    
    // Handle surat_pengantar upload
    if (req.files && req.files.surat_pengantar) {
      const file = req.files.surat_pengantar;
      
      // Validate file type
      const allowedTypes = [
        'application/pdf',
        'image/jpeg', 
        'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(422).json({
          message: 'Format file tidak valid. Hanya PDF, DOC, DOCX, JPEG, PNG yang diizinkan',
          received: file.mimetype
        });
      }

      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileExtension = path.extname(file.name);
      const fileName = `surat_pengantar_${timestamp}${fileExtension}`;
      
      // Ensure upload directory exists
      const uploadDir = path.join(__dirname, '../uploads/surat_pengantar');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      const filePath = path.join(uploadDir, fileName);
      
      // Move uploaded file
      file.mv(filePath, (err) => {
        if (err) {
          console.error('Error moving surat_pengantar file:', err);
          return res.status(500).json({
            message: 'Gagal menyimpan file surat pengantar',
            error: err.message
          });
        }
        
        // Add filename to request body
        req.body.surat_pengantar = fileName;
        proceedWithCreation();
      });
    } else {
      proceedWithCreation();
    }

    function proceedWithCreation() {
      // Validasi field waktu sebelum melanjutkan
      const { waktu, tanggal_kunjungan } = req.body;
      if (waktu && !['sesi1', 'sesi2'].includes(waktu)) {
        return res.status(400).json({
          message: 'Waktu tidak valid. Pilihan: sesi1 atau sesi2',
          received: waktu
        });
      }
      
      // Emit real-time notification untuk admin
      if (req.io) {
        const kontakPerson = req.body.kontak_person;
        const namaInstansi = req.body.nama_instansi;
        
        req.io.emit('newKunjunganRequest', {
          message: `Pengajuan kunjungan baru dari ${kontakPerson || 'Unknown'} - ${namaInstansi || 'Unknown'}`,
          type: 'kunjungan',
          tanggal: tanggal_kunjungan || 'tidak ditentukan',
          waktu: waktu || 'tidak ditentukan',
          timestamp: new Date()
        });
      }
      
      kunjunganController.daftarKunjungan(req, res, next);
    }
  });

  // GET /api/kunjungan/:id - Get single visit detail
  router.get('/:id', kunjunganController.getKunjunganById);

  // PUT /api/kunjungan/:id - Update visit status (with file upload support)
  router.put('/:id', (req, res, next) => {
    console.log(`PUT route called for ID: ${req.params.id}`);
    console.log('PUT route body:', req.body);
    console.log('PUT route files:', req.files ? Object.keys(req.files) : 'no files');
    
    // Validasi waktu jika ada
    if (req.body.waktu && !['sesi1', 'sesi2'].includes(req.body.waktu)) {
      return res.status(400).json({
        message: 'Waktu tidak valid. Pilihan: sesi1 atau sesi2',
        received: req.body.waktu
      });
    }
    
    const originalSend = res.send;
    res.send = function(data) {
      // Emit notification setelah berhasil update
      if (res.statusCode === 200 && req.io) {
        const { status, waktu } = req.body;
        req.io.emit('kunjunganStatusUpdate', {
          id: req.params.id,
          status: status,
          waktu: waktu,
          message: status === 'diterima' 
            ? 'Kunjungan telah disetujui'
            : status === 'ditolak'
            ? 'Kunjungan ditolak'
            : 'Status kunjungan diperbarui',
          timestamp: new Date()
        });
      }
      originalSend.call(this, data);
    };
    
    kunjunganController.updateKunjungan(req, res, next);
  });

  // DELETE /api/kunjungan/:id - Delete visit
  router.delete('/:id', kunjunganController.deleteKunjungan);

  // GET /api/kunjungan/:id/download/surat-pengantar - Download surat pengantar
  router.get('/:id/download/surat-pengantar', async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`Download surat pengantar route called for ID: ${id}`);
      
      // Get file info from database
      const db = require('../db');
      const sql = 'SELECT surat_pengantar FROM kunjungan WHERE id = ?';
      
      db.query(sql, [id], (err, results) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ message: 'Gagal mengambil data file' });
        }
        
        if (results.length === 0) {
          return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
        }
        
        const fileName = results[0].surat_pengantar;
        if (!fileName) {
          return res.status(404).json({ message: 'File surat pengantar tidak ada' });
        }
        
        const filePath = path.join(__dirname, '../uploads/surat_pengantar', fileName);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ message: 'File tidak ditemukan di server' });
        }
        
        // Set appropriate headers
        const ext = path.extname(fileName).toLowerCase();
        let contentType = 'application/octet-stream';
        
        switch (ext) {
          case '.pdf':
            contentType = 'application/pdf';
            break;
          case '.doc':
            contentType = 'application/msword';
            break;
          case '.docx':
            contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            break;
          case '.jpg':
          case '.jpeg':
            contentType = 'image/jpeg';
            break;
          case '.png':
            contentType = 'image/png';
            break;
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        
        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
        fileStream.on('error', (err) => {
          console.error('File stream error:', err);
          if (!res.headersSent) {
            res.status(500).json({ message: 'Gagal mengunduh file' });
          }
        });
      });
      
    } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({ message: 'Terjadi kesalahan saat mengunduh file' });
    }
  });

  // GET /api/kunjungan/:id/download/surat-balasan - Download surat balasan
  router.get('/:id/download/surat-balasan', async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`Download surat balasan route called for ID: ${id}`);
      
      // Get file info from database
      const db = require('../db');
      const sql = 'SELECT surat_balasan FROM kunjungan WHERE id = ?';
      
      db.query(sql, [id], (err, results) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ message: 'Gagal mengambil data file' });
        }
        
        if (results.length === 0) {
          return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
        }
        
        const fileName = results[0].surat_balasan;
        if (!fileName) {
          return res.status(404).json({ message: 'File surat balasan tidak ada' });
        }
        
        const filePath = path.join(__dirname, '../uploads/surat_balasan', fileName);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ message: 'File tidak ditemukan di server' });
        }
        
        // Set appropriate headers
        const ext = path.extname(fileName).toLowerCase();
        let contentType = 'application/octet-stream';
        
        switch (ext) {
          case '.pdf':
            contentType = 'application/pdf';
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
        
        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
        fileStream.on('error', (err) => {
          console.error('File stream error:', err);
          if (!res.headersSent) {
            res.status(500).json({ message: 'Gagal mengunduh file' });
          }
        });
      });
      
    } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({ message: 'Terjadi kesalahan saat mengunduh file' });
    }
  });

  // Route untuk update waktu khusus (jika diperlukan)
  router.patch('/:id/waktu', (req, res, next) => {
    console.log(`PATCH waktu route called for ID: ${req.params.id}`);
    console.log('PATCH waktu body:', req.body);
    
    const { id } = req.params;
    const { waktu } = req.body;
    
    // Validasi waktu
    if (!waktu || !['sesi1', 'sesi2'].includes(waktu)) {
      return res.status(400).json({
        message: 'Waktu tidak valid. Pilihan: sesi1 atau sesi2',
        received: waktu
      });
    }
    
    // Update hanya field waktu
    const db = require('../db');
    const sql = `UPDATE kunjungan SET waktu = ?, updated_at = NOW() WHERE id = ?`;
    
    db.query(sql, [waktu, id], (err, result) => {
      if (err) {
        console.error('Error updating waktu:', err);
        return res.status(500).json({ 
          message: 'Gagal mengupdate waktu kunjungan',
          error: err.message 
        });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Data kunjungan tidak ditemukan' });
      }
      
      console.log('Waktu kunjungan updated to:', waktu);
      res.status(200).json({ 
        message: 'Waktu kunjungan berhasil diupdate',
        waktu: waktu 
      });
    });
  });

  // Static file serving untuk akses langsung file
  router.use('/uploads/surat_pengantar', express.static(path.join(__dirname, '../uploads/surat_pengantar')));
  router.use('/uploads/surat_balasan', express.static(path.join(__dirname, '../uploads/surat_balasan')));

  // Error handling middleware
  router.use((err, req, res, next) => {
    console.error('Router error:', err);
    
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(422).json({ 
        message: 'Ukuran file terlalu besar, maksimal 5MB',
        error: 'FILE_TOO_LARGE'
      });
    }
    
    res.status(500).json({ 
      message: 'Terjadi kesalahan server',
      error: err.message 
    });
  });

  return router;
};