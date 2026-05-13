# Phone Number Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a phone number field to each vehicle — stored in the DB, searchable, editable in the details dialog, and enterable when adding a vehicle manually.

**Architecture:** Three focused changes: (1) data layer — `VehicleData.phone` + DB migration + update all queries, (2) `AddVehicleDialog` — phone input field, (3) `VehicleDetailsDialog` — phone QLineEdit + rename Save button; `MainWindow` — always preserve phone on card re-scan + update search placeholder.

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
| `src/Models.h` | Add `phone` field to `VehicleData` |
| `src/Database.cpp` | DDL + migration; update insertVehicle, updateVehicle, rowToVehicle (column shifts), searchVehicles |
| `src/AddVehicleDialog.h` | Add `QLineEdit* m_phone` member |
| `src/AddVehicleDialog.cpp` | Add Phone row to form; assign to `v.phone` |
| `src/VehicleDetailsDialog.h` | Add `QLineEdit* m_phoneEdit`; rename `onSaveMileage` → `onSave` |
| `src/VehicleDetailsDialog.cpp` | Add phone QLineEdit to form; rename button + slot; save both fields |
| `src/MainWindow.cpp` | Always preserve phone on card re-scan; update search placeholder |

---

## Task 1: Data layer — `VehicleData.phone` + DB migration + query updates

**Files:**
- Modify: `src/Models.h`
- Modify: `src/Database.cpp`

- [ ] **Step 1: Add `phone` to `VehicleData` in `src/Models.h`**

Replace the `VehicleData` struct with:

```cpp
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
```

Leave `ServiceData` unchanged.

- [ ] **Step 2: Add `phone TEXT DEFAULT ''` to the `CREATE TABLE vehicles` DDL in `src/Database.cpp`**

Find the `CREATE TABLE IF NOT EXISTS vehicles` block (lines 22–36). Add `phone TEXT DEFAULT '',` after the `owner TEXT,` line:

```sql
CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT,
    phone TEXT DEFAULT '',
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
```

- [ ] **Step 3: Add DB migration for existing databases in `src/Database.cpp`**

In `createTables()`, after the existing `migrate.exec("ALTER TABLE services ...")` line (currently line 54), add:

```cpp
    QSqlQuery migratePhone;
    migratePhone.exec("ALTER TABLE vehicles ADD COLUMN phone TEXT DEFAULT ''");
```

The result is intentionally ignored — the statement fails silently on re-runs when the column already exists.

- [ ] **Step 4: Update `insertVehicle` in `src/Database.cpp`**

Replace the entire `insertVehicle` function:

```cpp
int Database::insertVehicle(const VehicleData& v) {
    QSqlQuery q;
    q.prepare(R"(INSERT INTO vehicles
        (owner, phone, make_model, chassis_number, year, engine_power_kw, transmission, mileage, registration, color)
        VALUES (:owner, :phone, :make_model, :chassis_number, :year, :engine_power_kw, :transmission, :mileage, :registration, :color))");
    q.bindValue(":owner",         v.owner);
    q.bindValue(":phone",         v.phone);
    q.bindValue(":make_model",    v.makeModel);
    q.bindValue(":chassis_number", v.chassisNumber);
    q.bindValue(":year",          v.year);
    q.bindValue(":engine_power_kw", v.enginePowerKw);
    q.bindValue(":transmission",  v.transmission);
    q.bindValue(":mileage",       v.mileage);
    q.bindValue(":registration",  v.registration);
    q.bindValue(":color",         v.color);
    if (q.exec()) return q.lastInsertId().toInt();
    return -1;
}
```

- [ ] **Step 5: Update `updateVehicle` in `src/Database.cpp`**

Replace the entire `updateVehicle` function:

```cpp
bool Database::updateVehicle(int id, const VehicleData& v) {
    QSqlQuery q;
    q.prepare(R"(UPDATE vehicles SET
        owner=:owner, phone=:phone, make_model=:make_model, year=:year,
        engine_power_kw=:engine_power_kw, transmission=:transmission,
        mileage=:mileage, registration=:registration, color=:color
        WHERE id=:id)");
    q.bindValue(":owner",           v.owner);
    q.bindValue(":phone",           v.phone);
    q.bindValue(":make_model",      v.makeModel);
    q.bindValue(":year",            v.year);
    q.bindValue(":engine_power_kw", v.enginePowerKw);
    q.bindValue(":transmission",    v.transmission);
    q.bindValue(":mileage",         v.mileage);
    q.bindValue(":registration",    v.registration);
    q.bindValue(":color",           v.color);
    q.bindValue(":id",              id);
    return q.exec();
}
```

