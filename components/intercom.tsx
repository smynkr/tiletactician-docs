'use client';

import { useEffect } from 'react';

const INTERCOM_APP_ID = 'okr3tqrw'; // Source: docs.json integrations.intercom.appId.

declare global {
  interface Window {
    intercomSettings?: { app_id: string };
  }
}

export function Intercom() {
  useEffect(() => {
    const existing = document.querySelector(`script[data-intercom-app-id="${INTERCOM_APP_ID}"]`);
    if (existing) return;

    window.intercomSettings = { app_id: INTERCOM_APP_ID };
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://widget.intercom.io/widget/${INTERCOM_APP_ID}`;
    script.dataset.intercomAppId = INTERCOM_APP_ID;
    document.head.appendChild(script);
  }, []);

  return null;
}
