import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Read last selected client from cookie
  const lastClient = request.cookies.get('wh-client')?.value;

  // Pass hint as header so client-side can auto-select
  if (request.nextUrl.pathname === '/' && lastClient) {
    const response = NextResponse.next();
    response.headers.set('x-last-client', lastClient);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/'],
};
