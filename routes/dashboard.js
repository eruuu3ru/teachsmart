const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

// User Dashboard
router.get('/', requireAuth, async (req, res) => {
  try {
    // Get user's verified orders with product details
    const userOrders = await db.orders.listByUserId(req.session.userId);
    const allProducts = await db.products.listAll();

    const purchasedProducts = [];
    const seenProductIds = new Set();
    const verifiedOrders = userOrders.filter(o => o.status === 'verified');

    verifiedOrders.forEach(order => {
      const pid = Number(order.product_id);
      if (!seenProductIds.has(pid)) {
        seenProductIds.add(pid);
        const product = allProducts.find(p => Number(p.id) === pid);
        if (product) {
          purchasedProducts.push({
            ...product,
            verified_at: order.verified_at
          });
        }
      }
    });

    // Sort purchased products by category, then name
    purchasedProducts.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });

    // Get pending orders
    const pendingOrders = [];
    const pendingUserOrders = userOrders.filter(o => o.status === 'pending');

    pendingUserOrders.forEach(order => {
      const pid = Number(order.product_id);
      const product = allProducts.find(p => Number(p.id) === pid);
      if (product) {
        pendingOrders.push({
          ...order,
          product_name: product.name,
          category: product.category
        });
      }
    });

    // Sort pending orders by created_at DESC
    pendingOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

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
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).render('error', {
      title: 'Dashboard Error',
      message: 'Failed to load your dashboard. Please try again later.',
      user: req.session
    });
  }
});

module.exports = router;
