'use client';

import { type ReactNode, useEffect } from 'react';
import posthog, { type CaptureResult } from 'posthog-js';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '';
const HAS_VALID_KEY = POSTHOG_KEY.startsWith('phc_');
let initialized = false;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKEN_PATTERN = /\b(?:sk|pk|phc|phx|bearer)[_-]?[a-z0-9._-]{8,}\b/gi;

export function redactAnalyticsValue(value: string) {
  return value.replace(EMAIL_PATTERN, '[redacted-email]').replace(TOKEN_PATTERN, '[redacted-token]');
}

function redactProperties(properties?: Record<string, unknown>) {
  if (!properties) return;
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'string') properties[key] = redactAnalyticsValue(value);
    else if (value && typeof value === 'object' && !Array.isArray(value)) redactProperties(value as Record<string, unknown>);
  }
}

export function captureDocsEvent(event: string, properties: Record<string, unknown>) {
  if (!HAS_VALID_KEY) return;
  redactProperties(properties);
  posthog.capture(event, properties);
}

export function captureDocsSearch(event: string, properties: Record<string, unknown>) {
  captureDocsEvent(event, properties);
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!HAS_VALID_KEY || initialized) return;
    initialized = true;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: 'https://us.posthog.com',
      defaults: '2026-01-30',
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      persistence: 'localStorage',
      // Search terms can include customer identifiers. Apply the same
      // redaction discipline as the provided Axiomancer reference provider.
      before_send: (event: CaptureResult | null) => {
        if (!event) return event;
        redactProperties(event.properties);
        redactProperties(event.$set);
        redactProperties(event.$set_once);
        return event;
      },
    });
  }, []);

  return <>{children}</>;
}
