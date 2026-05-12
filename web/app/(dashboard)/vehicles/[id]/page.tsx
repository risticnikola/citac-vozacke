'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Gauge, User, Phone, Calendar,
  Wrench, Activity, BellDot, Plus, Check, Trash2,
} from 'lucide-react';
import { vehiclesApi } from '@/lib/api/vehicles';
import { jobsApi } from '@/lib/api/jobs';
import { mileageApi } from '@/lib/api/mileage';
import { remindersApi } from '@/lib/api/reminders';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { VehicleForm } from '@/components/forms/VehicleForm';
import { JobForm } from '@/components/forms/JobForm';
import { MileageForm } from '@/components/forms/MileageForm';
import { ReminderForm } from '@/components/forms/ReminderForm';
import type { Job, MileageEntry, ServiceReminder, Vehicle } from '@/types';

// ─── Formatters ───────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  oil_change: 'Oil Change', tire_rotation: 'Tire Rotation',
  small_service: 'Small Service', big_service: 'Big Service',
  technical_inspection: 'Technical Inspection', registration_renewal: 'Registration Renewal',
  brake_check: 'Brake Check', other: 'Other',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtPrice(cents: number) {
  return (cents / 100).toLocaleString('sr-RS', { minimumFractionDigits: 2 }) + ' RSD';
}
function fmtMileage(km: number | null) {
  return km != null ? km.toLocaleString() + ' km' : '—';
}

// ─── Info pill ────────────────────────────────────────────────────────────────

function InfoPill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-neutral-400">
      <Icon className="h-3.5 w-3.5 text-neutral-600" />
      {label}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function Empty({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-800">
        <Icon className="h-6 w-6 text-neutral-600" />
      </div>
      <p className="text-sm text-neutral-500">{text}</p>
    </div>
  );
}

// ─── Jobs tab ─────────────────────────────────────────────────────────────────

function JobsTab({ vehicleId }: { vehicleId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['jobs', vehicleId],
    queryFn: ({ pageParam }) => jobsApi.list({ vehicleId, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.hasNextPage ? p.nextCursor ?? undefined : undefined,
  });

  const remove = useMutation({
    mutationFn: (id: string) => jobsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs', vehicleId] }),
  });

  const jobs = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <div className="flex flex-col gap-3 pt-4">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add job
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : jobs.length === 0 ? (
          <Empty icon={Wrench} text="No jobs recorded yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {jobs.map((j: Job) => (
              <div key={j.id} className="group flex items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-neutral-100">{j.title}</span>
                    <span className="text-xs text-neutral-500">{fmtDate(j.performed_at)}</span>
                  </div>
                  {j.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-neutral-400">{j.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium tabular-nums text-neutral-200">
                    {fmtPrice(j.price_cents)}
                  </span>
                  <button
                    onClick={() => { if (confirm('Delete this job?')) remove.mutate(j.id); }}
                    className="text-neutral-600 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasNextPage && (
          <Button variant="ghost" size="sm" onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage} className="self-center">
            {isFetchingNextPage ? <Spinner className="h-4 w-4" /> : 'Load more'}
          </Button>
        )}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add job">
        <JobForm vehicleId={vehicleId} onSuccess={() => setAddOpen(false)} onCancel={() => setAddOpen(false)} />
      </Modal>
    </>
  );
}

// ─── Mileage tab ──────────────────────────────────────────────────────────────

