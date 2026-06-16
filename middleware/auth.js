function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'admin') {
    return next();
  }
  res.status(403).render('error', {
    title: 'Access Denied',
    message: 'You do not have permission to access this page.',
    user: req.session
  });
}

function setLocals(req, res, next) {
  res.locals.user = req.session.userId ? {
    id: req.session.userId,
    uniqueId: req.session.uniqueId,
    fullName: req.session.fullName,
    email: req.session.email,
    role: req.session.role
  } : null;
  res.locals.currentPath = req.path;
  next();
}

module.exports = { requireAuth, requireAdmin, setLocals };
