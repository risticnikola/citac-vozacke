import { apiClient } from './client';
import type { User } from '@/types';

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<{ token: string; expiresIn: number }>('/v1/auth/login', { email, password }).then((r) => r.data),
};

export function saveSession(token: string) {
  sessionStorage.setItem('token', token);
}

export function clearSession() {
  sessionStorage.removeItem('token');
}

export function getSession(): User | null {
  if (typeof window === 'undefined') return null;
  const token = sessionStorage.getItem('token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp * 1000 < Date.now()) { clearSession(); return null; }
    return payload as User;
  } catch {
    return null;
  }
}
