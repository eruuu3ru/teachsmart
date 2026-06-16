const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { getDb } = require('../database/init');
const { requireAdmin } = require('../middleware/auth');
const { generateUniqueId, generatePassword } = require('../utils/idGenerator');

// Configure multer storage for secure PDF uploads
const pdfStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'data', 'pdfs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const productId = parseInt(req.params.productId);
    cb(null, `${productId}.pdf`);
  }
});

const uploadPdf = multer({
  storage: pdfStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  }
});

// Admin Dashboard
router.get('/', requireAdmin, (req, res) => {
  const db = getDb();

  const stats = {
    totalUsers: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user'").get().count,
    pendingOrders: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get().count,
    verifiedOrders: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'verified'").get().count,
    totalRevenue: db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM orders WHERE status = 'verified'").get().total,
    todayOrders: db.prepare("SELECT COUNT(*) as count FROM orders WHERE DATE(created_at) = DATE('now')").get().count,
  };

  const recentOrders = db.prepare(`
    SELECT o.*, u.full_name, u.email, p.name as product_name, p.category
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN products p ON o.product_id = p.id
    ORDER BY o.created_at DESC
    LIMIT 10
  `).all();

  res.render('admin/dashboard', {
    title: 'Admin Dashboard — TeachSmart Academy',
    stats,
    recentOrders,
    user: req.session
  });
});

// Orders Management
router.get('/orders', requireAdmin, (req, res) => {
  const db = getDb();
  const filter = req.query.filter || 'all';

  // Fetch all orders (we filter after grouping to keep transactions whole)
  const query = `
    SELECT o.*, u.full_name, u.email, u.unique_id as user_unique_id, u.phone, u.plain_password,
           p.name as product_name, p.category, p.price
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN products p ON o.product_id = p.id
    ORDER BY o.created_at DESC
  `;

  const orders = db.prepare(query).all();

  // Group by transaction reference
  const transactions = [];
  const txnMap = {};

  orders.forEach(order => {
    let txnId = order.payment_reference;
    let paymentRef = order.payment_reference;
    if (order.payment_reference && order.payment_reference.includes('|')) {
      const parts = order.payment_reference.split('|');
      txnId = parts[0];
      paymentRef = parts[1];
    }

    if (!txnMap[txnId]) {
      txnMap[txnId] = {
        txnId: txnId,
        paymentRef: paymentRef,
        userId: order.user_id,
        fullName: order.full_name,
        email: order.email,
        phone: order.phone,
        uniqueId: order.user_unique_id,
        plainPassword: order.plain_password,
        paymentMethod: order.payment_method,
        createdAt: order.created_at,
        status: 'pending',
        items: [],
        total: 0
      };
      transactions.push(txnMap[txnId]);
    }

    txnMap[txnId].items.push({
      id: order.id,
      productName: order.product_name,
      category: order.category,
      price: order.price,
      status: order.status
    });

    txnMap[txnId].total += order.price;
  });

  // Determine aggregate status
  transactions.forEach(txn => {
    const statuses = txn.items.map(i => i.status);
    if (statuses.includes('pending')) {
      txn.status = 'pending';
    } else if (statuses.every(s => s === 'verified')) {
      txn.status = 'verified';
    } else if (statuses.every(s => s === 'rejected')) {
      txn.status = 'rejected';
    } else {
      txn.status = 'mixed';
    }
  });

  // Filter based on query
  let filteredTxns = transactions;
  if (filter !== 'all') {
    filteredTxns = transactions.filter(t => t.status === filter);
  }

  res.render('admin/orders', {
    title: 'Manage Orders — TeachSmart Academy',
    transactions: filteredTxns,
    filter,
    user: req.session
  });
});

