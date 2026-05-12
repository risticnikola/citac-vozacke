import { cn } from '@/lib/cn';
import { InputHTMLAttributes, forwardRef } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100',
        'placeholder:text-neutral-500',
        'outline-none transition-colors focus:border-orange-500 focus:ring-1 focus:ring-orange-500',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
