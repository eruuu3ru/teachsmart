const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { db } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

// Reader page - requires verified purchase
router.get('/:productId', requireAuth, async (req, res) => {
  const productId = parseInt(req.params.productId);

  try {
    // Check if user has purchased this product
    const userOrders = await db.orders.listByUserId(req.session.userId);
    const order = userOrders.find(o => Number(o.product_id) === productId && o.status === 'verified');

    if (!order && req.session.role !== 'admin') {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You have not purchased this material. Please purchase it first to gain access.',
        user: req.session
      });
    }

    // Get product details
    const product = await db.products.get(productId);
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
    const pages = await db.content_pages.listByProductId(productId);

    res.render('reader', {
      title: `${product.name} — TeachSmart Academy`,
      product,
      pages,
      hasPdf,
      user: req.session
    });
  } catch (err) {
    console.error('Reader error:', err);
    res.status(500).render('error', {
      title: 'Reader Error',
      message: 'An error occurred loading the material. Please try again.',
      user: req.session
    });
  }
});

// Secure PDF streaming route
router.get('/:productId/pdf', requireAuth, async (req, res) => {
  const productId = parseInt(req.params.productId);

  try {
    // Verify purchase
    const userOrders = await db.orders.listByUserId(req.session.userId);
    const order = userOrders.find(o => Number(o.product_id) === productId && o.status === 'verified');

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
  } catch (err) {
    console.error('PDF stream error:', err);
    res.status(500).send('Internal Server Error');
  }
});

// API: Get page content (returns as JSON)
router.get('/:productId/page/:pageNum', requireAuth, async (req, res) => {
  const productId = parseInt(req.params.productId);
  const pageNum = parseInt(req.params.pageNum);

  try {
    // Verify purchase
    const userOrders = await db.orders.listByUserId(req.session.userId);
    const order = userOrders.find(o => Number(o.product_id) === productId && o.status === 'verified');

    if (!order && req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const page = await db.content_pages.getByPageNumber(productId, pageNum);

    // Return page metadata even if text page content doesn't exist
    const watermarkText = `${req.session.fullName} | ${req.session.uniqueId}`;
    const totalPages = await db.content_pages.countByProductId(productId);
    
    if (!page) {
      return res.json({
        pageNumber: pageNum,
        title: `Page ${pageNum}`,
        content: '',
        totalPages,
        watermark: watermarkText
      });
    }

    // Return page data (rendered client-side with watermark)
    res.json({
      pageNumber: page.page_number,
      title: page.title,
      content: page.content,
      totalPages,
      watermark: watermarkText
    });
  } catch (err) {
    console.error('Get page API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API: Report security violation
router.post('/report-violation', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { eventType, details } = req.body;

  try {
    await db.security_alerts.insert({
      user_id: req.session.userId,
      username: req.session.fullName || req.session.uniqueId || 'Unknown User',
      event_type: eventType || 'Unknown Event',
      details: details || ''
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to log security alert:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
