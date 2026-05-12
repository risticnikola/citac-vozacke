import { apiClient } from './client';
import type { MileageEntry, Paginated } from '@/types';

export const mileageApi = {
  list: (vehicleId: string, params?: { cursor?: string; limit?: number }) =>
    apiClient.get<Paginated<MileageEntry>>('/v1/mileage', { params: { vehicleId, ...params } }).then((r) => r.data),

  record: (body: { vehicleId: string; mileageKm: number; recordedAt?: string; note?: string }) =>
    apiClient.post<MileageEntry>('/v1/mileage', body).then((r) => r.data),
};