- [ ] **Step 6: Update `searchVehicles` in `src/Database.cpp`**

Replace the entire `searchVehicles` function:

```cpp
QList<VehicleData> Database::searchVehicles(const QString& query) {
    QList<VehicleData> results;
    QSqlQuery q;
    QString escaped = query;
    escaped.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    QString pattern = "%" + escaped + "%";
    q.prepare(R"(SELECT id, owner, phone, make_model, chassis_number, year, engine_power_kw,
        transmission, mileage, registration, color, created_at
        FROM vehicles
        WHERE make_model LIKE :mm ESCAPE '\' OR chassis_number LIKE :cn ESCAPE '\'
           OR registration LIKE :reg ESCAPE '\' OR phone LIKE :phone ESCAPE '\'
        ORDER BY created_at DESC)");
    q.bindValue(":mm",    pattern);
    q.bindValue(":cn",    pattern);
    q.bindValue(":reg",   pattern);
    q.bindValue(":phone", pattern);
    q.exec();
    while (q.next()) results.append(rowToVehicle(q));
    return results;
}
```

- [ ] **Step 7: Update `vehicleById` SELECT in `src/Database.cpp`**

Replace the entire `vehicleById` function:

```cpp
VehicleData Database::vehicleById(int id) {
    QSqlQuery q;
    q.prepare(R"(SELECT id, owner, phone, make_model, chassis_number, year, engine_power_kw,
        transmission, mileage, registration, color, created_at
        FROM vehicles WHERE id = :id)");
    q.bindValue(":id", id);
    q.exec();
    if (q.next()) return rowToVehicle(q);
    return {};
}
```

- [ ] **Step 8: Update `rowToVehicle` column indices in `src/Database.cpp`**

Replace the entire `rowToVehicle` function. `phone` is now at col 2; all others shift by one:

```cpp
VehicleData Database::rowToVehicle(const QSqlQuery& q) {
    VehicleData v;
    v.id            = q.value(0).toInt();
    v.owner         = q.value(1).toString();
    v.phone         = q.value(2).toString();
    v.makeModel     = q.value(3).toString();
    v.chassisNumber = q.value(4).toString();
    v.year          = q.value(5).toString();
    v.enginePowerKw = q.value(6).toString();
    v.transmission  = q.value(7).toString();
    v.mileage       = q.value(8).toString();
    v.registration  = q.value(9).toString();
    v.color         = q.value(10).toString();
    v.createdAt     = q.value(11).toString();
    return v;
}
```

- [ ] **Step 9: Build to verify**

```bash
export PATH="/c/Qt/Tools/mingw810_32/bin:$PATH"
"C:/Qt/Tools/CMake_64/bin/cmake.exe" --build "C:/Users/nikol/source/repos/citacVozacke/build" 2>&1
```

Expected: clean build with no errors.

- [ ] **Step 10: Commit**

```bash
cd "C:/Users/nikol/source/repos/citacVozacke"
git add src/Models.h src/Database.cpp
git commit -m "feat: add phone field to VehicleData, DB migration, update all vehicle queries"
```

---

## Task 2: Add phone input to `AddVehicleDialog`

**Files:**
- Modify: `src/AddVehicleDialog.h`
- Modify: `src/AddVehicleDialog.cpp`

- [ ] **Step 1: Add `m_phone` member to `src/AddVehicleDialog.h`**

Replace the file with:

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
    QLineEdit* m_phone;
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

- [ ] **Step 2: Add phone field to `src/AddVehicleDialog.cpp`**

