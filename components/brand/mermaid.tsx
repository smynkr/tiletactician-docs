'use client';

import { useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';

interface MermaidProps {
  /** Mermaid diagram definition (flowchart, sequenceDiagram, etc.). */
  chart: string;
  /** Optional caption rendered below the diagram. */
  caption?: string;
  /** Preserve a readable intrinsic width on mobile and allow horizontal scroll. */
  mobileScroll?: boolean;
}

/**
 * Renders a Mermaid diagram themed to the Axiomancer palette. Re-renders on
 * theme change so diagrams stay legible in both the void and on paper.
 *
 * Usage in MDX:
 *   <Mermaid chart={`flowchart LR\n  A --> B`} caption="Request flow" />
 */
export function Mermaid({ chart, caption, mobileScroll = false }: MermaidProps) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string>('');
  const { resolvedTheme } = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import('mermaid')).default;
        const dark = resolvedTheme !== 'light';

        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          securityLevel: 'loose',
          themeVariables: {
            fontFamily: 'Inter, system-ui, sans-serif',
            background: 'transparent',
            primaryColor: dark ? '#161616' : '#f4f4f5',
            primaryTextColor: dark ? '#e8e8e8' : '#161616',
            primaryBorderColor: dark ? '#3a3a3a' : '#d4d4d8',
            lineColor: dark ? '#6a6a6a' : '#9ca3af',
            secondaryColor: dark ? '#111111' : '#ececee',
            tertiaryColor: dark ? '#0f0f0f' : '#fafafa',
            mainBkg: dark ? '#161616' : '#f4f4f5',
            nodeBorder: dark ? '#3a3a3a' : '#d4d4d8',
            clusterBkg: dark ? '#101010' : '#f7f7f8',
            clusterBorder: dark ? '#2a2a2a' : '#e2e2e4',
            edgeLabelBackground: dark ? '#0a0a0a' : '#fafafa',
            textColor: dark ? '#b0b0b0' : '#52525b',
          },
          flowchart: { curve: 'basis', htmlLabels: true },
          sequence: { mirrorActors: false },
        });

        const { svg: rendered } = await mermaid.render(`ax-mermaid-${id}`, chart.trim());
        if (!cancelled) {
          setSvg(rendered);
          setError('');
        }
      } catch (cause) {
        if (!cancelled) {
          setError('Diagram unavailable.');
          if (process.env.NODE_ENV !== 'production') {
            console.error('[Mermaid] diagram render failed', cause);
          }
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [chart, resolvedTheme, id]);

  return (
    <figure className="ax-figure not-prose my-8">
      {error ? (
        <div className="border-b border-fd-border bg-fd-card/60 p-6 text-sm text-fd-muted-foreground">
          <p className="font-medium text-fd-card-foreground">{error}</p>
          {caption ? <p className="mt-1">The written explanation remains available.</p> : null}
        </div>
      ) : (
        <div className="overflow-x-auto p-6">
          <div
            className={
              mobileScroll
                ? 'flex justify-start [&_svg]:h-auto [&_svg]:min-w-[40rem] [&_svg]:max-w-none sm:justify-center sm:[&_svg]:min-w-0 sm:[&_svg]:max-w-full'
                : 'flex justify-center [&_svg]:h-auto [&_svg]:max-w-full'
            }
            dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
          >
            {svg ? null : <span className="text-sm text-fd-muted-foreground">Rendering diagram…</span>}
          </div>
        </div>
      )}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
