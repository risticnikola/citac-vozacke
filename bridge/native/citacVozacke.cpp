/*
 * citacVozacke.cpp
 *
 * Thin wrapper around eVehicleRegistrationAPI.dll.
 * Reads vehicle registration smart cards and communicates with
 * the Node.js bridge via JSON on stdin/stdout.
 *
 * Protocol (one JSON object per line, newline-terminated):
 *   Startup  → writes {"type":"ack"} when ready
 *   Commands ← {"cmd":"read_card"} | {"cmd":"get_status"} | {"cmd":"shutdown"}
 *   Responses→ {"type":"card_data",...} | {"type":"status",...} | {"type":"error",...} | {"type":"ack"}
 *
 * Compile (MSVC, from bridge/native/):
 *   cl /EHsc /std:c++17 citacVozacke.cpp /link eVehicleRegistrationAPI.lib /out:citacVozacke.exe
 */

#include <windows.h>
#include <iostream>
#include <sstream>
#include <string>
#include <cstdlib>
#include "eVehicleRegistrationAPI.h"

#pragma comment(lib, "eVehicleRegistrationAPI.lib")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static std::string jsonStr(const char* buf, long size) {
    if (!buf || size <= 0) return "null";
    std::string result;
    result.reserve(size + 4);
    result += '"';
    for (long i = 0; i < size; i++) {
        unsigned char c = (unsigned char)buf[i];
        if      (c == '"')  result += "\\\"";
        else if (c == '\\') result += "\\\\";
        else if (c == '\n') result += "\\n";
        else if (c == '\r') result += "\\r";
        else if (c == '\t') result += "\\t";
        else if (c < 32) {
            char tmp[8];
            snprintf(tmp, sizeof(tmp), "\\u%04x", c);
            result += tmp;
        } else {
            result += (char)c;
        }
    }
    result += '"';
    return result;
}

static int fieldInt(const char* buf, long size) {
    if (!buf || size <= 0) return 0;
    return std::atoi(std::string(buf, (size_t)size).c_str());
}

static void send(const std::string& json) {
    std::cout << json << "\n";
    std::cout.flush();
}

static void sendError(const std::string& msg) {
    std::ostringstream o;
    o << "{\"type\":\"error\",\"error\":" << jsonStr(msg.c_str(), (long)msg.size()) << "}";
    send(o.str());
}

// ---------------------------------------------------------------------------
// Card read
// ---------------------------------------------------------------------------

