import "./environment.js";
import { PrismaClient } from "@prisma/client";

// Uses DATABASE_URL from prisma/schema.prisma, shared with the Prisma CLI
const prisma = new PrismaClient({
  log: [{ emit: "event", level: "error" }, { emit: "event", level: "warn" }],
});

// Prisma's formatted query errors can contain stored payment/credential values.
prisma.$on("error", () => console.error("Database operation failed; see the request's safe error code."));
prisma.$on("warn", () => console.warn("Database warning; review connection health."));

export default prisma;
