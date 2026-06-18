const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { db } = require('../database/db');
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
router.get('/', requireAdmin, async (req, res) => {
  try {
    const allUsers = await db.users.list();
    const allOrders = await db.orders.listAll();
    const allProducts = await db.products.listAll();

    const usersCount = allUsers.filter(u => u.role === 'user').length;
    const pendingCount = allOrders.filter(o => o.status === 'pending').length;
    const verifiedCount = allOrders.filter(o => o.status === 'verified').length;
    const totalRevenue = allOrders.filter(o => o.status === 'verified').reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

    const todayStr = new Date().toISOString().substring(0, 10);
    const todayCount = allOrders.filter(o => o.created_at && o.created_at.substring(0, 10) === todayStr).length;

    const stats = {
      totalUsers: usersCount,
      pendingOrders: pendingCount,
      verifiedOrders: verifiedCount,
      totalRevenue,
      todayOrders: todayCount,
    };

    const recentOrders = allOrders.slice(0, 10).map(o => {
      const user = allUsers.find(u => String(u.id) === String(o.user_id));
      const product = allProducts.find(p => Number(p.id) === Number(o.product_id));
      return {
        ...o,
        full_name: user ? user.full_name : 'Deleted User',
        email: user ? user.email : 'N/A',
        product_name: product ? product.name : 'Unknown Product',
        category: product ? product.category : 'N/A'
      };
    });

    res.render('admin/dashboard', {
      title: 'Admin Dashboard — TeachSmart Academy',
      stats,
      recentOrders,
      user: req.session
    });
  } catch (err) {
    console.error('Admin dashboard stats error:', err);
    res.status(500).render('error', {
      title: 'Admin Error',
      message: 'Failed to retrieve admin dashboard stats.',
      user: req.session
    });
  }
});

// Orders Management
router.get('/orders', requireAdmin, async (req, res) => {
  const filter = req.query.filter || 'all';

  try {
    const allOrders = await db.orders.listAll();
    const allUsers = await db.users.list();
    const allProducts = await db.products.listAll();

    const orders = allOrders.map(o => {
      const user = allUsers.find(u => String(u.id) === String(o.user_id));
      const product = allProducts.find(p => Number(p.id) === Number(o.product_id));
      return {
        ...o,
        full_name: user ? user.full_name : 'Deleted User',
        email: user ? user.email : 'N/A',
        user_unique_id: user ? user.unique_id : 'N/A',
        phone: user ? user.phone : 'N/A',
        plain_password: user ? user.plain_password : '',
        product_name: product ? product.name : 'Unknown Product',
        category: product ? product.category : 'N/A',
        price: product ? product.price : 0
      };
    });

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
  } catch (err) {
    console.error('Failed to load orders:', err);
    res.status(500).render('error', {
      title: 'Orders Load Error',
      message: 'An error occurred loading the orders.',
      user: req.session
    });
  }
});

