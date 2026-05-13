# Edit Mileage / Delete Vehicle & Service / Service Mileage Field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable mileage on vehicles, delete vehicle/service actions, and a mileage field on the service entry form.

**Architecture:** Four focused changes: (1) add `mileage` to `ServiceData` + DB migration, (2) show mileage field in `AddServiceDialog`, (3) add `deleteVehicle`/`deleteService` to `Database`, (4) wire all UI changes into `VehicleDetailsDialog` (editable mileage, delete buttons, mileage column in service table) and fix `MainWindow` to preserve mileage on card re-scan.

**Tech Stack:** Qt 5.15.2 32-bit MinGW, SQLite via Qt Sql, existing codebase at `C:/Users/nikol/source/repos/citacVozacke`.

---

## Environment

- Repo: `C:/Users/nikol/source/repos/citacVozacke`
- Build PATH required: `export PATH="/c/Qt/Tools/mingw810_32/bin:$PATH"`
- Configure: `"C:/Qt/Tools/CMake_64/bin/cmake.exe" -S . -B build -DCMAKE_PREFIX_PATH="C:/Qt/5.15.2/mingw81_32" -DCMAKE_C_COMPILER="C:/Qt/Tools/mingw810_32/bin/gcc.exe" -DCMAKE_CXX_COMPILER="C:/Qt/Tools/mingw810_32/bin/g++.exe" -G "Ninja" -DCMAKE_MAKE_PROGRAM="C:/Qt/Tools/Ninja/ninja.exe"`
- Build: `"C:/Qt/Tools/CMake_64/bin/cmake.exe" --build build`
- Git: user.email=rile.kv@gmail.com, user.name=Nikola

## File Map

| File | Change |
|------|--------|
| `src/Models.h` | Add `mileage` field to `ServiceData` |
| `src/Database.h` | Add `deleteVehicle(int)`, `deleteService(int)` declarations |
| `src/Database.cpp` | DB migration for `services.mileage` column; update `insertService` + `servicesForVehicle`; implement delete methods |
| `src/AddServiceDialog.h` | Add `QLineEdit* m_mileage` member |
| `src/AddServiceDialog.cpp` | Add mileage row to form; save to `ServiceData.mileage` |
| `src/VehicleDetailsDialog.h` | Add `onDeleteVehicle()`, `onDeleteService()`, `onSaveMileage()` slots; `QLineEdit* m_mileageEdit` member |
| `src/VehicleDetailsDialog.cpp` | Replace mileage QLabel with QLineEdit; add Delete Vehicle/Service buttons; add Mileage column to service table |
| `src/MainWindow.cpp` | Preserve existing mileage when card-scanning an existing vehicle |

---

## Task 1: Add `mileage` to `ServiceData` and migrate the database

**Files:**
- Modify: `src/Models.h`
- Modify: `src/Database.cpp`

- [ ] **Step 1: Add `mileage` field to `ServiceData` in `src/Models.h`**

Find the `ServiceData` struct (currently ends at `QString date;`) and add `mileage`:

```cpp
struct ServiceData {
    int id = -1;
    int vehicleId = -1;
    QString serviceType;
    QString description;
    QString mileage;
    double price = 0.0;
    QString date;
};
```

- [ ] **Step 2: Add DB migration for `services.mileage` in `src/Database.cpp`**

At the end of `Database::createTables()`, after the two `CREATE TABLE IF NOT EXISTS` calls but before `return`, add:

```cpp
    // Migration: add mileage column to services if it does not exist yet
    QSqlQuery migrate;
    migrate.exec("ALTER TABLE services ADD COLUMN mileage TEXT DEFAULT ''");
    // Intentionally ignore result — fails silently on subsequent runs when column already exists

    return true;
```

The full `createTables` function after this change:

```cpp
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

    // Migration: add mileage column to services if it does not exist yet
    QSqlQuery migrate;
    migrate.exec("ALTER TABLE services ADD COLUMN mileage TEXT DEFAULT ''");
    // Intentionally ignore result — fails silently on subsequent runs when column already exists

    return true;
}
```

- [ ] **Step 3: Update `insertService` to save `mileage`**

Find `Database::insertService` and update the INSERT to include `mileage`:

