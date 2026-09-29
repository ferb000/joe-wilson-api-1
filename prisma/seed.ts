import 'dotenv/config';
import { PrismaClient, Role, MasterclassStatus, SessionStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create owner account
  const ownerPassword = await bcrypt.hash('Admin@123456', 12);
  const owner = await prisma.user.upsert({
    where: { email: 'joseph@mrwilson.com' },
    update: {},
    create: {
      email: 'joseph@mrwilson.com',
      passwordHash: ownerPassword,
      firstName: 'Joseph',
      lastName: 'Wilson',
      role: Role.owner,
      emailVerified: true,
    },
  });
  console.log('Owner created:', owner.email);

  // Create a test member
  const memberPassword = await bcrypt.hash('Member@123456', 12);
  const member = await prisma.user.upsert({
    where: { email: 'test@member.com' },
    update: {},
    create: {
      email: 'test@member.com',
      passwordHash: memberPassword,
      firstName: 'Test',
      lastName: 'Member',
      role: Role.member,
      emailVerified: true,
    },
  });
  console.log('Test member created:', member.email);

  // Create services
  const services = await Promise.all([
    prisma.service.upsert({
      where: { slug: 'live-performance' },
      update: {},
      create: {
        slug: 'live-performance',
        title: 'Live Performance',
        tagline: 'High-energy professional bass performances',
        description: 'High-energy professional bass performances that elevate every stage.',
        isPublished: true,
        orderIndex: 1,
      },
    }),
    prisma.service.upsert({
      where: { slug: 'studio-session-bass' },
      update: {},
      create: {
        slug: 'studio-session-bass',
        title: 'Studio Session Bass',
        tagline: 'Remote and in-studio session work',
        description: 'Remote bass recording and in-studio session work for artists, choirs and producers.',
        isPublished: true,
        orderIndex: 2,
      },
    }),
    prisma.service.upsert({
      where: { slug: 'music-direction' },
      update: {},
      create: {
        slug: 'music-direction',
        title: 'Music Direction',
        tagline: 'Full band and worship team direction',
        description: 'Comprehensive music direction for churches, events, and recording projects.',
        isPublished: true,
        orderIndex: 3,
      },
    }),
  ]);
  console.log('Services created:', services.length);

  // Create masterclasses
  const masterclass1 = await prisma.masterclass.create({
    data: {
      title: 'Foundations of Gospel Bass',
      description: 'Master the foundational techniques of gospel bass playing.',
      priceCents: 34900,
      status: MasterclassStatus.active,
      isPublished: true,
      startsAt: new Date('2026-03-01'),
      endsAt: new Date('2026-06-01'),
    },
  });

  const masterclass2 = await prisma.masterclass.create({
    data: {
      title: 'Advanced Worship Direction',
      description: 'An intensive for music directors leading praise teams.',
      priceCents: 49900,
      status: MasterclassStatus.upcoming,
      isPublished: true,
      startsAt: new Date('2026-05-15'),
      endsAt: new Date('2026-06-26'),
    },
  });
  console.log('Masterclasses created: 2');

  // Create sessions for masterclass 1
  await prisma.session.createMany({
    data: [
      {
        masterclassId: masterclass1.id,
        title: 'The Architecture of Rhythm',
        description: 'A deep dive into subdivisions, internal clock development, and the physics of string attack.',
        orderIndex: 1,
        status: SessionStatus.completed,
      },
      {
        masterclassId: masterclass1.id,
        title: 'Pocket & Timing Fundamentals',
        description: "Mastering the 'push and pull' of professional rhythm sections.",
        orderIndex: 2,
        status: SessionStatus.live,
      },
      {
        masterclassId: masterclass1.id,
        title: 'Harmonic Foundations & Gospel Substitutions',
        description: 'Advanced re-harmonization techniques and movement theory for contemporary church music.',
        orderIndex: 3,
        status: SessionStatus.upcoming,
        scheduledAt: new Date('2026-05-15'),
      },
    ],
  });

  // Create testimonials
  await prisma.testimonial.createMany({
    data: [
      {
        quote: 'Joseph brought a clarity to our music team that we have never had before.',
        authorName: 'Pastor J. Williams',
        authorOrg: 'Grace Chapel',
        isFeatured: true,
        orderIndex: 1,
      },
      {
        quote: 'The masterclass completely transformed how I approach the bass.',
        authorName: 'Daniel Mensah',
        authorOrg: 'Accra Music School',
        isFeatured: true,
        orderIndex: 2,
      },
      {
        quote: 'Best investment I have made in my musical career.',
        authorName: 'Grace Adeyemi',
        authorOrg: 'Lagos Gospel Choir',
        isFeatured: true,
        orderIndex: 3,
      },
    ],
  });

  // Create events
  await prisma.event.createMany({
    data: [
      { title: 'London Event Apollo', venue: 'Apollo', city: 'London', country: 'UK', eventDate: new Date('2026-06-19'), isPublished: true },
      { title: 'Creamfields South Festival', venue: 'Creamfields', city: 'Chelmsford', country: 'UK', eventDate: new Date('2026-06-19'), isPublished: true },
      { title: 'Summerburst Festival', venue: 'Summerburst', city: 'Gothenburg', country: 'SE', eventDate: new Date('2026-06-19'), isPublished: true },
      { title: 'XS Las Vegas', venue: 'XS Nightclub', city: 'Las Vegas', country: 'US', eventDate: new Date('2026-06-12'), isPublished: true },
    ],
  });

  // Create settings
  const settingsData = [
    { key: 'contact_email', value: 'info@mrwilson.com' },
    { key: 'contact_phone_1', value: '(732) 555-0122' },
    { key: 'contact_phone_2', value: '(714) 555-0127' },
    { key: 'contact_address_1', value: '2972 Westheimer Rd, Santa Ana' },
    { key: 'contact_address_2', value: '1901 Thornridge Cir, Manchester' },
    { key: 'social_facebook', value: 'https://facebook.com/josephwilson' },
    { key: 'social_twitter', value: 'https://twitter.com/josephwilson' },
    { key: 'social_youtube', value: 'https://youtube.com/josephwilson' },
    { key: 'social_spotify', value: 'https://spotify.com/josephwilson' },
  ];

  for (const setting of settingsData) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }

  console.log('Settings created:', settingsData.length);
  console.log('Seed complete!');
  console.log('');
  console.log('Owner login:  joseph@mrwilson.com / Admin@123456');
  console.log('Member login: test@member.com / Member@123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
