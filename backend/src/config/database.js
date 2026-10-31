import "./environment.js";
import { PrismaClient } from "@prisma/client";

// Uses DATABASE_URL from prisma/schema.prisma, shared with the Prisma CLI
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "test" ? ["error", "warn"] : ["query", "error", "warn"],
});

export default prisma;
