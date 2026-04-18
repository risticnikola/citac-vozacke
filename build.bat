@echo off
set PATH=C:\Qt\Tools\mingw810_32\bin;%PATH%
"C:\Qt\Tools\CMake_64\bin\cmake.exe" -S . -B build ^
  -DCMAKE_PREFIX_PATH="C:/Qt/5.15.2/mingw81_32" ^
  -DCMAKE_C_COMPILER="C:/Qt/Tools/mingw810_32/bin/gcc.exe" ^
  -DCMAKE_CXX_COMPILER="C:/Qt/Tools/mingw810_32/bin/g++.exe" ^
  -G "Ninja" ^
  -DCMAKE_MAKE_PROGRAM="C:/Qt/Tools/Ninja/ninja.exe"
if errorlevel 1 goto :error
"C:\Qt\Tools\CMake_64\bin\cmake.exe" --build build
if errorlevel 1 goto :error
echo.
echo Build successful! Run: build\CarRepairShop.exe
goto :eof
:error
echo Build failed.
exit /b 1
