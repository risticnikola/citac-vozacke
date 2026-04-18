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

    int           m_vehicleId;
    VehicleData   m_vehicle;
    QTableWidget* m_servicesTable;
};
