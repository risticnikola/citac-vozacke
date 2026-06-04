import { apiClient } from './api/client';

export async function scanCard(deviceId: string): Promise<void> {
  await apiClient.post('/v1/scan', { deviceId });
}
