'use client';

import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mileageApi } from '@/lib/api/mileage';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { FormField, inputClass } from '@/components/ui/FormField';

interface MileageFormProps {
  vehicleId: string;
  currentMileage?: number | null;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function MileageForm({ vehicleId, currentMileage, onSuccess, onCancel }: MileageFormProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [mileage, setMileage] = useState('');
  const [note, setNote]       = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const km = parseInt(mileage);
    if (!mileage || isNaN(km) || km < 0) { setError('Enter a valid mileage.'); return; }
    setError('');
    setSaving(true);
    try {
      await mileageApi.record({ vehicleId, mileageKm: km, note: note.trim() || undefined });
      qc.invalidateQueries({ queryKey: ['mileage', vehicleId] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      onSuccess?.();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {currentMileage != null && (
        <p className="text-xs text-neutral-500">
          Current recorded mileage: <span className="font-medium text-neutral-300">{currentMileage.toLocaleString()} km</span>
        </p>
      )}

      <FormField label="Mileage (km)" htmlFor="mileage-km" required>
        <input id="mileage-km" type="number" min="0" className={inputClass}
          placeholder="e.g. 85000" value={mileage}
          onChange={(e) => setMileage(e.target.value)} autoFocus />
      </FormField>

      <FormField label="Note" htmlFor="mileage-note" hint="Optional — e.g. read from dashboard during service">
        <input id="mileage-note" className={inputClass} placeholder="Optional note"
          value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>

      {error && <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner className="h-4 w-4" /> : 'Record mileage'}
        </Button>
      </div>
    </form>
  );
}