// Verify Transaction / Batch Orders
router.post('/orders/transaction/:txnId/verify', requireAdmin, async (req, res) => {
  const db = getDb();
  const txnId = req.params.txnId;

  // Find all orders belonging to this transaction reference
  const orders = db.prepare(`
    SELECT o.*, u.email, u.full_name, u.unique_id, u.id as uid, p.name as product_name, p.category
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN products p ON o.product_id = p.id
    WHERE o.payment_reference = ? OR o.payment_reference LIKE ?
  `).all(txnId, txnId + '|%');

  if (orders.length === 0) {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    return res.redirect('/admin/orders');
  }

  const userId = orders[0].uid;

  // Generate single new password for the user
  const newPassword = generatePassword();
  const passwordHash = bcrypt.hashSync(newPassword, 10);

  try {
    const updateStmt = db.prepare(
      'UPDATE orders SET status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    for (const o of orders) {
      updateStmt.run('verified', req.session.userId, o.id);
    }
    db.prepare('UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?').run(passwordHash, newPassword, userId);
  } catch (err) {
    console.error('Database update failed:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(500).json({ success: false, error: 'Failed to verify transaction' });
    }
    return res.redirect('/admin/orders');
  }

  // Fetch all verified products for this user (to include in welcome email)
  const allUserOrders = db.prepare(`
    SELECT o.*, p.name as product_name, p.category
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.user_id = ? AND o.status = 'verified'
  `).all(userId);

  // Send credentials email
  try {
    const { sendCredentials } = require('../utils/email');
    await sendCredentials(
      orders[0].email,
      orders[0].full_name,
      orders[0].unique_id,
      newPassword,
      allUserOrders.map(o => ({ category: o.category, name: o.product_name }))
    );
  } catch (e) {
    console.error('Email sending failed:', e);
  }

  // Flash credentials for admin
  const creds = {
    uniqueId: orders[0].unique_id,
    password: newPassword,
    email: orders[0].email,
    fullName: orders[0].full_name
  };
  req.session.flashCredentials = creds;

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
    return res.json({
      success: true,
      status: 'verified',
      credentials: creds
    });
  }

  res.redirect('/admin/orders?verified=true');
});

// Reject Transaction / Batch Orders
router.post('/orders/transaction/:txnId/reject', requireAdmin, async (req, res) => {
  const db = getDb();
  const txnId = req.params.txnId;

  // Find all orders belonging to this transaction reference
  const orders = db.prepare(`
    SELECT o.*, u.email, u.full_name, u.id as uid, p.name as product_name, p.category
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN products p ON o.product_id = p.id
    WHERE o.payment_reference = ? OR o.payment_reference LIKE ?
  `).all(txnId, txnId + '|%');

  if (orders.length === 0) {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    return res.redirect('/admin/orders');
  }

  // Update status to rejected
  try {
    const updateStmt = db.prepare(
      'UPDATE orders SET status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    for (const o of orders) {
      updateStmt.run('rejected', req.session.userId, o.id);
    }
  } catch (err) {
    console.error('Database update failed:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(500).json({ success: false, error: 'Failed to reject transaction' });
    }
    return res.redirect('/admin/orders');
  }

  // Send rejection email
  try {
    const { sendRejection } = require('../utils/email');
    await sendRejection(
      orders[0].email,
      orders[0].full_name,
      txnId.includes('|') ? txnId.split('|')[1] : txnId,
      orders.map(o => ({ category: o.category, name: o.product_name }))
    );
  } catch (e) {
    console.error('Rejection email sending failed:', e);
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
    return res.json({
      success: true,
      status: 'rejected'
    });
  }

  res.redirect('/admin/orders');
});

// Delete Transaction / Batch Orders
router.post('/orders/transaction/:txnId/delete', requireAdmin, (req, res) => {
  const db = getDb();
  const txnId = req.params.txnId;

  try {
    db.prepare('DELETE FROM orders WHERE payment_reference = ? OR payment_reference LIKE ?').run(txnId, txnId + '|%');
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.json({ success: true });
    }
    res.redirect('/admin/orders');
  } catch (err) {
    console.error('Failed to delete transaction:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.redirect('/admin/orders');
  }
});

