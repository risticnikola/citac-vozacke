// bridge/tests/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseCardOutput, mapCardType } from '../src/bridge/parser.js';

describe('mapCardType', () => {
  it('maps "vehicle_registration" correctly', () => {
    expect(mapCardType('vehicle_registration')).toBe('vehicle_registration');
    expect(mapCardType('vehicleregistration')).toBe('vehicle_registration');
    expect(mapCardType('registration')).toBe('vehicle_registration');
  });

  it('maps "id_card" variants correctly', () => {
    expect(mapCardType('id_card')).toBe('id_card');
    expect(mapCardType('idcard')).toBe('id_card');
    expect(mapCardType('identity')).toBe('id_card');
  });

  it('falls back to "other" for unknown values', () => {
    expect(mapCardType('unknown')).toBe('other');
    expect(mapCardType(undefined)).toBe('other');
  });
});

describe('parseCardOutput', () => {
  it('maps all standard vehicle registration fields', () => {
    const raw = {
      vehicleIdNumber: 'WBA3A5C55EF123456',
      registrationPlateNumber: 'NS-123-AB',
      vehicleMake: 'BMW',
      commercialDescription: 'Serija 3',
      yearOfProduction: '2020',
      engineCapacity: '1998',
      maximumNetPower: '110',
      typeOfFuel: 'Dizel',
      stateIssuing: 'SRB',
      dateOfFirstRegistration: '15.01.2020',
      expiryDate: '2025-01-15',
      ownersSurnameOrBusinessName: 'Petrović',
      ownersFirstName: 'Milan',
    };

    const result = parseCardOutput(raw);

    expect(result.vehicleIdNumber).toBe('WBA3A5C55EF123456');
    expect(result.registrationPlateNumber).toBe('NS-123-AB');
    expect(result.yearOfProduction).toBe(2020);
    expect(result.engineCapacity).toBe(1998);
    expect(result.maximumNetPower).toBe(110);
    // Serbian DD.MM.YYYY → ISO
    expect(result.dateOfFirstRegistration).toBe('2020-01-15');
    // Already ISO
    expect(result.expiryDate).toBe('2025-01-15');
    expect(result.ownersSurnameOrBusinessName).toBe('Petrović');
  });

  it('coerces string numbers to integers', () => {
    const r = parseCardOutput({ massInService: '1560', numberOfAxles: '2' });
    expect(r.massInService).toBe(1560);
    expect(r.numberOfAxles).toBe(2);
  });

  it('returns undefined for empty string fields', () => {
    const r = parseCardOutput({ vehicleIdNumber: '' });
    expect(r.vehicleIdNumber).toBeUndefined();
  });

  it('handles completely empty input gracefully', () => {
    const r = parseCardOutput({});
    expect(r.vehicleIdNumber).toBeUndefined();
    expect(r.yearOfProduction).toBeUndefined();
  });
});
