const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getDb } = require('../database/init');
const { generateUniqueId, generatePassword, generateOrderRef } = require('../utils/idGenerator');
const { checkDeviceLimit, clearDeviceSessions } = require('../middleware/deviceLimit');

// Login Page
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { title: 'Login — TeachSmart Academy', error: null });
});

// Login Handler
router.post('/login', (req, res) => {
  const { unique_id, password } = req.body;
  const db = getDb();

  const user = db.prepare('SELECT * FROM users WHERE unique_id = ? AND is_active = 1').get(unique_id);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', {
      title: 'Login — TeachSmart Academy',
      error: 'Invalid credentials. Please check your Unique ID and password.'
    });
  }

  // Check device limit
  const maxDevices = parseInt(process.env.MAX_DEVICES) || 1;
  const fingerprint = require('../middleware/deviceLimit').generateFingerprint
    ? require('crypto').createHash('sha256').update((req.headers['user-agent'] || '') + (req.ip || '')).digest('hex').substring(0, 32)
    : 'unknown';

  const existingDevice = db.prepare(
    'SELECT id FROM device_sessions WHERE user_id = ? AND device_fingerprint = ? AND is_active = 1'
  ).get(user.id, fingerprint);

  if (!existingDevice) {
    const activeDevices = db.prepare(
      'SELECT COUNT(*) as count FROM device_sessions WHERE user_id = ? AND is_active = 1'
    ).get(user.id);

    if (activeDevices.count >= maxDevices) {
      return res.render('login', {
        title: 'Login — TeachSmart Academy',
        error: `Device limit reached. You can only access from ${maxDevices} device(s). Log out from other devices or contact support.`
      });
    }

    // Register device
    db.prepare(
      'INSERT INTO device_sessions (user_id, device_fingerprint, device_info, session_id) VALUES (?, ?, ?, ?)'
    ).run(user.id, fingerprint, req.headers['user-agent'] || 'Unknown', req.sessionID);
  } else {
    db.prepare('UPDATE device_sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(existingDevice.id);
  }

  // Set session
  req.session.userId = user.id;
  req.session.uniqueId = user.unique_id;
  req.session.fullName = user.full_name;
  req.session.email = user.email;
  req.session.role = user.role;

  const returnTo = req.session.returnTo || (user.role === 'admin' ? '/admin' : '/dashboard');
  delete req.session.returnTo;
  res.redirect(returnTo);
});

// Register / Order Page
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  const db = getDb();
  const products = db.prepare('SELECT * FROM products WHERE is_active = 1').all();
  res.render('register', { title: 'Get Started — TeachSmart Academy', products, error: null, success: null });
});

// Register + Order Handler
router.post('/register', async (req, res) => {
  const { first_name, last_name, email, phone, products: selectedProducts, payment_method, payment_reference, coupon_code } = req.body;
  const db = getDb();

  const allProducts = db.prepare('SELECT * FROM products WHERE is_active = 1').all();

  // Validate
  if (!first_name || !last_name || !email) {
    return res.render('register', {
      title: 'Get Started — TeachSmart Academy',
      products: allProducts,
      error: 'Please fill in all required fields.',
      success: null
    });
  }

  const productIds = Array.isArray(selectedProducts) ? selectedProducts.map(Number) : selectedProducts ? [Number(selectedProducts)] : [];

  if (productIds.length === 0) {
    return res.render('register', {
      title: 'Get Started — TeachSmart Academy',
      products: allProducts,
      error: 'Please select at least one product.',
      success: null
    });
  }

  if (!payment_method || !payment_reference) {
    return res.render('register', {
      title: 'Get Started — TeachSmart Academy',
      products: allProducts,
      error: 'Please select a payment method and enter a reference number.',
      success: null
    });
  }

  const fullName = `${first_name} ${last_name}`;
  const uniqueId = generateUniqueId();
  const password = generatePassword();
  const passwordHash = bcrypt.hashSync(password, 10);

  try {
    // Check if email already used with pending/verified orders
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

    let userId;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create user account
      const result = db.prepare(
        'INSERT INTO users (unique_id, email, full_name, phone, password_hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uniqueId, email, fullName, phone || null, passwordHash);
      userId = result.lastInsertRowid;
    }

    // Calculate total
    const selectedProductDetails = allProducts.filter(p => productIds.includes(p.id));
    let total = selectedProductDetails.reduce((sum, p) => sum + p.price, 0);

    // Apply coupon if provided
    if (coupon_code) {
      const coupon = db.prepare(
        'SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) AND (max_uses = -1 OR used_count < max_uses)'
      ).get(coupon_code.toUpperCase());

      if (coupon) {
        if (coupon.discount_percent > 0) {
          total = total * (1 - coupon.discount_percent / 100);
        } else if (coupon.discount_amount > 0) {
          total = Math.max(0, total - coupon.discount_amount);
        }
        db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
      }
    }

    // Create orders for each product
    const orderRef = generateOrderRef();
    for (const pid of productIds) {
      const product = allProducts.find(p => p.id === pid);
      db.prepare(
        'INSERT INTO orders (user_id, product_id, payment_method, payment_reference, amount, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(userId, pid, payment_method, `${orderRef}|${payment_reference}`, product.price, 'pending');
    }

    // Try sending order confirmation email
    try {
      const { sendOrderConfirmation } = require('../utils/email');
      await sendOrderConfirmation(email, fullName, orderRef, selectedProductDetails, total);
    } catch (e) {
      console.log('Email not configured, skipping order confirmation');
    }

    res.render('order-success', {
      title: 'Order Submitted — TeachSmart Academy',
      orderRef,
      email,
      fullName,
      products: selectedProductDetails,
      total,
      paymentMethod: payment_method
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.render('register', {
      title: 'Get Started — TeachSmart Academy',
      products: allProducts,
      error: 'Something went wrong. Please try again.',
      success: null
    });
  }
});

// Logout
router.get('/logout', (req, res) => {
  const db = getDb();
  if (req.session.userId) {
    // Deactivate device session
    const fingerprint = require('crypto')
      .createHash('sha256')
      .update((req.headers['user-agent'] || '') + (req.ip || ''))
      .digest('hex').substring(0, 32);
    db.prepare('UPDATE device_sessions SET is_active = 0 WHERE user_id = ? AND device_fingerprint = ?')
      .run(req.session.userId, fingerprint);
  }
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
