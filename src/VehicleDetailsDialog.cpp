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
