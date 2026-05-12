'use client';

import { useState } from 'react';
import { Monitor, Plus, Copy, Check, Download, Wifi, WifiOff, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { devicesApi, type Device } from '@/lib/api/devices';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/hooks/useAuth';

const BRIDGE_DOWNLOAD_URL = process.env.NEXT_PUBLIC_BRIDGE_DOWNLOAD_URL;

const PLATFORM_LABEL: Record<string, string> = {
  windows: 'Windows',
  linux:   'Linux',
  macos:   'macOS',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 2)   return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return `${days}d ago`;
}

function DeviceRow({ device }: { device: Device }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const online = device.last_seen_at
    ? Date.now() - new Date(device.last_seen_at).getTime() < 5 * 60_000
    : false;
  const revoked = !!device.revoked_at;

  const { mutate: remove, isPending } = useMutation({
    mutationFn: () => devicesApi.remove(device.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });

  return (
    <div className="flex items-center gap-4 border-b border-neutral-800 px-5 py-3.5 last:border-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-800">
        {online
          ? <Wifi className="h-4 w-4 text-green-400" />
          : <WifiOff className="h-4 w-4 text-neutral-600" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-neutral-100">
          {device.name ?? 'Unnamed device'}
        </span>
        <span className="text-xs text-neutral-500">
          {device.platform ? PLATFORM_LABEL[device.platform] : 'Unknown OS'}
          {device.bridge_version ? ` · v${device.bridge_version}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {revoked ? (
          <span className="rounded-full bg-red-950/50 px-2 py-0.5 text-xs text-red-400">Revoked</span>
        ) : device.last_seen_at ? (
          <span className="text-xs text-neutral-500">{timeAgo(device.last_seen_at)}</span>
        ) : (
          <span className="text-xs text-neutral-600">Never connected</span>
        )}
        {!revoked && (
          confirm ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setConfirm(false); remove(); }}
                disabled={isPending}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                {isPending ? 'Removing…' : 'Confirm'}
              </button>
              <span className="text-neutral-700">·</span>
              <button
                onClick={() => setConfirm(false)}
                className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirm(true)}
              className="text-neutral-700 hover:text-red-400 transition-colors"
              title="Remove device"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )
        )}
      </div>
    </div>
  );
}

function TokenDisplay({ token, expiresAt, onDone }: { token: string; expiresAt: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const write = navigator.clipboard?.writeText(token);
    if (write) {
      write.then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    } else {
      const el = document.createElement('textarea');
      el.value = token;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-400 leading-relaxed">
        Share this code with the mechanic. They'll enter it into the bridge app
        on first launch. The code expires{' '}
        <span className="text-neutral-300">{new Date(expiresAt).toLocaleString()}</span>.
      </p>

      <div className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-3">
        <span className="flex-1 select-all font-mono text-2xl font-bold tracking-[0.2em] text-orange-400">
          {token}
        </span>
        <button
          onClick={copy}
          className="text-neutral-500 transition-colors hover:text-neutral-200"
          title="Copy"
        >
          {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>

      <p className="text-xs text-neutral-600">
        Once the mechanic activates, the device will appear in the list below.
      </p>

      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

function AddDeviceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [result, setResult] = useState<{ token: string; expiresAt: string } | null>(null);
  const queryClient = useQueryClient();

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => devicesApi.generateToken({ label: label.trim() || undefined }),
    onSuccess: (data) => setResult({ token: data.token, expiresAt: data.expiresAt }),
  });

  function handleClose() {
    setLabel('');
    setResult(null);
    queryClient.invalidateQueries({ queryKey: ['devices'] });
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add device">
      {result ? (
        <TokenDisplay token={result.token} expiresAt={result.expiresAt} onDone={handleClose} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-400 leading-relaxed">
            Give this device a name so you can recognise it in the dashboard later.
          </p>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-500">
              Device name <span className="text-neutral-600">(optional)</span>
            </label>
            <Input
              placeholder="e.g. Front desk, Workshop PC"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') mutate(); }}
              autoFocus
            />
          </div>

          {error && (
            <p className="text-xs text-red-400">
              {(error as any)?.response?.data?.error ?? 'Failed to generate code. Try again.'}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button onClick={() => mutate()} disabled={isPending}>
              {isPending && <Spinner className="h-4 w-4" />}
              Generate code
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const isAdmin = user?.role === 'garage_admin' || user?.role === 'saas_admin';

  const { data: devices, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn:  devicesApi.list,
    enabled:  isAdmin,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-neutral-100">Settings</h1>

      {isAdmin && BRIDGE_DOWNLOAD_URL && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800">
                <Download className="h-4 w-4 text-neutral-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-100">Bridge app</p>
                <p className="text-xs text-neutral-500">Install on the mechanic's PC to enable card scanning</p>
              </div>
            </div>
            <a href={BRIDGE_DOWNLOAD_URL} download>
              <Button size="sm" variant="ghost">
                <Download className="h-3.5 w-3.5" />
                Download .exe
              </Button>
            </a>
          </div>
        </section>
      )}

      {isAdmin && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800">
                <Monitor className="h-4 w-4 text-neutral-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-100">Devices</p>
                <p className="text-xs text-neutral-500">Bridge installations connected to this account</p>
              </div>
            </div>
            <Button size="sm" onClick={() => setModalOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add device
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : !devices?.length ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <Monitor className="h-8 w-8 text-neutral-700" />
              <p className="text-sm text-neutral-500">No devices connected yet</p>
              <p className="text-xs text-neutral-600">
                Click <strong className="text-neutral-500">Add device</strong> to generate an activation code
              </p>
            </div>
          ) : (
            <div>
              {devices.map((d) => <DeviceRow key={d.id} device={d} />)}
            </div>
          )}
        </section>
      )}

      {!isAdmin && (
        <p className="text-sm text-neutral-500">No settings available for your role.</p>
      )}

      <AddDeviceModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
