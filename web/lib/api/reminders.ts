import { apiClient } from './client';
import type { ServiceReminder, Paginated, ServiceType } from '@/types';

export const remindersApi = {
  list: (params?: {
    vehicleId?: string; serviceType?: string; status?: 'open' | 'completed';
    dueBefore?: string; overdue?: boolean; cursor?: string; limit?: number;
  }) => apiClient.get<Paginated<ServiceReminder>>('/v1/service-reminders', { params }).then((r) => r.data),

  create: (body: {
    vehicleId: string; serviceType: ServiceType;
    dueDate?: string; dueMileageKm?: number; notes?: string;
  }) => apiClient.post<ServiceReminder>('/v1/service-reminders', body).then((r) => r.data),

  update: (id: string, body: Partial<{
    serviceType: ServiceType; dueDate: string; dueMileageKm: number;
    notes: string; completed: boolean;
  }>) => apiClient.patch<ServiceReminder>(`/v1/service-reminders/${id}`, body).then((r) => r.data),

  remove: (id: string) => apiClient.delete(`/v1/service-reminders/${id}`),
};
