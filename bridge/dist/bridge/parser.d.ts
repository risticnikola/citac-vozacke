import type { VehicleRegistrationData, CardType } from '../types.js';
/** Raw JSON object as the C++ binary writes it to stdout. */
export interface CppCardOutput {
    cardType?: string;
    cardSerial?: string;
    rawDump?: string;
    vehicleIdNumber?: string;
    registrationPlateNumber?: string;
    vehicleCategory?: string;
    vehicleMake?: string;
    commercialDescription?: string;
    colourOfVehicle?: string;
    yearOfProduction?: string | number;
    engineCapacity?: string | number;
    maximumNetPower?: string | number;
    typeOfFuel?: string;
    massInService?: string | number;
    numberOfAxles?: string | number;
    stateIssuing?: string;
    competentAuthority?: string;
    dateOfFirstRegistration?: string;
    registrationDate?: string;
    expiryDate?: string;
    ownersSurnameOrBusinessName?: string;
    ownersFirstName?: string;
    ownersAddress?: string;
    personalNo?: string;
}
export declare function mapCardType(raw: string | undefined): CardType;
export declare function parseCardOutput(raw: CppCardOutput): VehicleRegistrationData;
