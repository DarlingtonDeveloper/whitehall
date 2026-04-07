import { ImageResponse } from 'next/og';
import { getEntity } from '@/data/entities';

export const runtime = 'edge';
export const alt = 'Whitehall Entity';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entity = getEntity(id);
  if (!entity) return new Response('Not found', { status: 404 });

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px 80px',
          width: '100%',
          height: '100%',
          backgroundColor: '#0a0a0b',
          color: 'white',
          fontFamily: 'system-ui',
        }}
      >
        <div style={{ fontSize: 20, letterSpacing: '0.15em', color: '#5DCAA5', marginBottom: 24 }}>
          WHITEHALL
        </div>
        <div style={{ fontSize: 48, fontWeight: 600, marginBottom: 12, lineHeight: 1.2 }}>
          {entity.name}
        </div>
        {entity.currentHolder && (
          <div style={{ fontSize: 24, color: '#a1a1aa', marginBottom: 24 }}>
            {entity.currentHolder}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              fontSize: 16,
              padding: '4px 16px',
              borderRadius: 8,
              backgroundColor: '#1a2a40',
              color: '#5DCAA5',
            }}
          >
            {entity.subtype.replace(/-/g, ' ')}
          </div>
          <div style={{ fontSize: 16, color: '#71717a' }}>
            Political Intelligence Platform
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
