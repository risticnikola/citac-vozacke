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

const INTERVAL_DEFAULTS: Record<ServiceType, { km: string; days: string }> = {
  oil_change:           { km: '10000', days: '365' },
  small_service:        { km: '10000', days: '365' },
  big_service:          { km: '20000', days: '730' },
  tire_rotation:        { km: '15000', days: '365' },
  technical_inspection: { km: '',      days: '365' },
  registration_renewal: { km: '',      days: '365' },
  brake_check:          { km: '30000', days: '' },
  other:                { km: '',      days: '' },
};

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
  const [intervalKm, setIntervalKm]   = useState(INTERVAL_DEFAULTS.oil_change.km);
  const [intervalDays, setIntervalDays] = useState(INTERVAL_DEFAULTS.oil_change.days);
  const [notes, setNotes]             = useState('');

  function handleServiceTypeChange(value: ServiceType) {
    setServiceType(value);
    setIntervalKm(INTERVAL_DEFAULTS[value].km);
    setIntervalDays(INTERVAL_DEFAULTS[value].days);
  }

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
        dueMileageKm: dueMileage ? parseInt(dueMileage, 10) : undefined,
        intervalKm:   intervalKm   ? parseInt(intervalKm, 10)   : undefined,
        intervalDays: intervalDays ? parseInt(intervalDays, 10) : undefined,
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
          value={serviceType} onChange={(e) => handleServiceTypeChange(e.target.value as ServiceType)}>
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

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Repeat every (km)" htmlFor="interval-km" hint="Optional">
          <input id="interval-km" type="number" min="1" className={inputClass}
            placeholder="e.g. 10000" value={intervalKm}
            onChange={(e) => setIntervalKm(e.target.value)} />
        </FormField>
        <FormField label="Repeat every (days)" htmlFor="interval-days" hint="Optional">
          <input id="interval-days" type="number" min="1" className={inputClass}
            placeholder="e.g. 365" value={intervalDays}
            onChange={(e) => setIntervalDays(e.target.value)} />
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
