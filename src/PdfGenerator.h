#pragma once
#include "Models.h"
#include <QString>

class PdfGenerator {
public:
    // Returns saved file path, or empty string on failure.
    QString generate(const VehicleData& vehicle, const ServiceData& service);
};
