# Car Repair Shop Qt6 Desktop App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Qt 6 Windows desktop application for a car repair shop that reads vehicle registration cards, manages a SQLite vehicle/service database, and generates PDF invoices.

**Architecture:** CMake project with Qt6 Widgets/Sql/PrintSupport; existing `eVehicleRegistrationAPI` SDK in `citacVozacke/` subdirectory is wrapped in a `CardReader` class; all business logic separated from UI in `Database` and `PdfGenerator` classes.

**Tech Stack:** C++17, Qt 6 (Widgets, Sql, PrintSupport), SQLite via Qt SQL driver, QPdfWriter for PDF, CMake 3.20+, eVehicleRegistrationAPI SDK (DLL already present).

---

## File Map

| File | Responsibility |
|------|---------------|
| `CMakeLists.txt` | Build config, Qt6 deps, SDK linking |
| `src/Models.h` | VehicleData + ServiceData structs (no logic) |
| `src/Database.h/.cpp` | SQLite CRUD — vehicles + services tables |
| `src/CardReader.h/.cpp` | Wraps eVehicleRegistrationAPI SDK |
| `src/PdfGenerator.h/.cpp` | QPdfWriter — generates invoice PDF |
| `src/MainWindow.h/.cpp` | Main window: table, search, Read Card, Add Vehicle |
| `src/AddVehicleDialog.h/.cpp` | Modal form: add vehicle manually |
| `src/VehicleDetailsDialog.h/.cpp` | Vehicle info + service history + action buttons |
| `src/AddServiceDialog.h/.cpp` | Modal form: add service to vehicle |
| `src/main.cpp` | QApplication entry, DB init |

---

## Task 1: CMake Project Scaffold

**Files:**
- Create: `CMakeLists.txt`
- Create: `src/` (directory)

- [ ] **Step 1: Create CMakeLists.txt**

```cmake
cmake_minimum_required(VERSION 3.20)
project(CarRepairShop VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Sql PrintSupport)

set(SDK_DIR "${CMAKE_SOURCE_DIR}/citacVozacke")

set(SOURCES
    src/main.cpp
    src/MainWindow.cpp
    src/AddVehicleDialog.cpp
    src/VehicleDetailsDialog.cpp
    src/AddServiceDialog.cpp
    src/CardReader.cpp
    src/Database.cpp
    src/PdfGenerator.cpp
)

set(HEADERS
    src/Models.h
    src/MainWindow.h
    src/AddVehicleDialog.h
    src/VehicleDetailsDialog.h
    src/AddServiceDialog.h
    src/CardReader.h
    src/Database.h
    src/PdfGenerator.h
)

add_executable(CarRepairShop WIN32 ${SOURCES} ${HEADERS})

target_include_directories(CarRepairShop PRIVATE
    src
    ${SDK_DIR}
)

target_link_libraries(CarRepairShop PRIVATE
    Qt6::Widgets
    Qt6::Sql
    Qt6::PrintSupport
    "${SDK_DIR}/eVehicleRegistrationAPI.lib"
)

add_custom_command(TARGET CarRepairShop POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${SDK_DIR}/eVehicleRegistrationAPI.dll"
        $<TARGET_FILE_DIR:CarRepairShop>
)
```

- [ ] **Step 2: Create minimal src/main.cpp to verify CMake configures**

```cpp
#include <QApplication>
int main(int argc, char* argv[]) {
    QApplication app(argc, argv);
    return 0;
}
```

- [ ] **Step 3: Configure and build (from repo root)**

```bash
cmake -S . -B build -DCMAKE_PREFIX_PATH="C:/Qt/6.x.x/msvc2022_64"
cmake --build build --config Debug
```

Expected: build succeeds, `build/Debug/CarRepairShop.exe` exists.

- [ ] **Step 4: Commit**

```bash
git add CMakeLists.txt src/main.cpp
git commit -m "feat: add CMake scaffold for Qt6 CarRepairShop"
```

---

## Task 2: Data Models

**Files:**
- Create: `src/Models.h`

- [ ] **Step 1: Write src/Models.h**

```cpp
#pragma once
#include <QString>

struct VehicleData {
    int id = -1;
    QString owner;
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
    double price = 0.0;
    QString date;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/Models.h
git commit -m "feat: add VehicleData and ServiceData model structs"
```

---

## Task 3: Database Layer

**Files:**
- Create: `src/Database.h`
- Create: `src/Database.cpp`

- [ ] **Step 1: Write src/Database.h**

```cpp
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
```

- [ ] **Step 2: Write src/Database.cpp**

