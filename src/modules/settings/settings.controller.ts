import { z } from 'zod';
import { Request, Response } from 'express';
import { prisma } from '../../config/database';
import { ok } from '../../utils/response';

const PUBLIC_KEYS = [
  'booking_email', 'contact_location', 'social_instagram',
  'contact_email', 'contact_phone_1', 'contact_phone_2',
  'contact_address_1', 'contact_address_2',
  'social_facebook', 'social_twitter', 'social_youtube',
  'social_spotify', 'social_apple_music', 'social_soundcloud',
];

function settingsArrayToObject(settings: { key: string; value: string }[]) {
  return settings.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {} as Record<string, string>);
}

export async function getPublicSettings(req: Request, res: Response) {
  const settings = await prisma.setting.findMany({ where: { key: { in: PUBLIC_KEYS } } });
  return ok(res, settingsArrayToObject(settings));
}

export async function getAllSettings(req: Request, res: Response) {
  const settings = await prisma.setting.findMany();
  return ok(res, settingsArrayToObject(settings));
}

export async function updateSettings(req: Request, res: Response) {
  const updates = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,99}$/), z.string().max(10000)).refine(data => Object.keys(data).length > 0 && Object.keys(data).length <= 100, 'Provide 1 to 100 settings').parse(req.body);

  await prisma.$transaction(
    Object.entries(updates).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  );

  const settings = await prisma.setting.findMany();
  return ok(res, settingsArrayToObject(settings));
}
