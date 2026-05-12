'use client';

import { useEffect, useState } from 'react';
import { getSession, clearSession } from '@/lib/api/auth';
import type { User } from '@/types';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(getSession());
    setLoading(false);
  }, []);

  function logout() {
    clearSession();
    window.location.href = '/login';
  }

  return { user, loading, logout };
}