// Verify Individual Order (from dashboard quick-verify)
router.post('/orders/:id/verify', requireAdmin, async (req, res) => {
  const db = getDb();
  const orderId = parseInt(req.params.id);

  const order = db.prepare(`
    SELECT o.*, u.email, u.full_name, u.unique_id, u.id as uid, p.name as product_name, p.category
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN products p ON o.product_id = p.id
    WHERE o.id = ?
  `).get(orderId);

  if (!order) {
    return res.redirect('/admin');
  }

  const userId = order.uid;
  const newPassword = generatePassword();
  const passwordHash = bcrypt.hashSync(newPassword, 10);

  try {
    db.prepare('UPDATE orders SET status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('verified', req.session.userId, orderId);
    db.prepare('UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?').run(passwordHash, newPassword, userId);
  } catch (err) {
    console.error('Failed to verify order:', err);
    return res.redirect('/admin');
  }

  try {
    const { sendCredentials } = require('../utils/email');
    const allUserOrders = db.prepare(`
      SELECT o.*, p.name as product_name, p.category
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.user_id = ? AND o.status = 'verified'
    `).all(userId);
    await sendCredentials(
      order.email,
      order.full_name,
      order.unique_id,
      newPassword,
      allUserOrders.map(o => ({ category: o.category, name: o.product_name }))
    );
  } catch (e) {
    console.error('Email sending failed:', e);
  }

  req.session.flashCredentials = {
    uniqueId: order.unique_id,
    password: newPassword,
    email: order.email,
    fullName: order.full_name
  };

  res.redirect('/admin?verified=true');
});

// Users Management
router.get('/users', requireAdmin, (req, res) => {
  const db = getDb();

  const users = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM orders WHERE user_id = u.id AND status = 'verified') as purchased_count,
      (SELECT COUNT(*) FROM device_sessions WHERE user_id = u.id AND is_active = 1) as active_devices
    FROM users u
    WHERE role = 'user'
    ORDER BY u.created_at DESC
  `).all();

  res.render('admin/users', {
    title: 'Manage Users — TeachSmart Academy',
    users,
    user: req.session
  });
});

// Toggle User Active
router.post('/users/:id/toggle', requireAdmin, (req, res) => {
  const db = getDb();
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(req.params.id));
  if (targetUser) {
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(targetUser.is_active ? 0 : 1, targetUser.id);
  }
  res.redirect('/admin/users');
});

// Reset User Devices
router.post('/users/:id/reset-devices', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE device_sessions SET is_active = 0 WHERE user_id = ?').run(parseInt(req.params.id));
  res.redirect('/admin/users');
});

// Delete User Account
router.post('/users/:id/delete', requireAdmin, (req, res) => {
  const db = getDb();
  const userId = parseInt(req.params.id);

  if (isNaN(userId)) {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }
    return res.redirect('/admin/users');
  }

  try {
    db.prepare('UPDATE orders SET verified_by = NULL WHERE verified_by = ?').run(userId);
    db.prepare('DELETE FROM device_sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM security_alerts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    if (result.changes === 0) {
      console.error('User not found for deletion:', userId);
    }

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.json({ success: true });
    }
    res.redirect('/admin/users');
  } catch (err) {
    console.error('Failed to delete user:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.redirect('/admin/users');
  }
});

// Content Management
router.get('/content', requireAdmin, (req, res) => {
  const db = getDb();
  const products = db.prepare('SELECT * FROM products ORDER BY category, name').all();

  // Get page counts
  products.forEach(p => {
    p.pageCount = db.prepare('SELECT COUNT(*) as count FROM content_pages WHERE product_id = ?').get(p.id).count;
  });

  const selectedProductId = parseInt(req.query.product) || null;
  let selectedProduct = null;
  let selectedPages = [];
  let hasPdf = false;

  if (selectedProductId) {
    selectedProduct = products.find(p => p.id === selectedProductId);
    if (selectedProduct) {
      selectedPages = db.prepare('SELECT * FROM content_pages WHERE product_id = ? ORDER BY page_number').all(selectedProductId);
      const pdfPath = path.join(__dirname, '..', 'data', 'pdfs', `${selectedProductId}.pdf`);
      hasPdf = fs.existsSync(pdfPath);
    }
  }

  res.render('admin/content', {
    title: 'Manage Content — TeachSmart Academy',
    products,
    selectedProduct,
    selectedPages,
    hasPdf,
    user: req.session
  });
});

// Upload PDF route
router.post('/content/:productId/upload-pdf', requireAdmin, uploadPdf.single('pdf'), (req, res) => {
  const productId = parseInt(req.params.productId);
  res.redirect(`/admin/content?product=${productId}`);
});

// Delete PDF route
router.post('/content/:productId/delete-pdf', requireAdmin, (req, res) => {
  const productId = parseInt(req.params.productId);
  const pdfPath = path.join(__dirname, '..', 'data', 'pdfs', `${productId}.pdf`);
  if (fs.existsSync(pdfPath)) {
    fs.unlinkSync(pdfPath);
  }
  res.redirect(`/admin/content?product=${productId}`);
});

// Add text content page
router.post('/content/:productId/add-page', requireAdmin, (req, res) => {
  const db = getDb();
  const { title, content } = req.body;
  const productId = parseInt(req.params.productId);

  const lastPage = db.prepare(
    'SELECT MAX(page_number) as maxPage FROM content_pages WHERE product_id = ?'
  ).get(productId);

  const pageNumber = (lastPage.maxPage || 0) + 1;

  db.prepare(
    'INSERT INTO content_pages (product_id, page_number, title, content) VALUES (?, ?, ?, ?)'
  ).run(productId, pageNumber, title, content);

  db.prepare('UPDATE products SET total_pages = ? WHERE id = ?').run(pageNumber, productId);

  res.redirect('/admin/content?product=' + productId);
});

// Delete text content page
router.post('/content/page/:pageId/delete', requireAdmin, (req, res) => {
  const db = getDb();
  const page = db.prepare('SELECT * FROM content_pages WHERE id = ?').get(parseInt(req.params.pageId));
  if (page) {
    db.prepare('DELETE FROM content_pages WHERE id = ?').run(page.id);
    // Reorder remaining pages
    const remaining = db.prepare(
      'SELECT id FROM content_pages WHERE product_id = ? ORDER BY page_number'
    ).all(page.product_id);
    remaining.forEach((p, i) => {
      db.prepare('UPDATE content_pages SET page_number = ? WHERE id = ?').run(i + 1, p.id);
    });
    db.prepare('UPDATE products SET total_pages = ? WHERE id = ?').run(remaining.length, page.product_id);
  }
  res.redirect('/admin/content');
});

// Coupons
router.get('/coupons', requireAdmin, (req, res) => {
  const db = getDb();
  const coupons = db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
  res.render('admin/coupons', {
    title: 'Manage Coupons — TeachSmart Academy',
    coupons,
    user: req.session
  });
});

router.post('/coupons/create', requireAdmin, (req, res) => {
  const db = getDb();
  const { code, discount_percent, discount_amount, max_uses, expires_at } = req.body;
  db.prepare(
    'INSERT INTO coupons (code, discount_percent, discount_amount, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(
    code.toUpperCase(),
    parseFloat(discount_percent) || 0,
    parseFloat(discount_amount) || 0,
    parseInt(max_uses) || -1,
    expires_at || null
  );
  res.redirect('/admin/coupons');
});

// Security Alerts View
router.get('/alerts', requireAdmin, (req, res) => {
  const db = getDb();

  // Get latest 100 alerts
  const alerts = db.prepare(`
    SELECT a.*, u.unique_id as user_unique_id, u.email
    FROM security_alerts a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
    LIMIT 100
  `).all();

  res.render('admin/alerts', {
    title: 'Security Alerts — TeachSmart Academy',
    alerts,
    user: req.session
  });
});

// Clear Alerts Handler
router.post('/alerts/clear', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM security_alerts').run();
  res.redirect('/admin/alerts');
});

// Delete Individual Alert
router.post('/alerts/:id/delete', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM security_alerts WHERE id = ?').run(parseInt(req.params.id));
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
    return res.json({ success: true });
  }
  res.redirect('/admin/alerts');
});

module.exports = router;
