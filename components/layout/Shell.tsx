'use client';

import { type ReactNode } from 'react';
import NavBar from './NavBar';

interface ShellProps {
  children: ReactNode;
}

export default function Shell({ children }: ShellProps) {
  return (
    <div className="flex h-full flex-col">
      <NavBar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
