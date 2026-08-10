import { ImageResponse } from 'next/og';
import { PRODUCTS } from '@/components/brand/products';

export const alt = 'Axiomancer Docs — the physical world, quantified';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Branded homepage Open Graph image. The void, the signal, the product
 * accents — rendered as a static survey card. Accents derive from the single
 * product-identity source so the card can never drift from the hub.
 */
export default function Image() {
  const accents = PRODUCTS.map((product) => product.accent);

  // Deterministic star field for the constellation backdrop
  const stars = Array.from({ length: 40 }, (_, i) => ({
    x: ((i * 137.5) % 1200),
    y: ((i * 89.7) % 630),
    r: (i % 3) + 1,
  }));

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#0A0A0A',
          position: 'relative',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Ambient glow */}
        <div
          style={{
            position: 'absolute',
            top: -150,
            left: '50%',
            width: 900,
            height: 500,
            transform: 'translateX(-50%)',
            background: 'radial-gradient(ellipse, rgba(0,212,255,0.14), transparent 65%)',
            display: 'flex',
          }}
        />
        {/* Constellation stars */}
        {stars.map((s, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: s.x,
              top: s.y,
              width: s.r * 2,
              height: s.r * 2,
              borderRadius: '50%',
              background: 'rgba(0,212,255,0.35)',
              display: 'flex',
            }}
          />
        ))}

        <div style={{ display: 'flex', flexDirection: 'column', padding: '0 90px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 28,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#00D4FF',
                display: 'flex',
              }}
            />
            <span
              style={{
                color: '#00D4FF',
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: 6,
                textTransform: 'uppercase',
              }}
            >
              Axiomancer Docs
            </span>
          </div>

          <div
            style={{
              fontSize: 88,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: '#FFFFFF',
            }}
          >
            The physical world,
          </div>
          <div
            style={{
              fontSize: 88,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: '#00D4FF',
            }}
          >
            quantified.
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              marginTop: 44,
            }}
          >
            {accents.map((c) => (
              <div
                key={c}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: c,
                  display: 'flex',
                }}
              />
            ))}
            <span style={{ color: '#888888', fontSize: 24, marginLeft: 8 }}>
              Layer · Overwatch · Locus · Codex · RouteShift · Invest
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
