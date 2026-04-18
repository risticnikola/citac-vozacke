cmake_minimum_required(VERSION 3.20)
project(CarRepairShop VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(Qt5 REQUIRED COMPONENTS Widgets Sql PrintSupport)

set(SDK_DIR "${CMAKE_SOURCE_DIR}/citacVozacke")

# Generate MinGW-compatible import library from the 32-bit MSVC DLL
# Requires two steps: gendef extracts exports, then dlltool builds the .a
set(GENDEF  "C:/Qt/Tools/mingw810_32/bin/gendef.exe")
set(DLLTOOL "C:/Qt/Tools/mingw810_32/bin/dlltool.exe")
set(SDK_DEF        "${CMAKE_BINARY_DIR}/eVehicleRegistrationAPI.def")
set(SDK_IMPORT_LIB "${CMAKE_BINARY_DIR}/libeVehicleRegistrationAPI.a")

if(NOT EXISTS "${SDK_IMPORT_LIB}")
    execute_process(
        COMMAND "${GENDEF}" - "${SDK_DIR}/eVehicleRegistrationAPI.dll"
        OUTPUT_FILE "${SDK_DEF}"
        RESULT_VARIABLE GENDEF_RESULT
    )
    if(NOT GENDEF_RESULT EQUAL 0)
        message(FATAL_ERROR "gendef failed to extract DLL exports")
    endif()
    execute_process(
        COMMAND "${DLLTOOL}" -D "eVehicleRegistrationAPI.dll"
                             -d "${SDK_DEF}"
                             -l "${SDK_IMPORT_LIB}"
        RESULT_VARIABLE DLLTOOL_RESULT
    )
    if(NOT DLLTOOL_RESULT EQUAL 0)
        message(FATAL_ERROR "dlltool failed to generate import library")
    endif()
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
    Qt5::Widgets
    Qt5::Sql
    Qt5::PrintSupport
    "${SDK_IMPORT_LIB}"
)

add_custom_command(TARGET CarRepairShop POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${SDK_DIR}/eVehicleRegistrationAPI.dll"
        $<TARGET_FILE_DIR:CarRepairShop>
)

find_program(WINDEPLOYQT windeployqt
    HINTS "C:/Qt/5.15.2/mingw81_32/bin")
if(WINDEPLOYQT)
    add_custom_command(TARGET CarRepairShop POST_BUILD
        COMMAND "${WINDEPLOYQT}"
            --no-translations --no-system-d3d-compiler --no-opengl-sw
            $<TARGET_FILE:CarRepairShop>
        WORKING_DIRECTORY $<TARGET_FILE_DIR:CarRepairShop>
    )
endif()
