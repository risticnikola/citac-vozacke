#include "CardReader.h"
#include "eVehicleRegistrationAPI.h"
#include <windows.h>

bool CardReader::init() {
    if (sdStartup(0) != S_OK) return false;
    if (!selectFirstReader()) {
        sdCleanup();
        return false;
    }
    m_initialized = true;
    return true;
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
    if (sdReadVehicleData(&vehicle) != S_OK) return false;
    if (sdReadPersonalData(&person) != S_OK) return false;

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
