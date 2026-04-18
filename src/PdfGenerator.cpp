#include "PdfGenerator.h"
#include <QPdfWriter>
#include <QPainter>
#include <QPageSize>
#include <QDateTime>
#include <QFont>

QString PdfGenerator::generate(const VehicleData& vehicle, const ServiceData& service) {
    QString datePart = QDateTime::currentDateTime().toString("yyyy-MM-dd");
    QString regSafe  = vehicle.registration;
    regSafe.replace(" ", "_").replace("/", "-");
    QString filename = QString("invoice_%1_%2.pdf").arg(regSafe, datePart);

    QPdfWriter writer(filename);
    writer.setPageSize(QPageSize(QPageSize::A4));
    writer.setResolution(1200);

    QPainter painter(&writer);
    if (!painter.isActive()) return {};

    QFont titleFont("Arial", 24, QFont::Bold);
    QFont sectionFont("Arial", 14, QFont::Bold);
    QFont normalFont("Arial", 12);

    int x    = 800;
    int y    = 600;
    int lineH = 260;
    int gapH  = 400;

    auto drawText = [&](const QString& text, const QFont& font) {
        painter.setFont(font);
        painter.drawText(x, y, text);
        y += lineH;
    };

    auto drawHRule = [&]() {
        painter.drawLine(x, y, 9000, y);
        y += 150;
    };

    drawText("AUTO SERVIS — RACUN ZA USLUGU", titleFont);
    drawHRule();
    y += gapH;

    drawText("VOZILO", sectionFont);
    drawHRule();
    drawText("Vlasnik:       " + vehicle.owner,         normalFont);
    drawText("Marka/Model:   " + vehicle.makeModel,     normalFont);
    drawText("Registracija:  " + vehicle.registration,  normalFont);
    drawText("Broj sasije:   " + vehicle.chassisNumber, normalFont);
    drawText("Godiste:       " + vehicle.year,          normalFont);
    y += gapH;

    drawText("USLUGA", sectionFont);
    drawHRule();
    drawText("Vrsta usluge:  " + service.serviceType,  normalFont);
    drawText("Opis:          " + service.description,  normalFont);
    drawText("Datum:         " + service.date,         normalFont);
    drawText(QString("Cena:          %1 RSD").arg(service.price, 0, 'f', 2), normalFont);
    drawHRule();

    painter.end();
    return filename;
}
