#include "Database.h"
#include <QSqlQuery>
#include <QSqlError>
#include <QVariant>

Database& Database::instance() {
    static Database db;
    return db;
}

bool Database::init(const QString& path) {
    if (QSqlDatabase::contains(QSqlDatabase::defaultConnection))
        QSqlDatabase::removeDatabase(QSqlDatabase::defaultConnection);
    QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE");
    db.setDatabaseName(path);
    if (!db.open()) return false;
    return createTables();
}

bool Database::createTables() {
    QSqlQuery q;
    bool ok = q.exec(R"(
        CREATE TABLE IF NOT EXISTS vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner TEXT,
            make_model TEXT,
            chassis_number TEXT UNIQUE,
            year TEXT,
            engine_power_kw TEXT,
            transmission TEXT,
            mileage TEXT,
            registration TEXT,
            color TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    )");
    if (!ok) return false;
    ok = q.exec(R"(
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id INTEGER,
            service_type TEXT,
            description TEXT,
            price REAL,
            date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
        )
    )");
    if (!ok) return false;

    // Migration: add mileage column if not present (fails silently on repeat runs)
    QSqlQuery migrate;
    migrate.exec("ALTER TABLE services ADD COLUMN mileage TEXT DEFAULT ''");

    return true;
}

int Database::insertVehicle(const VehicleData& v) {
    QSqlQuery q;
    q.prepare(R"(INSERT INTO vehicles
        (owner, make_model, chassis_number, year, engine_power_kw, transmission, mileage, registration, color)
        VALUES (:owner, :make_model, :chassis_number, :year, :engine_power_kw, :transmission, :mileage, :registration, :color))");
    q.bindValue(":owner", v.owner);
    q.bindValue(":make_model", v.makeModel);
    q.bindValue(":chassis_number", v.chassisNumber);
    q.bindValue(":year", v.year);
    q.bindValue(":engine_power_kw", v.enginePowerKw);
    q.bindValue(":transmission", v.transmission);
    q.bindValue(":mileage", v.mileage);
    q.bindValue(":registration", v.registration);
    q.bindValue(":color", v.color);
    if (q.exec()) return q.lastInsertId().toInt();
    return -1;
}

bool Database::vehicleExistsByChassisNumber(const QString& chassisNumber) {
    QSqlQuery q;
    q.prepare("SELECT id FROM vehicles WHERE chassis_number = :cn");
    q.bindValue(":cn", chassisNumber);
    q.exec();
    return q.next();
}

int Database::vehicleIdByChassisNumber(const QString& chassisNumber) {
    QSqlQuery q;
    q.prepare("SELECT id FROM vehicles WHERE chassis_number = :cn");
    q.bindValue(":cn", chassisNumber);
    q.exec();
    if (q.next()) return q.value(0).toInt();
    return -1;
}

bool Database::updateVehicle(int id, const VehicleData& v) {
    QSqlQuery q;
    q.prepare(R"(UPDATE vehicles SET
        owner=:owner, make_model=:make_model, year=:year,
        engine_power_kw=:engine_power_kw, transmission=:transmission,
        mileage=:mileage, registration=:registration, color=:color
        WHERE id=:id)");
    q.bindValue(":owner", v.owner);
    q.bindValue(":make_model", v.makeModel);
    q.bindValue(":year", v.year);
    q.bindValue(":engine_power_kw", v.enginePowerKw);
    q.bindValue(":transmission", v.transmission);
    q.bindValue(":mileage", v.mileage);
    q.bindValue(":registration", v.registration);
    q.bindValue(":color", v.color);
    q.bindValue(":id", id);
    return q.exec();
}

QList<VehicleData> Database::searchVehicles(const QString& query) {
    QList<VehicleData> results;
    QSqlQuery q;
    QString escaped = query;
    escaped.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    QString pattern = "%" + escaped + "%";
    q.prepare(R"(SELECT id, owner, make_model, chassis_number, year, engine_power_kw,
        transmission, mileage, registration, color, created_at
        FROM vehicles
        WHERE make_model LIKE :mm ESCAPE '\' OR chassis_number LIKE :cn ESCAPE '\' OR registration LIKE :reg ESCAPE '\'
        ORDER BY created_at DESC)");
    q.bindValue(":mm", pattern);
    q.bindValue(":cn", pattern);
    q.bindValue(":reg", pattern);
    q.exec();
    while (q.next()) results.append(rowToVehicle(q));
    return results;
}

VehicleData Database::vehicleById(int id) {
    QSqlQuery q;
    q.prepare(R"(SELECT id, owner, make_model, chassis_number, year, engine_power_kw,
        transmission, mileage, registration, color, created_at
        FROM vehicles WHERE id = :id)");
    q.bindValue(":id", id);
    q.exec();
    if (q.next()) return rowToVehicle(q);
    return {};
}

VehicleData Database::rowToVehicle(const QSqlQuery& q) {
    VehicleData v;
    v.id            = q.value(0).toInt();
    v.owner         = q.value(1).toString();
    v.makeModel     = q.value(2).toString();
    v.chassisNumber = q.value(3).toString();
    v.year          = q.value(4).toString();
    v.enginePowerKw = q.value(5).toString();
    v.transmission  = q.value(6).toString();
    v.mileage       = q.value(7).toString();
    v.registration  = q.value(8).toString();
    v.color         = q.value(9).toString();
    v.createdAt     = q.value(10).toString();
    return v;
}

bool Database::insertService(const ServiceData& s) {
    QSqlQuery q;
    q.prepare(R"(INSERT INTO services (vehicle_id, service_type, description, mileage, price)
        VALUES (:vid, :type, :desc, :mileage, :price))");
    q.bindValue(":vid", s.vehicleId);
    q.bindValue(":type", s.serviceType);
    q.bindValue(":desc", s.description);
    q.bindValue(":mileage", s.mileage);
    q.bindValue(":price", s.price);
    return q.exec();
}

QList<ServiceData> Database::servicesForVehicle(int vehicleId) {
    QList<ServiceData> results;
    QSqlQuery q;
    q.prepare(R"(SELECT id, vehicle_id, service_type, description, mileage, price, date
        FROM services WHERE vehicle_id = :vid ORDER BY date DESC)");
    q.bindValue(":vid", vehicleId);
    q.exec();
    while (q.next()) {
        ServiceData s;
        s.id          = q.value(0).toInt();
        s.vehicleId   = q.value(1).toInt();
        s.serviceType = q.value(2).toString();
        s.description = q.value(3).toString();
        s.mileage     = q.value(4).toString();
        s.price       = q.value(5).toDouble();
        s.date        = q.value(6).toString();
        results.append(s);
    }
    return results;
}
