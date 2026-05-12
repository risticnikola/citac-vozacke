import { cn } from '@/lib/cn';

interface Tab {
  key: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-0 border-b border-neutral-800">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
            active === tab.key
              ? 'border-orange-500 text-orange-400'
              : 'border-transparent text-neutral-500 hover:text-neutral-300',
          )}
        >
          {tab.label}
          {tab.count != null && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-xs',
                active === tab.key
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'bg-neutral-800 text-neutral-500',
              )}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
