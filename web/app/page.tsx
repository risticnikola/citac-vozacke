'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from '@/lib/api/auth';

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    const user = getSession();
    router.replace(user ? '/dashboard' : '/login');
  }, [router]);
  return null;
}
