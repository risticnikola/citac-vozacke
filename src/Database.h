#pragma once
#include <QSqlDatabase>
#include <QList>
#include "Models.h"

class Database {
public:
    static Database& instance();

    bool init(const QString& path);

    int insertVehicle(const VehicleData& v);
    bool vehicleExistsByChassisNumber(const QString& chassisNumber);
    int vehicleIdByChassisNumber(const QString& chassisNumber);
    bool updateVehicle(int id, const VehicleData& v);
    QList<VehicleData> searchVehicles(const QString& query);
    VehicleData vehicleById(int id);

    bool insertService(const ServiceData& s);
    QList<ServiceData> servicesForVehicle(int vehicleId);

private:
    Database() = default;
    bool createTables();
    static VehicleData rowToVehicle(const QSqlQuery& q);
};