```cpp
#include "Database.h"
#include <QSqlQuery>
#include <QSqlError>
#include <QVariant>

Database& Database::instance() {
    static Database db;
    return db;
}

bool Database::init(const QString& path) {
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
    return q.exec(R"(
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
    QString pattern = "%" + query + "%";
    q.prepare(R"(SELECT id, owner, make_model, chassis_number, year, engine_power_kw,
        transmission, mileage, registration, color, created_at
        FROM vehicles
        WHERE make_model LIKE :mm OR chassis_number LIKE :cn OR registration LIKE :reg
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
    v.id             = q.value(0).toInt();
    v.owner          = q.value(1).toString();
    v.makeModel      = q.value(2).toString();
    v.chassisNumber  = q.value(3).toString();
    v.year           = q.value(4).toString();
    v.enginePowerKw  = q.value(5).toString();
    v.transmission   = q.value(6).toString();
    v.mileage        = q.value(7).toString();
    v.registration   = q.value(8).toString();
    v.color          = q.value(9).toString();
    v.createdAt      = q.value(10).toString();
    return v;
}

bool Database::insertService(const ServiceData& s) {
    QSqlQuery q;
    q.prepare(R"(INSERT INTO services (vehicle_id, service_type, description, price)
        VALUES (:vid, :type, :desc, :price))");
    q.bindValue(":vid", s.vehicleId);
    q.bindValue(":type", s.serviceType);
    q.bindValue(":desc", s.description);
    q.bindValue(":price", s.price);
    return q.exec();
}

QList<ServiceData> Database::servicesForVehicle(int vehicleId) {
    QList<ServiceData> results;
    QSqlQuery q;
    q.prepare(R"(SELECT id, vehicle_id, service_type, description, price, date
        FROM services WHERE vehicle_id = :vid ORDER BY date DESC)");
    q.bindValue(":vid", vehicleId);
    q.exec();
    while (q.next()) {
        ServiceData s;
        s.id          = q.value(0).toInt();
        s.vehicleId   = q.value(1).toInt();
        s.serviceType = q.value(2).toString();
        s.description = q.value(3).toString();
        s.price       = q.value(4).toDouble();
        s.date        = q.value(5).toString();
        results.append(s);
    }
    return results;
}
```

- [ ] **Step 3: Build to verify no compile errors**

```bash
cmake --build build --config Debug
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/Database.h src/Database.cpp
git commit -m "feat: add Database layer with SQLite CRUD for vehicles and services"
```

---

## Task 4: Card Reader SDK Wrapper

**Files:**
- Create: `src/CardReader.h`
- Create: `src/CardReader.cpp`

The SDK is in `citacVozacke/eVehicleRegistrationAPI.h/.lib/.dll`. Key SDK call sequence:
1. `sdStartup(0)` — init library
2. `GetReaderName(0, buf, &size)` — get first reader name
3. `SelectReader(name)` — select it
4. `sdProcessNewCard()` — wait/read card
5. `sdReadVehicleData()` + `sdReadPersonalData()` — get data
6. `sdCleanup()` — free

Note: SDK fields for `transmission` and `mileage` do not exist — those fields are left empty from card reads.

- [ ] **Step 1: Write src/CardReader.h**

```cpp
#pragma once
#include "Models.h"

class CardReader {
public:
    bool init();
    bool readCard(VehicleData& outData);
    void cleanup();

private:
    bool m_initialized = false;
    bool selectFirstReader();
};
```

- [ ] **Step 2: Write src/CardReader.cpp**

```cpp
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

    QString surname = toQStr(person.ownersSurnameOrBusinessName, person.ownersSurnameOrBusinessNameSize);
    QString givenName = toQStr(person.ownerName, person.ownerNameSize);
    outData.owner = (surname + " " + givenName).trimmed();

    QString make = toQStr(vehicle.vehicleMake, vehicle.vehicleMakeSize);
    QString model = toQStr(vehicle.commercialDescription, vehicle.commercialDescriptionSize);
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
```

- [ ] **Step 3: Build to verify no compile errors**

```bash
cmake --build build --config Debug
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/CardReader.h src/CardReader.cpp
git commit -m "feat: add CardReader wrapper for eVehicleRegistrationAPI SDK"
```

---

## Task 5: PDF Generator

**Files:**
- Create: `src/PdfGenerator.h`
- Create: `src/PdfGenerator.cpp`

Uses `QPdfWriter` + `QPainter`. Resolution 1200 DPI on A4 gives ~9921×14031 device pixels. All text coordinates are in those device units.

- [ ] **Step 1: Write src/PdfGenerator.h**

```cpp
#pragma once
#include "Models.h"
#include <QString>

class PdfGenerator {
public:
    // Returns the saved file path, or empty string on failure.
    QString generate(const VehicleData& vehicle, const ServiceData& service);
};
```

