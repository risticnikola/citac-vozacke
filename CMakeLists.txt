cmake_minimum_required(VERSION 3.20)
project(CarRepairShop VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Sql PrintSupport)

set(SDK_DIR "${CMAKE_SOURCE_DIR}/citacVozacke")

# Generate MinGW-compatible import library from the MSVC-format DLL
set(DLLTOOL "C:/Qt/Tools/mingw1310_64/bin/dlltool.exe")
set(SDK_IMPORT_LIB "${CMAKE_BINARY_DIR}/libeVehicleRegistrationAPI.a")
execute_process(
    COMMAND "${DLLTOOL}" -D "${SDK_DIR}/eVehicleRegistrationAPI.dll"
                         -l "${SDK_IMPORT_LIB}"
    RESULT_VARIABLE DLLTOOL_RESULT
)
if(NOT DLLTOOL_RESULT EQUAL 0)
    message(FATAL_ERROR "dlltool failed to generate import library")
endif()

set(SOURCES
    src/main.cpp
    src/MainWindow.cpp
    src/AddVehicleDialog.cpp
    src/VehicleDetailsDialog.cpp
    src/AddServiceDialog.cpp
    src/CardReader.cpp
    src/Database.cpp
    src/PdfGenerator.cpp
)

set(HEADERS
    src/Models.h
    src/MainWindow.h
    src/AddVehicleDialog.h
    src/VehicleDetailsDialog.h
    src/AddServiceDialog.h
    src/CardReader.h
    src/Database.h
    src/PdfGenerator.h
)

add_executable(CarRepairShop WIN32 ${SOURCES} ${HEADERS})

target_include_directories(CarRepairShop PRIVATE
    src
    ${SDK_DIR}
)

target_link_libraries(CarRepairShop PRIVATE
    Qt6::Widgets
    Qt6::Sql
    Qt6::PrintSupport
    "${SDK_IMPORT_LIB}"
)

add_custom_command(TARGET CarRepairShop POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${SDK_DIR}/eVehicleRegistrationAPI.dll"
        $<TARGET_FILE_DIR:CarRepairShop>
)
