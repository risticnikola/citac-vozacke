#include <iostream>
#include <string>
#include <sstream>
#include "eVehicleRegistrationAPI.h"
#include <windows.h>

#pragma comment(lib, "eVehicleRegistrationAPI.lib")

// ── helpers ──────────────────────────────────────────────────────────────────

static std::string field(const char* data, long size) {
    if (size <= 0) return "";
    return std::string(data, (size_t)size);
}

static std::string toHex(const char* data, long size) {
    static const char hex[] = "0123456789abcdef";
    std::string out;
    out.reserve((size_t)size * 2);
    for (long i = 0; i < size; i++) {
        unsigned char b = (unsigned char)data[i];
        out += hex[b >> 4];
        out += hex[b & 0x0f];
    }
    return out;
}

static std::string jsonStr(const std::string& s) {
    std::string out = "\"";
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:   out += c;
        }
    }
    out += "\"";
    return out;
}

// Extract a quoted string value for a key from a flat JSON line.
// Good enough for the simple commands the bridge sends.
static std::string extractValue(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos = json.find(':', pos + search.size());
    if (pos == std::string::npos) return "";
    pos = json.find('"', pos + 1);
    if (pos == std::string::npos) return "";
    size_t end = json.find('"', pos + 1);
    if (end == std::string::npos) return "";
    return json.substr(pos + 1, end - pos - 1);
}

static void emit(const std::string& json) {
    std::cout << json << "\n";
    std::cout.flush();
}

static void emitError(const std::string& msg) {
    emit("{\"type\":\"error\",\"error\":" + jsonStr(msg) + "}");
}

// ── card read ─────────────────────────────────────────────────────────────────

static void handleReadCard(const std::string& readerOverride, const std::string& defaultReader) {
    const std::string& reader = readerOverride.empty() ? defaultReader : readerOverride;

    if (!reader.empty()) {
        std::string rn = reader;
        long r = SelectReader(const_cast<char*>(rn.c_str()));
        if (r != S_OK) {
            emitError("SelectReader failed: " + std::to_string(r));
            return;
        }
    }

    long r = sdProcessNewCard();
    if (r != S_OK) {
        emitError("sdProcessNewCard failed: " + std::to_string(r));
        return;
    }

    SD_REGISTRATION_DATA reg{};
    SD_DOCUMENT_DATA     doc{};
    SD_VEHICLE_DATA      veh{};
    SD_PERSONAL_DATA     per{};

    sdReadRegistration(&reg, 1);
    sdReadDocumentData(&doc);
    sdReadVehicleData(&veh);
    sdReadPersonalData(&per);

    std::ostringstream pd;
    pd << "{"
       << "\"stateIssuing\":"       << jsonStr(field(doc.stateIssuing,       doc.stateIssuingSize))       << ","
       << "\"competentAuthority\":" << jsonStr(field(doc.competentAuthority, doc.competentAuthoritySize)) << ","
       << "\"issuingDate\":"        << jsonStr(field(doc.issuingDate,        doc.issuingDateSize))        << ","
       << "\"expiryDate\":"         << jsonStr(field(doc.expiryDate,         doc.expiryDateSize))         << ","
       << "\"vin\":"                << jsonStr(field(veh.vehicleIDNumber,    veh.vehicleIDNumberSize))    << ","
       << "\"plate\":"              << jsonStr(field(veh.registrationNumberOfVehicle, veh.registrationNumberOfVehicleSize)) << ","
       << "\"make\":"               << jsonStr(field(veh.vehicleMake,        veh.vehicleMakeSize))        << ","
       << "\"model\":"              << jsonStr(field(veh.commercialDescription, veh.commercialDescriptionSize)) << ","
       << "\"year\":"               << jsonStr(field(veh.yearOfProduction,   veh.yearOfProductionSize))   << ","
       << "\"category\":"           << jsonStr(field(veh.vehicleCategory,    veh.vehicleCategorySize))    << ","
       << "\"engineCapacity\":"     << jsonStr(field(veh.engineCapacity,     veh.engineCapacitySize))     << ","
       << "\"maxNetPower\":"        << jsonStr(field(veh.maximumNetPower,    veh.maximumNetPowerSize))    << ","
       << "\"fuelType\":"           << jsonStr(field(veh.typeOfFuel,         veh.typeOfFuelSize))         << ","
       << "\"mass\":"               << jsonStr(field(veh.vehicleMass,        veh.vehicleMassSize))        << ","
       << "\"colour\":"             << jsonStr(field(veh.colourOfVehicle,    veh.colourOfVehicleSize))    << ","
       << "\"ownerName\":"          << jsonStr(field(per.ownerName,          per.ownerNameSize))          << ","
       << "\"ownerSurname\":"       << jsonStr(field(per.ownersSurnameOrBusinessName, per.ownersSurnameOrBusinessNameSize)) << ","
       << "\"ownerAddress\":"       << jsonStr(field(per.ownerAddress,       per.ownerAddressSize))       << ","
       << "\"ownerPersonalNo\":"    << jsonStr(field(per.ownersPersonalNo,   per.ownersPersonalNoSize))
       << "}";

    std::ostringstream out;
    out << "{"
        << "\"type\":\"card_data\","
        << "\"cardType\":\"vehicle_registration\","
        << "\"cardSerial\":" << jsonStr(field(doc.serialNumber, doc.serialNumberSize)) << ","
        << "\"rawDump\":"    << jsonStr(toHex(reg.registrationData, reg.registrationDataSize)) << ","
        << "\"parsedData\":" << pd.str()
        << "}";

    emit(out.str());
}

// ── main ──────────────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    // Prevent SDK noise from polluting the JSON stdout stream
    freopen("NUL", "w", stderr);

    std::string defaultReader;
    for (int i = 1; i + 1 < argc; i++) {
        if (std::string(argv[i]) == "--reader") {
            defaultReader = argv[i + 1];
        }
    }

    long r = sdStartup(0);
    if (r != S_OK) {
        emitError("sdStartup failed: " + std::to_string(r));
        return 1;
    }

    // Auto-detect first available reader if none specified
    if (defaultReader.empty()) {
        char buf[256];
        long sz = sizeof(buf);
        if (GetReaderName(0, buf, &sz) == S_OK) {
            defaultReader = std::string(buf, sz);
        }
    }

    if (!defaultReader.empty()) {
        r = SelectReader(const_cast<char*>(defaultReader.c_str()));
        if (r != S_OK) {
            emitError("SelectReader failed: " + std::to_string(r));
            sdCleanup();
            return 1;
        }
    }

    emit("{\"type\":\"ack\",\"status\":\"ready\"}");

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        std::string cmd = extractValue(line, "cmd");

        if (cmd == "read_card") {
            handleReadCard(extractValue(line, "port"), defaultReader);
        } else if (cmd == "get_status") {
            emit("{\"type\":\"status\",\"status\":\"ready\"}");
        } else if (cmd == "shutdown") {
            emit("{\"type\":\"ack\",\"status\":\"shutdown\"}");
            break;
        } else {
            emitError("Unknown command: " + cmd);
        }
    }

    sdCleanup();
    return 0;
}
