'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { VehicleForm } from '@/components/forms/VehicleForm';
import type { Vehicle } from '@/types';

export default function NewVehiclePage() {
  const router = useRouter();

  function handleSuccess(v: Vehicle) {
    router.push(`/vehicles/${v.id}`);
  }

  return (
    <div className="max-w-lg">
      <button
        onClick={() => router.push('/vehicles')}
        className="mb-6 flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All vehicles
      </button>

      <h2 className="mb-6 text-lg font-semibold text-neutral-100">Add vehicle</h2>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <VehicleForm
          onSuccess={handleSuccess}
          onCancel={() => router.push('/vehicles')}
        />
      </div>
    </div>
  );
}
