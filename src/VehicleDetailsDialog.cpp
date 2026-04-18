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
    resize(720, 540);

    QGroupBox* infoBox   = new QGroupBox("Vehicle Information");
    QFormLayout* form    = new QFormLayout(infoBox);
    form->addRow("Owner:",        new QLabel(m_vehicle.owner));
    form->addRow("Make/Model:",   new QLabel(m_vehicle.makeModel));
    form->addRow("Chassis:",      new QLabel(m_vehicle.chassisNumber));
    form->addRow("Year:",         new QLabel(m_vehicle.year));
    form->addRow("Engine (kW):",  new QLabel(m_vehicle.enginePowerKw));
    form->addRow("Transmission:", new QLabel(m_vehicle.transmission));
    form->addRow("Mileage:",      new QLabel(m_vehicle.mileage));
    form->addRow("Registration:", new QLabel(m_vehicle.registration));
    form->addRow("Color:",        new QLabel(m_vehicle.color));

    m_servicesTable = new QTableWidget(0, 5);
    m_servicesTable->setHorizontalHeaderLabels({"ID", "Type", "Description", "Price (RSD)", "Date"});
    m_servicesTable->setEditTriggers(QAbstractItemView::NoEditTriggers);
    m_servicesTable->setSelectionBehavior(QAbstractItemView::SelectRows);
    m_servicesTable->horizontalHeader()->setStretchLastSection(true);
    m_servicesTable->setColumnWidth(0, 40);
    m_servicesTable->setColumnWidth(1, 140);
    m_servicesTable->setColumnWidth(2, 200);
    m_servicesTable->setColumnWidth(3, 90);

    QGroupBox* servBox   = new QGroupBox("Service History");
    QVBoxLayout* servLay = new QVBoxLayout(servBox);
    servLay->addWidget(m_servicesTable);

    QPushButton* btnAdd   = new QPushButton("Add Service");
    QPushButton* btnPdf   = new QPushButton("Generate PDF Invoice");
    QPushButton* btnClose = new QPushButton("Close");
    QHBoxLayout* btns     = new QHBoxLayout();
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
    if (dlg.exec() == QDialog::Accepted)
        loadServices();
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
    QPushButton* btnOk  = new QPushButton("Generate");
    QPushButton* btnNo  = new QPushButton("Cancel");
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
    if (!path.isEmpty())
        QMessageBox::information(this, "PDF Saved", "Invoice saved to:\n" + path);
    else
        QMessageBox::critical(this, "Error", "Failed to generate PDF.");
}
