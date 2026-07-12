import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const getDatabaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.DATABASE_URL;
  }
  return process.env.DATABASE_URL_LOCAL;
};

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
  log: ['query', 'error', 'warn'],
});

export default prisma;

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
