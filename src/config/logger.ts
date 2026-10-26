import pino from 'pino';

export const loggerOptions: pino.LoggerOptions = {
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'password', 'refreshToken', 'token', 'req.body', 'req.query'], censor: '[REDACTED]' },
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        }
      : undefined,

  level: process.env.NODE_ENV === 'production'
    ? 'info'
    : 'debug',
};
export const logger = pino(loggerOptions);
