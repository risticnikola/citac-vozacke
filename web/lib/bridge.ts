import { apiClient } from './api/client';

export async function scanCard(): Promise<void> {
  await apiClient.post('/v1/scan');
}
