import { cn } from '@/lib/cn';
import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' && 'h-9 px-4 text-sm',
        size === 'sm' && 'h-7 px-3 text-xs',
        variant === 'primary' && 'bg-orange-500 text-white hover:bg-orange-400',
        variant === 'ghost'   && 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100',
        variant === 'danger'  && 'text-red-400 hover:bg-red-950/40 hover:text-red-300',
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
