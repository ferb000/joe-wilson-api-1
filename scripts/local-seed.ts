import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.NODE_ENV !== 'development' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/joe_wilson_dev') throw new Error('Local seed requires the local development database');
  const ownerEmail = process.env.SEED_OWNER_EMAIL!;
  const memberEmail = process.env.SEED_MEMBER_EMAIL!;
  if (!ownerEmail || !memberEmail || !process.env.SEED_OWNER_PASSWORD || !process.env.SEED_MEMBER_PASSWORD) throw new Error('Configure local seed credentials');
  await prisma.user.upsert({ where: { email: ownerEmail }, update: {}, create: { email: ownerEmail, firstName: 'Local', lastName: 'Owner', role: 'owner', emailVerified: true, passwordHash: await bcrypt.hash(process.env.SEED_OWNER_PASSWORD!, 12) } });
  const member = await prisma.user.upsert({ where: { email: memberEmail }, update: {}, create: { email: memberEmail, firstName: 'Local', lastName: 'Member', role: 'member', emailVerified: true, passwordHash: await bcrypt.hash(process.env.SEED_MEMBER_PASSWORD!, 12) } });
  const classId = '11111111-1111-4111-8111-111111111111';
  await prisma.masterclass.upsert({ where: { id: classId }, update: {}, create: { id: classId, title: 'Local Gospel Bass Workshop', description: 'Development course for testing the catalogue, enrollment, session editor and resources.', priceCents: 2500, status: 'active', isPublished: true, startsAt: new Date(), endsAt: new Date(Date.now() + 90 * 86400000) } });
  await prisma.session.upsert({ where: { id: '22222222-2222-4222-8222-222222222222' }, update: {}, create: { id: '22222222-2222-4222-8222-222222222222', masterclassId: classId, title: 'Pocket and timing fundamentals', description: 'Attach a private recording using the admin media library to test HLS playback.', status: 'completed', orderIndex: 0 } });
  const payment = await prisma.payment.upsert({ where: { id: '33333333-3333-4333-8333-333333333333' }, update: {}, create: { id: '33333333-3333-4333-8333-333333333333', userId: member.id, masterclassId: classId, amountCents: 2500, status: 'succeeded', billingMetadata: { source: 'local-development-seed', realCharge: false } } });
  await prisma.enrollment.upsert({ where: { userId_masterclassId: { userId: member.id, masterclassId: classId } }, update: {}, create: { userId: member.id, masterclassId: classId, paymentId: payment.id } });
  await prisma.service.upsert({ where: { slug: 'live-performance' }, update: {}, create: { slug: 'live-performance', title: 'Live Performance', description: 'Local demo service for quote requests.', isPublished: true, orderIndex: 0 } });
  for (const [key, value] of Object.entries({ contact_email: 'hello@local.test', booking_email: 'booking@local.test', contact_location: 'Local development' })) await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  console.log('Local owner, enrolled member, course and service ready. Run npm run local:accounts for credentials. No payment was charged.');
}
main().catch(() => { console.error('Local seeding failed; check database and seed configuration'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
