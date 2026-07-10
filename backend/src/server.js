import dotenv from 'dotenv';
import app from './app.js';
import prisma from './config/database.js';
import autoStageService from './services/autoStageService.js';
import refundNotificationService from './services/refundNotificationService.js';

dotenv.config();

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');
    
    // Start auto-stage service (runs every 10 seconds)
    const AUTO_STAGE_INTERVAL = 10000; // 10 seconds
    setInterval(async () => {
      try {
        await autoStageService.processAutoStages();
      } catch (error) {
        console.error('Auto-stage service error:', error);
      }
    }, AUTO_STAGE_INTERVAL);
    console.log('⏱️ Auto-stage service started (runs every 10 seconds)');
    
    // Start refund notification service (runs every 60 seconds)
    const REFUND_NOTIFICATION_INTERVAL = 60000; // 60 seconds
    setInterval(async () => {
      try {
        await refundNotificationService.processPendingRefundNotifications();
      } catch (error) {
        console.error('Refund notification service error:', error);
      }
    }, REFUND_NOTIFICATION_INTERVAL);
    console.log('📧 Refund notification service started (runs every 60 seconds)');
    
    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 API URL: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});
