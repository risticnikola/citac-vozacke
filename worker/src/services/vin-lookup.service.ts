// worker/src/services/vin-lookup.service.ts
import pino from 'pino';

const log = pino({ name: 'vin-lookup' });

export interface VinData {
  make?: string;
  model?: string;
  year?: number;
  engineDisplacement?: number;
  fuelType?: string;
  bodyType?: string;
}

const NHTSA_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues';

export async function lookupVin(vin: string): Promise<VinData | null> {
  try {
    const url = `${NHTSA_URL}/${encodeURIComponent(vin)}?format=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) {
      log.warn({ vin, status: resp.status }, 'NHTSA non-ok response');
      return null;
    }
    const json = (await resp.json()) as { Results: Array<Record<string, string>> };
    const r = json.Results?.[0];
    if (!r) return null;

    const year = parseInt(r['ModelYear'] ?? '', 10);
    return {
      make: r['Make'] || undefined,
      model: r['Model'] || undefined,
      year: isNaN(year) ? undefined : year,
      engineDisplacement: parseFloat(r['DisplacementL'] ?? '') || undefined,
      fuelType: r['FuelTypePrimary'] || undefined,
      bodyType: r['BodyClass'] || undefined,
    };
  } catch (err) {
    log.error({ err, vin }, 'VIN lookup failed');
    return null;
  }
}
