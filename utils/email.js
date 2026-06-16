const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return transporter;
}

async function sendCredentials(email, fullName, uniqueId, password, products) {
  const productList = products.map(p => `• ${p.category} — ${p.name}`).join('\n');

  const mailOptions = {
    from: process.env.SMTP_FROM || 'ame <noreply@ame.com>',
    to: email,
    subject: 'Your Access Credentials for TeachSmart Academy',
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0A0A0A; color: #E8E8F0; padding: 40px; border-radius: 16px; border: 1px solid #222;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #FFFFFF; font-size: 28px; margin: 0; font-weight: 800; letter-spacing: -1px;">TeachSmart Academy</h1>
          <p style="color: #666; margin-top: 5px; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 1.5px;">Secure Learning Platform</p>
        </div>

        <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid #222; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
          <h2 style="color: #FFFFFF; margin-top: 0; font-size: 18px;">Welcome, ${fullName}</h2>
          <p>Your payment has been verified. Below are your secure login credentials:</p>

          <div style="background: rgba(0, 0, 0, 0.4); border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 8px 0; font-size: 0.95rem;"><strong style="color: #888;">Unique ID:</strong> <code style="background: rgba(255, 255, 255, 0.05); padding: 4px 8px; border-radius: 4px; color: #fff; font-family: monospace;">${uniqueId}</code></p>
            <p style="margin: 8px 0; font-size: 0.95rem;"><strong style="color: #888;">Password:</strong> <code style="background: rgba(255, 255, 255, 0.05); padding: 4px 8px; border-radius: 4px; color: #fff; font-family: monospace;">${password}</code></p>
          </div>
        </div>

        <div style="background: rgba(255, 255, 255, 0.01); border: 1px solid #1A1A1A; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
          <h3 style="color: #888; margin-top: 0; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">Purchased Materials</h3>
          <pre style="color: #E8E8F0; font-family: inherit; white-space: pre-wrap; margin: 0; line-height: 1.5;">${productList}</pre>
        </div>

        <div style="text-align: center; padding: 20px; border-top: 1px solid #222;">
          <p style="color: #555; font-size: 11px; line-height: 1.4;">
            Keep your credentials secure. Do not share them with others.<br>
            Your account is restricted to 1 active device session.
          </p>
        </div>
      </div>
    `
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log(`✓ Credentials email sent to ${email}`);
    return true;
  } catch (err) {
    console.error('✗ Email sending failed:', err.message);
    return false;
  }
}

async function sendOrderConfirmation(email, fullName, orderRef, products, total) {
  const productList = products.map(p => `• ${p.name} — ₱${p.price.toFixed(2)}`).join('\n');

  const mailOptions = {
    from: process.env.SMTP_FROM || 'ame <noreply@ame.com>',
    to: email,
    subject: `Order Received — ${orderRef}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0A0A0A; color: #E8E8F0; padding: 40px; border-radius: 16px; border: 1px solid #222;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #FFFFFF; font-size: 28px; margin: 0; font-weight: 800; letter-spacing: -1px;">TeachSmart Academy</h1>
        </div>

        <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid #222; border-radius: 12px; padding: 24px;">
          <h2 style="color: #FFFFFF; margin-top: 0; font-size: 18px;">Hi ${fullName},</h2>
          <p>We have received your order. Our team is currently verifying your payment.</p>
          <p><strong>Order Reference:</strong> ${orderRef}</p>
          <p><strong>Total:</strong> ₱${total.toFixed(2)}</p>
          <pre style="color: #E8E8F0; font-family: inherit; white-space: pre-wrap; border-top: 1px solid #1A1A1A; padding-top: 12px; margin-top: 12px;">${productList}</pre>
          <p style="color: #666; margin-top: 16px; font-size: 0.85rem; line-height: 1.4;">You will receive your login credentials via email once your payment is confirmed. This typically takes a few minutes.</p>
        </div>
      </div>
    `
  };

  try {
    await getTransporter().sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('✗ Order confirmation email failed:', err.message);
    return false;
  }
}

async function sendRejection(email, fullName, orderRef, products) {
  const productList = products.map(p => `• ${p.category || p.category_name || 'Reviewer'} — ${p.name || p.product_name}`).join('\n');

  const mailOptions = {
    from: process.env.SMTP_FROM || 'ame <noreply@ame.com>',
    to: email,
    subject: `Unable to Verify Payment — Order Ref: ${orderRef}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0A0A0A; color: #E8E8F0; padding: 40px; border-radius: 16px; border: 1px solid #222;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #FFFFFF; font-size: 28px; margin: 0; font-weight: 800; letter-spacing: -1px;">TeachSmart Academy</h1>
        </div>

        <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid #222; border-radius: 12px; padding: 24px;">
          <h2 style="color: #FF6B6B; margin-top: 0; font-size: 18px;">Hi ${fullName},</h2>
          <p>We are writing to inform you that we encountered an issue while attempting to verify the payment for your order.</p>
          <p>Unfortunately, the payment verification failed or we did not receive the transaction details for the reference provided.</p>
          <p><strong>Order Reference:</strong> ${orderRef}</p>
          
          <div style="background: rgba(255, 107, 107, 0.05); border: 1px solid rgba(255, 107, 107, 0.15); border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0; font-size: 0.95rem; line-height: 1.5; color: #FFA8A8;">
              Please double check your payment reference details. If you believe this is in error, or if you need help, please contact us immediately with your proof of payment so we can resolve this and unlock your materials.
            </p>
          </div>

          <pre style="color: #A0A0B0; font-family: inherit; white-space: pre-wrap; border-top: 1px solid #1A1A1A; padding-top: 12px; margin-top: 12px;">${productList}</pre>
        </div>
      </div>
    `
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log(`✓ Rejection email sent to ${email}`);
    return true;
  } catch (err) {
    console.error('✗ Rejection email sending failed:', err.message);
    return false;
  }
}

module.exports = { sendCredentials, sendOrderConfirmation, sendRejection };
