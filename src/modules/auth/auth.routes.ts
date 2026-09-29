import { Router } from 'express';

import {
  register,
  login,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
  getMe,
  updateMe,
} from './auth.controller';

import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshSchema,
} from './auth.validation';

import { validate } from '../../middleware/validate';
import {
  loginLimiter,
  registerLimiter,
  refreshLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} from '../../middleware/rateLimit';

import { authenticate } from '../../middleware/authenticate';

const router = Router();

/**
 * @openapi
 * /v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 */
router.post(
  '/register',
  registerLimiter,
  validate(registerSchema),
  register
);

/**
 * @openapi
 * /v1/auth/login:
 *   post:
 *     summary: Login user
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  login
);

/**
 * @openapi
 * /v1/auth/forgot-password:
 *   post:
 *     summary: Request password reset
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reset email sent
 */
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate(forgotPasswordSchema),
  forgotPassword
);

/**
 * @openapi
 * /v1/auth/reset-password:
 *   post:
 *     summary: Reset user password
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successful
 */
router.post(
  '/reset-password',
  resetPasswordLimiter,
  validate(resetPasswordSchema),
  resetPassword
);



/**
 * @openapi
 * /v1/auth/me:
 *   get:
 *     summary: Get the current authenticated user
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *       401:
 *         description: Unauthorized
 */
router.get('/me', authenticate, getMe);

/**
 * @openapi
 * /v1/auth/me:
 *   patch:
 *     summary: Update the current authenticated user
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated user profile
 *       401:
 *         description: Unauthorized
 */
router.patch('/me', authenticate, updateMe);

/**
 * @openapi
 * /v1/auth/refresh:
 *   post:
 *     summary: Refresh access and refresh tokens
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: New access and refresh tokens returned
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post(
  '/refresh',
  refreshLimiter,
  validate(refreshSchema),
  refresh
);

/**
 * @openapi
 * /v1/auth/logout:
 *   post:
 *     summary: Log out the current authenticated user
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/logout', authenticate, logout);

export default router;