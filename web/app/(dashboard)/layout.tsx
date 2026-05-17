import { AuthGuard } from '@/components/AuthGuard';
import { DashboardShell } from '@/components/DashboardShell';
import { BridgeProvider } from '@/components/BridgeProvider';
import { CardToast } from '@/components/CardToast';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <BridgeProvider>
        <DashboardShell>{children}</DashboardShell>
        <CardToast />
      </BridgeProvider>
    </AuthGuard>
  );
}
