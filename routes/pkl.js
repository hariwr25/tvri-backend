// routes/pkl.js - Updated dengan support alasan penolakan
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pklController = require('../controllers/pklController');

module.exports = function(io) {
  const router = express.Router();

  // Configure multer for file uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '../uploads/pkl');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const filename = `${file.fieldname}-${Date.now()}${ext}`;
      cb(null, filename);
    }
  });

  const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
      const allowedTypes = {
        'surat_pengantar': ['application/pdf'],
        'cv': ['application/pdf'],
        'nilai_raport_transkrip': ['application/pdf', 'image/jpeg', 'image/png'],
        'kartu_pelajar': ['application/pdf', 'image/jpeg', 'image/png'],
        'foto_id_card': ['image/jpeg', 'image/png']
      };

      if (!allowedTypes[file.fieldname]?.includes(file.mimetype)) {
        const error = new Error('Invalid file type');
        error.code = 'LIMIT_FILE_TYPES';
        return cb(error, false);
      }

      cb(null, true);
    }
  });

  // Handle multiple file uploads for registration
  const uploadFields = upload.fields([
    { name: 'surat_pengantar', maxCount: 1 },
    { name: 'cv', maxCount: 1 },
    { name: 'nilai_raport_transkrip', maxCount: 1 },
    { name: 'kartu_pelajar', maxCount: 1 },
    { name: 'foto_id_card', maxCount: 1 }
  ]);

  // Middleware to attach io instance
  router.use((req, res, next) => {
    req.io = io;
    next();
  });

  // === ROUTES ===

  // POST /api/pkl - Daftar PKL baru
  router.post('/', uploadFields, pklController.daftarPKL);
  
  // GET /api/pkl - Get semua data PKL (dengan optional filter status)
  router.get('/', pklController.getAllPKL);
  
  // GET /api/pkl/:id - Get data PKL berdasarkan ID
  router.get('/:id', pklController.getPKLById);
  
  // PUT /api/pkl/:id - Update status PKL
  router.put('/:id', (req, res, next) => {
    // Log untuk debugging
    console.log('PUT /api/pkl/:id called with:', {
      id: req.params.id,
      body: req.body
    });
    
    // Update status (approved/rejected/pending dengan alasan penolakan jika rejected)
    pklController.updateStatus(req, res);
  });

  // DEPRECATED: Endpoint lama untuk backward compatibility
  router.put('/:id/status', pklController.updateStatus);
  
  // DELETE /api/pkl/:id - Hapus data PKL
  router.delete('/:id', pklController.deletePKL);

  // === MIDDLEWARE ERROR HANDLERS ===
  
  // Handle multer errors
  router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(422).json({ 
          message: 'Ukuran file terlalu besar, maksimal 5MB',
          error: 'FILE_TOO_LARGE'
        });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(422).json({ 
          message: 'Terlalu banyak file',
          error: 'TOO_MANY_FILES'
        });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(422).json({ 
          message: 'Field file tidak dikenali',
          error: 'UNEXPECTED_FIELD'
        });
      }
    }
    
    if (err.code === 'LIMIT_FILE_TYPES') {
      return res.status(422).json({ 
        message: 'Format file tidak valid',
        error: 'INVALID_FILE_TYPE'
      });
    }
    
    // Log error untuk debugging
    console.error('Unhandled error in PKL routes:', err);
    next(err);
  });

  return router;
};