- [ ] **Step 2: Write src/PdfGenerator.cpp**

```cpp
#include "PdfGenerator.h"
#include <QPdfWriter>
#include <QPainter>
#include <QPageSize>
#include <QDateTime>
#include <QFont>

QString PdfGenerator::generate(const VehicleData& vehicle, const ServiceData& service) {
    QString datePart = QDateTime::currentDateTime().toString("yyyy-MM-dd");
    QString regSafe = vehicle.registration;
    regSafe.replace(" ", "_").replace("/", "-");
    QString filename = QString("invoice_%1_%2.pdf").arg(regSafe, datePart);

    QPdfWriter writer(filename);
    writer.setPageSize(QPageSize(QPageSize::A4));
    writer.setResolution(1200);

    QPainter painter(&writer);
    if (!painter.isActive()) return {};

    QFont titleFont("Arial", 24, QFont::Bold);
    QFont sectionFont("Arial", 14, QFont::Bold);
    QFont normalFont("Arial", 12);

    int x = 800;
    int y = 600;
    int lineH = 260;
    int gapH = 400;

    auto drawText = [&](const QString& text, const QFont& font) {
        painter.setFont(font);
        painter.drawText(x, y, text);
        y += lineH;
    };

    auto drawHRule = [&]() {
        painter.drawLine(x, y, 9000, y);
        y += 150;
    };

    drawText("AUTO SERVIS — RACUN ZA USLUGU", titleFont);
    drawHRule();
    y += gapH;

    drawText("VOZILO", sectionFont);
    drawHRule();
    drawText("Vlasnik:        " + vehicle.owner, normalFont);
    drawText("Marka/Model:    " + vehicle.makeModel, normalFont);
    drawText("Registracija:   " + vehicle.registration, normalFont);
    drawText("Broj sasije:    " + vehicle.chassisNumber, normalFont);
    drawText("Godiste:        " + vehicle.year, normalFont);
    y += gapH;

    drawText("USLUGA", sectionFont);
    drawHRule();
    drawText("Vrsta usluge:   " + service.serviceType, normalFont);
    drawText("Opis:           " + service.description, normalFont);
    drawText("Datum:          " + service.date, normalFont);
    drawText(QString("Cena:           %1 RSD").arg(service.price, 0, 'f', 2), normalFont);
    drawHRule();

    painter.end();
    return filename;
}
```

- [ ] **Step 3: Build to verify no compile errors**

```bash
cmake --build build --config Debug
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/PdfGenerator.h src/PdfGenerator.cpp
git commit -m "feat: add PdfGenerator using QPdfWriter for invoice generation"
```

---

## Task 6: Add Vehicle Dialog

**Files:**
- Create: `src/AddVehicleDialog.h`
- Create: `src/AddVehicleDialog.cpp`

- [ ] **Step 1: Write src/AddVehicleDialog.h**

```cpp
#pragma once
#include <QDialog>
#include <QLineEdit>

class AddVehicleDialog : public QDialog {
    Q_OBJECT
public:
    explicit AddVehicleDialog(QWidget* parent = nullptr);

private slots:
    void onSubmit();

private:
    QLineEdit* m_owner;
    QLineEdit* m_makeModel;
    QLineEdit* m_chassisNumber;
    QLineEdit* m_year;
    QLineEdit* m_enginePowerKw;
    QLineEdit* m_transmission;
    QLineEdit* m_mileage;
    QLineEdit* m_registration;
    QLineEdit* m_color;
};
```

- [ ] **Step 2: Write src/AddVehicleDialog.cpp**

