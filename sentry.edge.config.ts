import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn?.startsWith('https://')) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
  });
}
