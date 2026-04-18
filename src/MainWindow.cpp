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
    setWindowTitle("Auto Servis — Vehicle Management");
    resize(960, 600);

    m_btnReadCard   = new QPushButton("Read Card");
    m_btnAddVehicle = new QPushButton("Add Vehicle");
    m_search        = new QLineEdit();
    m_search->setPlaceholderText("Search by make/model, chassis number, or registration...");

    QHBoxLayout* topBar = new QHBoxLayout();
    topBar->addWidget(m_btnReadCard);
    topBar->addWidget(m_btnAddVehicle);
    topBar->addWidget(m_search, 1);

    m_table = new QTableWidget(0, 6);
    m_table->setHorizontalHeaderLabels({"ID", "Owner", "Make/Model", "Chassis", "Registration", "Year"});
    m_table->setSelectionBehavior(QAbstractItemView::SelectRows);
    m_table->setEditTriggers(QAbstractItemView::NoEditTriggers);
    m_table->horizontalHeader()->setStretchLastSection(true);
    m_table->setColumnWidth(0, 40);
    m_table->setColumnWidth(1, 160);
    m_table->setColumnWidth(2, 180);
    m_table->setColumnWidth(3, 160);
    m_table->setColumnWidth(4, 110);

    QWidget*     central = new QWidget(this);
    QVBoxLayout* layout  = new QVBoxLayout(central);
    layout->addLayout(topBar);
    layout->addWidget(m_table);
    setCentralWidget(central);

    connect(m_btnReadCard,   &QPushButton::clicked,           this, &MainWindow::onReadCard);
    connect(m_btnAddVehicle, &QPushButton::clicked,           this, &MainWindow::onAddVehicle);
    connect(m_search,        &QLineEdit::textChanged,         this, &MainWindow::onSearchChanged);
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
        QMessageBox::critical(this, "Error",
            "Failed to initialize card reader.\nCheck that it is connected.");
        return;
    }
    VehicleData data;
    if (!m_cardReader.readCard(data)) {
        QMessageBox::critical(this, "Error",
            "Failed to read card.\nEnsure the card is properly inserted.");
        m_cardReader.cleanup();
        return;
    }
    m_cardReader.cleanup();
    handleCardData(data);
}

void MainWindow::handleCardData(const VehicleData& data) {
    if (data.chassisNumber.isEmpty()) {
        QMessageBox::warning(this, "Warning",
            "Card has no chassis number — vehicle not saved.");
        return;
    }

    auto& db = Database::instance();
    if (db.vehicleExistsByChassisNumber(data.chassisNumber)) {
        int choice = QMessageBox::question(this, "Vehicle Exists",
            QString("A vehicle with chassis %1 already exists.\nUpdate it?")
                .arg(data.chassisNumber),
            QMessageBox::Yes | QMessageBox::No);
        if (choice == QMessageBox::Yes) {
            int id = db.vehicleIdByChassisNumber(data.chassisNumber);
            VehicleData toUpdate = data;
            if (toUpdate.mileage.isEmpty()) {
                VehicleData existing = db.vehicleById(id);
                toUpdate.mileage = existing.mileage;
            }
            if (!db.updateVehicle(id, toUpdate)) {
                QMessageBox::critical(this, "Error", "Failed to update vehicle record.");
                return;
            }
            QMessageBox::information(this, "Updated", "Vehicle record updated.");
        }
    } else {
        if (db.insertVehicle(data) < 0) {
            QMessageBox::critical(this, "Error", "Failed to save vehicle to database.");
            return;
        }
        QMessageBox::information(this, "Saved", "Vehicle added successfully.");
    }
    loadVehicles(m_search->text());
}

void MainWindow::onAddVehicle() {
    AddVehicleDialog dlg(this);
    if (dlg.exec() == QDialog::Accepted)
        loadVehicles(m_search->text());
}

void MainWindow::onSearchChanged(const QString& text) {
    loadVehicles(text);
}

void MainWindow::onTableRowDoubleClicked(int row, int) {
    QTableWidgetItem* idItem = m_table->item(row, 0);
    if (!idItem) return;
    bool ok = false;
    int vehicleId = idItem->text().toInt(&ok);
    if (!ok || vehicleId <= 0) return;
    VehicleDetailsDialog dlg(vehicleId, this);
    dlg.exec();
    loadVehicles(m_search->text());
}
