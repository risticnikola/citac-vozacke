import { apiClient } from './client';
import type { Job, Paginated } from '@/types';

export const jobsApi = {
  list: (params?: { vehicleId?: string; cursor?: string; limit?: number }) =>
    apiClient.get<Paginated<Job>>('/v1/jobs', { params }).then((r) => r.data),

  create: (body: {
    vehicleId: string; title: string; description?: string;
    priceCents?: number; performedAt?: string;
  }) => apiClient.post<Job>('/v1/jobs', body).then((r) => r.data),

  update: (id: string, body: Partial<{ title: string; description: string; priceCents: number; performedAt: string }>) =>
    apiClient.patch<Job>(`/v1/jobs/${id}`, body).then((r) => r.data),

  remove: (id: string) => apiClient.delete(`/v1/jobs/${id}`),
};
