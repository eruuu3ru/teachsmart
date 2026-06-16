const { getDb } = require('../database/init');

function checkDeviceLimit(req, res, next) {
  if (!req.session.userId) return next();

  const db = getDb();
  const maxDevices = parseInt(process.env.MAX_DEVICES) || 1;

  // Generate a simple device fingerprint
  const fingerprint = generateFingerprint(req);
  req.deviceFingerprint = fingerprint;

  // Check if this device is already registered
  const existingDevice = db.prepare(
    'SELECT id FROM device_sessions WHERE user_id = ? AND device_fingerprint = ? AND is_active = 1'
  ).get(req.session.userId, fingerprint);

  if (existingDevice) {
    // Update last active
    db.prepare(
      'UPDATE device_sessions SET last_active = CURRENT_TIMESTAMP, session_id = ? WHERE id = ?'
    ).run(req.session.id, existingDevice.id);
    return next();
  }

  // Count active devices
  const activeDevices = db.prepare(
    'SELECT COUNT(*) as count FROM device_sessions WHERE user_id = ? AND is_active = 1'
  ).get(req.session.userId);

  if (activeDevices.count >= maxDevices) {
    return res.status(403).render('error', {
      title: 'Device Limit Reached',
      message: `You can only access ame from ${maxDevices} device(s). Please log out from your other device first, or contact support.`,
      user: req.session,
      showDeviceReset: true
    });
  }

  // Register new device
  db.prepare(
    'INSERT INTO device_sessions (user_id, device_fingerprint, device_info, session_id) VALUES (?, ?, ?, ?)'
  ).run(req.session.userId, fingerprint, req.headers['user-agent'] || 'Unknown', req.session.id);

  next();
}

function generateFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  const accept = req.headers['accept-language'] || '';
  const ip = req.ip || req.connection.remoteAddress || '';
  // Simple fingerprint - combine user agent and IP
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(ua + ip).digest('hex').substring(0, 32);
}

function clearDeviceSessions(userId) {
  const db = getDb();
  db.prepare('UPDATE device_sessions SET is_active = 0 WHERE user_id = ?').run(userId);
}

module.exports = { checkDeviceLimit, clearDeviceSessions };