static void readCard() {
    long ret = sdProcessNewCard();
    // -2146434970 (0x80041026) means the card was already present when the reader
    // was selected — not a real error. Attempt to read the data anyway.
    if (ret != 0 && ret != -2146434970) {
        sendError("sdProcessNewCard failed: " + std::to_string(ret));
        return;
    }

    SD_DOCUMENT_DATA doc = {};
    SD_VEHICLE_DATA  veh = {};
    SD_PERSONAL_DATA per = {};

    long r1 = sdReadDocumentData(&doc);
    long r2 = sdReadVehicleData(&veh);
    long r3 = sdReadPersonalData(&per);
    fprintf(stderr, "DBG sdRead ret: doc=%ld veh=%ld per=%ld | serialSz=%ld plateSz=%ld makeSz=%ld\n",
            r1, r2, r3, doc.serialNumberSize,
            veh.registrationNumberOfVehicleSize, veh.vehicleMakeSize);
    fflush(stderr);

    // Read raw registration bytes for rawDump (file index 1)
    SD_REGISTRATION_DATA reg = {};
    std::string rawHex;
    if (sdReadRegistration(&reg, 1) == 0 && reg.registrationDataSize > 0) {
        rawHex.reserve((size_t)reg.registrationDataSize * 2);
        static const char hex[] = "0123456789abcdef";
        for (long i = 0; i < reg.registrationDataSize; i++) {
            unsigned char b = (unsigned char)reg.registrationData[i];
            rawHex += hex[b >> 4];
            rawHex += hex[b & 0xF];
        }
    }

    // cardSerial: prefer serialNumber, fall back to unambiguousNumber
    std::string serial;
    if (doc.serialNumberSize > 0)
        serial = std::string(doc.serialNumber, (size_t)doc.serialNumberSize);
    else if (doc.unambiguousNumberSize > 0)
        serial = std::string(doc.unambiguousNumber, (size_t)doc.unambiguousNumberSize);
    else
        serial = "unknown";

    int year = fieldInt(veh.yearOfProduction, veh.yearOfProductionSize);

    std::ostringstream o;
    o << "{"
      << "\"type\":\"card_data\","
      << "\"cardType\":\"vehicle_registration\","
      << "\"cardSerial\":" << jsonStr(serial.c_str(), (long)serial.size()) << ","
      << "\"rawDump\":\"" << rawHex << "\","
      << "\"parsedData\":{"
          << "\"stateIssuing\":"                << jsonStr(doc.stateIssuing,                doc.stateIssuingSize)                << ","
          << "\"competentAuthority\":"          << jsonStr(doc.competentAuthority,          doc.competentAuthoritySize)          << ","
          << "\"expiryDate\":"                  << jsonStr(doc.expiryDate,                  doc.expiryDateSize)                  << ","
          << "\"registrationDate\":"            << jsonStr(doc.issuingDate,                 doc.issuingDateSize)                 << ","
          << "\"vehicleMake\":"                 << jsonStr(veh.vehicleMake,                 veh.vehicleMakeSize)                 << ","
          << "\"commercialDescription\":"       << jsonStr(veh.commercialDescription,       veh.commercialDescriptionSize)       << ","
          << "\"vehicleIdNumber\":"             << jsonStr(veh.vehicleIDNumber,             veh.vehicleIDNumberSize)             << ","
          << "\"registrationPlateNumber\":"     << jsonStr(veh.registrationNumberOfVehicle, veh.registrationNumberOfVehicleSize) << ","
          << "\"vehicleCategory\":"             << jsonStr(veh.vehicleCategory,             veh.vehicleCategorySize)             << ","
          << "\"colourOfVehicle\":"             << jsonStr(veh.colourOfVehicle,             veh.colourOfVehicleSize)             << ","
          << "\"engineCapacity\":"              << jsonStr(veh.engineCapacity,              veh.engineCapacitySize)              << ","
          << "\"maximumNetPower\":"             << jsonStr(veh.maximumNetPower,             veh.maximumNetPowerSize)             << ","
          << "\"typeOfFuel\":"                  << jsonStr(veh.typeOfFuel,                  veh.typeOfFuelSize)                  << ","
          << "\"massInService\":"               << jsonStr(veh.vehicleMass,                 veh.vehicleMassSize)                 << ","
          << "\"numberOfAxles\":"               << jsonStr(veh.numberOfAxles,               veh.numberOfAxlesSize)               << ","
          << "\"dateOfFirstRegistration\":"     << jsonStr(veh.dateOfFirstRegistration,     veh.dateOfFirstRegistrationSize)     << ","
          << "\"yearOfProduction\":"            << (year > 0 ? std::to_string(year) : "null") << ","
          << "\"ownersSurnameOrBusinessName\":" << jsonStr(per.ownersSurnameOrBusinessName, per.ownersSurnameOrBusinessNameSize) << ","
          << "\"ownersFirstName\":"             << jsonStr(per.ownerName,                   per.ownerNameSize)                   << ","
          << "\"ownersAddress\":"               << jsonStr(per.ownerAddress,                per.ownerAddressSize)                << ","
          << "\"personalNo\":"                  << jsonStr(per.ownersPersonalNo,            per.ownersPersonalNoSize)
      << "}"
      << "}";
    send(o.str());
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

static void listReaders() {
    std::ostringstream o;
    o << "{\"type\":\"readers\",\"readers\":[";
    char name[256] = {};
    long sz = sizeof(name);
    bool first = true;
    for (long i = 0; ; i++) {
        sz = sizeof(name);
        if (GetReaderName(i, name, &sz) != 0) break;
        while (sz > 0 && name[sz - 1] == '\0') sz--;
        if (!first) o << ",";
        o << jsonStr(name, sz);
        first = false;
    }
    o << "]}";
    send(o.str());
}

int main(int argc, char* argv[]) {
    // Disable output buffering so Node reads responses immediately
    setvbuf(stdout, nullptr, _IONBF, 0);

    long ret = sdStartup(5);
    if (ret != 0) {
        sendError("sdStartup failed: " + std::to_string(ret));
        return 1;
    }

    // --list mode: enumerate readers, print JSON, exit
    if (argc > 1 && std::string(argv[1]) == "--list") {
        listReaders();
        sdCleanup();
        return 0;
    }

    // Select reader — use argv[1] if provided, otherwise first available
    char readerName[256] = {};
    long nameSize = sizeof(readerName);

    if (argc > 1) {
        strncpy_s(readerName, sizeof(readerName), argv[1], _TRUNCATE);
        nameSize = (long)strlen(readerName);
    } else {
        ret = GetReaderName(0, readerName, &nameSize);
        if (ret != 0) {
            sendError("No card reader found (GetReaderName returned " + std::to_string(ret) + ")");
            sdCleanup();
            return 1;
        }
    }

    ret = SelectReader(readerName);
    if (ret != 0) {
        sendError("SelectReader failed: " + std::to_string(ret));
        sdCleanup();
        return 1;
    }

    // Signal ready to the Node bridge
    send("{\"type\":\"ack\"}");

    std::string line;
    while (std::getline(std::cin, line)) {
        // Trim CR/LF/spaces
        while (!line.empty() && (line.back() == '\r' || line.back() == '\n' || line.back() == ' '))
            line.pop_back();
        if (line.empty()) continue;

        // Minimal cmd extraction — find "cmd":"value"
        std::string cmd;
        auto pos = line.find("\"cmd\"");
        if (pos != std::string::npos) {
            auto colon = line.find(':', pos + 5);
            auto q1    = line.find('"', colon + 1);
            auto q2    = line.find('"', q1 + 1);
            if (q1 != std::string::npos && q2 != std::string::npos)
                cmd = line.substr(q1 + 1, q2 - q1 - 1);
        }

        if (cmd == "read_card") {
            readCard();
        } else if (cmd == "get_status") {
            send("{\"type\":\"status\",\"status\":\"ready\"}");
        } else if (cmd == "shutdown") {
            send("{\"type\":\"ack\"}");
            break;
        } else {
            sendError("Unknown command: " + cmd);
        }
    }

    sdCleanup();
    return 0;
}
