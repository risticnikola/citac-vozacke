#include "CardReader.h"
#include "eVehicleRegistrationAPI.h"
#include <windows.h>

bool CardReader::init() {
    long result = sdStartup(0);
    if (result != S_OK) return false;
    m_initialized = true;
    return selectFirstReader();
}

bool CardReader::selectFirstReader() {
    char name[256];
    long nameSize = sizeof(name);
    if (GetReaderName(0, name, &nameSize) != S_OK) return false;
    return SelectReader(name) == S_OK;
}

bool CardReader::readCard(VehicleData& outData) {
    if (!m_initialized) return false;
    if (sdProcessNewCard() != S_OK) return false;

    SD_VEHICLE_DATA vehicle{};
    SD_PERSONAL_DATA person{};
    sdReadVehicleData(&vehicle);
    sdReadPersonalData(&person);

    auto toQStr = [](const char* data, long size) -> QString {
        return QString::fromLocal8Bit(data, size).trimmed();
    };

    QString surname  = toQStr(person.ownersSurnameOrBusinessName, person.ownersSurnameOrBusinessNameSize);
    QString given    = toQStr(person.ownerName, person.ownerNameSize);
    outData.owner    = (surname + " " + given).trimmed();

    QString make     = toQStr(vehicle.vehicleMake, vehicle.vehicleMakeSize);
    QString model    = toQStr(vehicle.commercialDescription, vehicle.commercialDescriptionSize);
    outData.makeModel = (make + " " + model).trimmed();

    outData.chassisNumber = toQStr(vehicle.vehicleIDNumber, vehicle.vehicleIDNumberSize);
    outData.year          = toQStr(vehicle.yearOfProduction, vehicle.yearOfProductionSize);
    outData.enginePowerKw = toQStr(vehicle.maximumNetPower, vehicle.maximumNetPowerSize);
    outData.transmission  = "";
    outData.mileage       = "";
    outData.registration  = toQStr(vehicle.registrationNumberOfVehicle, vehicle.registrationNumberOfVehicleSize);
    outData.color         = toQStr(vehicle.colourOfVehicle, vehicle.colourOfVehicleSize);

    return true;
}

void CardReader::cleanup() {
    if (m_initialized) {
        sdCleanup();
        m_initialized = false;
    }
}
