#pragma once
#include "Models.h"

class CardReader {
public:
    bool init();
    bool readCard(VehicleData& outData);
    void cleanup();

private:
    bool m_initialized = false;
    bool selectFirstReader();
};
