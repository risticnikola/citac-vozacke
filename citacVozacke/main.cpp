#define HPDF_DLL
#include <iostream>
#include <string>
#include "eVehicleRegistrationAPI.h"
extern "C" {
    #include <hpdf.h>
}
#include <windows.h>

#pragma comment(lib, "eVehicleRegistrationAPI.lib")
#pragma comment(lib, "hpdf.lib")

std::string toString(const char* data, long size) {
    return std::string(data, size);
}

void createPDF(
    const SD_DOCUMENT_DATA& doc,
    const SD_VEHICLE_DATA& vehicle,
    const SD_PERSONAL_DATA& person
) {
    HPDF_Doc pdf = HPDF_New(NULL, NULL);
    if (!pdf) {
        std::cout << "Failed to create PDF\n";
        return;
    }

    HPDF_Page page = HPDF_AddPage(pdf);
    HPDF_Page_SetSize(page, HPDF_PAGE_SIZE_A4, HPDF_PAGE_PORTRAIT);

    HPDF_Font font = HPDF_GetFont(pdf, "Helvetica", NULL);
    HPDF_Page_SetFontAndSize(page, font, 12);

    float y = 800;

    auto printLine = [&](std::string text) {
        HPDF_Page_BeginText(page);
        HPDF_Page_TextOut(page, 50, y, text.c_str());
        HPDF_Page_EndText(page);
        y -= 20;
        };

    printLine("=== VEHICLE DATA ===");

    printLine("VIN: " + toString(vehicle.vehicleIDNumber, vehicle.vehicleIDNumberSize));
    printLine("Registration: " + toString(vehicle.registrationNumberOfVehicle, vehicle.registrationNumberOfVehicleSize));
    printLine("Make: " + toString(vehicle.vehicleMake, vehicle.vehicleMakeSize));
    printLine("Model: " + toString(vehicle.commercialDescription, vehicle.commercialDescriptionSize));
    printLine("Year: " + toString(vehicle.yearOfProduction, vehicle.yearOfProductionSize));

    printLine("");
    printLine("=== OWNER ===");

    printLine("Name: " + toString(person.ownerName, person.ownerNameSize));
    printLine("Surname: " + toString(person.ownersSurnameOrBusinessName, person.ownersSurnameOrBusinessNameSize));
    printLine("Address: " + toString(person.ownerAddress, person.ownerAddressSize));

    printLine("");
    printLine("=== DOCUMENT ===");

    printLine("Issuing State: " + toString(doc.stateIssuing, doc.stateIssuingSize));
    printLine("Expiry: " + toString(doc.expiryDate, doc.expiryDateSize));
    printLine("Serial: " + toString(doc.serialNumber, doc.serialNumberSize));

    HPDF_SaveToFile(pdf, "vehicle_report.pdf");
    HPDF_Free(pdf);

    std::cout << "PDF generated: vehicle_report.pdf\n";
}

int main() {
    long result;

    // 1. Init SDK
    result = sdStartup(0);
    if (result != S_OK) {
        std::cout << "Startup failed: " << result << "\n";
        return 1;
    }

    // 2. Get first reader
    char readerName[256];
    long readerSize = sizeof(readerName);

    result = GetReaderName(0, readerName, &readerSize);
    if (result != S_OK) {
        std::cout << "No reader found: " << result << "\n";
        sdCleanup();
        return 1;
    }

    std::cout << "Using reader: " << readerName << "\n";

    // 3. Select reader
    result = SelectReader(readerName);
    if (result != S_OK) {
        std::cout << "SelectReader failed\n";
        sdCleanup();
        return 1;
    }

    std::cout << "Insert card...\n";
    system("pause");

    // 4. Process card
    result = sdProcessNewCard();
    if (result != S_OK) {
        std::cout << "Card read failed: " << result << "\n";
        sdCleanup();
        return 1;
    }

    // 5. Read data
    SD_DOCUMENT_DATA doc{};
    SD_VEHICLE_DATA vehicle{};
    SD_PERSONAL_DATA person{};

    sdReadDocumentData(&doc);
    sdReadVehicleData(&vehicle);
    sdReadPersonalData(&person);

    // 6. Print to console
    std::cout << "VIN: " << toString(vehicle.vehicleIDNumber, vehicle.vehicleIDNumberSize) << "\n";
    std::cout << "Registration: " << toString(vehicle.registrationNumberOfVehicle, vehicle.registrationNumberOfVehicleSize) << "\n";

    // 7. Create PDF
    createPDF(doc, vehicle, person);

    // 8. Cleanup
    sdCleanup();

    return 0;
}