import { apiClient } from './client';
import type { Vehicle, Paginated } from '@/types';

export const vehiclesApi = {
  list: (params?: { plate?: string; vin?: string; cursor?: string; limit?: number }) =>
    apiClient.get<Paginated<Vehicle>>('/v1/vehicles', { params }).then((r) => r.data),

  get: (id: string) =>
    apiClient.get<Vehicle>(`/v1/vehicles/${id}`).then((r) => r.data),

  create: (body: Partial<Vehicle>) =>
    apiClient.post<Vehicle>('/v1/vehicles', body).then((r) => r.data),

  update: (id: string, body: Partial<Vehicle>) =>
    apiClient.patch<Vehicle>(`/v1/vehicles/${id}`, body).then((r) => r.data),

  remove: (id: string) =>
    apiClient.delete(`/v1/vehicles/${id}`),
};
