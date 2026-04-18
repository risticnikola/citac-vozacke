#include <QApplication>
#include <QMessageBox>
#include "Database.h"
#include "MainWindow.h"

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);
    app.setApplicationName("Auto Servis");
    app.setOrganizationName("AutoServis");

    if (!Database::instance().init("vehicles.db")) {
        QMessageBox::critical(nullptr, "Database Error",
            "Cannot open vehicles.db. Application will exit.");
        return 1;
    }

    MainWindow window;
    window.show();

    return app.exec();
}
