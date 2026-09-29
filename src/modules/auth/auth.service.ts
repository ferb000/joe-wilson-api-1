import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { prisma } from '../../config/database';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt';

import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
} from '../../utils/email';

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

/**
 * Hash a refresh token for database storage.
 *
 * Refresh tokens are cryptographically random JWT credentials,
 * so SHA-256 is appropriate for storing their digest.
 *
 * This is NOT used for passwords.
 */
function hashRefreshToken(token: string): string {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

function generateTokens(user: {
  id: string;
  email: string;
  role: string;
}) {
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  const refreshToken = signRefreshToken({
    sub: user.id,
  });

  return {
    accessToken,
    refreshToken,
  };
}

/**
 * Generate a new access + refresh token pair and
 * persist the refresh-token digest.
 */
async function issueTokens(user: {
  id: string;
  email: string;
  role: string;
}) {
  const { accessToken, refreshToken } = generateTokens(user);

  const refreshTokenHash = hashRefreshToken(refreshToken);

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      refreshTokenHash,
    },
  });

  return {
    accessToken,
    refreshToken,
  };
}

export async function register(data: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}) {
  const email = data.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existing) {
    throw new Error('EMAIL_TAKEN');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      refreshTokenHash: null,
    },
  });

  try {
    await sendWelcomeEmail(user.email, user.firstName);
  } catch (error) {
    console.error('[AUTH] Welcome email failed:', error);
  }

  const tokens = await issueTokens(user);

  return {
    user: safeUser(user),
    ...tokens,
  };
}

export async function login(
  email: string,
  password: string
) {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
  });

  /*
   * Keep the response generic so attackers cannot determine
   * whether an email address exists.
   */
  if (!user) {
    throw new Error('INVALID_CREDENTIALS');
  }

  const valid = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!valid) {
    throw new Error('INVALID_CREDENTIALS');
  }

  const tokens = await issueTokens(user);

  return {
    user: safeUser(user),
    ...tokens,
  };
}

/**
 * Refresh-token rotation.
 *
 * Flow:
 * 1. Verify JWT signature, issuer, audience, expiry and type.
 * 2. Find the user.
 * 3. Hash the supplied refresh token.
 * 4. Atomically replace the stored hash.
 * 5. If replacement fails, the token is no longer valid.
 *
 * Because the database update checks the previous hash,
 * two requests cannot both successfully rotate the same
 * refresh token.
 */
export async function refresh(rawToken: string) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('INVALID_TOKEN');
  }

  let payload;

  try {
    payload = verifyRefreshToken(rawToken);
  } catch {
    throw new Error('INVALID_TOKEN');
  }

  const user = await prisma.user.findUnique({
    where: {
      id: payload.sub,
    },
  });

  if (!user || !user.refreshTokenHash) {
    throw new Error('INVALID_TOKEN');
  }

  const suppliedHash = hashRefreshToken(rawToken);

  /*
   * Atomic rotation.
   *
   * The refresh token is valid only if the database still
   * contains the exact hash belonging to this token.
   */
  const newTokens = generateTokens(user);
  const newRefreshTokenHash = hashRefreshToken(
    newTokens.refreshToken
  );

  const rotated = await prisma.user.updateMany({
    where: {
      id: user.id,
      refreshTokenHash: suppliedHash,
    },
    data: {
      refreshTokenHash: newRefreshTokenHash,
    },
  });

  if (rotated.count !== 1) {
    /*
     * The token has already been rotated, revoked,
     * or otherwise does not match the active session.
     *
     * Revoke the current session as a defensive response.
     */
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        refreshTokenHash: null,
      },
    });

    throw new Error('INVALID_TOKEN');
  }

  return {
    accessToken: newTokens.accessToken,
    refreshToken: newTokens.refreshToken,
  };
}

export async function logout(userId: string) {
  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      refreshTokenHash: null,
    },
  });
}

export async function forgotPassword(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
  });

  /*
   * Never reveal whether the account exists.
   */
  if (!user) {
    return;
  }

  const rawToken = crypto.randomBytes(32).toString('hex');

  const tokenHash = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  const expires = new Date(
    Date.now() + 60 * 60 * 1000
  );

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      resetPasswordToken: tokenHash,
      resetPasswordExpires: expires,
    },
  });

  await sendPasswordResetEmail(
    user.email,
    rawToken
  );
}

export async function resetPassword(
  rawToken: string,
  newPassword: string
) {
  if (!rawToken || !newPassword) {
    throw new Error('INVALID_RESET_TOKEN');
  }

  const tokenHash = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  const user = await prisma.user.findFirst({
    where: {
      resetPasswordToken: tokenHash,
      resetPasswordExpires: {
        gt: new Date(),
      },
    },
  });

  if (!user) {
    throw new Error('INVALID_RESET_TOKEN');
  }

  const passwordHash = await bcrypt.hash(
    newPassword,
    12
  );

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      passwordHash,

      /*
       * Make the reset token single-use.
       */
      resetPasswordToken: null,
      resetPasswordExpires: null,

      /*
       * Force existing refresh sessions to become
       * invalid after a password reset.
       */
      refreshTokenHash: null,
    },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  return safeUser(user);
}

export async function updateProfile(
  userId: string,
  data: {
    firstName?: string;
    lastName?: string;
    avatarUrl?: string | null;
  }
) {
  const updated = await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      ...(data.firstName !== undefined && {
        firstName: data.firstName.trim(),
      }),

      ...(data.lastName !== undefined && {
        lastName: data.lastName.trim(),
      }),

      ...(data.avatarUrl !== undefined && {
        avatarUrl: data.avatarUrl,
      }),
    },
  });

  return safeUser(updated);
}
