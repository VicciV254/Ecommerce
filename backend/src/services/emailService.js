import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function getTimeSince(date) {
  if (!date) return 'Unknown';
  const now = new Date();
  const diff = now - new Date(date);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day(s)`;
  if (hours > 0) return `${hours} hour(s)`;
  if (minutes > 0) return `${minutes} minute(s)`;
  return 'Just now';
}

const BRAND_COLORS = {
  primary: '#2b1b12',
  secondary: '#d7a84f',
  accent: '#8a4f2a',
  background: '#fff6f7',
  text: '#1f1f1f',
};

const BRAND_LOGO_URL = process.env.BRAND_LOGO_URL || 'https://your-domain.com/images/logo.png';

function getBrandedEmailTemplate(subject, content) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; background-color: #f5f5f5; color: ${BRAND_COLORS.text}; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: ${BRAND_COLORS.primary}; padding: 30px; text-align: center; border-bottom: 4px solid ${BRAND_COLORS.secondary}; }
        .logo { max-width: 80px; height: auto; margin-bottom: 15px; }
        .header h1 { color: #fff; font-size: 24px; margin-bottom: 5px; }
        .header p { color: rgba(255,255,255,0.8); font-size: 14px; }
        .content { background-color: #fff; padding: 30px; border-radius: 8px; margin-top: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .content h2 { color: ${BRAND_COLORS.primary}; font-size: 20px; margin-bottom: 15px; }
        .content p { line-height: 1.6; margin-bottom: 15px; }
        .content .highlight { background-color: ${BRAND_COLORS.background}; padding: 15px; border-left: 4px solid ${BRAND_COLORS.secondary}; margin: 20px 0; }
        .content .button { display: inline-block; background-color: ${BRAND_COLORS.primary}; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
        .content .button:hover { background-color: ${BRAND_COLORS.secondary}; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; margin-top: 20px; }
        .footer a { color: ${BRAND_COLORS.secondary}; text-decoration: none; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th { background-color: ${BRAND_COLORS.primary}; color: #fff; padding: 12px; text-align: left; }
        td { border: 1px solid #ddd; padding: 12px; }
        .total-row { font-weight: bold; background-color: ${BRAND_COLORS.background}; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="${BRAND_LOGO_URL}" alt="No Maneno Bazaar Logo" class="logo" />
          <h1>No Maneno Bazaar</h1>
          <p>Your Trusted Fashion Destination</p>
        </div>
        <div class="content">
          ${content}
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} No Maneno Bazaar. All rights reserved.</p>
          <p>Visit us at <a href="https://ecommerce-vicciv.vercel.app">ecommerce-vicciv.vercel.app</a></p>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function sendEmail(to, subject, htmlContent) {
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'No Maneno Bazaar <noreply@nomanenobazaar.com>',
      to,
      subject,
      html: htmlContent,
    });
    console.log('Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, error: error.message };
  }
}

export const emailService = {
  async sendOrderConfirmation(order, user) {
    const itemsHtml = order.items.map(item => `
      <tr>
        <td>${item.productName}</td>
        <td>${item.quantity}</td>
        <td>KES ${item.productPrice.toLocaleString()}</td>
        <td>KES ${item.subtotal.toLocaleString()}</td>
      </tr>
    `).join('');

    const content = `
      <h2>Order Confirmation</h2>
      <p>Dear ${user.firstName},</p>
      <p>Thank you for your order! Your order <strong>${order.orderNumber}</strong> has been successfully placed.</p>
      
      <div class="highlight">
        <p><strong>Order Details:</strong></p>
        <p>Order Number: ${order.orderNumber}</p>
        <p>Date: ${new Date(order.createdAt).toLocaleString()}</p>
        <p>Total: KES ${order.total.toLocaleString()}</p>
        <p>Payment Method: ${order.paymentMethod}</p>
      </div>

      <h3>Order Items</h3>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Price</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="3">Subtotal</td>
            <td>KES ${order.subtotal.toLocaleString()}</td>
          </tr>
          <tr class="total-row">
            <td colspan="3">Tax</td>
            <td>KES ${order.tax.toLocaleString()}</td>
          </tr>
          <tr class="total-row">
            <td colspan="3">Shipping</td>
            <td>KES ${order.shippingCost.toLocaleString()}</td>
          </tr>
          <tr class="total-row">
            <td colspan="3"><strong>Total</strong></td>
            <td><strong>KES ${order.total.toLocaleString()}</strong></td>
          </tr>
        </tfoot>
      </table>

      <p>We'll send you updates as your order progresses. You can track your order using the order number above.</p>
      <p>If you have any questions, please don't hesitate to contact us.</p>
    `;

    const html = getBrandedEmailTemplate(`Order Confirmation - ${order.orderNumber}`, content);
    return sendEmail(user.email, `Order Confirmation - ${order.orderNumber}`, html);
  },

  async sendOrderCancellation(order, user) {
    const content = `
      <h2>Order Cancellation</h2>
      <p>Dear ${user.firstName},</p>
      <p>Your order <strong>${order.orderNumber}</strong> has been cancelled.</p>
      
      <div class="highlight">
        <p><strong>Cancellation Details:</strong></p>
        <p>Order Number: ${order.orderNumber}</p>
        <p>Cancelled on: ${new Date().toLocaleString()}</p>
        ${order.cancellationReason ? `<p>Reason: ${order.cancellationReason}</p>` : ''}
        ${order.paymentStatus === 'PAID' ? '<p>Refund Status: Your refund is being processed and will be credited to your original payment method within 5-7 business days.</p>' : '<p>Since payment was not completed, no refund is required.</p>'}
      </div>

      <p>We're sorry to see you go. If you have any feedback about why you cancelled, we'd love to hear from you.</p>
      <p>If you have any questions about this cancellation, please contact our customer service.</p>
    `;

    const html = getBrandedEmailTemplate(`Order Cancelled - ${order.orderNumber}`, content);
    return sendEmail(user.email, `Order Cancelled - ${order.orderNumber}`, html);
  },

  async sendPickupReady(order, user) {
    const content = `
      <h2>Your Order is Ready for Pickup!</h2>
      <p>Dear ${user.firstName},</p>
      <p>Great news! Your order <strong>${order.orderNumber}</strong> is ready for pickup at our store.</p>
      
      <div class="highlight">
        <p><strong>Pickup Details:</strong></p>
        <p>Order Number: ${order.orderNumber}</p>
        <p>Ready for pickup: ${new Date().toLocaleString()}</p>
        <p>Total: KES ${order.total.toLocaleString()}</p>
      </div>

      <h3>Pickup Location</h3>
      <p><strong>No Maneno Bazaar Store</strong></p>
      <p>123 Fashion Street</p>
      <p>Nairobi, Kenya</p>
      <p>Business Hours: Mon-Sat, 9:00 AM - 6:00 PM</p>

      <p>Please bring your order confirmation email or order number when picking up your order.</p>
      <p>If you have any questions, please contact us.</p>
    `;

    const html = getBrandedEmailTemplate(`Order Ready for Pickup - ${order.orderNumber}`, content);
    return sendEmail(user.email, `Order Ready for Pickup - ${order.orderNumber}`, html);
  },

  async sendPickupConfirmation(order, user) {
    const content = `
      <h2>Order Picked Up Successfully!</h2>
      <p>Dear ${user.firstName},</p>
      <p>Your order <strong>${order.orderNumber}</strong> has been successfully picked up.</p>
      
      <div class="highlight">
        <p><strong>Pickup Details:</strong></p>
        <p>Order Number: ${order.orderNumber}</p>
        <p>Picked up at: ${new Date().toLocaleString()}</p>
        <p>Total: KES ${order.total.toLocaleString()}</p>
      </div>

      <p>Thank you for shopping with No Maneno Bazaar. We hope you enjoy your purchase!</p>
      <p>If you have any questions or concerns about your order, please don't hesitate to contact us.</p>
    `;

    const html = getBrandedEmailTemplate(`Order Picked Up - ${order.orderNumber}`, content);
    return sendEmail(user.email, `Order Picked Up - ${order.orderNumber}`, html);
  },

  async sendPromotionalEmail(emails, subject, content) {
    const html = getBrandedEmailTemplate(subject, content);
    const results = [];
    
    for (const email of emails) {
      const result = await sendEmail(email, subject, html);
      results.push({ email, ...result });
    }
    
    return results;
  },

  async sendRefundPendingNotification(order, isReminder = false) {
    const content = `
      <h2>Refund Approval Required</h2>
      <p>${isReminder ? 'REMINDER: ' : ''}A refund approval is pending for the following order:</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
        <p><strong>Order Number:</strong> ${order.orderNumber}</p>
        <p><strong>Customer:</strong> ${order.user?.firstName} ${order.user?.lastName} (${order.user?.email})</p>
        <p><strong>Total Amount:</strong> KES ${order.total.toLocaleString()}</p>
        <p><strong>Return Reason:</strong> ${order.cancellationReason || 'Not specified'}</p>
        <p><strong>Time Since Request:</strong> ${getTimeSince(order.awaitingRefundAt)}</p>
      </div>
      <p>Please review and approve this refund request in the admin panel.</p>
      <p style="text-align: center; margin-top: 20px;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin" style="background: #E91E63; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Go to Admin Panel</a>
      </p>
    `;
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@nomanenobazaar.com';
    
    // Send simple email without branded template for admin notifications
    const simpleHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Refund Approval Pending - Order ${order.orderNumber}</title>
      </head>
      <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #2b1b12; margin-top: 0;">${isReminder ? 'REMINDER: ' : ''}Refund Approval Required</h2>
          <p>${isReminder ? 'REMINDER: ' : ''}A refund approval is pending for the following order:</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Order Number:</strong> ${order.orderNumber}</p>
            <p><strong>Customer:</strong> ${order.user?.firstName} ${order.user?.lastName} (${order.user?.email})</p>
            <p><strong>Total Amount:</strong> KES ${order.total.toLocaleString()}</p>
            <p><strong>Return Reason:</strong> ${order.cancellationReason || 'Not specified'}</p>
            <p><strong>Time Since Request:</strong> ${getTimeSince(order.awaitingRefundAt)}</p>
          </div>
          <p>Please review and approve this refund request in the admin panel.</p>
          <p style="text-align: center; margin-top: 20px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin" style="background: #E91E63; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Go to Admin Panel</a>
          </p>
        </div>
      </body>
      </html>
    `;
    
    return sendEmail(adminEmail, `${isReminder ? 'REMINDER: ' : ''}Refund Approval Pending - Order ${order.orderNumber}`, simpleHtml);
  },

  async sendReturnRequestConfirmation(order, user) {
    const content = `
      <h2>Return Request Received</h2>
      <p>Dear ${user.firstName},</p>
      <p>We have received your return request for order <strong>${order.orderNumber}</strong>.</p>
      
      <div class="highlight">
        <p><strong>Return Details:</strong></p>
        <p>Order Number: ${order.orderNumber}</p>
        <p>Request Date: ${new Date().toLocaleString()}</p>
        <p>Total Amount: KES ${order.total.toLocaleString()}</p>
        ${order.cancellationReason ? `<p>Reason: ${order.cancellationReason}</p>` : ''}
      </div>

      <p>Your return request is being reviewed. Once approved, your refund will be processed and credited to your original payment method within 5-7 business days.</p>
      <p>We'll send you another email when your refund has been approved and processed.</p>
      <p>If you have any questions about your return, please don't hesitate to contact our customer service.</p>
    `;

    const html = getBrandedEmailTemplate(`Return Request Received - ${order.orderNumber}`, content);
    return sendEmail(user.email, `Return Request Received - ${order.orderNumber}`, html);
  },

  async sendRefundProcessed(order, user) {
    const content = `
      <h2>Refund Processed</h2>
      <p>Dear ${user.firstName},</p>
      <p>Great news! Your refund for order <strong>${order.orderNumber}</strong> has been approved and processed.</p>
      
      <div class="highlight">
        <p><strong>Refund Details:</strong></p>
        <p>Order Number: ${order.orderNumber}</p>
        <p>Refund Amount: KES ${order.total.toLocaleString()}</p>
        <p>Processed Date: ${new Date().toLocaleString()}</p>
      </div>

      <p>Your refund has been credited to your original payment method. Please allow 5-7 business days for the amount to appear in your account, depending on your bank's processing times.</p>
      <p>If you don't see the refund after 7 business days, please contact your bank or our customer service.</p>
      <p>Thank you for your patience and understanding. We hope to serve you again soon!</p>
    `;

    const html = getBrandedEmailTemplate(`Refund Processed - ${order.orderNumber}`, content);
    return sendEmail(user.email, `Refund Processed - ${order.orderNumber}`, html);
  },
};

export default emailService;