// Verify Transaction / Batch Orders
router.post('/orders/transaction/:txnId/verify', requireAdmin, async (req, res) => {
  const txnId = req.params.txnId;

  try {
    const matchingOrders = await db.orders.listByPaymentReference(txnId);
    if (matchingOrders.length === 0) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(404).json({ success: false, error: 'Transaction not found' });
      }
      return res.redirect('/admin/orders');
    }

    const allUsers = await db.users.list();
    const allProducts = await db.products.listAll();

    const orders = matchingOrders.map(o => {
      const user = allUsers.find(u => String(u.id) === String(o.user_id));
      const product = allProducts.find(p => Number(p.id) === Number(o.product_id));
      return {
        ...o,
        email: user ? user.email : '',
        full_name: user ? user.full_name : '',
        unique_id: user ? user.unique_id : '',
        uid: user ? user.id : '',
        product_name: product ? product.name : '',
        category: product ? product.category : ''
      };
    });

    const userId = orders[0].uid;
    const newPassword = generatePassword();
    const passwordHash = bcrypt.hashSync(newPassword, 10);

    for (const o of orders) {
      await db.orders.update(o.id, {
        status: 'verified',
        verified_by: req.session.userId,
        verified_at: 'CURRENT_TIMESTAMP'
      });
    }
    await db.users.update(userId, {
      password_hash: passwordHash,
      plain_password: newPassword
    });

    // Fetch all verified products for this user
    const allUserOrders = await db.orders.listByUserId(userId);
    const verifiedUserOrders = allUserOrders.filter(o => o.status === 'verified');
    const verifiedDetails = verifiedUserOrders.map(o => {
      const product = allProducts.find(p => Number(p.id) === Number(o.product_id));
      return {
        category: product ? product.category : 'General',
        name: product ? product.name : 'Reviewer'
      };
    });

    // Send credentials email
    try {
      const { sendCredentials } = require('../utils/email');
      await sendCredentials(
        orders[0].email,
        orders[0].full_name,
        orders[0].unique_id,
        newPassword,
        verifiedDetails
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
  } catch (err) {
    console.error('Database update failed:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(500).json({ success: false, error: 'Failed to verify transaction' });
    }
    res.redirect('/admin/orders');
  }
});

// Reject Transaction / Batch Orders
router.post('/orders/transaction/:txnId/reject', requireAdmin, async (req, res) => {
  const txnId = req.params.txnId;

  try {
    const matchingOrders = await db.orders.listByPaymentReference(txnId);
    if (matchingOrders.length === 0) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(404).json({ success: false, error: 'Transaction not found' });
      }
      return res.redirect('/admin/orders');
    }

    const allUsers = await db.users.list();
    const allProducts = await db.products.listAll();

    const orders = matchingOrders.map(o => {
      const user = allUsers.find(u => String(u.id) === String(o.user_id));
      const product = allProducts.find(p => Number(p.id) === Number(o.product_id));
      return {
        ...o,
        email: user ? user.email : '',
        full_name: user ? user.full_name : '',
        uid: user ? user.id : '',
        product_name: product ? product.name : '',
        category: product ? product.category : ''
      };
    });

    for (const o of orders) {
      await db.orders.update(o.id, {
        status: 'rejected',
        verified_by: req.session.userId,
        verified_at: 'CURRENT_TIMESTAMP'
      });
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
  } catch (err) {
    console.error('Database update failed:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(500).json({ success: false, error: 'Failed to reject transaction' });
    }
    res.redirect('/admin/orders');
  }
});

// Delete Transaction / Batch Orders
router.post('/orders/transaction/:txnId/delete', requireAdmin, async (req, res) => {
  const txnId = req.params.txnId;

  try {
    await db.orders.deleteByPaymentReference(txnId);
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

// Verify Individual Order
router.post('/orders/:id/verify', requireAdmin, async (req, res) => {
  const orderId = req.params.id;

  try {
    const order = await db.orders.get(orderId);
    if (!order) {
      return res.redirect('/admin');
    }

    const userId = order.user_id;
    const newPassword = generatePassword();
    const passwordHash = bcrypt.hashSync(newPassword, 10);

    await db.orders.update(orderId, {
      status: 'verified',
      verified_by: req.session.userId,
      verified_at: 'CURRENT_TIMESTAMP'
    });

    await db.users.update(userId, {
      password_hash: passwordHash,
      plain_password: newPassword
    });

    const user = await db.users.get(userId);
    const allUserOrders = await db.orders.listByUserId(userId);
    const allProducts = await db.products.listAll();

    const verifiedDetails = allUserOrders.filter(o => o.status === 'verified').map(o => {
      const product = allProducts.find(p => Number(p.id) === Number(o.product_id));
      return {
        category: product ? product.category : 'General',
        name: product ? product.name : 'Reviewer'
      };
    });

    try {
      const { sendCredentials } = require('../utils/email');
      await sendCredentials(
        user.email,
        user.full_name,
        user.unique_id,
        newPassword,
        verifiedDetails
      );
    } catch (e) {
      console.error('Email sending failed:', e);
    }

    req.session.flashCredentials = {
      uniqueId: user.unique_id,
      password: newPassword,
      email: user.email,
      fullName: user.full_name
    };

    res.redirect('/admin?verified=true');
  } catch (err) {
    console.error('Failed to verify order:', err);
    res.redirect('/admin');
  }
});

// Users Management
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const allUsers = await db.users.list();
    const allOrders = await db.orders.listAll();
    
    // Fetch active device sessions
    const allSessions = await db.firestore.collection('device_sessions').where('is_active', '==', 1).get();
    const activeSessions = allSessions.docs.map(d => d.data());

    const users = allUsers
      .filter(u => u.role === 'user')
      .map(u => {
        const purchasedCount = allOrders.filter(o => String(o.user_id) === String(u.id) && o.status === 'verified').length;
        const activeDevicesCount = activeSessions.filter(s => String(s.user_id) === String(u.id)).length;
        return {
          ...u,
          purchased_count: purchasedCount,
          active_devices: activeDevicesCount
        };
      });

    res.render('admin/users', {
      title: 'Manage Users — TeachSmart Academy',
      users,
      user: req.session
    });
  } catch (err) {
    console.error('Failed to load users:', err);
    res.status(500).render('error', {
      title: 'Users Load Error',
      message: 'Failed to retrieve users list.',
      user: req.session
    });
  }
});

