const { db } = require('../database/db');

async function checkDeviceLimit(req, res, next) {
  if (!req.session.userId) return next();

  const maxDevices = parseInt(process.env.MAX_DEVICES) || 1;

  // Generate a simple device fingerprint
  const fingerprint = generateFingerprint(req);
  req.deviceFingerprint = fingerprint;

  try {
    // Check if this device is already registered
    const existingDevice = await db.device_sessions.getByUserAndFingerprint(req.session.userId, fingerprint);

    if (existingDevice) {
      // Update last active
      await db.device_sessions.update(existingDevice.id, {
        last_active: 'CURRENT_TIMESTAMP',
        session_id: req.session.id
      });
      return next();
    }

    // Count active devices
    const activeCount = await db.device_sessions.countActive(req.session.userId);

    if (activeCount >= maxDevices) {
      return res.status(403).render('error', {
        title: 'Device Limit Reached',
        message: `You can only access TeachSmart Academy from ${maxDevices} device(s). Please log out from your other device first, or contact support.`,
        user: req.session,
        showDeviceReset: true
      });
    }

    // Register new device
    await db.device_sessions.insert({
      user_id: req.session.userId,
      device_fingerprint: fingerprint,
      device_info: req.headers['user-agent'] || 'Unknown',
      session_id: req.session.id
    });

    next();
  } catch (err) {
    console.error('Device limit middleware error:', err);
    next();
  }
}

function generateFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  const accept = req.headers['accept-language'] || '';
  const ip = req.ip || req.connection.remoteAddress || '';
  // Simple fingerprint - combine user agent and IP
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(ua + ip).digest('hex').substring(0, 32);
}

async function clearDeviceSessions(userId) {
  try {
    await db.device_sessions.deactivateAllForUser(userId);
  } catch (err) {
    console.error('Failed to clear device sessions:', err);
  }
}

module.exports = { checkDeviceLimit, clearDeviceSessions, generateFingerprint };
