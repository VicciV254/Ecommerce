import prisma from '../config/database.js';

const STAGE_SEQUENCE = ['PENDING', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP'];
const STAGE_DURATION_MINUTES = 1;

export const autoStageService = {
  async processAutoStages() {
    try {
      // Find all orders that are eligible for auto-stage progression
      const orders = await prisma.order.findMany({
        where: {
          autoStageEnabled: true,
          autoStagePaused: false,
          status: {
            in: STAGE_SEQUENCE.slice(0, -1), // All stages except DELIVERED
          },
          NOT: {
            status: 'CANCELLED',
            status: 'AWAITING_REFUND',
            status: 'RETURNED',
          },
        },
        include: {
          trackingHistory: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      const updates = [];

      for (const order of orders) {
        const currentIndex = STAGE_SEQUENCE.indexOf(order.status);
        if (currentIndex === -1 || currentIndex === STAGE_SEQUENCE.length - 1) continue;

        const lastUpdate = order.autoStageLastUpdate || order.createdAt;
        const now = new Date();
        const diffMinutes = (now.getTime() - new Date(lastUpdate).getTime()) / (1000 * 60);

        if (diffMinutes >= STAGE_DURATION_MINUTES) {
          const nextStatus = STAGE_SEQUENCE[currentIndex + 1];
          
          // Skip if next stage is DELIVERED and this is a store pickup order
          if (nextStatus === 'DELIVERED' && order.deliveryMethod === 'STORE_PICKUP') {
            continue;
          }

          updates.push({
            orderId: order.id,
            currentStatus: order.status,
            nextStatus,
          });
        }
      }

      // Apply the updates
      for (const update of updates) {
        await prisma.order.update({
          where: { id: update.orderId },
          data: {
            status: update.nextStatus,
            autoStageLastUpdate: new Date(),
            trackingHistory: {
              create: {
                status: update.nextStatus,
                description: `Auto-stage progression from ${update.currentStatus} to ${update.nextStatus}`,
                location: 'Automated system',
              },
            },
          },
        });
      }

      console.log(`Auto-stage service processed ${updates.length} orders`);
      return { processed: updates.length };
    } catch (error) {
      console.error('Auto-stage service error:', error);
      throw error;
    }
  },

  async pauseAutoStage(orderId) {
    return prisma.order.update({
      where: { id: orderId },
      data: {
        autoStagePaused: true,
      },
    });
  },

  async resumeAutoStage(orderId) {
    return prisma.order.update({
      where: { id: orderId },
      data: {
        autoStagePaused: false,
        autoStageLastUpdate: new Date(),
      },
    });
  },

  async toggleAutoStage(orderId, enabled) {
    return prisma.order.update({
      where: { id: orderId },
      data: {
        autoStageEnabled: enabled,
        autoStagePaused: false,
        autoStageLastUpdate: enabled ? new Date() : null,
      },
    });
  },

  async bulkToggleAutoStage(orderIds, enabled) {
    return prisma.order.updateMany({
      where: {
        id: { in: orderIds },
      },
      data: {
        autoStageEnabled: enabled,
        autoStagePaused: false,
        autoStageLastUpdate: enabled ? new Date() : null,
      },
    });
  },
};

export default autoStageService;
