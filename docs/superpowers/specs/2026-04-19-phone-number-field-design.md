# Phone Number Field — Design Spec

**Date:** 2026-04-19
**Status:** Approved

## Goal

Add a phone number field to each vehicle record so mechanics can store and look up owners by phone number.

## Requirements

- Phone number is stored per vehicle, optional (no validation enforced)
- Phone number is searchable via the main search bar
- Phone number does NOT appear on PDF invoices
- Phone number is NOT provided by the card reader SDK (always preserved from DB on card re-scan)

---

## Data Layer

### `src/Models.h`

Add `QString phone` to `VehicleData` after `owner`:

```cpp
struct VehicleData {
    int id = -1;
    QString owner;
    QString phone;
    QString makeModel;
    // ... rest unchanged
};
```

### `src/Database.cpp` — schema

Add `phone TEXT DEFAULT ''` to the `CREATE TABLE IF NOT EXISTS vehicles` DDL (after `owner`) for schema consistency on new databases.

Add migration at the end of `createTables()` for existing databases:

```cpp
QSqlQuery migPhone;
migPhone.exec("ALTER TABLE vehicles ADD COLUMN phone TEXT DEFAULT ''");
```

### `src/Database.cpp` — query updates

- **`insertVehicle`**: add `phone` to INSERT column list and bind `:phone` from `v.phone`
- **`updateVehicle`**: add `phone=:phone` to SET clause and bind `:phone`
- **`searchVehicles`** and **`vehicleById`** SELECT lists: add `phone` after `owner` so the column indices match `rowToVehicle`
- **`rowToVehicle`**: column indices shift — `phone` is inserted at position 2 (after `owner`). New mapping:
  - col 0: id
  - col 1: owner
  - col 2: phone
  - col 3: make_model
  - col 4: chassis_number
  - col 5: year
  - col 6: engine_power_kw
  - col 7: transmission
  - col 8: mileage
  - col 9: registration
  - col 10: color
  - col 11: created_at
- **`searchVehicles`**: add `OR phone LIKE :phone ESCAPE '\'` to the WHERE clause; bind `:phone` to the same pattern as other fields

---

## UI

### `src/AddVehicleDialog` (`.h` + `.cpp`)

Add a `QLineEdit* m_phone` field. Position it in the form after "Owner:" and before "Make/Model:". Label: `"Phone:"`.

In `onSubmit()`, assign `v.phone = m_phone->text().trimmed()`.

### `src/VehicleDetailsDialog` (`.h` + `.cpp`)

- Replace the "Mileage:" `QLabel` with `m_mileageEdit` (already done in previous feature)
- Add `QLineEdit* m_phoneEdit` for the "Phone:" row — positioned after "Owner:" in the info form, initialized with `m_vehicle.phone`
- Rename the "Save Mileage" button to **"Save"**
- `onSaveMileage()` renamed to `onSave()` — saves both phone and mileage:
  ```cpp
  void VehicleDetailsDialog::onSave() {
      QString newMileage = m_mileageEdit->text().trimmed();
      QString newPhone   = m_phoneEdit->text().trimmed();
      VehicleData toSave = m_vehicle;
      toSave.mileage = newMileage;
      toSave.phone   = newPhone;
      if (!Database::instance().updateVehicle(m_vehicleId, toSave)) {
          QMessageBox::critical(this, "Error", "Failed to save.");
          return;
      }
      m_vehicle.mileage = newMileage;
      m_vehicle.phone   = newPhone;
      QMessageBox::information(this, "Saved", "Vehicle details updated.");
  }
  ```

### `src/MainWindow.cpp`

In `handleCardData`, consolidate into a single `vehicleById` call (phone always needs preserving; mileage only when empty):

```cpp
VehicleData toUpdate = data;
VehicleData existing = db.vehicleById(id);
if (toUpdate.mileage.isEmpty())
    toUpdate.mileage = existing.mileage;
toUpdate.phone = existing.phone;
```

---

## File Map

| File | Change |
|------|--------|
| `src/Models.h` | Add `phone` to `VehicleData` |
| `src/Database.cpp` | DDL + migration; update insert/update/select/search |
| `src/AddVehicleDialog.h` | Add `QLineEdit* m_phone` |
| `src/AddVehicleDialog.cpp` | Add Phone field to form; bind to `v.phone` |
| `src/VehicleDetailsDialog.h` | Add `QLineEdit* m_phoneEdit`; rename `onSaveMileage` → `onSave` |
| `src/VehicleDetailsDialog.cpp` | Add phone QLineEdit to form; rename button + slot; save both fields |
| `src/MainWindow.cpp` | Preserve phone on card re-scan |
