'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Car, AlertTriangle, Clock, BellDot, ChevronRight } from 'lucide-react';
import { remindersApi } from '@/lib/api/reminders';
import { vehiclesApi } from '@/lib/api/vehicles';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const SERVICE_LABELS: Record<string, string> = {
  oil_change: 'Oil Change', tire_rotation: 'Tire Rotation',
  small_service: 'Small Service', big_service: 'Big Service',
  technical_inspection: 'Technical Inspection', registration_renewal: 'Registration Renewal',
  brake_check: 'Brake Check', other: 'Other',
};

function StatCard({ label, value, icon: Icon, onClick, danger }: {
  label: string; value: number | string; icon: React.ElementType;
  onClick?: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col gap-3 rounded-2xl border bg-neutral-900 p-5 text-left transition-colors',
        danger && value !== 0
          ? 'border-red-900/50 hover:border-red-700/60'
          : 'border-neutral-800 hover:border-neutral-700',
        !onClick && 'cursor-default',
      )}
    >
      <div className={cn(
        'flex h-9 w-9 items-center justify-center rounded-xl',
        danger && value !== 0 ? 'bg-red-950/50' : 'bg-neutral-800',
      )}>
        <Icon className={cn('h-4.5 w-4.5', danger && value !== 0 ? 'text-red-400' : 'text-neutral-400')} />
      </div>
      <div>
        <div className={cn(
          'text-2xl font-bold tabular-nums',
          danger && value !== 0 ? 'text-red-400' : 'text-neutral-100',
        )}>
          {value}
        </div>
        <div className="text-xs text-neutral-500">{label}</div>
      </div>
    </button>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  const { data: overdueData, isLoading: l1 } = useQuery({
    queryKey: ['reminders-dash', 'overdue', ''],
    queryFn: () => remindersApi.list({ status: 'open', overdue: true, limit: 5 }),
  });

  const { data: soonData, isLoading: l2 } = useQuery({
    queryKey: ['reminders-dash', 'due_7', ''],
    queryFn: () => remindersApi.list({ status: 'open', dueBefore: addDays(7), limit: 5 }),
  });

  const { data: vehiclesData, isLoading: l3 } = useQuery({
    queryKey: ['vehicles', {}],
    queryFn: () => vehiclesApi.list({ limit: 1 }),
  });

  const overdue = overdueData?.items ?? [];
  const soon    = soonData?.items ?? [];
  const isLoading = l1 || l2 || l3;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Stat cards */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Overdue reminders"
            value={overdue.length >= 5 ? '5+' : overdue.length}
            icon={AlertTriangle}
            danger
            onClick={() => router.push('/reminders?preset=overdue')}
          />
          <StatCard
            label="Due in 7 days"
            value={soon.length >= 5 ? '5+' : soon.length}
            icon={Clock}
            onClick={() => router.push('/reminders?preset=due_7')}
          />
          <StatCard
            label="Open reminders"
            value="—"
            icon={BellDot}
            onClick={() => router.push('/reminders')}
          />
          <StatCard
            label="Total vehicles"
            value="—"
            icon={Car}
            onClick={() => router.push('/vehicles')}
          />
        </div>
      )}

      {/* Overdue section */}
      {overdue.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300">Overdue</h2>
            <button
              onClick={() => router.push('/reminders')}
              className="flex items-center gap-1 text-xs text-neutral-500 transition-colors hover:text-orange-400"
            >
              View all <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-red-900/40 bg-neutral-900">
            {overdue.map((r, i) => (
              <div
                key={r.id}
                onClick={() => router.push(`/vehicles/${r.vehicle_id}?tab=reminders`)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-neutral-800/60',
                  i < overdue.length - 1 && 'border-b border-neutral-800',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-100">
                      {SERVICE_LABELS[r.service_type] ?? r.service_type}
                    </span>
                    <Badge variant="danger">Overdue</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    <span className="font-mono">{r.plate ?? '—'}</span>
                    {(r.make || r.model) && ` · ${[r.make, r.model].filter(Boolean).join(' ')}`}
                  </p>
                </div>
                {r.due_date && (
                  <span className="shrink-0 text-xs text-red-400">
                    {new Date(r.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </span>
                )}
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-700" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Due soon section */}
      {soon.filter((r) => !r.is_overdue).length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300">Due in the next 7 days</h2>
          </div>
          <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            {soon.filter((r) => !r.is_overdue).map((r, i, arr) => (
              <div
                key={r.id}
                onClick={() => router.push(`/vehicles/${r.vehicle_id}?tab=reminders`)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-neutral-800/60',
                  i < arr.length - 1 && 'border-b border-neutral-800',
                )}
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-neutral-100">
                    {SERVICE_LABELS[r.service_type] ?? r.service_type}
                  </span>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    <span className="font-mono">{r.plate ?? '—'}</span>
                    {(r.make || r.model) && ` · ${[r.make, r.model].filter(Boolean).join(' ')}`}
                  </p>
                </div>
                {r.due_date && (
                  <span className="shrink-0 text-xs text-amber-400">
                    {new Date(r.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </span>
                )}
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-700" />
              </div>
            ))}
          </div>
        </section>
      )}

      {!isLoading && overdue.length === 0 && soon.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900 py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-800">
            <BellDot className="h-6 w-6 text-neutral-600" />
          </div>
          <p className="text-sm font-medium text-neutral-300">All clear</p>
          <p className="mt-1 text-xs text-neutral-600">No overdue or upcoming reminders</p>
        </div>
      )}
    </div>
  );
}
