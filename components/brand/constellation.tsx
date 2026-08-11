'use client';

import { useEffect, useRef } from 'react';

interface ConstellationProps {
  /** Number of stars. Default 90 per the brand spec. */
  count?: number;
  /** Max distance (px) at which two stars link. Default 150. */
  linkDistance?: number;
  /** Radius (px) within which stars gravitate toward the cursor. Default 180. */
  pullRadius?: number;
  /** Star color as "r, g, b". Defaults to the amber signal. */
  color?: string;
  className?: string;
}

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/**
 * The TileTactician constellation — the brand's signature motion: a field of
 * drifting points of light, like tiles catching the table light, that link to
 * their nearest neighbours and gravitate toward the cursor. Rendered on a
 * <canvas> behind dead-end surfaces (the 404).
 *
 * Honors `prefers-reduced-motion` by drawing a single static frame.
 */
export function Constellation({
  count = 90,
  linkDistance = 150,
  pullRadius = 180,
  color = '245, 158, 11',
  className,
}: ConstellationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let raf = 0;
    let stars: Star[] = [];
    const mouse = { x: -9999, y: -9999 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.4 + 0.6,
      }));
    }

    function step() {
      for (const s of stars) {
        // Gentle drift
        s.x += s.vx;
        s.y += s.vy;

        // Cursor gravity
        const dx = mouse.x - s.x;
        const dy = mouse.y - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist < pullRadius && dist > 0.001) {
          const force = ((pullRadius - dist) / pullRadius) * 0.02;
          s.x += (dx / dist) * force * 10;
          s.y += (dy / dist) * force * 10;
        }

        // Wrap at edges
        if (s.x < -10) s.x = width + 10;
        if (s.x > width + 10) s.x = -10;
        if (s.y < -10) s.y = height + 10;
        if (s.y > height + 10) s.y = -10;
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);

      // Links
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const a = stars[i];
          const b = stars[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < linkDistance) {
            const alpha = (1 - d / linkDistance) * 0.14;
            ctx!.strokeStyle = `rgba(${color}, ${alpha})`;
            ctx!.lineWidth = 1;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }

      // Stars
      for (const s of stars) {
        ctx!.fillStyle = `rgba(${color}, 0.55)`;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function loop() {
      step();
      draw();
      raf = requestAnimationFrame(loop);
    }

    // The loop runs only while someone can actually see it: an infinite rAF
    // burns CPU/battery on every page that carries the constellation, even
    // when the tab is backgrounded or the canvas has scrolled out of view.
    // Both gates must be true to run; either flipping false stops the loop.
    // Visibility starts unknown (false) so a below-the-fold canvas never runs
    // even one frame before the observer's first callback reports it.
    let inViewport = false;
    let running = false;
    function syncLoop() {
      const shouldRun = !reduceMotion && inViewport && !document.hidden;
      if (shouldRun && !running) {
        running = true;
        raf = requestAnimationFrame(loop);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    }

    function onPointerMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    }
    function onPointerLeave() {
      mouse.x = -9999;
      mouse.y = -9999;
    }
    function onVisibilityChange() {
      syncLoop();
    }

    resize();
    seed();

    if (reduceMotion) {
      draw();
    } else {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerleave', onPointerLeave);
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        inViewport = entry.isIntersecting;
        syncLoop();
      },
      { rootMargin: '64px' },
    );
    io.observe(canvas);

    const ro = new ResizeObserver(() => {
      resize();
      seed();
      draw();
    });
    ro.observe(canvas);

    syncLoop();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [count, linkDistance, pullRadius, color]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className ?? 'ax-constellation'}
    />
  );
}