Replace the file with:

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
    setMinimumWidth(400);

    m_owner         = new QLineEdit();
    m_phone         = new QLineEdit();
    m_makeModel     = new QLineEdit();
    m_chassisNumber = new QLineEdit();
    m_year          = new QLineEdit();
    m_enginePowerKw = new QLineEdit();
    m_transmission  = new QLineEdit();
    m_mileage       = new QLineEdit();
    m_registration  = new QLineEdit();
    m_color         = new QLineEdit();

    QFormLayout* form = new QFormLayout();
    form->addRow("Owner:",             m_owner);
    form->addRow("Phone:",             m_phone);
    form->addRow("Make/Model:",        m_makeModel);
    form->addRow("Chassis Number *:",  m_chassisNumber);
    form->addRow("Year:",              m_year);
    form->addRow("Engine Power (kW):", m_enginePowerKw);
    form->addRow("Transmission:",      m_transmission);
    form->addRow("Mileage:",           m_mileage);
    form->addRow("Registration:",      m_registration);
    form->addRow("Color:",             m_color);

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
    v.phone         = m_phone->text().trimmed();
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

- [ ] **Step 3: Build to verify**

```bash
export PATH="/c/Qt/Tools/mingw810_32/bin:$PATH"
"C:/Qt/Tools/CMake_64/bin/cmake.exe" --build "C:/Users/nikol/source/repos/citacVozacke/build" 2>&1
```

Expected: clean build with no errors.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/nikol/source/repos/citacVozacke"
git add src/AddVehicleDialog.h src/AddVehicleDialog.cpp
git commit -m "feat: add phone field to AddVehicleDialog"
```

---

## Task 3: `VehicleDetailsDialog` phone edit + rename Save button; `MainWindow` card-scan fix

**Files:**
- Modify: `src/VehicleDetailsDialog.h`
- Modify: `src/VehicleDetailsDialog.cpp`
- Modify: `src/MainWindow.cpp`

- [ ] **Step 1: Update `src/VehicleDetailsDialog.h`**

Replace the file with:

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
    void onSave();
    void onGeneratePdf();

private:
    void setupUi();
    void loadServices();

    int           m_vehicleId;
    VehicleData   m_vehicle;
    QTableWidget* m_servicesTable;
    QLineEdit*    m_mileageEdit;
    QLineEdit*    m_phoneEdit;
};
```

- [ ] **Step 2: Update `src/VehicleDetailsDialog.cpp`**

Replace the file with:

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
#include <QTimer>

VehicleDetailsDialog::VehicleDetailsDialog(int vehicleId, QWidget* parent)
    : QDialog(parent), m_vehicleId(vehicleId) {
    m_vehicle = Database::instance().vehicleById(vehicleId);
    if (m_vehicle.id <= 0) {
        QTimer::singleShot(0, this, [this]{ reject(); });
        return;
    }
    setupUi();
    loadServices();
}