// Toggle User Active
router.post('/users/:id/toggle', requireAdmin, async (req, res) => {
  const userId = req.params.id;

  try {
    const targetUser = await db.users.get(userId);
    if (targetUser) {
      await db.users.update(userId, {
        is_active: targetUser.is_active ? 0 : 1
      });
    }
    res.redirect('/admin/users');
  } catch (err) {
    console.error('Toggle user active error:', err);
    res.redirect('/admin/users');
  }
});

// Reset User Devices
router.post('/users/:id/reset-devices', requireAdmin, async (req, res) => {
  const userId = req.params.id;

  try {
    await db.device_sessions.deactivateAllForUser(userId);
    res.redirect('/admin/users');
  } catch (err) {
    console.error('Reset devices error:', err);
    res.redirect('/admin/users');
  }
});

// Delete User Account
router.post('/users/:id/delete', requireAdmin, async (req, res) => {
  const userId = req.params.id;

  try {
    const userOrdersRef = await db.firestore.collection('orders').where('user_id', '==', userId).get();
    const verifiedOrdersRef = await db.firestore.collection('orders').where('verified_by', '==', userId).get();
    const sessionsRef = await db.firestore.collection('device_sessions').where('user_id', '==', userId).get();
    const alertsRef = await db.firestore.collection('security_alerts').where('user_id', '==', userId).get();

    const batch = db.firestore.batch();
    userOrdersRef.docs.forEach(doc => batch.delete(doc.ref));
    verifiedOrdersRef.docs.forEach(doc => batch.update(doc.ref, { verified_by: null }));
    sessionsRef.docs.forEach(doc => batch.delete(doc.ref));
    alertsRef.docs.forEach(doc => batch.delete(doc.ref));
    batch.delete(db.firestore.collection('users').doc(userId));
    
    await batch.commit();

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
router.get('/content', requireAdmin, async (req, res) => {
  try {
    const products = await db.products.listAll();
    
    products.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });

    // Get page counts
    for (const p of products) {
      p.pageCount = await db.content_pages.countByProductId(p.id);
    }

    const selectedProductId = parseInt(req.query.product) || null;
    let selectedProduct = null;
    let selectedPages = [];
    let hasPdf = false;

    if (selectedProductId) {
      selectedProduct = products.find(p => Number(p.id) === selectedProductId);
      if (selectedProduct) {
        selectedPages = await db.content_pages.listByProductId(selectedProductId);
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
  } catch (err) {
    console.error('Failed to load content management:', err);
    res.status(500).render('error', {
      title: 'Content Error',
      message: 'Failed to load content management dashboard.',
      user: req.session
    });
  }
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
router.post('/content/:productId/add-page', requireAdmin, async (req, res) => {
  const { title, content } = req.body;
  const productId = parseInt(req.params.productId);

  try {
    const pages = await db.content_pages.listByProductId(productId);
    const pageNumber = pages.length + 1;

    await db.content_pages.insert({
      product_id: productId,
      page_number: pageNumber,
      title,
      content
    });

    await db.products.update(productId, { total_pages: pageNumber });

    res.redirect('/admin/content?product=' + productId);
  } catch (err) {
    console.error('Failed to add page:', err);
    res.redirect('/admin/content?product=' + productId);
  }
});

// Delete text content page
router.post('/content/page/:pageId/delete', requireAdmin, async (req, res) => {
  const pageId = req.params.pageId;

  try {
    const page = await db.content_pages.get(pageId);
    if (page) {
      await db.content_pages.delete(pageId);
      // Reorder remaining pages
      const remaining = await db.content_pages.listByProductId(page.product_id);
      for (let i = 0; i < remaining.length; i++) {
        await db.firestore.collection('content_pages').doc(remaining[i].id).update({
          page_number: i + 1
        });
      }
      await db.products.update(page.product_id, { total_pages: remaining.length });
    }
    res.redirect('/admin/content');
  } catch (err) {
    console.error('Failed to delete page:', err);
    res.redirect('/admin/content');
  }
});

// Coupons
router.get('/coupons', requireAdmin, async (req, res) => {
  try {
    const coupons = await db.coupons.listAll();
    res.render('admin/coupons', {
      title: 'Manage Coupons — TeachSmart Academy',
      coupons,
      user: req.session
    });
  } catch (err) {
    console.error('Failed to list coupons:', err);
    res.status(500).render('error', {
      title: 'Coupons Error',
      message: 'Failed to retrieve coupons list.',
      user: req.session
    });
  }
});

router.post('/coupons/create', requireAdmin, async (req, res) => {
  const { code, discount_percent, discount_amount, max_uses, expires_at } = req.body;

  try {
    await db.coupons.insert({
      code: code.toUpperCase(),
      discount_percent: parseFloat(discount_percent) || 0,
      discount_amount: parseFloat(discount_amount) || 0,
      max_uses: parseInt(max_uses) || -1,
      expires_at: expires_at || null
    });
    res.redirect('/admin/coupons');
  } catch (err) {
    console.error('Failed to create coupon:', err);
    res.redirect('/admin/coupons');
  }
});

// Security Alerts View
router.get('/alerts', requireAdmin, async (req, res) => {
  try {
    const alerts = await db.security_alerts.listLatest(100);
    const allUsers = await db.users.list();

    const formattedAlerts = alerts.map(a => {
      const user = allUsers.find(u => String(u.id) === String(a.user_id));
      return {
        ...a,
        user_unique_id: user ? user.unique_id : 'N/A',
        email: user ? user.email : 'N/A'
      };
    });

    res.render('admin/alerts', {
      title: 'Security Alerts — TeachSmart Academy',
      alerts: formattedAlerts,
      user: req.session
    });
  } catch (err) {
    console.error('Failed to load security alerts:', err);
    res.status(500).render('error', {
      title: 'Alerts Error',
      message: 'Failed to retrieve security alerts.',
      user: req.session
    });
  }
});

// Clear Alerts Handler
router.post('/alerts/clear', requireAdmin, async (req, res) => {
  try {
    await db.security_alerts.clearAll();
    res.redirect('/admin/alerts');
  } catch (err) {
    console.error('Failed to clear alerts:', err);
    res.redirect('/admin/alerts');
  }
});

// Delete Individual Alert
router.post('/alerts/:id/delete', requireAdmin, async (req, res) => {
  const alertId = req.params.id;

  try {
    await db.security_alerts.delete(alertId);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.json({ success: true });
    }
    res.redirect('/admin/alerts');
  } catch (err) {
    console.error('Failed to delete alert:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.redirect('/admin/alerts');
  }
});

module.exports = router;
