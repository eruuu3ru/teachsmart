/**
 * WhatsApp notification utility (Deprecated - Replaced with Email Notifications)
 */
async function sendWhatsAppMessage() {
  console.warn('[WhatsApp] WhatsApp notifications have been disabled. All notifications are sent via Email.');
  return false;
}

module.exports = { sendWhatsAppMessage };
