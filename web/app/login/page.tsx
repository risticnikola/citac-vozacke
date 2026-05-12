'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, saveSession } from '@/lib/api/auth';
import { cn } from '@/lib/cn';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await authApi.login(email, password);
      saveSession(token);
      router.push('/dashboard');
    } catch (err: any) {
      const msg = err?.response?.data?.error;
      setError(msg === 'Invalid credentials' ? 'Invalid email or password.' : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4">
      {/* Logo / brand */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500">
          <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0M13 17h-2V5l-3 3m0 0 3 3m-3-3h10" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-100">CarMech</h1>
        <p className="text-sm text-neutral-400">Vehicle service management</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-8">
        <h2 className="mb-6 text-base font-medium text-neutral-100">Sign in to your account</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-neutral-400" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(
                'rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-sm text-neutral-100',
                'placeholder:text-neutral-500',
                'outline-none transition-colors',
                'focus:border-orange-500 focus:ring-1 focus:ring-orange-500',
              )}
              placeholder="you@garage.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-neutral-400" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(
                'rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-sm text-neutral-100',
                'placeholder:text-neutral-500',
                'outline-none transition-colors',
                'focus:border-orange-500 focus:ring-1 focus:ring-orange-500',
              )}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              'mt-1 flex h-10 items-center justify-center rounded-lg bg-orange-500 text-sm font-medium text-white',
              'transition-colors hover:bg-orange-400',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </div>

      <p className="mt-6 text-xs text-neutral-600">
        Contact your garage admin if you need an account.
      </p>
    </div>
  );
}
