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
