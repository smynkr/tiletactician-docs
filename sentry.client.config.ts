import * as Sentry from '@sentry/nextjs';

const dsn = (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || '').trim();

if (dsn?.startsWith('https://')) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // Recorded privacy decision: docs sites must not enable Sentry Session Replay.
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
