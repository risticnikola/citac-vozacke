import { cn } from '@/lib/cn';
import { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, htmlFor, hint, error, required, children, className }: FormFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-neutral-400">
        {label}
        {required && <span className="ml-0.5 text-orange-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-neutral-600">{hint}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export const inputClass = [
  'h-9 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100',
  'placeholder:text-neutral-500 outline-none transition-colors',
  'focus:border-orange-500 focus:ring-1 focus:ring-orange-500 disabled:opacity-50',
].join(' ');

export const selectClass = inputClass;

export const textareaClass = [
  'w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100',
  'placeholder:text-neutral-500 outline-none transition-colors resize-none',
  'focus:border-orange-500 focus:ring-1 focus:ring-orange-500 disabled:opacity-50',
].join(' ');
