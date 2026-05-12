import { AuthGuard } from '@/components/AuthGuard';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { BridgeProvider } from '@/components/BridgeProvider';
import { CardToast } from '@/components/CardToast';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <BridgeProvider>
        <div className="flex h-full">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar />
            <main className="flex-1 overflow-y-auto bg-neutral-950 p-6">
              {children}
            </main>
          </div>
        </div>
        <CardToast />
      </BridgeProvider>
    </AuthGuard>
  );
}