```cpp
#include "AddVehicleDialog.h"
#include "Database.h"
#include "Models.h"
#include <QFormLayout>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton>
#include <QMessageBox>

AddVehicleDialog::AddVehicleDialog(QWidget* parent) : QDialog(parent) {
    setWindowTitle("Add Vehicle");
    setMinimumWidth(420);

    m_owner        = new QLineEdit();
    m_makeModel    = new QLineEdit();
    m_chassisNumber = new QLineEdit();
    m_year         = new QLineEdit();
    m_enginePowerKw = new QLineEdit();
    m_transmission = new QLineEdit();
    m_mileage      = new QLineEdit();
    m_registration = new QLineEdit();
    m_color        = new QLineEdit();

    QFormLayout* form = new QFormLayout();
    form->addRow("Owner:",              m_owner);
    form->addRow("Make/Model:",         m_makeModel);
    form->addRow("Chassis Number *:",   m_chassisNumber);
    form->addRow("Year:",               m_year);
    form->addRow("Engine Power (kW):",  m_enginePowerKw);
    form->addRow("Transmission:",       m_transmission);
    form->addRow("Mileage:",            m_mileage);
    form->addRow("Registration:",       m_registration);
    form->addRow("Color:",              m_color);

    QPushButton* btnOk     = new QPushButton("Add");
    QPushButton* btnCancel = new QPushButton("Cancel");
    QHBoxLayout* btns      = new QHBoxLayout();
    btns->addWidget(btnOk);
    btns->addWidget(btnCancel);

    QVBoxLayout* layout = new QVBoxLayout(this);
    layout->addLayout(form);
    layout->addLayout(btns);

    connect(btnOk,     &QPushButton::clicked, this, &AddVehicleDialog::onSubmit);
    connect(btnCancel, &QPushButton::clicked, this, &QDialog::reject);
}

void AddVehicleDialog::onSubmit() {
    QString chassis = m_chassisNumber->text().trimmed();
    if (chassis.isEmpty()) {
        QMessageBox::warning(this, "Validation", "Chassis number is required.");
        return;
    }
    if (Database::instance().vehicleExistsByChassisNumber(chassis)) {
        QMessageBox::warning(this, "Duplicate", "A vehicle with this chassis number already exists.");
        return;
    }

    VehicleData v;
    v.owner         = m_owner->text().trimmed();
    v.makeModel     = m_makeModel->text().trimmed();
    v.chassisNumber = chassis;
    v.year          = m_year->text().trimmed();
    v.enginePowerKw = m_enginePowerKw->text().trimmed();
    v.transmission  = m_transmission->text().trimmed();
    v.mileage       = m_mileage->text().trimmed();
    v.registration  = m_registration->text().trimmed();
    v.color         = m_color->text().trimmed();

    if (Database::instance().insertVehicle(v) < 0) {
        QMessageBox::critical(this, "Error", "Failed to save vehicle to database.");
        return;
    }
    accept();
}
```

- [ ] **Step 3: Build to verify no compile errors**

```bash
cmake --build build --config Debug
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/AddVehicleDialog.h src/AddVehicleDialog.cpp
git commit -m "feat: add AddVehicleDialog for manual vehicle entry"
```

---

## Task 7: Add Service Dialog

**Files:**
- Create: `src/AddServiceDialog.h`
- Create: `src/AddServiceDialog.cpp`

- [ ] **Step 1: Write src/AddServiceDialog.h**

```cpp
#pragma once
#include <QDialog>
#include <QComboBox>
#include <QLineEdit>
#include <QDoubleSpinBox>

class AddServiceDialog : public QDialog {
    Q_OBJECT
public:
    explicit AddServiceDialog(int vehicleId, QWidget* parent = nullptr);

private slots:
    void onSubmit();

private:
    int m_vehicleId;
    QComboBox*      m_serviceType;
    QLineEdit*      m_description;
    QDoubleSpinBox* m_price;
};
```

- [ ] **Step 2: Write src/AddServiceDialog.cpp**

```cpp
#include "AddServiceDialog.h"
#include "Database.h"
#include "Models.h"
#include <QFormLayout>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton>
#include <QMessageBox>

AddServiceDialog::AddServiceDialog(int vehicleId, QWidget* parent)
    : QDialog(parent), m_vehicleId(vehicleId) {
    setWindowTitle("Add Service");
    setMinimumWidth(400);

    m_serviceType = new QComboBox();
    m_serviceType->setEditable(true);
    m_serviceType->addItems({
        "Mali servis", "Veliki servis", "Zamena ulja", "Zamena guma",
        "Servis kocnica", "Zamena akumulatora", "Servis klime",
        "Dijagnostika", "Ostalo"
    });

    m_description = new QLineEdit();

    m_price = new QDoubleSpinBox();
    m_price->setRange(0.0, 10000000.0);
    m_price->setDecimals(2);
    m_price->setSuffix(" RSD");

    QFormLayout* form = new QFormLayout();
    form->addRow("Vrsta usluge *:", m_serviceType);
    form->addRow("Opis:",           m_description);
    form->addRow("Cena:",           m_price);

    QPushButton* btnOk     = new QPushButton("Sacuvaj");
    QPushButton* btnCancel = new QPushButton("Otkazi");
    QHBoxLayout* btns      = new QHBoxLayout();
    btns->addWidget(btnOk);
    btns->addWidget(btnCancel);

    QVBoxLayout* layout = new QVBoxLayout(this);
    layout->addLayout(form);
    layout->addLayout(btns);

    connect(btnOk,     &QPushButton::clicked, this, &AddServiceDialog::onSubmit);
    connect(btnCancel, &QPushButton::clicked, this, &QDialog::reject);
}

void AddServiceDialog::onSubmit() {
    QString type = m_serviceType->currentText().trimmed();
    if (type.isEmpty()) {
        QMessageBox::warning(this, "Validacija", "Vrsta usluge je obavezna.");
        return;
    }

    ServiceData s;
    s.vehicleId   = m_vehicleId;
    s.serviceType = type;
    s.description = m_description->text().trimmed();
    s.price       = m_price->value();

    if (!Database::instance().insertService(s)) {
        QMessageBox::critical(this, "Greska", "Neuspesno cuvanje usluge.");
        return;
    }
    accept();
}
```

