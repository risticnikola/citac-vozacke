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
