const express = require('express');
const router = express.Router();
const { getDb } = require('../database/init');
const { requireAuth } = require('../middleware/auth');

// User Dashboard
router.get('/', requireAuth, (req, res) => {
  const db = getDb();

  // Get user's verified orders with product details
  const purchasedProducts = db.prepare(`
    SELECT DISTINCT p.*, o.verified_at
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.user_id = ? AND o.status = 'verified'
    ORDER BY p.category, p.name
  `).all(req.session.userId);

  // Get pending orders
  const pendingOrders = db.prepare(`
    SELECT o.*, p.name as product_name, p.category
    FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.user_id = ? AND o.status = 'pending'
    ORDER BY o.created_at DESC
  `).all(req.session.userId);

  // Group products by category
  const categories = {};
  purchasedProducts.forEach(p => {
    if (!categories[p.category]) categories[p.category] = [];
    categories[p.category].push(p);
  });

  res.render('dashboard', {
    title: 'My Library — TeachSmart Academy',
    categories,
    pendingOrders,
    user: req.session
  });
});

module.exports = router;