- [ ] **Step 3: Build to verify no compile errors**

```bash
cmake --build build --config Debug
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/AddServiceDialog.h src/AddServiceDialog.cpp
git commit -m "feat: add AddServiceDialog for logging vehicle services"
```

---

## Task 8: Vehicle Details Dialog

**Files:**
- Create: `src/VehicleDetailsDialog.h`
- Create: `src/VehicleDetailsDialog.cpp`

- [ ] **Step 1: Write src/VehicleDetailsDialog.h**

```cpp
#pragma once
#include <QDialog>
#include <QTableWidget>
#include "Models.h"

class VehicleDetailsDialog : public QDialog {
    Q_OBJECT
public:
    explicit VehicleDetailsDialog(int vehicleId, QWidget* parent = nullptr);

private slots:
    void onAddService();
    void onGeneratePdf();

private:
    void setupUi();
    void loadServices();

    int          m_vehicleId;
    VehicleData  m_vehicle;
    QTableWidget* m_servicesTable;
};
```

- [ ] **Step 2: Write src/VehicleDetailsDialog.cpp**

```cpp
#include "VehicleDetailsDialog.h"
#include "Database.h"
#include "AddServiceDialog.h"
#include "PdfGenerator.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFormLayout>
#include <QGroupBox>
#include <QLabel>
#include <QPushButton>
#include <QComboBox>
#include <QMessageBox>
#include <QHeaderView>

VehicleDetailsDialog::VehicleDetailsDialog(int vehicleId, QWidget* parent)
    : QDialog(parent), m_vehicleId(vehicleId) {
    m_vehicle = Database::instance().vehicleById(vehicleId);
    setupUi();
    loadServices();
}

void VehicleDetailsDialog::setupUi() {
    setWindowTitle("Detalji vozila — " + m_vehicle.makeModel);
    resize(720, 540);

    QGroupBox* infoBox = new QGroupBox("Informacije o vozilu");
    QFormLayout* form  = new QFormLayout(infoBox);
    form->addRow("Vlasnik:",       new QLabel(m_vehicle.owner));
    form->addRow("Marka/Model:",   new QLabel(m_vehicle.makeModel));
    form->addRow("Broj sasije:",   new QLabel(m_vehicle.chassisNumber));
    form->addRow("Godiste:",       new QLabel(m_vehicle.year));
    form->addRow("Snaga (kW):",    new QLabel(m_vehicle.enginePowerKw));
    form->addRow("Menjac:",        new QLabel(m_vehicle.transmission));
    form->addRow("Kilometraza:",   new QLabel(m_vehicle.mileage));
    form->addRow("Registracija:",  new QLabel(m_vehicle.registration));
    form->addRow("Boja:",          new QLabel(m_vehicle.color));

    m_servicesTable = new QTableWidget(0, 5);
    m_servicesTable->setHorizontalHeaderLabels({"ID", "Vrsta", "Opis", "Cena (RSD)", "Datum"});
    m_servicesTable->setEditTriggers(QAbstractItemView::NoEditTriggers);
    m_servicesTable->setSelectionBehavior(QAbstractItemView::SelectRows);
    m_servicesTable->horizontalHeader()->setStretchLastSection(true);
    m_servicesTable->setColumnWidth(0, 40);
    m_servicesTable->setColumnWidth(1, 140);
    m_servicesTable->setColumnWidth(2, 200);
    m_servicesTable->setColumnWidth(3, 90);

    QGroupBox* servBox    = new QGroupBox("Istorija servisa");
    QVBoxLayout* servLay  = new QVBoxLayout(servBox);
    servLay->addWidget(m_servicesTable);

    QPushButton* btnAdd  = new QPushButton("Dodaj servis");
    QPushButton* btnPdf  = new QPushButton("Generisi PDF racun");
    QPushButton* btnClose = new QPushButton("Zatvori");

    QHBoxLayout* btns = new QHBoxLayout();
    btns->addWidget(btnAdd);
    btns->addWidget(btnPdf);
    btns->addStretch();
    btns->addWidget(btnClose);

    QVBoxLayout* main = new QVBoxLayout(this);
    main->addWidget(infoBox);
    main->addWidget(servBox, 1);
    main->addLayout(btns);

    connect(btnAdd,   &QPushButton::clicked, this, &VehicleDetailsDialog::onAddService);
    connect(btnPdf,   &QPushButton::clicked, this, &VehicleDetailsDialog::onGeneratePdf);
    connect(btnClose, &QPushButton::clicked, this, &QDialog::accept);
}

void VehicleDetailsDialog::loadServices() {
    auto services = Database::instance().servicesForVehicle(m_vehicleId);
    m_servicesTable->setRowCount(0);
    for (const auto& s : services) {
        int row = m_servicesTable->rowCount();
        m_servicesTable->insertRow(row);
        m_servicesTable->setItem(row, 0, new QTableWidgetItem(QString::number(s.id)));
        m_servicesTable->setItem(row, 1, new QTableWidgetItem(s.serviceType));
        m_servicesTable->setItem(row, 2, new QTableWidgetItem(s.description));
        m_servicesTable->setItem(row, 3, new QTableWidgetItem(QString::number(s.price, 'f', 2)));
        m_servicesTable->setItem(row, 4, new QTableWidgetItem(s.date));
    }
}

void VehicleDetailsDialog::onAddService() {
    AddServiceDialog dlg(m_vehicleId, this);
    if (dlg.exec() == QDialog::Accepted) {
        loadServices();
    }
}

void VehicleDetailsDialog::onGeneratePdf() {
    auto services = Database::instance().servicesForVehicle(m_vehicleId);
    if (services.isEmpty()) {
        QMessageBox::information(this, "Nema servisa", "Ovo vozilo nema evidentiranih servisa.");
        return;
    }

    QDialog picker(this);
    picker.setWindowTitle("Izaberi servis za racun");
    QComboBox* combo = new QComboBox();
    for (const auto& s : services) {
        combo->addItem(QString("%1 — %2 — %3 RSD")
            .arg(s.serviceType, s.date, QString::number(s.price, 'f', 2)));
    }
    QPushButton* btnOk  = new QPushButton("Generisi");
    QPushButton* btnNo  = new QPushButton("Otkazi");
    QHBoxLayout* btns   = new QHBoxLayout();
    btns->addWidget(btnOk);
    btns->addWidget(btnNo);
    QVBoxLayout* lay = new QVBoxLayout(&picker);
    lay->addWidget(combo);
    lay->addLayout(btns);
    connect(btnOk, &QPushButton::clicked, &picker, &QDialog::accept);
    connect(btnNo, &QPushButton::clicked, &picker, &QDialog::reject);

    if (picker.exec() != QDialog::Accepted) return;

    const ServiceData& sel = services[combo->currentIndex()];
    PdfGenerator gen;
    QString path = gen.generate(m_vehicle, sel);
    if (!path.isEmpty()) {
        QMessageBox::information(this, "PDF sacuvan", "Racun sacuvan:\n" + path);
    } else {
        QMessageBox::critical(this, "Greska", "Neuspesno generisanje PDF-a.");
    }
}
```

