'use client';

import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { vehiclesApi } from '@/lib/api/vehicles';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { FormField, inputClass } from '@/components/ui/FormField';
import type { Vehicle } from '@/types';

interface VehiclePrefill {
  vin?: string; plate?: string; make?: string;
  model?: string; year?: number; ownerName?: string;
}

interface VehicleFormProps {
  vehicle?: Vehicle;            // present → edit mode
  prefill?: VehiclePrefill;     // pre-fill from card read (create mode only)
  onSuccess?: (v: Vehicle) => void;
  onCancel?: () => void;
}

export function VehicleForm({ vehicle, prefill, onSuccess, onCancel }: VehicleFormProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [fields, setFields] = useState({
    plate:      vehicle?.plate      ?? prefill?.plate      ?? '',
    vin:        vehicle?.vin        ?? prefill?.vin        ?? '',
    make:       vehicle?.make       ?? prefill?.make       ?? '',
    model:      vehicle?.model      ?? prefill?.model      ?? '',
    year:       vehicle?.year       != null ? String(vehicle.year)
                : prefill?.year    != null ? String(prefill.year) : '',
    ownerName:  vehicle?.owner_name  ?? prefill?.ownerName ?? '',
    ownerPhone: vehicle?.owner_phone ?? '',
  });

  function set(key: keyof typeof fields) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = {
        plate:      fields.plate      || undefined,
        vin:        fields.vin        || undefined,
        make:       fields.make       || undefined,
        model:      fields.model      || undefined,
        year:       fields.year       ? parseInt(fields.year) : undefined,
        ownerName:  fields.ownerName  || undefined,
        ownerPhone: fields.ownerPhone || undefined,
      };

      const result = vehicle
        ? await vehiclesApi.update(vehicle.id, body)
        : await vehiclesApi.create(body);

      qc.invalidateQueries({ queryKey: ['vehicles'] });
      if (vehicle) qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      onSuccess?.(result);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.response?.data?.message ?? 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Plate" htmlFor="plate">
          <input id="plate" className={inputClass} placeholder="BG123-AB"
            value={fields.plate} onChange={set('plate')} />
        </FormField>
        <FormField label="VIN" htmlFor="vin" hint="Up to 17 characters">
          <input id="vin" className={inputClass} placeholder="WBA…"
            maxLength={17} value={fields.vin} onChange={set('vin')} />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Make" htmlFor="make">
          <input id="make" className={inputClass} placeholder="Volkswagen"
            value={fields.make} onChange={set('make')} />
        </FormField>
        <FormField label="Model" htmlFor="model">
          <input id="model" className={inputClass} placeholder="Golf"
            value={fields.model} onChange={set('model')} />
        </FormField>
      </div>

      <FormField label="Year" htmlFor="year">
        <input id="year" type="number" className={inputClass} placeholder="2020"
          min={1900} max={2100} value={fields.year} onChange={set('year')} />
      </FormField>

      <FormField label="Owner name" htmlFor="ownerName">
        <input id="ownerName" className={inputClass} placeholder="Marko Marković"
          value={fields.ownerName} onChange={set('ownerName')} />
      </FormField>

      <FormField label="Owner phone" htmlFor="ownerPhone">
        <input id="ownerPhone" type="tel" className={inputClass} placeholder="+381 60 123 4567"
          value={fields.ownerPhone} onChange={set('ownerPhone')} />
      </FormField>

      {error && <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner className="h-4 w-4" /> : vehicle ? 'Save changes' : 'Create vehicle'}
        </Button>
      </div>
    </form>
  );
}
