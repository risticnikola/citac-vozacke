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