- [ ] **Step 3: Build to verify no compile errors**

```bash
cmake --build build --config Debug
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/VehicleDetailsDialog.h src/VehicleDetailsDialog.cpp
git commit -m "feat: add VehicleDetailsDialog with service history and PDF generation"
```

---

## Task 9: Main Window

**Files:**
- Create: `src/MainWindow.h`
- Create: `src/MainWindow.cpp`

- [ ] **Step 1: Write src/MainWindow.h**

```cpp
#pragma once
#include <QMainWindow>
#include <QTableWidget>
#include <QLineEdit>
#include <QPushButton>
#include "CardReader.h"
#include "Models.h"

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(QWidget* parent = nullptr);

private slots:
    void onReadCard();
    void onAddVehicle();
    void onSearchChanged(const QString& text);
    void onTableRowDoubleClicked(int row, int column);

private:
    void setupUi();
    void loadVehicles(const QString& query = "");
    void handleCardData(const VehicleData& data);

    QTableWidget* m_table;
    QLineEdit*    m_search;
    QPushButton*  m_btnReadCard;
    QPushButton*  m_btnAddVehicle;
    CardReader    m_cardReader;
};
```

- [ ] **Step 2: Write src/MainWindow.cpp**

```cpp
#include "MainWindow.h"
#include "Database.h"
#include "AddVehicleDialog.h"
#include "VehicleDetailsDialog.h"
#include <QWidget>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QMessageBox>

MainWindow::MainWindow(QWidget* parent) : QMainWindow(parent) {
    setupUi();
    loadVehicles();
}

void MainWindow::setupUi() {
    setWindowTitle("Auto Servis — Upravljanje vozilima");
    resize(960, 600);

    m_btnReadCard   = new QPushButton("Citaj karticu");
    m_btnAddVehicle = new QPushButton("Dodaj vozilo");
    m_search        = new QLineEdit();
    m_search->setPlaceholderText("Pretraga po marki/modelu, broju sasije, registraciji...");

    QHBoxLayout* topBar = new QHBoxLayout();
    topBar->addWidget(m_btnReadCard);
    topBar->addWidget(m_btnAddVehicle);
    topBar->addWidget(m_search, 1);

    m_table = new QTableWidget(0, 6);
    m_table->setHorizontalHeaderLabels({"ID", "Vlasnik", "Marka/Model", "Br. sasije", "Registracija", "Godiste"});
    m_table->setSelectionBehavior(QAbstractItemView::SelectRows);
    m_table->setEditTriggers(QAbstractItemView::NoEditTriggers);
    m_table->horizontalHeader()->setStretchLastSection(true);
    m_table->setColumnWidth(0, 40);
    m_table->setColumnWidth(1, 160);
    m_table->setColumnWidth(2, 180);
    m_table->setColumnWidth(3, 160);
    m_table->setColumnWidth(4, 110);

    QWidget* central    = new QWidget(this);
    QVBoxLayout* layout = new QVBoxLayout(central);
    layout->addLayout(topBar);
    layout->addWidget(m_table);
    setCentralWidget(central);

    connect(m_btnReadCard,   &QPushButton::clicked,      this, &MainWindow::onReadCard);
    connect(m_btnAddVehicle, &QPushButton::clicked,      this, &MainWindow::onAddVehicle);
    connect(m_search,        &QLineEdit::textChanged,    this, &MainWindow::onSearchChanged);
    connect(m_table,         &QTableWidget::cellDoubleClicked, this, &MainWindow::onTableRowDoubleClicked);
}

void MainWindow::loadVehicles(const QString& query) {
    auto vehicles = Database::instance().searchVehicles(query);
    m_table->setRowCount(0);
    for (const auto& v : vehicles) {
        int row = m_table->rowCount();
        m_table->insertRow(row);
        m_table->setItem(row, 0, new QTableWidgetItem(QString::number(v.id)));
        m_table->setItem(row, 1, new QTableWidgetItem(v.owner));
        m_table->setItem(row, 2, new QTableWidgetItem(v.makeModel));
        m_table->setItem(row, 3, new QTableWidgetItem(v.chassisNumber));
        m_table->setItem(row, 4, new QTableWidgetItem(v.registration));
        m_table->setItem(row, 5, new QTableWidgetItem(v.year));
    }
}

void MainWindow::onReadCard() {
    if (!m_cardReader.init()) {
        QMessageBox::critical(this, "Greska",
            "Nije moguce inicijalizovati citac kartica.\n"
            "Proverite da li je citac prikljucen.");
        return;
    }
    VehicleData data;
    if (!m_cardReader.readCard(data)) {
        QMessageBox::critical(this, "Greska",
            "Neuspesno citanje kartice.\n"
            "Proverite da li je kartica pravilno ubacena.");
        m_cardReader.cleanup();
        return;
    }
    m_cardReader.cleanup();
    handleCardData(data);
}

void MainWindow::handleCardData(const VehicleData& data) {
    if (data.chassisNumber.isEmpty()) {
        QMessageBox::warning(this, "Upozorenje",
            "Kartica ne sadrzi broj sasije — vozilo nije sacuvano.");
        return;
    }

    auto& db = Database::instance();
    if (db.vehicleExistsByChassisNumber(data.chassisNumber)) {
        int choice = QMessageBox::question(this, "Vozilo postoji",
            QString("Vozilo sa sasijem %1 vec postoji.\nAzurirati podatke?")
                .arg(data.chassisNumber),
            QMessageBox::Yes | QMessageBox::No);
        if (choice == QMessageBox::Yes) {
            int id = db.vehicleIdByChassisNumber(data.chassisNumber);
            db.updateVehicle(id, data);
            QMessageBox::information(this, "Azurirano", "Podaci o vozilu su azurirani.");
        }
    } else {
        if (db.insertVehicle(data) < 0) {
            QMessageBox::critical(this, "Greska", "Neuspesno cuvanje vozila u bazu.");
            return;
        }
        QMessageBox::information(this, "Sacuvano", "Vozilo je uspesno dodato.");
    }
    loadVehicles(m_search->text());
}

void MainWindow::onAddVehicle() {
    AddVehicleDialog dlg(this);
    if (dlg.exec() == QDialog::Accepted) {
        loadVehicles(m_search->text());
    }
}

void MainWindow::onSearchChanged(const QString& text) {
    loadVehicles(text);
}

void MainWindow::onTableRowDoubleClicked(int row, int) {
    QTableWidgetItem* idItem = m_table->item(row, 0);
    if (!idItem) return;
    int vehicleId = idItem->text().toInt();
    VehicleDetailsDialog dlg(vehicleId, this);
    dlg.exec();
    loadVehicles(m_search->text());
}
```

