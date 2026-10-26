import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
  const input = z.object({ OWNER_EMAIL: z.string().email().toLowerCase(), OWNER_PASSWORD: z.string().min(12).refine(value => Buffer.byteLength(value) <= 72, 'Password must be at most 72 UTF-8 bytes') }).parse(process.env);
  const existing = await prisma.user.findUnique({ where: { email: input.OWNER_EMAIL } });
  if (existing) throw new Error('Account already exists; use the password-reset workflow or a reviewed database role update');
  const user = await prisma.user.create({ data: { email: input.OWNER_EMAIL, passwordHash: await bcrypt.hash(input.OWNER_PASSWORD, 12), firstName: 'Owner', lastName: 'Account', role: 'owner' } });
  console.log('Owner account created:', user.id);
}
main().catch(() => { console.error('Owner creation failed. Check environment configuration or existing account.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