```cpp
bool Database::insertService(const ServiceData& s) {
    QSqlQuery q;
    q.prepare(R"(INSERT INTO services (vehicle_id, service_type, description, mileage, price)
        VALUES (:vid, :type, :desc, :mileage, :price))");
    q.bindValue(":vid",    s.vehicleId);
    q.bindValue(":type",   s.serviceType);
    q.bindValue(":desc",   s.description);
    q.bindValue(":mileage", s.mileage);
    q.bindValue(":price",  s.price);
    return q.exec();
}
```

- [ ] **Step 4: Update `servicesForVehicle` to read `mileage`**

Find `Database::servicesForVehicle` and update the SELECT + row mapping:

```cpp
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
```

- [ ] **Step 5: Build to verify**

```bash
export PATH="/c/Qt/Tools/mingw810_32/bin:$PATH"
cd C:/Users/nikol/source/repos/citacVozacke
"C:/Qt/Tools/CMake_64/bin/cmake.exe" --build build 2>&1
```

Expected: compiles clean; `AddServiceDialog.cpp` will have a warning or error about the unused `m_mileage` member — that is OK for now, it will be resolved in Task 2.

- [ ] **Step 6: Commit**

```bash
git add src/Models.h src/Database.cpp
git commit -m "feat: add mileage field to ServiceData and migrate services table"
```

---

## Task 2: Add mileage input to `AddServiceDialog`

**Files:**
- Modify: `src/AddServiceDialog.h`
- Modify: `src/AddServiceDialog.cpp`

- [ ] **Step 1: Add `m_mileage` member to `src/AddServiceDialog.h`**

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
    int             m_vehicleId;
    QComboBox*      m_serviceType;
    QLineEdit*      m_description;
    QLineEdit*      m_mileage;
    QDoubleSpinBox* m_price;
};
```

- [ ] **Step 2: Update `src/AddServiceDialog.cpp` to show and save the mileage field**

Full file replacement:

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
    m_mileage     = new QLineEdit();
    m_mileage->setPlaceholderText("e.g. 123456 km");

    m_price = new QDoubleSpinBox();
    m_price->setRange(0.0, 10000000.0);
    m_price->setDecimals(2);
    m_price->setSuffix(" RSD");

    QFormLayout* form = new QFormLayout();
    form->addRow("Service Type *:", m_serviceType);
    form->addRow("Description:",    m_description);
    form->addRow("Mileage:",        m_mileage);
    form->addRow("Price:",          m_price);

    QPushButton* btnOk     = new QPushButton("Save");
    QPushButton* btnCancel = new QPushButton("Cancel");
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
        QMessageBox::warning(this, "Validation", "Service type is required.");
        return;
    }

    ServiceData s;
    s.vehicleId   = m_vehicleId;
    s.serviceType = type;
    s.description = m_description->text().trimmed();
    s.mileage     = m_mileage->text().trimmed();
    s.price       = m_price->value();

    if (!Database::instance().insertService(s)) {
        QMessageBox::critical(this, "Error", "Failed to save service.");
        return;
    }
    accept();
}
```

- [ ] **Step 3: Build to verify**

```bash
export PATH="/c/Qt/Tools/mingw810_32/bin:$PATH"
cd C:/Users/nikol/source/repos/citacVozacke
"C:/Qt/Tools/CMake_64/bin/cmake.exe" --build build 2>&1
```

Expected: clean build with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/AddServiceDialog.h src/AddServiceDialog.cpp
git commit -m "feat: add mileage field to AddServiceDialog"
```

---

## Task 3: Add delete methods to `Database`

**Files:**
- Modify: `src/Database.h`
- Modify: `src/Database.cpp`

- [ ] **Step 1: Add declarations to `src/Database.h`**

Add two new public methods after `servicesForVehicle`:

```cpp
#pragma once
#include <QSqlDatabase>
#include <QSqlQuery>
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
    bool deleteService(int id);
    bool deleteVehicle(int id);

private:
    Database() = default;
    bool createTables();
    static VehicleData rowToVehicle(const QSqlQuery& q);
};
```

- [ ] **Step 2: Implement the two delete methods in `src/Database.cpp`**

Add at the end of `Database.cpp`:

```cpp
bool Database::deleteService(int id) {
    QSqlQuery q;
    q.prepare("DELETE FROM services WHERE id = :id");
    q.bindValue(":id", id);
    return q.exec();
}

