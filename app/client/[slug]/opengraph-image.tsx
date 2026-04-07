import { ImageResponse } from 'next/og';
import { getClientBySlug } from '@/data/clients';

export const runtime = 'edge';
export const alt = 'Whitehall Client';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = getClientBySlug(slug);
  if (!client) return new Response('Not found', { status: 404 });

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
        <div style={{ fontSize: 48, fontWeight: 600, marginBottom: 12 }}>
          {client.name}
        </div>
        <div style={{ fontSize: 24, color: '#a1a1aa', marginBottom: 24 }}>
          {client.sector} &middot; {client.stakeholders.length} stakeholders
        </div>
        <div style={{ fontSize: 16, color: '#71717a' }}>
          Political Intelligence Platform
        </div>
      </div>
    ),
    { ...size },
  );
}
