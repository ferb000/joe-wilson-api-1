export function hasActiveAccess(enrollment: { accessExpiresAt: Date | null; payment?: { status: string } } | null | undefined): boolean {
  return !!enrollment && (!enrollment.accessExpiresAt || enrollment.accessExpiresAt > new Date()) && (!enrollment.payment || enrollment.payment.status === 'succeeded');
}
