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
