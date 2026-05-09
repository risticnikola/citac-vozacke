// bridge/src/bridge/parser.ts
// Maps the JSON output of the C++ binary (eVehicleRegistrationAPI.dll) to our
// internal VehicleRegistrationData shape. All binary parsing is done by the
// DLL — this module only normalises field names and coerces types.
import type { VehicleRegistrationData, CardType } from '../types.js';

/** Raw JSON object as the C++ binary writes it to stdout. */
export interface CppCardOutput {
  cardType?: string;
  cardSerial?: string;
  rawDump?: string; // hex-encoded

  // Vehicle — field names from the eVehicleRegistrationAPI spec
  vehicleIdNumber?: string;
  registrationPlateNumber?: string;
  vehicleCategory?: string;
  vehicleMake?: string;
  commercialDescription?: string;
  colourOfVehicle?: string;
  yearOfProduction?: string | number;

  // Technical
  engineCapacity?: string | number;
  maximumNetPower?: string | number;
  typeOfFuel?: string;
  massInService?: string | number;
  numberOfAxles?: string | number;

  // Registration
  stateIssuing?: string;
  competentAuthority?: string;
  dateOfFirstRegistration?: string;
  registrationDate?: string;
  expiryDate?: string;

  // Owner (PII — stored encrypted in production)
  ownersSurnameOrBusinessName?: string;
  ownersFirstName?: string;
  ownersAddress?: string;
  personalNo?: string;
}

export function mapCardType(raw: string | undefined): CardType {
  switch (raw?.toLowerCase()) {
    case 'vehicle_registration':
    case 'vehicleregistration':
    case 'registration': return 'vehicle_registration';
    case 'id_card':
    case 'idcard':
    case 'identity': return 'id_card';
    default: return 'other';
  }
}

function toInt(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? undefined : n;
}

function toDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  // Accept YYYY-MM-DD or DD.MM.YYYY (Serbian format)
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return v;
}

export function parseCardOutput(raw: CppCardOutput): VehicleRegistrationData {
  return {
    vehicleIdNumber:              raw.vehicleIdNumber?.trim()                    || undefined,
    registrationPlateNumber:      raw.registrationPlateNumber?.trim()            || undefined,
    vehicleCategory:              raw.vehicleCategory?.trim()                    || undefined,
    vehicleMake:                  raw.vehicleMake?.trim()                        || undefined,
    commercialDescription:        raw.commercialDescription?.trim()              || undefined,
    colourOfVehicle:              raw.colourOfVehicle?.trim()                   || undefined,
    yearOfProduction:             toInt(raw.yearOfProduction),
    engineCapacity:               toInt(raw.engineCapacity),
    maximumNetPower:              toInt(raw.maximumNetPower),
    typeOfFuel:                   raw.typeOfFuel?.trim()                         || undefined,
    massInService:                toInt(raw.massInService),
    numberOfAxles:                toInt(raw.numberOfAxles),
    stateIssuing:                 raw.stateIssuing?.trim()                       || undefined,
    competentAuthority:           raw.competentAuthority?.trim()                 || undefined,
    dateOfFirstRegistration:      toDate(raw.dateOfFirstRegistration),
    registrationDate:             toDate(raw.registrationDate),
    expiryDate:                   toDate(raw.expiryDate),
    ownersSurnameOrBusinessName:  raw.ownersSurnameOrBusinessName?.trim()        || undefined,
    ownersFirstName:              raw.ownersFirstName?.trim()                    || undefined,
    ownersAddress:                raw.ownersAddress?.trim()                      || undefined,
    personalNo:                   raw.personalNo?.trim()                         || undefined,
  };
}
