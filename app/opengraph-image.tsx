import { ImageResponse } from 'next/og';
import { PRODUCTS } from '@/components/brand/products';

export const alt = 'TileTactician — every legal play, ranked by score';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Branded homepage Open Graph image. The void, the signal, the tile mark —
 * rendered as a static card in the TileTactician identity: near-black board
 * at night, a single deliberate point of amber light. The accent derives from
 * the single product-identity source so the card can never drift from the
 * site's chrome.
 */
export default function Image() {
  const accent = PRODUCTS[0]?.accent ?? '#F59E0B';

  // Deterministic board-edge dots: one quiet row of 15 tiles, echoing the
  // 15×15 grid the app analyzes.
  const tiles = Array.from({ length: 15 }, (_, i) => i);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#0A0A0F',
          position: 'relative',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Ambient amber glow — the point of light in the void. */}
        <div
          style={{
            position: 'absolute',
            top: -180,
            left: '50%',
            width: 1000,
            height: 560,
            transform: 'translateX(-50%)',
            background: 'radial-gradient(ellipse, rgba(245,158,11,0.13), transparent 65%)',
            display: 'flex',
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', padding: '0 90px' }}>
          {/* Tile mark: rounded square outline with the cross — the same
              geometry as public/logo.svg, drawn in divs so satori renders it
              without raster assets. */}
          <div style={{ display: 'flex', marginBottom: 36 }}>
            <div
              style={{
                width: 92,
                height: 92,
                borderRadius: 20,
                border: `6px solid ${accent}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  width: 52,
                  height: 8,
                  borderRadius: 4,
                  background: accent,
                  display: 'flex',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  width: 8,
                  height: 52,
                  borderRadius: 4,
                  background: accent,
                  display: 'flex',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 30 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: accent,
                display: 'flex',
              }}
            />
            <span
              style={{
                color: accent,
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: 6,
                textTransform: 'uppercase',
              }}
            >
              TileTactician
            </span>
          </div>

          <div
            style={{
              fontSize: 84,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: '#FFFFFF',
            }}
          >
            Every legal play,
          </div>
          <div
            style={{
              fontSize: 84,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: accent,
            }}
          >
            ranked by score.
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 40,
              color: '#8F8F8F',
              fontSize: 26,
            }}
          >
            Scrabble &amp; NYT Crossplay board analysis — works fully offline
          </div>
        </div>

        {/* Board-edge tile row, quiet at the bottom of the card. */}
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            gap: 18,
          }}
        >
          {tiles.map((i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 1.5,
                background: 'rgba(245,158,11,0.28)',
                display: 'flex',
              }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