- [ ] **Step 3: Build to verify no compile errors**

```bash
cmake --build build --config Debug
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/MainWindow.h src/MainWindow.cpp
git commit -m "feat: add MainWindow with vehicle table, search, and card reader integration"
```

---

## Task 10: Wire main.cpp and Final Build

**Files:**
- Modify: `src/main.cpp`

- [ ] **Step 1: Replace src/main.cpp with full entry point**

```cpp
#include <QApplication>
#include <QMessageBox>
#include "Database.h"
#include "MainWindow.h"

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);
    app.setApplicationName("Auto Servis");
    app.setOrganizationName("AutoServis");

    if (!Database::instance().init("vehicles.db")) {
        QMessageBox::critical(nullptr, "Greska baze",
            "Nije moguce otvoriti bazu podataka vehicles.db.");
        return 1;
    }

    MainWindow window;
    window.show();

    return app.exec();
}
```

- [ ] **Step 2: Build release**

```bash
cmake --build build --config Release
```

Expected: `build/Release/CarRepairShop.exe` exists with no errors.

- [ ] **Step 3: Run the application**

```bash
./build/Release/CarRepairShop.exe
```

Expected:
- Window appears with title "Auto Servis — Upravljanje vozilima"
- Table is empty (fresh DB)
- "Dodaj vozilo" opens dialog, fill in fields, click Add → vehicle appears in table
- Typing in search box filters rows in real-time
- Double-clicking a row opens VehicleDetailsDialog
- Inside details: "Dodaj servis" works, service appears in history table
- "Generisi PDF racun" opens service picker, then saves `invoice_<reg>_<date>.pdf`

