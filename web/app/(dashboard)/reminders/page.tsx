'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BellDot, Check, Car, ChevronRight, AlertTriangle, Clock } from 'lucide-react';
import { remindersApi } from '@/lib/api/reminders';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { ServiceReminder, ServiceType } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  oil_change: 'Oil Change', tire_rotation: 'Tire Rotation',
  small_service: 'Small Service', big_service: 'Big Service',
  technical_inspection: 'Technical Inspection', registration_renewal: 'Registration Renewal',
  brake_check: 'Brake Check', other: 'Other',
};

const SERVICE_TYPES = Object.entries(SERVICE_LABELS) as [ServiceType, string][];

// ─── Filter presets ───────────────────────────────────────────────────────────

type Preset = 'all_open' | 'overdue' | 'due_soon' | 'completed';

interface PresetDef {
  key: Preset;
  label: string;
  icon: React.ElementType;
  params: () => Record<string, unknown>;
}

const PRESETS: PresetDef[] = [
  {
    key: 'all_open',
    label: 'All open',
    icon: BellDot,
    params: () => ({ status: 'open' }),
  },
  {
    key: 'overdue',
    label: 'Overdue',
    icon: AlertTriangle,
    params: () => ({ status: 'open', overdue: true }),
  },
  {
    key: 'due_soon',
    label: 'Due soon',
    icon: Clock,
    params: () => ({ status: 'open', dueSoon: true }),
  },
  {
    key: 'completed',
    label: 'Completed',
    icon: Check,
    params: () => ({ status: 'completed' }),
  },
];

// ─── Row ─────────────────────────────────────────────────────────────────────

