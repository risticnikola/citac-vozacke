'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Car, Plus, Search, ChevronRight, ScanLine } from 'lucide-react';
import { vehiclesApi } from '@/lib/api/vehicles';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { scanCard } from '@/lib/bridge';
import type { Vehicle } from '@/types';

function formatMileage(km: number | null) {
  if (km == null) return '—';
  return km.toLocaleString() + ' km';
}

function vehicleLabel(v: Vehicle) {
  const parts = [v.make, v.model, v.year].filter(Boolean);
  return parts.length ? parts.join(' ') : '—';
}

function VehicleRow({ v, onClick }: { v: Vehicle; onClick: () => void }) {
  return (
    <tr
      onClick={onClick}
      className="group cursor-pointer border-b border-neutral-800 transition-colors hover:bg-neutral-800/50"
    >
      <td className="py-3 pl-4 pr-3">
        <span className="font-mono text-sm font-medium text-neutral-100">
          {v.plate ?? '—'}
        </span>
      </td>
      <td className="px-3 py-3">
        <span className="text-sm text-neutral-300">{vehicleLabel(v)}</span>
      </td>
      <td className="hidden px-3 py-3 sm:table-cell">
        <span className="text-sm text-neutral-400">{v.vin ?? '—'}</span>
      </td>
      <td className="hidden px-3 py-3 md:table-cell">
        <span className="text-sm text-neutral-400">{v.owner_name ?? '—'}</span>
      </td>
      <td className="hidden px-3 py-3 lg:table-cell">
        <span className="text-sm tabular-nums text-neutral-400">
          {formatMileage(v.current_mileage_km)}
        </span>
      </td>
      <td className="py-3 pl-3 pr-4 text-right">
        <ChevronRight className="ml-auto h-4 w-4 text-neutral-600 transition-colors group-hover:text-neutral-400" />
      </td>
    </tr>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800">
        <Car className="h-7 w-7 text-neutral-500" />
      </div>
      <p className="text-sm font-medium text-neutral-300">
        {hasSearch ? 'No vehicles match your search' : 'No vehicles yet'}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        {hasSearch ? 'Try a different plate or VIN' : 'Add your first vehicle to get started'}
      </p>
    </div>
  );
}

export default function VehiclesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');

  async function handleScan() {
    setScanning(true);
    setScanError('');
    try {
      await scanCard();
    } catch (err: any) {
      const msg = err.message ?? 'Scan failed';
      setScanError(msg);
      setTimeout(() => setScanError(''), 3000);
    } finally {
      setScanning(false);
    }
  }

  // Determine if search looks like a VIN (17 chars, alphanumeric) or a plate
  const isVin = /^[A-HJ-NPR-Z0-9]{5,17}$/i.test(debouncedSearch) && debouncedSearch.length > 6;
  const queryParams = debouncedSearch
    ? (isVin ? { vin: debouncedSearch } : { plate: debouncedSearch })
    : {};

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ['vehicles', queryParams],
    queryFn: ({ pageParam }) =>
      vehiclesApi.list({ ...queryParams, cursor: pageParam as string | undefined, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.hasNextPage ? last.nextCursor ?? undefined : undefined,
  });

  const vehicles = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
          <Input
            placeholder="Search by plate or VIN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleScan} disabled={scanning}>
              {scanning
                ? <Spinner className="h-4 w-4" />
                : <ScanLine className="h-4 w-4" />}
              {scanning ? 'Scanning…' : 'Scan card'}
            </Button>
            <Button onClick={() => router.push('/vehicles/new')}>
              <Plus className="h-4 w-4" />
              Add vehicle
            </Button>
          </div>
          {scanError && (
            <p className="text-xs text-red-400">{scanError}</p>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner />
          </div>
        ) : isError ? (
          <div className="py-16 text-center text-sm text-red-400">
            Failed to load vehicles. Check your connection.
          </div>
        ) : vehicles.length === 0 ? (
          <EmptyState hasSearch={!!debouncedSearch} />
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th className="py-2.5 pl-4 pr-3 text-left text-xs font-medium text-neutral-500">Plate</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-neutral-500">Make / Model / Year</th>
                  <th className="hidden px-3 py-2.5 text-left text-xs font-medium text-neutral-500 sm:table-cell">VIN</th>
                  <th className="hidden px-3 py-2.5 text-left text-xs font-medium text-neutral-500 md:table-cell">Owner</th>
                  <th className="hidden px-3 py-2.5 text-left text-xs font-medium text-neutral-500 lg:table-cell">Mileage</th>
                  <th className="py-2.5 pl-3 pr-4" />
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <VehicleRow
                    key={v.id}
                    v={v}
                    onClick={() => router.push(`/vehicles/${v.id}`)}
                  />
                ))}
              </tbody>
            </table>

            {hasNextPage && (
              <div className="flex justify-center border-t border-neutral-800 p-4">
                <Button
                  variant="ghost"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? <Spinner className="h-4 w-4" /> : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {vehicles.length > 0 && (
        <p className="text-right text-xs text-neutral-600">
          {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} shown
        </p>
      )}
    </div>
  );
}
