#pragma once
#include <QString>

struct VehicleData {
    int id = -1;
    QString owner;
    QString phone;
    QString makeModel;
    QString chassisNumber;
    QString year;
    QString enginePowerKw;
    QString transmission;
    QString mileage;
    QString registration;
    QString color;
    QString createdAt;
};

struct ServiceData {
    int id = -1;
    int vehicleId = -1;
    QString serviceType;
    QString description;
    QString mileage;
    double price = 0.0;
    QString date;
};