function MileageTab({ vehicleId, currentMileage }: { vehicleId: string; currentMileage: number | null }) {
  const [addOpen, setAddOpen] = useState(false);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['mileage', vehicleId],
    queryFn: ({ pageParam }) => mileageApi.list(vehicleId, { cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.hasNextPage ? p.nextCursor ?? undefined : undefined,
  });

  const entries = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <div className="flex flex-col gap-3 pt-4">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Record mileage
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : entries.length === 0 ? (
          <Empty icon={Activity} text="No mileage recorded yet" />
        ) : (
          <div className="flex flex-col">
            {entries.map((m: MileageEntry, i) => (
              <div key={m.id} className="flex items-center gap-4 border-b border-neutral-800 py-3 last:border-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-xs font-medium text-neutral-500">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <span className="text-base font-semibold tabular-nums text-neutral-100">
                    {m.mileage_km.toLocaleString()} km
                  </span>
                  {m.note && <p className="text-xs text-neutral-500">{m.note}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs text-neutral-400">{fmtDate(m.recorded_at)}</p>
                  {m.recorded_by_email && <p className="text-xs text-neutral-600">{m.recorded_by_email}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {hasNextPage && (
          <Button variant="ghost" size="sm" onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage} className="self-center">
            {isFetchingNextPage ? <Spinner className="h-4 w-4" /> : 'Load more'}
          </Button>
        )}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Record mileage">
        <MileageForm vehicleId={vehicleId} currentMileage={currentMileage}
          onSuccess={() => setAddOpen(false)} onCancel={() => setAddOpen(false)} />
      </Modal>
    </>
  );
}

// ─── Reminders tab ────────────────────────────────────────────────────────────

function RemindersTab({ vehicleId }: { vehicleId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['reminders', vehicleId],
    queryFn: () => remindersApi.list({ vehicleId, limit: 50 }),
  });

  const complete = useMutation({
    mutationFn: (id: string) => remindersApi.update(id, { completed: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders', vehicleId] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => remindersApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders', vehicleId] }),
  });

  const reminders = data?.items ?? [];
  const open = reminders.filter((r) => !r.completed_at);
  const done = reminders.filter((r) => r.completed_at);

  return (
    <>
      <div className="flex flex-col gap-3 pt-4">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add reminder
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : reminders.length === 0 ? (
          <Empty icon={BellDot} text="No service reminders yet" />
        ) : (
          <>
            {open.length > 0 && (
              <div className="flex flex-col gap-2">
                {open.map((r: ServiceReminder) => (
                  <ReminderRow key={r.id} r={r}
                    onComplete={() => complete.mutate(r.id)}
                    onDelete={() => { if (confirm('Delete this reminder?')) remove.mutate(r.id); }} />
                ))}
              </div>
            )}
            {done.length > 0 && (
              <>
                <p className="mt-2 text-xs font-medium uppercase tracking-wider text-neutral-600">Completed</p>
                <div className="flex flex-col gap-2 opacity-50">
                  {done.map((r: ServiceReminder) => (
                    <ReminderRow key={r.id} r={r}
                      onDelete={() => { if (confirm('Delete?')) remove.mutate(r.id); }} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add service reminder">
        <ReminderForm vehicleId={vehicleId} onSuccess={() => setAddOpen(false)} onCancel={() => setAddOpen(false)} />
      </Modal>
    </>
  );
}

function ReminderRow({ r, onComplete, onDelete }: { r: ServiceReminder; onComplete?: () => void; onDelete: () => void }) {
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-neutral-100">
            {SERVICE_LABELS[r.service_type] ?? r.service_type}
          </span>
          {r.is_overdue && <Badge variant="danger">Overdue</Badge>}
          {r.completed_at && <Badge variant="success">Done</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-neutral-500">
          {r.due_date && <span>Due {fmtDate(r.due_date)}</span>}
          {r.due_mileage_km && <span>Due at {r.due_mileage_km.toLocaleString()} km</span>}
        </div>
        {r.notes && <p className="mt-1 text-xs text-neutral-500">{r.notes}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onComplete && !r.completed_at && (
          <button onClick={onComplete} title="Mark complete"
            className="rounded-lg p-1.5 text-neutral-600 transition-colors hover:bg-green-950/40 hover:text-green-400">
            <Check className="h-4 w-4" />
          </button>
        )}
        <button onClick={onDelete}
          className="rounded-lg p-1.5 text-neutral-600 opacity-0 transition-all hover:bg-red-950/40 hover:text-red-400 group-hover:opacity-100">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'jobs',      label: 'Jobs'      },
  { key: 'mileage',   label: 'Mileage'   },
  { key: 'reminders', label: 'Reminders' },
];

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab]       = useState('jobs');
  const [editOpen, setEditOpen] = useState(false);

  const { data: vehicle, isLoading, isError } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => vehiclesApi.get(id),
  });

  const remove = useMutation({
    mutationFn: () => vehiclesApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicles'] }); router.push('/vehicles'); },
  });

  if (isLoading) return <div className="flex justify-center py-24"><Spinner /></div>;

  if (isError || !vehicle) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <p className="text-sm text-red-400">Vehicle not found.</p>
        <Button variant="ghost" size="sm" onClick={() => router.push('/vehicles')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to vehicles
        </Button>
      </div>
    );
  }

  const title = [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') || 'Unknown vehicle';

  return (
    <>
      <div className="flex max-w-3xl flex-col gap-6">
        {/* Back */}
        <button onClick={() => router.push('/vehicles')}
          className="flex w-fit items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-neutral-300">
          <ArrowLeft className="h-3.5 w-3.5" /> All vehicles
        </button>

        {/* Info header */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1">
                <span className="font-mono text-lg font-bold tracking-widest text-neutral-100">
                  {vehicle.plate ?? '—'}
                </span>
              </div>
              <h2 className="mt-2 text-xl font-semibold text-neutral-100">{title}</h2>
              <div className="mt-3 flex flex-wrap gap-4">
                {vehicle.owner_name  && <InfoPill icon={User}     label={vehicle.owner_name} />}
                {vehicle.owner_phone && <InfoPill icon={Phone}    label={vehicle.owner_phone} />}
                {vehicle.year        && <InfoPill icon={Calendar} label={String(vehicle.year)} />}
                <InfoPill icon={Gauge} label={fmtMileage(vehicle.current_mileage_km)} />
              </div>
              {vehicle.vin && (
                <p className="mt-3 font-mono text-xs text-neutral-600">VIN: {vehicle.vin}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>
              <Button variant="danger" size="sm" disabled={remove.isPending}
                onClick={() => { if (confirm(`Delete ${vehicle.plate ?? 'this vehicle'}?`)) remove.mutate(); }}>
                {remove.isPending ? <Spinner className="h-4 w-4" /> : 'Delete'}
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-col">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          {tab === 'jobs'      && <JobsTab      vehicleId={id} />}
          {tab === 'mileage'   && <MileageTab   vehicleId={id} currentMileage={vehicle.current_mileage_km} />}
          {tab === 'reminders' && <RemindersTab vehicleId={id} />}
        </div>
      </div>

      {/* Edit vehicle modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit vehicle">
        <VehicleForm vehicle={vehicle} onSuccess={() => setEditOpen(false)} onCancel={() => setEditOpen(false)} />
      </Modal>
    </>
  );
}