function ReminderRow({
  r, onComplete,
}: {
  r: ServiceReminder;
  onComplete?: () => void;
}) {
  const router = useRouter();
  const vehicleLabel = [r.make, r.model, r.year].filter(Boolean).join(' ') || 'Unknown vehicle';

  return (
    <div className="group flex items-center gap-4 border-b border-neutral-800 px-4 py-3.5 last:border-0 transition-colors hover:bg-neutral-800/40">
      {/* Service type + badges */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-neutral-100">
            {SERVICE_LABELS[r.service_type] ?? r.service_type}
          </span>
          {!r.completed_at && r.urgency === 'overdue' && (
            <Badge variant="danger">
              {r.days_remaining != null && r.days_remaining < 0 && r.km_remaining != null && r.km_remaining < 0
                ? 'Overdue'
                : r.days_remaining != null && r.days_remaining < 0
                ? 'Date overdue'
                : 'Mileage overdue'}
            </Badge>
          )}
          {!r.completed_at && r.urgency === 'due_soon' && <Badge variant="warning">Due soon</Badge>}
          {r.completed_at && <Badge variant="success">Done</Badge>}
        </div>

        {/* Vehicle */}
        <button
          onClick={(e) => { e.stopPropagation(); router.push(`/vehicles/${r.vehicle_id}?tab=reminders`); }}
          className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-orange-400"
        >
          <Car className="h-3 w-3" />
          <span className="font-mono">{r.plate ?? '—'}</span>
          {vehicleLabel !== 'Unknown vehicle' && <span className="text-neutral-600">· {vehicleLabel}</span>}
        </button>

        {/* Due triggers */}
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-500">
          {r.due_date && (
            <span className={cn(
              !r.completed_at && r.urgency === 'overdue' && r.days_remaining != null && r.days_remaining < 0
                ? 'text-red-400'
                : !r.completed_at && r.urgency === 'due_soon' && r.days_remaining != null && r.days_remaining >= 0
                  ? 'text-amber-400'
                  : '',
            )}>
              {r.days_remaining != null && !r.completed_at
                ? r.days_remaining < 0
                  ? `${Math.abs(r.days_remaining)}d overdue`
                  : r.days_remaining === 0
                  ? 'Due today'
                  : `${r.days_remaining}d left`
                : new Date(r.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
          {r.due_mileage_km && (
            <span className={cn(
              !r.completed_at && r.urgency === 'overdue' && r.km_remaining != null && r.km_remaining < 0
                ? 'text-red-400'
                : !r.completed_at && r.urgency === 'due_soon' && r.km_remaining != null && r.km_remaining >= 0
                  ? 'text-amber-400'
                  : '',
            )}>
              {r.km_remaining != null && !r.completed_at
                ? r.km_remaining < 0
                  ? `${Math.abs(r.km_remaining).toLocaleString()} km overdue`
                  : `${r.km_remaining.toLocaleString()} km left`
                : `Due at ${r.due_mileage_km.toLocaleString()} km`}
            </span>
          )}
          {r.notes && <span className="italic text-neutral-600">"{r.notes}"</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        {onComplete && !r.completed_at && (
          <button
            onClick={onComplete}
            title="Mark complete"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-green-950/40 hover:text-green-400"
          >
            <Check className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => router.push(`/vehicles/${r.vehicle_id}?tab=reminders`)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:text-neutral-400"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RemindersPage() {
  const qc = useQueryClient();
  const [preset, setPreset]         = useState<Preset>('all_open');
  const [serviceType, setServiceType] = useState<string>('');

  const activePreset = PRESETS.find((p) => p.key === preset)!;
  const queryParams = {
    ...activePreset.params(),
    ...(serviceType ? { serviceType } : {}),
    limit: 100,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reminders-dash', preset, serviceType],
    queryFn: () => remindersApi.list(queryParams as any),
  });

  const complete = useMutation({
    mutationFn: (id: string) => remindersApi.update(id, { completed: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders-dash'] });
      qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });

  const reminders = data?.items ?? [];

  // Group by service type when showing "all open" without a type filter
  const grouped = preset === 'all_open' && !serviceType
    ? SERVICE_TYPES
        .map(([type, label]) => ({
          type, label,
          items: reminders.filter((r) => r.service_type === type),
        }))
        .filter((g) => g.items.length > 0)
    : null;

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      {/* Preset chips */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setPreset(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              preset === key
                ? 'border-orange-500/50 bg-orange-500/10 text-orange-400'
                : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Service type filter */}
      <div className="flex items-center gap-3">
        <select
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value)}
          className="h-9 rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100 outline-none transition-colors focus:border-orange-500"
        >
          <option value="">All service types</option>
          {SERVICE_TYPES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        {(serviceType) && (
          <button
            onClick={() => setServiceType('')}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Clear filter
          </button>
        )}

        <span className="ml-auto text-xs text-neutral-600">
          {!isLoading && `${reminders.length} result${reminders.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Results */}
      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : isError ? (
          <div className="py-16 text-center text-sm text-red-400">Failed to load. Check your connection.</div>
        ) : reminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-800">
              <BellDot className="h-6 w-6 text-neutral-600" />
            </div>
            <p className="text-sm text-neutral-500">
              {preset === 'overdue' ? 'No overdue reminders' :
               preset === 'due_soon' ? 'No reminders due soon' :
               preset === 'completed' ? 'No completed reminders' :
               'No reminders match this filter'}
            </p>
          </div>
        ) : grouped ? (
          // Grouped view
          grouped.map((group) => (
            <div key={group.type}>
              <div className="border-b border-neutral-800 bg-neutral-900/80 px-4 py-2">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                  {group.label}
                  <span className="ml-2 text-neutral-700">{group.items.length}</span>
                </span>
              </div>
              {group.items.map((r) => (
                <ReminderRow
                  key={r.id}
                  r={r}
                  onComplete={preset !== 'completed' ? () => complete.mutate(r.id) : undefined}
                />
              ))}
            </div>
          ))
        ) : (
          // Flat list (overdue, due_soon, completed, type-filtered)
          reminders.map((r) => (
            <ReminderRow
              key={r.id}
              r={r}
              onComplete={preset !== 'completed' ? () => complete.mutate(r.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
