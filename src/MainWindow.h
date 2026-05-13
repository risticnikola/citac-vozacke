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
