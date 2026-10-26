
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { env } from '../../config/env';
import { HttpError } from '../../utils/httpError';
import { prisma } from '../../config/database';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../../utils/email';

function safeUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}

function generateTokens(user: { id: string; email: string; role: string; tokenVersion: number }) {
  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role, version: user.tokenVersion });
  const refreshToken = signRefreshToken({ sub: user.id });
  return { accessToken, refreshToken };
}

export async function register(data: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new Error('EMAIL_TAKEN');

  const passwordHash = await bcrypt.hash(data.password, 12);
  const userId = crypto.randomUUID();
  const refreshToken = signRefreshToken({ sub: userId });
  const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  const user = await prisma.$transaction(async tx => {
    const user = await tx.user.create({
    data: {
      id: userId,
      email: data.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      refreshTokenHash,
    },
  });

    await sendWelcomeEmail(user.email, user.firstName, tx);
    return user;
  });

  const { accessToken } = generateTokens(user);
  return { user: safeUser(user), accessToken, refreshToken };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('INVALID_CREDENTIALS');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error('INVALID_CREDENTIALS');
  const userId = user.id;

  const refreshToken = signRefreshToken({ sub: userId });
  const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  const signedIn = await prisma.user.updateMany({
    where: { id: user.id, passwordHash: user.passwordHash, tokenVersion: user.tokenVersion },
    data: { refreshTokenHash },
  });
  if (signedIn.count !== 1) throw new Error('INVALID_CREDENTIALS');

  const { accessToken } = generateTokens(user);
  return { user: safeUser(user), accessToken, refreshToken };
}

export async function refresh(rawToken: string) {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(rawToken);
  } catch {
    throw new Error('INVALID_TOKEN');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.refreshTokenHash) throw new Error('INVALID_TOKEN');

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  if (tokenHash !== user.refreshTokenHash) throw new Error('INVALID_TOKEN');
  const newRefreshToken = signRefreshToken({ sub: user.id });
  const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
  const rotated = await prisma.user.updateMany({
    where: { id: user.id, refreshTokenHash: tokenHash, tokenVersion: user.tokenVersion },
    data: { refreshTokenHash: newRefreshTokenHash },
  });
  if (rotated.count !== 1) throw new Error('INVALID_TOKEN');

  const { accessToken } = generateTokens(user);
  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null, tokenVersion: { increment: 1 } } });
}

export async function forgotPassword(email: string) {
  if (!env.RESEND_API_KEY) throw new HttpError(503, 'Password reset email is not configured');
  const user = await prisma.user.findUnique({ where: { email } });
  // Always return (no throw) to prevent email enumeration
  if (!user) return;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // FIXED: store a SHA-256 hash of the token, never the raw token.
  // If the database is breached, attackers cannot use leaked tokens.
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await prisma.user.update({
    where: { id: user.id },
    data: { resetPasswordToken: tokenHash, resetPasswordExpires: expires },
  });

  // Send the raw token to the user's email — they never see the hash
  await sendPasswordResetEmail(user.email, rawToken);
}

export async function resetPassword(rawToken: string, newPassword: string) {
  // Hash the incoming token before looking it up in the database
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const user = await prisma.user.findFirst({
    where: {
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { gt: new Date() },
    },
  });
  if (!user) throw new Error('INVALID_TOKEN');

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      refreshTokenHash: null, // force re-login on all devices
    },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('NOT_FOUND');
  return safeUser(user);
}

export async function updateProfile(
  userId: string,
  data: { firstName?: string; lastName?: string; avatarUrl?: string }
) {
  const user = await prisma.user.update({ where: { id: userId }, data: {
    ...(data.firstName !== undefined && { firstName: data.firstName }),
    ...(data.lastName !== undefined && { lastName: data.lastName }),
    ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
  } });
  return safeUser(user);
}
