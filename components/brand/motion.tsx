'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Reveals a block on entry into the viewport. Server-renders visible so
 * content is never lost if JS fails; reduced-motion users stay visible.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true); // SSR-visible by default
  const [mounted, setMounted] = useState(false); // only hide after JS boots

  useEffect(() => {
    setMounted(true); // JS is alive — safe to hide for the reveal
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return;
    }
    setVisible(false); // now safe to hide; IO will reveal on scroll
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!mounted) {
    // SSR or pre-hydration: render visible, no transitions
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(18px)',
        transition: `opacity 700ms cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 700ms cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
        ...(visible ? {} : { willChange: 'opacity, transform' }),
      }}
    >
      {children}
    </div>
  );
}
