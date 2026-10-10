import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Uses DATABASE_URL from prisma/schema.prisma, shared with the Prisma CLI
const prisma = new PrismaClient({
  log: ["query", "error", "warn"],
});

export default prisma;

// Handle graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});