bool Database::deleteVehicle(int id) {
    QSqlQuery q;
    q.prepare("DELETE FROM services WHERE vehicle_id = :id");
    q.bindValue(":id", id);
    if (!q.exec()) return false;
    q.prepare("DELETE FROM vehicles WHERE id = :id");
    q.bindValue(":id", id);
    return q.exec();
}
```

- [ ] **Step 3: Build to verify**

```bash
export PATH="/c/Qt/Tools/mingw810_32/bin:$PATH"
cd C:/Users/nikol/source/repos/citacVozacke
"C:/Qt/Tools/CMake_64/bin/cmake.exe" --build build 2>&1
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/Database.h src/Database.cpp
git commit -m "feat: add deleteVehicle and deleteService to Database"
```

---

## Task 4: Wire UI — editable mileage, delete buttons, service mileage column, MainWindow fix

**Files:**
- Modify: `src/VehicleDetailsDialog.h`
- Modify: `src/VehicleDetailsDialog.cpp`
- Modify: `src/MainWindow.cpp`

### Changes overview

In `VehicleDetailsDialog`:
- Replace the read-only `QLabel` for mileage with a `QLineEdit` (`m_mileageEdit`)
- Add a **"Save Mileage"** button in the button bar
- Add a **"Delete Vehicle"** button in the button bar
- Add a **"Delete Service"** button in the button bar (enabled only when a row is selected)
- Service table gets a 6th column: **Mileage** (inserted after Description, before Price)
  - New column order: ID | Type | Description | Mileage | Price (RSD) | Date

In `MainWindow`:
- When a card re-scan updates an existing vehicle, preserve the stored mileage if the card provides no mileage (since `data.mileage` is always `""` from card reads)

- [ ] **Step 1: Update `src/VehicleDetailsDialog.h`**

```cpp
#pragma once
#include <QDialog>
#include <QTableWidget>
#include <QLineEdit>
#include "Models.h"

class VehicleDetailsDialog : public QDialog {
    Q_OBJECT
public:
    explicit VehicleDetailsDialog(int vehicleId, QWidget* parent = nullptr);

private slots:
    void onAddService();
    void onDeleteService();
    void onDeleteVehicle();
    void onSaveMileage();
    void onGeneratePdf();

private:
    void setupUi();
    void loadServices();

