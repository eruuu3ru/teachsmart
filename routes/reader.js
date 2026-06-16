const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { getDb } = require('../database/init');
const { requireAuth } = require('../middleware/auth');

// Reader page - requires verified purchase
router.get('/:productId', requireAuth, (req, res) => {
  const db = getDb();
  const productId = parseInt(req.params.productId);

  // Check if user has purchased this product
  const order = db.prepare(
    "SELECT * FROM orders WHERE user_id = ? AND product_id = ? AND status = 'verified'"
  ).get(req.session.userId, productId);

  if (!order && req.session.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'You have not purchased this material. Please purchase it first to gain access.',
      user: req.session
    });
  }

  // Get product details
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'This material does not exist.',
      user: req.session
    });
  }

  // Check if there is an uploaded PDF file for this product
  const pdfPath = path.join(__dirname, '..', 'data', 'pdfs', `${productId}.pdf`);
  const hasPdf = fs.existsSync(pdfPath);

  // Get all pages for this product
  const pages = db.prepare(
    'SELECT id, page_number, title FROM content_pages WHERE product_id = ? ORDER BY page_number'
  ).all(productId);

  res.render('reader', {
    title: `${product.name} — TeachSmart Academy`,
    product,
    pages,
    hasPdf,
    user: req.session
  });
});

// Secure PDF streaming route
router.get('/:productId/pdf', requireAuth, (req, res) => {
  const db = getDb();
  const productId = parseInt(req.params.productId);

  // Verify purchase
  const order = db.prepare(
    "SELECT * FROM orders WHERE user_id = ? AND product_id = ? AND status = 'verified'"
  ).get(req.session.userId, productId);

  if (!order && req.session.role !== 'admin') {
    return res.status(403).send('Access Denied');
  }

  const pdfPath = path.join(__dirname, '..', 'data', 'pdfs', `${productId}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).send('PDF not found');
  }

  // Prevent caching and stream
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  
  fs.createReadStream(pdfPath).pipe(res);
});

// API: Get page content (returns as JSON)
router.get('/:productId/page/:pageNum', requireAuth, (req, res) => {
  const db = getDb();
  const productId = parseInt(req.params.productId);
  const pageNum = parseInt(req.params.pageNum);

  // Verify purchase
  const order = db.prepare(
    "SELECT * FROM orders WHERE user_id = ? AND product_id = ? AND status = 'verified'"
  ).get(req.session.userId, productId);

  if (!order && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const page = db.prepare(
    'SELECT * FROM content_pages WHERE product_id = ? AND page_number = ?'
  ).get(productId, pageNum);

  // Return page metadata even if text page content doesn't exist (e.g. for PDF.js user data loading)
  const watermarkText = `${req.session.fullName} | ${req.session.uniqueId}`;
  
  if (!page) {
    return res.json({
      pageNumber: pageNum,
      title: `Page ${pageNum}`,
      content: '',
      totalPages: db.prepare('SELECT COUNT(*) as count FROM content_pages WHERE product_id = ?').get(productId).count,
      watermark: watermarkText
    });
  }

  // Return page data (rendered client-side with watermark)
  res.json({
    pageNumber: page.page_number,
    title: page.title,
    content: page.content,
    totalPages: db.prepare('SELECT COUNT(*) as count FROM content_pages WHERE product_id = ?').get(productId).count,
    watermark: watermarkText
  });
});

// API: Report security violation
router.post('/report-violation', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { eventType, details } = req.body;
  const db = getDb();

  try {
    db.prepare(
      'INSERT INTO security_alerts (user_id, username, event_type, details) VALUES (?, ?, ?, ?)'
    ).run(
      req.session.userId,
      req.session.fullName || req.session.uniqueId || 'Unknown User',
      eventType || 'Unknown Event',
      details || ''
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to log security alert:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
