# Windows twin of check-cpp-package.sh: build the C++ agent with vcpkg's
# libcurl/OpenSSL/nlohmann-json, run its tests, install it to a throwaway
# prefix, then build a consumer that knows only find_package() against it.
#
#   .\tools\check-cpp-package.ps1 [-VcpkgRoot C:\vcpkg] [-Cmake <path to cmake.exe>]
#
# cmake defaults to the copy Visual Studio 2022 ships when none is on PATH.
param(
    [string]$VcpkgRoot = $(if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { 'C:\vcpkg' }),
    [string]$Cmake = '',
    [string]$Triplet = 'x64-windows'
)
$ErrorActionPreference = 'Stop'

function Find-Cmake {
    if ($Cmake) { return $Cmake }
    $onPath = Get-Command cmake.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $candidates = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio\2022\*\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe' -ErrorAction SilentlyContinue
    if (-not $candidates) { throw 'cmake.exe not found: install CMake or the Visual Studio C++ workload' }
    return $candidates[0].FullName
}

function Invoke-Step {
    param([string[]]$Command)
    Write-Host ('> ' + ($Command -join ' '))
    & $Command[0] $Command[1..($Command.Length - 1)]
    if ($LASTEXITCODE -ne 0) { throw "failed (exit $LASTEXITCODE): $($Command -join ' ')" }
}

$root = Split-Path -Parent $PSScriptRoot
$agent = Join-Path $root 'agents\cpp-agent'
# The secret the consumer must print; see agents/cpp-agent/tests/security_vectors_test.cpp.
$expectedSecret = 'channel_Ck3KugJN7TGNR7R5wy5fhW7cB0K6b90sGaJJdonFK6A'
$cmakeExe = Find-Cmake
$toolchain = Join-Path $VcpkgRoot 'scripts\buildsystems\vcpkg.cmake'
if (-not (Test-Path $toolchain)) { throw "vcpkg toolchain not found at $toolchain" }
$vcpkgBin = Join-Path $VcpkgRoot "installed\$Triplet\bin"

$work = Join-Path ([IO.Path]::GetTempPath()) ('hmdev-cpp-release-' + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $build = Join-Path $work 'build'; $prefix = Join-Path $work 'prefix'; $consumer = Join-Path $work 'consumer'
    $common = @("-DCMAKE_TOOLCHAIN_FILE=$toolchain", "-DVCPKG_TARGET_TRIPLET=$Triplet")

    Invoke-Step (@($cmakeExe, '-S', $agent, '-B', $build, '-DBUILD_TESTS=ON', '-DBUILD_EXAMPLES=OFF') + $common)
    Invoke-Step @($cmakeExe, '--build', $build, '--config', 'Release')
    # The test exe sits in tests\Release, the DLL it needs in Release.
    $env:PATH = "$build\Release;$vcpkgBin;$env:PATH"
    Invoke-Step @("$(Split-Path $cmakeExe)\ctest.exe", '--test-dir', $build, '-C', 'Release', '--output-on-failure')
    Invoke-Step @($cmakeExe, '--install', $build, '--config', 'Release', '--prefix', $prefix)

    if (-not (Test-Path "$prefix\include\hmdev\messaging\webrtc\webrtc_signaling.h")) {
        throw 'installed headers lost their directory layout'
    }

    Invoke-Step (@($cmakeExe, '-S', "$agent\consumer", '-B', $consumer, "-DCMAKE_PREFIX_PATH=$prefix") + $common)
    Invoke-Step @($cmakeExe, '--build', $consumer, '--config', 'Release')

    $env:PATH = "$prefix\bin;$env:PATH"
    $exe = (Get-ChildItem -Path $consumer -Recurse -Filter 'messaging_consumer.exe' | Select-Object -First 1).FullName
    $actual = (& $exe | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "consumer exited $LASTEXITCODE" }
    if ($actual -ne $expectedSecret) { throw "consumer printed '$actual', expected '$expectedSecret'" }
    Write-Host "CPP PACKAGE CHECK PASSED: build, ctest, install and find_package consumer printed $actual"
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