    int           m_vehicleId;
    VehicleData   m_vehicle;
    QTableWidget* m_servicesTable;
    QLineEdit*    m_mileageEdit;
};
```

- [ ] **Step 2: Rewrite `src/VehicleDetailsDialog.cpp`**

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
    setWindowTitle("Vehicle Details — " + m_vehicle.makeModel);
    resize(760, 580);

    m_mileageEdit = new QLineEdit(m_vehicle.mileage);

    QGroupBox*   infoBox = new QGroupBox("Vehicle Information");
    QFormLayout* form    = new QFormLayout(infoBox);
    form->addRow("Owner:",        new QLabel(m_vehicle.owner));
    form->addRow("Make/Model:",   new QLabel(m_vehicle.makeModel));
    form->addRow("Chassis:",      new QLabel(m_vehicle.chassisNumber));
    form->addRow("Year:",         new QLabel(m_vehicle.year));
    form->addRow("Engine (kW):",  new QLabel(m_vehicle.enginePowerKw));
    form->addRow("Transmission:", new QLabel(m_vehicle.transmission));
    form->addRow("Mileage:",      m_mileageEdit);
    form->addRow("Registration:", new QLabel(m_vehicle.registration));
    form->addRow("Color:",        new QLabel(m_vehicle.color));

    // Service history table — 6 columns
    m_servicesTable = new QTableWidget(0, 6);
    m_servicesTable->setHorizontalHeaderLabels({"ID", "Type", "Description", "Mileage", "Price (RSD)", "Date"});
    m_servicesTable->setEditTriggers(QAbstractItemView::NoEditTriggers);
    m_servicesTable->setSelectionBehavior(QAbstractItemView::SelectRows);
    m_servicesTable->horizontalHeader()->setStretchLastSection(true);
    m_servicesTable->setColumnWidth(0, 40);
    m_servicesTable->setColumnWidth(1, 130);
    m_servicesTable->setColumnWidth(2, 180);
    m_servicesTable->setColumnWidth(3, 90);
    m_servicesTable->setColumnWidth(4, 90);

    QGroupBox*   servBox = new QGroupBox("Service History");
    QVBoxLayout* servLay = new QVBoxLayout(servBox);
    servLay->addWidget(m_servicesTable);

    QPushButton* btnSaveMileage  = new QPushButton("Save Mileage");
    QPushButton* btnAdd          = new QPushButton("Add Service");
    QPushButton* btnDeleteSvc    = new QPushButton("Delete Service");
    QPushButton* btnPdf          = new QPushButton("Generate PDF Invoice");
    QPushButton* btnDeleteVeh    = new QPushButton("Delete Vehicle");
    QPushButton* btnClose        = new QPushButton("Close");

    QHBoxLayout* btns = new QHBoxLayout();
    btns->addWidget(btnSaveMileage);
    btns->addWidget(btnAdd);
    btns->addWidget(btnDeleteSvc);
    btns->addWidget(btnPdf);
    btns->addStretch();
    btns->addWidget(btnDeleteVeh);
    btns->addWidget(btnClose);

    QVBoxLayout* main = new QVBoxLayout(this);
    main->addWidget(infoBox);
    main->addWidget(servBox, 1);
    main->addLayout(btns);

    connect(btnSaveMileage, &QPushButton::clicked, this, &VehicleDetailsDialog::onSaveMileage);
    connect(btnAdd,         &QPushButton::clicked, this, &VehicleDetailsDialog::onAddService);
    connect(btnDeleteSvc,   &QPushButton::clicked, this, &VehicleDetailsDialog::onDeleteService);
    connect(btnPdf,         &QPushButton::clicked, this, &VehicleDetailsDialog::onGeneratePdf);
    connect(btnDeleteVeh,   &QPushButton::clicked, this, &VehicleDetailsDialog::onDeleteVehicle);
    connect(btnClose,       &QPushButton::clicked, this, &QDialog::accept);
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
        m_servicesTable->setItem(row, 3, new QTableWidgetItem(s.mileage));
        m_servicesTable->setItem(row, 4, new QTableWidgetItem(QString::number(s.price, 'f', 2)));
        m_servicesTable->setItem(row, 5, new QTableWidgetItem(s.date));
    }
}

void VehicleDetailsDialog::onAddService() {
    AddServiceDialog dlg(m_vehicleId, this);
    if (dlg.exec() == QDialog::Accepted)
        loadServices();
}

void VehicleDetailsDialog::onDeleteService() {
    int row = m_servicesTable->currentRow();
    if (row < 0) {
        QMessageBox::information(this, "No Selection", "Select a service row to delete.");
        return;
    }
    QTableWidgetItem* idItem = m_servicesTable->item(row, 0);
    if (!idItem) return;
    bool ok = false;
    int serviceId = idItem->text().toInt(&ok);
    if (!ok || serviceId <= 0) return;

    int choice = QMessageBox::question(this, "Delete Service",
        "Delete this service record? This cannot be undone.",
        QMessageBox::Yes | QMessageBox::No);
    if (choice != QMessageBox::Yes) return;

    if (!Database::instance().deleteService(serviceId)) {
        QMessageBox::critical(this, "Error", "Failed to delete service.");
        return;
    }
    loadServices();
}

void VehicleDetailsDialog::onDeleteVehicle() {
    int choice = QMessageBox::question(this, "Delete Vehicle",
        QString("Delete vehicle %1 (%2) and ALL its service records?\nThis cannot be undone.")
            .arg(m_vehicle.makeModel, m_vehicle.registration),
        QMessageBox::Yes | QMessageBox::No);
    if (choice != QMessageBox::Yes) return;

    if (!Database::instance().deleteVehicle(m_vehicleId)) {
        QMessageBox::critical(this, "Error", "Failed to delete vehicle.");
        return;
    }
    accept();
}

void VehicleDetailsDialog::onSaveMileage() {
    m_vehicle.mileage = m_mileageEdit->text().trimmed();
    if (!Database::instance().updateVehicle(m_vehicleId, m_vehicle)) {
        QMessageBox::critical(this, "Error", "Failed to save mileage.");
        return;
    }
    QMessageBox::information(this, "Saved", "Mileage updated.");
}

void VehicleDetailsDialog::onGeneratePdf() {
    auto services = Database::instance().servicesForVehicle(m_vehicleId);
    if (services.isEmpty()) {
        QMessageBox::information(this, "No Services", "This vehicle has no recorded services.");
        return;
    }

    QDialog picker(this);
    picker.setWindowTitle("Select Service for Invoice");
    QComboBox* combo = new QComboBox();
    for (const auto& s : services) {
        combo->addItem(QString("%1 — %2 — %3 RSD")
            .arg(s.serviceType, s.date, QString::number(s.price, 'f', 2)));
    }
    QPushButton* btnOk = new QPushButton("Generate");
    QPushButton* btnNo = new QPushButton("Cancel");
    QHBoxLayout* btns  = new QHBoxLayout();
    btns->addWidget(btnOk);
    btns->addWidget(btnNo);
    QVBoxLayout* lay = new QVBoxLayout(&picker);
    lay->addWidget(combo);
    lay->addLayout(btns);
    connect(btnOk, &QPushButton::clicked, &picker, &QDialog::accept);
    connect(btnNo, &QPushButton::clicked, &picker, &QDialog::reject);

    if (picker.exec() != QDialog::Accepted) return;

    int idx = combo->currentIndex();
    if (idx < 0 || idx >= services.size()) return;
    const ServiceData& sel = services[idx];
    PdfGenerator gen;
    QString path = gen.generate(m_vehicle, sel);
    if (!path.isEmpty())
        QMessageBox::information(this, "PDF Saved", "Invoice saved to:\n" + path);
    else
        QMessageBox::critical(this, "Error", "Failed to generate PDF.");
}
```

