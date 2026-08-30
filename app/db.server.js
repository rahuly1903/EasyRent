import { PrismaClient } from "@prisma/client";

// Bump when the Prisma schema unique keys change so the cached dev client is rebuilt.
const PRISMA_CLIENT_REV = 3;

if (process.env.NODE_ENV !== "production") {
  if (global.prismaGlobalRev !== PRISMA_CLIENT_REV) {
    if (global.prismaGlobal) void global.prismaGlobal.$disconnect();
    global.prismaGlobal = new PrismaClient();
    global.prismaGlobalRev = PRISMA_CLIENT_REV;
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
