const express = require('express');
const router = express.Router();
const { 
  loginAdmin,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  toggleUserStatus,
  changePassword // ✅ TAMBAHKAN INI
} = require('../controllers/adminController');

// 🔐 Login Route (sudah ada)
router.post('/login', (req, res, next) => {
  console.log('🔥 POST /api/admin/login masuk');
  next();
}, loginAdmin);

// 🔑 CHANGE PASSWORD - TAMBAHKAN INI
router.put('/change-password', (req, res, next) => {
  console.log('🔥 PUT /api/admin/change-password masuk');
  console.log('📝 Data:', {
    current_password: req.body.current_password ? '***' : 'MISSING',
    new_password: req.body.new_password ? '***' : 'MISSING',
    confirm_password: req.body.confirm_password ? '***' : 'MISSING',
    username: req.body.username || 'NOT PROVIDED'
  });
  next();
}, changePassword);

// 📋 Get All Users - GET /api/admin/users
router.get('/users', (req, res, next) => {
  console.log('🔥 GET /api/admin/users masuk');
  next();
}, getAllUsers);

// ➕ Create New User - POST /api/admin/users
router.post('/users', (req, res, next) => {
  console.log('🔥 POST /api/admin/users masuk');
  console.log('📝 Data:', req.body);
  next();
}, createUser);

// ✏️ Update User - PUT /api/admin/users/:id
router.put('/users/:id', (req, res, next) => {
  console.log(`🔥 PUT /api/admin/users/${req.params.id} masuk`);
  console.log('📝 Data:', req.body);
  next();
}, updateUser);

// 🗑️ Delete User - DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res, next) => {
  console.log(`🔥 DELETE /api/admin/users/${req.params.id} masuk`);
  next();
}, deleteUser);

// 🔄 Toggle User Status - PATCH /api/admin/users/:id/toggle-status
router.patch('/users/:id/toggle-status', (req, res, next) => {
  console.log(`🔥 PATCH /api/admin/users/${req.params.id}/toggle-status masuk`);
  next();
}, toggleUserStatus);

module.exports = router;