- [ ] **Step 4: Deploy Qt DLLs alongside executable (if not using static build)**

Run `windeployqt` from the Qt bin directory:

```bash
"C:/Qt/6.x.x/msvc2022_64/bin/windeployqt.exe" build/Release/CarRepairShop.exe
```

Expected: all required Qt DLLs and the QSQLITE driver plugin are copied next to the exe.

- [ ] **Step 5: Final commit**

```bash
git add src/main.cpp
git commit -m "feat: complete Car Repair Shop Qt6 application"
```

---

## Self-Review Checklist

### Spec Coverage

| Requirement | Covered by |
|-------------|------------|
| CMake + Qt6 Widgets/Sql/PrintSupport | Task 1 |
| vehicles + services SQLite tables | Task 3 |
| `sdStartup` / `sdReadVehicleData` / `sdReadPersonalData` | Task 4 |
| Map SDK fields → VehicleData | Task 4 (CardReader.cpp) |
| "Read Card" button | Task 9 (MainWindow) |
| "Add Vehicle" button + modal | Task 6, Task 9 |
| Real-time search with LIKE | Task 3 (searchVehicles), Task 9 |
| Vehicle details view with all fields | Task 8 |
| Service list in details view | Task 8 |
| "Add Service" dialog | Task 7 |
| Insert service with vehicle_id | Task 3 (insertService) |
| "Generate PDF Invoice" flow | Task 5, Task 8 |
| PDF with shop header, vehicle info, service info | Task 5 |
| File named `invoice_<reg>_<date>.pdf` | Task 5 |
| Chassis duplicate check → update or warn | Task 9 (handleCardData) |
| Services always preserved | Task 3 (separate table, no cascade delete) |
| Full service history visible | Task 8 (loadServices) |

### Notes

- `transmission` and `mileage` are **not present** in the SDK structs — they are left empty on card read but can be filled manually via AddVehicleDialog.
- `sdStartup` takes `apiVersion` as `int`. Passing `0` matches the existing working code in `citacVozacke/main.cpp`.
- `QString::fromLocal8Bit` is used for SDK strings to handle Serbian characters (Latin-2/Windows-1250 encoding). If the SDK returns UTF-8, change to `fromUtf8`.
- PDF is saved to the **current working directory** of the process. On Windows this is typically the directory containing the `.exe`. Mechanic can find it there or in the file browser.
