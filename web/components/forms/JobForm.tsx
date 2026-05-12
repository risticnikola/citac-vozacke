'use client';

import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { jobsApi } from '@/lib/api/jobs';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { FormField, inputClass, textareaClass } from '@/components/ui/FormField';

interface JobFormProps {
  vehicleId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function JobForm({ vehicleId, onSuccess, onCancel }: JobFormProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle]           = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice]           = useState('');
  const [performedAt, setPerformedAt] = useState(today);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    setError('');
    setSaving(true);
    try {
      await jobsApi.create({
        vehicleId,
        title: title.trim(),
        description: description.trim() || undefined,
        priceCents: price ? Math.round(parseFloat(price) * 100) : 0,
        performedAt,
      });
      qc.invalidateQueries({ queryKey: ['jobs', vehicleId] });
      onSuccess?.();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormField label="Title" htmlFor="job-title" required>
        <input id="job-title" className={inputClass} placeholder="Oil filter replacement"
          value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </FormField>

      <FormField label="Description" htmlFor="job-desc">
        <textarea id="job-desc" className={textareaClass} rows={3}
          placeholder="Optional details, parts used…"
          value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Price (RSD)" htmlFor="job-price">
          <input id="job-price" type="number" min="0" step="0.01" className={inputClass}
            placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
        </FormField>
        <FormField label="Date" htmlFor="job-date" required>
          <input id="job-date" type="date" className={inputClass}
            value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} />
        </FormField>
      </div>

      {error && <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner className="h-4 w-4" /> : 'Add job'}
        </Button>
      </div>
    </form>
  );
}
