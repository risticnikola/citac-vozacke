'use client';

import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { remindersApi } from '@/lib/api/reminders';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { FormField, inputClass, selectClass, textareaClass } from '@/components/ui/FormField';
import type { ServiceType } from '@/types';

const SERVICE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: 'oil_change',           label: 'Oil Change' },
  { value: 'tire_rotation',        label: 'Tire Rotation' },
  { value: 'small_service',        label: 'Small Service' },
  { value: 'big_service',          label: 'Big Service' },
  { value: 'technical_inspection', label: 'Technical Inspection' },
  { value: 'registration_renewal', label: 'Registration Renewal' },
  { value: 'brake_check',          label: 'Brake Check' },
  { value: 'other',                label: 'Other' },
];

interface ReminderFormProps {
  vehicleId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ReminderForm({ vehicleId, onSuccess, onCancel }: ReminderFormProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const [serviceType, setServiceType] = useState<ServiceType>('oil_change');
  const [dueDate, setDueDate]         = useState('');
  const [dueMileage, setDueMileage]   = useState('');
  const [notes, setNotes]             = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dueDate && !dueMileage) {
      setError('Set at least a due date or a due mileage.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await remindersApi.create({
        vehicleId,
        serviceType,
        dueDate:      dueDate    || undefined,
        dueMileageKm: dueMileage ? parseInt(dueMileage) : undefined,
        notes:        notes.trim() || undefined,
      });
      qc.invalidateQueries({ queryKey: ['reminders', vehicleId] });
      onSuccess?.();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormField label="Service type" htmlFor="svc-type" required>
        <select id="svc-type" className={selectClass}
          value={serviceType} onChange={(e) => setServiceType(e.target.value as ServiceType)}>
          {SERVICE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Due date" htmlFor="due-date" hint="Optional">
          <input id="due-date" type="date" className={inputClass}
            value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FormField>
        <FormField label="Due mileage (km)" htmlFor="due-km" hint="Optional">
          <input id="due-km" type="number" min="1" className={inputClass}
            placeholder="100000" value={dueMileage}
            onChange={(e) => setDueMileage(e.target.value)} />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="svc-notes">
        <textarea id="svc-notes" className={textareaClass} rows={2}
          placeholder="Optional notes…"
          value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>

      {error && <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner className="h-4 w-4" /> : 'Add reminder'}
        </Button>
      </div>
    </form>
  );
}
