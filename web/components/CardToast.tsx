'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, X, UserPlus, Search } from 'lucide-react';
import { useBridge } from './BridgeProvider';
import { Modal } from './ui/Modal';
import { VehicleForm } from './forms/VehicleForm';
import { cn } from '@/lib/cn';
import type { CardParsedData, Vehicle } from '@/types';

const AUTO_DISMISS_MS = 30_000;

function cardToVehiclePrefill(d: CardParsedData) {
  const ownerParts = [d.ownersFirstName, d.ownersSurnameOrBusinessName].filter(Boolean);
  return {
    vin:        d.vehicleIdNumber,
    plate:      d.registrationPlateNumber,
    make:       d.vehicleMake,
    model:      d.commercialDescription,
    year:       d.yearOfProduction,
    ownerName:  ownerParts.join(' ') || undefined,
  };
}

export function CardToast() {
  const router = useRouter();
  const { lastCard, clearCard, scanError, clearScanError } = useBridge();
  const [visible, setVisible]   = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Show toast when a card arrives
  useEffect(() => {
    if (!lastCard) { setVisible(false); return; }
    setVisible(true);
    const t = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [lastCard]);

  function dismiss() {
    setVisible(false);
    setTimeout(clearCard, 300); // wait for slide-out animation
  }

  function handleCreate() {
    setCreateOpen(true);
  }

  function handleFind() {
    const plate = lastCard?.parsedData?.registrationPlateNumber;
    const vin   = lastCard?.parsedData?.vehicleIdNumber;
    if (plate) router.push(`/vehicles?plate=${encodeURIComponent(plate)}`);
    else if (vin) router.push(`/vehicles?vin=${encodeURIComponent(vin)}`);
    else router.push('/vehicles');
    dismiss();
  }

  function handleCreated(v: Vehicle) {
    setCreateOpen(false);
    dismiss();
    router.push(`/vehicles/${v.id}`);
  }

  if (!lastCard && !scanError) return null;

  if (scanError) {
    return (
      <div className="fixed bottom-5 right-5 z-40 w-80 overflow-hidden rounded-2xl border border-red-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2.5 px-4 py-3 bg-red-500/10 border-b border-red-900">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-500/20">
            <CreditCard className="h-4 w-4 text-red-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-300">Scan failed</p>
            <p className="text-xs text-red-400/80">{scanError}</p>
          </div>
          <button onClick={clearScanError} className="text-neutral-500 transition-colors hover:text-neutral-300">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (!lastCard) return null;

  const d = lastCard.parsedData ?? {};
  const plate      = d.registrationPlateNumber;
  const make       = d.vehicleMake;
  const model      = d.commercialDescription;
  const year       = d.yearOfProduction;
  const ownerFirst = d.ownersFirstName;
  const ownerLast  = d.ownersSurnameOrBusinessName;
  const ownerName  = [ownerFirst, ownerLast].filter(Boolean).join(' ');

  const prefill = cardToVehiclePrefill(d);

  return (
    <>
      {/* Toast */}
      <div
        className={cn(
          'fixed bottom-5 right-5 z-40 w-80 overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl',
          'transition-all duration-300',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-neutral-800 bg-orange-500/10 px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-500/20">
            <CreditCard className="h-4 w-4 text-orange-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-orange-300">Card detected</p>
            <p className="text-xs text-orange-400/60">
              {lastCard.cardType === 'vehicle_registration' ? 'Vehicle registration card' :
               lastCard.cardType === 'id_card' ? 'ID card' : 'Unknown card type'}
            </p>
          </div>
          <button onClick={dismiss} className="text-neutral-500 transition-colors hover:text-neutral-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Card data */}
        <div className="px-4 py-3">
          {plate && (
            <div className="mb-2 inline-flex items-center rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1">
              <span className="font-mono text-base font-bold tracking-widest text-neutral-100">{plate}</span>
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            {(make || model || year) && (
              <p className="text-sm text-neutral-300">
                {[make, model, year].filter(Boolean).join(' ')}
              </p>
            )}
            {ownerName && (
              <p className="text-xs text-neutral-500">{ownerName}</p>
            )}
            {d.expiryDate && (
              <p className="text-xs text-neutral-600">
                Reg. expires: {new Date(d.expiryDate).toLocaleDateString('en-GB', {
                  day: '2-digit', month: 'short', year: 'numeric',
                })}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-neutral-800 px-4 py-3">
          <button
            onClick={handleCreate}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-orange-400"
          >
            <UserPlus className="h-3.5 w-3.5" /> Create vehicle
          </button>
          <button
            onClick={handleFind}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            <Search className="h-3.5 w-3.5" /> Find existing
          </button>
        </div>

        {/* Auto-dismiss progress bar */}
        <div className="h-0.5 bg-neutral-800">
          <div
            className="h-full bg-orange-500/50 origin-left"
            style={{ animation: `shrink ${AUTO_DISMISS_MS}ms linear forwards` }}
          />
        </div>
      </div>

      {/* Create vehicle modal pre-filled from card */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create vehicle from card">
        <VehicleForm
          prefill={prefill}
          onSuccess={handleCreated}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      <style>{`
        @keyframes shrink {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </>
  );
}
