"use client";

import { type ReactNode, useEffect } from "react";
import posthog, { type CaptureResult } from "posthog-js";
import { redactShareTokenFromUrl } from "@/lib/analytics-fingerprint";

const POSTHOG_KEY =
  process.env.NEXT_PUBLIC_POSTHOG_KEY ||
  "phc_vdWbowGRpRbAwh8zCFPQbri6gf6DavM4qaBHNxvfxNVu";
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://b.axiomancer.io";

// Only valid PostHog project keys begin with "phc_". Prod was misconfigured
// with a "phx_..." token that 404s on /array/.../config and 401s on /flags,
// flooding the console + breaking Lighthouse best-practices. Skip the boot
// when the key is empty or doesn't look like a project key.
const HAS_VALID_KEY = POSTHOG_KEY.startsWith("phc_");

let hasInitializedPostHog = false;

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!HAS_VALID_KEY || hasInitializedPostHog) return;

    hasInitializedPostHog = true;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: "https://us.posthog.com",
      defaults: "2026-01-30",
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      persistence: "localStorage",
      // Automatic pageview/pageleave/autocapture send $current_url and $pathname,
      // which embed the raw share/referral bearer token on the public share route.
      // Redact it here so URL capture obeys the same "never send the raw token"
      // invariant as the manual fingerprint events (see analytics-fingerprint.ts).
      before_send: (event: CaptureResult | null) => {
        if (!event) return event;
        // Session-replay $snapshot events embed the raw page URL inside nested
        // rrweb data that the top-level prop redactor below can't reach — drop
        // them entirely where the URL carries a share/referral bearer token.
        if (
          event.event === "$snapshot" &&
          typeof window !== "undefined" &&
          (() => {
            const url = window.location.pathname + window.location.search;
            return url !== redactShareTokenFromUrl(url);
          })()
        ) {
          return null;
        }
        const redact = (props?: Record<string, unknown>) => {
          if (!props) return;
          for (const key of Object.keys(props)) {
            const val = props[key];
            if (typeof val === "string") props[key] = redactShareTokenFromUrl(val);
          }
        };
        redact(event.properties);
        redact(event.$set);
        redact(event.$set_once);
        return event;
      },
    });
  }, []);

  return <>{children}</>;
}
