const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { db } = require('../database/db');
const { generateUniqueId, generatePassword, generateOrderRef } = require('../utils/idGenerator');

// Login Page
router.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  res.render('login', { title: 'Login — TeachSmart Academy', error: null });
});

// Login Handler
router.post('/login', async (req, res) => {
  const { unique_id, password } = req.body;

  try {
    const user = await db.users.getByUniqueId(unique_id);

    if (!user || user.is_active !== 1 || !bcrypt.compareSync(password, user.password_hash)) {
      return res.render('login', {
        title: 'Login — TeachSmart Academy',
        error: 'Invalid credentials or inactive account. Please check your Unique ID and password.'
      });
    }

    // Check device limit
    const maxDevices = parseInt(process.env.MAX_DEVICES) || 1;
    const fingerprint = require('crypto')
      .createHash('sha256')
      .update((req.headers['user-agent'] || '') + (req.ip || ''))
      .digest('hex')
      .substring(0, 32);

    const existingDevice = await db.device_sessions.getByUserAndFingerprint(user.id, fingerprint);

    if (!existingDevice) {
      const activeCount = await db.device_sessions.countActive(user.id);

      if (activeCount >= maxDevices) {
        return res.render('login', {
          title: 'Login — TeachSmart Academy',
          error: `Device limit reached. You can only access from ${maxDevices} device(s). Log out from other devices or contact support.`
        });
      }

      // Register device
      await db.device_sessions.insert({
        user_id: user.id,
        device_fingerprint: fingerprint,
        device_info: req.headers['user-agent'] || 'Unknown',
        session_id: req.sessionID || 'cookie-session'
      });
    } else {
      await db.device_sessions.update(existingDevice.id, { last_active: 'CURRENT_TIMESTAMP' });
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
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', {
      title: 'Login — TeachSmart Academy',
      error: 'An unexpected error occurred. Please try again.'
    });
  }
});

// Register / Order Page
router.get('/register', async (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  try {
    const products = await db.products.listActive();
    res.render('register', { title: 'Get Started — TeachSmart Academy', products, error: null, success: null });
  } catch (err) {
    console.error('Get register error:', err);
    res.render('register', { title: 'Get Started — TeachSmart Academy', products: [], error: 'Could not load products.', success: null });
  }
});

// Register + Order Handler
router.post('/register', async (req, res) => {
  const { first_name, last_name, email, phone, products: selectedProducts, payment_method, payment_reference, coupon_code } = req.body;

  let allProducts = [];
  try {
    allProducts = await db.products.listActive();
  } catch (e) {
    console.error(e);
  }

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
    // Check if email already used
    const existingUser = await db.users.getByEmail(email);

    let userId;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create user account
      const result = await db.users.insert({
        unique_id: uniqueId,
        email,
        full_name: fullName,
        phone: phone || null,
        password_hash: passwordHash,
        plain_password: password
      });
      userId = result.id;
    }

    // Calculate total
    const selectedProductDetails = allProducts.filter(p => productIds.includes(Number(p.id)));
    let total = selectedProductDetails.reduce((sum, p) => sum + p.price, 0);

    // Apply coupon if provided
    if (coupon_code) {
      const coupon = await db.coupons.getByCode(coupon_code.toUpperCase());

      if (coupon && coupon.is_active === 1) {
        const isExpired = coupon.expires_at && new Date(coupon.expires_at) < new Date();
        const usesExceeded = coupon.max_uses !== -1 && coupon.used_count >= coupon.max_uses;

        if (!isExpired && !usesExceeded) {
          if (coupon.discount_percent > 0) {
            total = total * (1 - coupon.discount_percent / 100);
          } else if (coupon.discount_amount > 0) {
            total = Math.max(0, total - coupon.discount_amount);
          }
          await db.coupons.incrementUsedCount(coupon.id);
        }
      }
    }

    // Create orders for each product
    const orderRef = generateOrderRef();
    for (const pid of productIds) {
      const product = allProducts.find(p => Number(p.id) === pid);
      await db.orders.insert({
        user_id: userId,
        product_id: pid,
        payment_method,
        payment_reference: `${orderRef}|${payment_reference}`,
        amount: product.price,
        status: 'pending'
      });
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
router.get('/logout', async (req, res) => {
  if (req.session && req.session.userId) {
    try {
      // Deactivate device session
      const fingerprint = require('crypto')
        .createHash('sha256')
        .update((req.headers['user-agent'] || '') + (req.ip || ''))
        .digest('hex').substring(0, 32);
      await db.device_sessions.deactivateUserDevice(req.session.userId, fingerprint);
    } catch (e) {
      console.error('Logout device deactivation error:', e);
    }
  }
  req.session = null;
  res.redirect('/');
});

module.exports = router;
