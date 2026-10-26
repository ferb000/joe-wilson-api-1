import { Resend } from 'resend';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { HttpError } from './httpError';
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
export function escapeHtml(text: string) { return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]!)); }
export async function sendEmail(to: string, subject: string, html: string, client = resend) {
  if (!client) throw new HttpError(503, 'Email delivery is not configured');
  const result = await client.emails.send({ from: env.RESEND_FROM_EMAIL, to, subject, html });
  if (result.error) throw new Error('Email provider rejected delivery');
}
export async function queueEmail(to: string, subject: string, html: string, tx: Prisma.TransactionClient = prisma) {
  if (!env.RESEND_API_KEY) return; // Optional notifications are disabled; password reset checks availability first.
  await tx.emailOutbox.create({ data: { to, subject, html } });
}
export async function sendWelcomeEmail(to: string, firstName: string, tx?: Prisma.TransactionClient) { await queueEmail(to, 'Welcome to the Mr. Wilson Platform', '<h1>Welcome, ' + escapeHtml(firstName) + '!</h1><p>Your account has been created.</p>', tx); }
export async function sendPasswordResetEmail(to: string, token: string, tx?: Prisma.TransactionClient) {
  if (!env.RESEND_API_KEY) throw new HttpError(503, 'Password reset email is not configured');
  const url = env.FRONTEND_URLS.split(',')[0].trim() + '/reset-password?token=' + encodeURIComponent(token);
  await queueEmail(to, 'Reset your password', '<h1>Password Reset</h1><p>This link expires in one hour.</p><a href="' + escapeHtml(url) + '">Reset password</a>', tx);
}
export async function sendPaymentReceiptEmail(to: string, firstName: string, title: string, amountCents: number, tx?: Prisma.TransactionClient) { await queueEmail(to, 'Payment confirmed', '<p>Hi ' + escapeHtml(firstName) + ', your payment of $' + (amountCents / 100).toFixed(2) + ' for ' + escapeHtml(title) + ' was successful.</p>', tx); }
export async function sendInquiryNotificationEmail(name: string, email: string, message: string, tx?: Prisma.TransactionClient) { await queueEmail(env.ADMIN_EMAIL, 'New inquiry', '<p>From: ' + escapeHtml(name) + ' (' + escapeHtml(email) + ')</p><p>' + escapeHtml(message) + '</p>', tx); }
export async function sendInquiryReplyEmail(to: string, name: string, reply: string, tx?: Prisma.TransactionClient) { await queueEmail(to, 'Reply from Joseph Wilson', '<p>Hi ' + escapeHtml(name) + ',</p><p>' + escapeHtml(reply) + '</p>', tx); }
export async function sendQuoteNotificationEmail(name: string, email: string, title: string, tx?: Prisma.TransactionClient) { await queueEmail(env.ADMIN_EMAIL, 'New quote request', '<p>Client: ' + escapeHtml(name) + ' (' + escapeHtml(email) + ')</p><p>Service: ' + escapeHtml(title) + '</p>', tx); }
