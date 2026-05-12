import { apiClient } from './client';

export interface GenerateTokenResult {
  token:     string;
  expiresAt: string;
  label:     string | null;
}

export interface Device {
  id:             string;
  name:           string | null;
  platform:       'windows' | 'linux' | 'macos' | null;
  bridge_version: string | null;
  last_seen_at:   string | null;
  created_at:     string;
  revoked_at:     string | null;
}

export const devicesApi = {
  list: () =>
    apiClient.get<Device[]>('/v1/admin/devices').then((r) => r.data),

  generateToken: (body: { label?: string; expiresInHours?: number }) =>
    apiClient.post<GenerateTokenResult>('/v1/admin/devices/generate-token', body).then((r) => r.data),

  remove: (id: string) =>
    apiClient.delete(`/v1/admin/devices/${id}`),
};