- [ ] **Step 3: Fix mileage preservation on card rescan in `src/MainWindow.cpp`**

Find `handleCardData` in `MainWindow.cpp`. The existing update block is:

```cpp
        if (choice == QMessageBox::Yes) {
            int id = db.vehicleIdByChassisNumber(data.chassisNumber);
            db.updateVehicle(id, data);
            QMessageBox::information(this, "Updated", "Vehicle record updated.");
        }
```

Replace with:

```cpp
        if (choice == QMessageBox::Yes) {
            int id = db.vehicleIdByChassisNumber(data.chassisNumber);
            VehicleData toUpdate = data;
            if (toUpdate.mileage.isEmpty()) {
                VehicleData existing = db.vehicleById(id);
                toUpdate.mileage = existing.mileage;
            }
            db.updateVehicle(id, toUpdate);
            QMessageBox::information(this, "Updated", "Vehicle record updated.");
        }
```

- [ ] **Step 4: Build to verify**

```bash
export PATH="/c/Qt/Tools/mingw810_32/bin:$PATH"
cd C:/Users/nikol/source/repos/citacVozacke
"C:/Qt/Tools/CMake_64/bin/cmake.exe" --build build 2>&1
```

Expected: clean build, `CarRepairShop.exe` produced.

- [ ] **Step 5: Commit**

```bash
git add src/VehicleDetailsDialog.h src/VehicleDetailsDialog.cpp src/MainWindow.cpp
git commit -m "feat: editable mileage, delete vehicle/service buttons, mileage column in service history"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Edit mileage on scanned vehicle | Task 4 — `onSaveMileage` + mileage preservation on rescan in MainWindow |
| Edit mileage on manually added vehicle | Task 4 — `m_mileageEdit` in VehicleDetailsDialog (works for both) |
| Delete vehicle | Task 3 (`deleteVehicle`) + Task 4 (`onDeleteVehicle`) |
| Delete service | Task 3 (`deleteService`) + Task 4 (`onDeleteService`) |
| Mileage field on service entry | Task 1 (model + DB) + Task 2 (dialog) |
| Mileage shown in service history table | Task 4 (6th column in `loadServices`) |

All requirements covered. No gaps.

### Placeholder Scan

No TBD/TODO placeholders. All code blocks are complete.

### Type Consistency

- `ServiceData.mileage` (QString) used consistently across Models.h (Task 1), Database.cpp (Tasks 1, 3), AddServiceDialog.cpp (Task 2), VehicleDetailsDialog.cpp (Task 4).
- `Database::deleteService(int)` and `Database::deleteVehicle(int)` declared in Task 3 header and called in Task 4 — signatures match.
- `m_mileageEdit` (QLineEdit*) declared in Task 4 header and used in Task 4 cpp — consistent.
