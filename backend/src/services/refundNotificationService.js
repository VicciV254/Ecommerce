import prisma from '../config/database.js';
import emailService from './emailService.js';

const REFUND_NOTIFICATION_MINUTES = 5;

export const refundNotificationService = {
  async processPendingRefundNotifications() {
    try {
      // Find orders that have been awaiting refund for more than 5 minutes
      const fiveMinutesAgo = new Date(Date.now() - REFUND_NOTIFICATION_MINUTES * 60 * 1000);
      
      const orders = await prisma.order.findMany({
        where: {
          status: 'AWAITING_REFUND',
          awaitingRefundAt: {
            lte: fiveMinutesAgo,
          },
        },
        include: {
          user: true,
        },
      });

      const notificationsSent = [];

      for (const order of orders) {
        try {
          // Check if we should send a notification
          const shouldSend = !order.refundNotificationSent || 
            (order.refundNotificationLastSentAt && 
             new Date(order.refundNotificationLastSentAt) < fiveMinutesAgo);
          
          if (shouldSend) {
            const isReminder = !!order.refundNotificationSent;
            await emailService.sendRefundPendingNotification(order, isReminder);
            
            // Update notification tracking
            await prisma.order.update({
              where: { id: order.id },
              data: {
                refundNotificationSent: true,
                refundNotificationLastSentAt: new Date(),
              },
            });

            notificationsSent.push({
              orderId: order.id,
              orderNumber: order.orderNumber,
              customerEmail: order.user?.email,
              isReminder,
            });
          }
        } catch (error) {
          console.error(`Failed to send refund notification for order ${order.orderNumber}:`, error);
        }
      }

      if (notificationsSent.length > 0) {
        console.log(`Refund notification service: Sent ${notificationsSent.length} notification(s)`);
      }

      return { sent: notificationsSent.length };
    } catch (error) {
      console.error('Refund notification service error:', error);
      throw error;
    }
  },
};

export default refundNotificationService;
