export interface User {
  sub: string;
  tenantId: string;
  role: 'mechanic' | 'garage_admin' | 'saas_admin';
  type: 'user';
  exp: number;
}

export interface Vehicle {
  id: string;
  tenant_id: string;
  vin: string | null;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  owner_name: string | null;
  owner_phone: string | null;
  current_mileage_km: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Job {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  title: string;
  description: string | null;
  price_cents: number;
  performed_at: string;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface MileageEntry {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  mileage_km: number;
  recorded_at: string;
  recorded_by: string | null;
  recorded_by_email: string | null;
  note: string | null;
  created_at: string;
}

export type ServiceType =
  | 'oil_change'
  | 'tire_rotation'
  | 'small_service'
  | 'big_service'
  | 'technical_inspection'
  | 'registration_renewal'
  | 'brake_check'
  | 'other';

export interface ServiceReminder {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  service_type: ServiceType;
  due_date: string | null;
  due_mileage_km: number | null;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_email: string | null;
  notes: string | null;
  is_overdue: boolean;
  km_remaining: number | null;
  days_remaining: number | null;
  urgency: 'overdue' | 'due_soon' | 'ok';
  interval_km: number | null;
  interval_days: number | null;
  plate: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  current_mileage_km: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Bridge / card reader ─────────────────────────────────────────────────────

export interface CardParsedData {
  vehicleIdNumber?: string;             // VIN
  registrationPlateNumber?: string;
  vehicleMake?: string;
  commercialDescription?: string;       // model / variant
  yearOfProduction?: number;
  colourOfVehicle?: string;
  vehicleCategory?: string;
  engineCapacity?: number;
  maximumNetPower?: number;
  typeOfFuel?: string;
  stateIssuing?: string;
  dateOfFirstRegistration?: string;
  registrationDate?: string;
  expiryDate?: string;
  ownersSurnameOrBusinessName?: string;
  ownersFirstName?: string;
  ownersAddress?: string;
  personalNo?: string;
}

export interface BridgeCardEvent {
  cardType: 'vehicle_registration' | 'id_card' | 'other';
  cardSerial: string;
  parsedData?: CardParsedData;
}

export interface BridgeWsMessage {
  type: 'card.read' | 'device.status' | 'error' | 'scan.error';
  payload: unknown;
  error?: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
}
