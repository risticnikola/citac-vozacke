import { cn } from '@/lib/cn';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'warning' | 'danger' | 'success';
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        variant === 'default' && 'bg-neutral-800 text-neutral-300',
        variant === 'warning' && 'bg-amber-950/50 text-amber-400',
        variant === 'danger'  && 'bg-red-950/50 text-red-400',
        variant === 'success' && 'bg-green-950/50 text-green-400',
        className,
      )}
    >
      {children}
    </span>
  );
}