void VehicleDetailsDialog::setupUi() {
    setWindowTitle("Vehicle Details — " + m_vehicle.makeModel);
    resize(760, 580);

    m_phoneEdit   = new QLineEdit(m_vehicle.phone);
    m_mileageEdit = new QLineEdit(m_vehicle.mileage);

    QGroupBox*   infoBox = new QGroupBox("Vehicle Information");
    QFormLayout* form    = new QFormLayout(infoBox);
    form->addRow("Owner:",        new QLabel(m_vehicle.owner));
    form->addRow("Phone:",        m_phoneEdit);
    form->addRow("Make/Model:",   new QLabel(m_vehicle.makeModel));
    form->addRow("Chassis:",      new QLabel(m_vehicle.chassisNumber));
    form->addRow("Year:",         new QLabel(m_vehicle.year));
    form->addRow("Engine (kW):",  new QLabel(m_vehicle.enginePowerKw));
    form->addRow("Transmission:", new QLabel(m_vehicle.transmission));
    form->addRow("Mileage:",      m_mileageEdit);
    form->addRow("Registration:", new QLabel(m_vehicle.registration));
    form->addRow("Color:",        new QLabel(m_vehicle.color));

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

    QPushButton* btnSave      = new QPushButton("Save");
    QPushButton* btnAdd       = new QPushButton("Add Service");
    QPushButton* btnDeleteSvc = new QPushButton("Delete Service");
    QPushButton* btnPdf       = new QPushButton("Generate PDF Invoice");
    QPushButton* btnDeleteVeh = new QPushButton("Delete Vehicle");
    QPushButton* btnClose     = new QPushButton("Close");

    QHBoxLayout* btns = new QHBoxLayout();
    btns->addWidget(btnSave);
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

    connect(btnSave,      &QPushButton::clicked, this, &VehicleDetailsDialog::onSave);
    connect(btnAdd,       &QPushButton::clicked, this, &VehicleDetailsDialog::onAddService);
    connect(btnDeleteSvc, &QPushButton::clicked, this, &VehicleDetailsDialog::onDeleteService);
    connect(btnPdf,       &QPushButton::clicked, this, &VehicleDetailsDialog::onGeneratePdf);
    connect(btnDeleteVeh, &QPushButton::clicked, this, &VehicleDetailsDialog::onDeleteVehicle);
    connect(btnClose,     &QPushButton::clicked, this, &QDialog::accept);
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

void VehicleDetailsDialog::onSave() {
    QString newPhone   = m_phoneEdit->text().trimmed();
    QString newMileage = m_mileageEdit->text().trimmed();
    VehicleData toSave = m_vehicle;
    toSave.phone   = newPhone;
    toSave.mileage = newMileage;
    if (!Database::instance().updateVehicle(m_vehicleId, toSave)) {
        QMessageBox::critical(this, "Error", "Failed to save.");
        return;
    }
    m_vehicle.phone   = newPhone;
    m_vehicle.mileage = newMileage;
    QMessageBox::information(this, "Saved", "Vehicle details updated.");
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

- [ ] **Step 3: Update `src/MainWindow.cpp` — preserve phone on card re-scan + update placeholder**

Find the `m_search->setPlaceholderText(...)` line in `setupUi()` (currently line 23). Replace it:

```cpp
    m_search->setPlaceholderText("Search by make/model, chassis, registration, or phone...");
```

Find `handleCardData` and replace the update block (currently lines 98–109):

```cpp
        if (choice == QMessageBox::Yes) {
            int id = db.vehicleIdByChassisNumber(data.chassisNumber);
            VehicleData existing = db.vehicleById(id);
            VehicleData toUpdate = data;
            if (toUpdate.mileage.isEmpty())
                toUpdate.mileage = existing.mileage;
            toUpdate.phone = existing.phone;
            if (!db.updateVehicle(id, toUpdate)) {
                QMessageBox::critical(this, "Error", "Failed to update vehicle record.");
                return;
            }
            QMessageBox::information(this, "Updated", "Vehicle record updated.");
        }
```

- [ ] **Step 4: Build to verify**

```bash
export PATH="/c/Qt/Tools/mingw810_32/bin:$PATH"
"C:/Qt/Tools/CMake_64/bin/cmake.exe" --build "C:/Users/nikol/source/repos/citacVozacke/build" 2>&1
```

Expected: clean build, `CarRepairShop.exe` produced.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/nikol/source/repos/citacVozacke"
git add src/VehicleDetailsDialog.h src/VehicleDetailsDialog.cpp src/MainWindow.cpp
git commit -m "feat: phone field in VehicleDetailsDialog, preserve phone on card rescan, update search hint"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| `VehicleData.phone` field | Task 1 — Models.h |
| DB migration for existing databases | Task 1 — `ALTER TABLE vehicles ADD COLUMN phone` |
| `CREATE TABLE` DDL includes phone | Task 1 — Step 2 |
| `insertVehicle` saves phone | Task 1 — Step 4 |
| `updateVehicle` saves phone | Task 1 — Step 5 |
| `rowToVehicle` reads phone (col 2, all others shift) | Task 1 — Step 8 |
| `searchVehicles` searches by phone | Task 1 — Step 6 |
| `vehicleById` SELECT includes phone | Task 1 — Step 7 |
| Phone input in AddVehicleDialog | Task 2 |
| Phone QLineEdit in VehicleDetailsDialog | Task 3 — Step 2 |
| Save button saves both phone and mileage | Task 3 — `onSave()` |
| Phone preserved on card re-scan | Task 3 — Step 3 |
| Search placeholder updated | Task 3 — Step 3 |

All requirements covered.

### Placeholder Scan

No TBD/TODO. All code blocks are complete.

### Type Consistency

- `VehicleData.phone` (QString) defined in Task 1, used in Tasks 2 and 3 — consistent.
- `onSave()` slot declared in header (Task 3 Step 1) and implemented in cpp (Task 3 Step 2) — consistent.
- Column indices in `rowToVehicle` (Task 1 Step 8) match the SELECT order in `searchVehicles` (Step 6) and `vehicleById` (Step 7) — verified above.
