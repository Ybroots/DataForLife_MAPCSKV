param([switch]$Qa, [switch]$Release, [int]$VersionCode = 1, [string]$VersionName = '1.0.0-preview')
$ErrorActionPreference = 'Stop'
$webRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$platformRoot = [IO.Path]::GetFullPath((Join-Path $webRoot '..'))
$nativeRoot = Join-Path $webRoot 'android-native'
$previousJava = $env:JAVA_HOME
$previousSdk = $env:ANDROID_HOME
$previousApi = $env:VITE_API_BASE_URL
$previousPush = $env:VITE_PUSH_ENABLED
$previousLocation = Get-Location
try {
    if ($Qa -and $Release) { throw 'The emulator QA build (cleartext fixture API) must never be a release build.' }
    if ($Release -and -not (Test-Path -LiteralPath (Join-Path $nativeRoot 'keystore.properties'))) { throw 'Release needs android-native\keystore.properties (owner-managed signing key). See platform\docs\android-release.md.' }
    if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr' }
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
    if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw 'JDK missing. Set JAVA_HOME.' }
    if (-not (Test-Path -LiteralPath $env:ANDROID_HOME)) { throw 'Android SDK missing. Set ANDROID_HOME.' }
    # Never inherit a local browser API override into an APK intended for citizens.
    $env:VITE_API_BASE_URL = if ($Qa) { 'http://10.0.2.2:3001' } else { 'https://bandosocskv.com/api' }
    # Push notifications are enabled only when the project has its Firebase config. Without the file the app still
    # works and the notification entry shows "in development" (the plugin is never called). See docs\push-notifications.md.
    $hasFirebase = Test-Path -LiteralPath (Join-Path $nativeRoot 'app\google-services.json')
    $env:VITE_PUSH_ENABLED = if ($hasFirebase -and -not $Qa) { 'true' } else { 'false' }
    Write-Host ("Thong bao day (FCM): " + $(if ($env:VITE_PUSH_ENABLED -eq 'true') { 'BAT' } else { 'TAT - thieu android-native\app\google-services.json' }))
    Set-Location $webRoot
    $buildTask = if ($Qa) { 'build:android:qa' } else { 'build:android' }
    & npm.cmd run $buildTask
    if ($LASTEXITCODE -ne 0) { throw 'Android web build failed.' }
    & npm.cmd exec -- cap sync android
    if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
    Set-Location $nativeRoot
    $output = Join-Path $platformRoot 'android-artifacts'
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    if ($Release) {
        & .\gradlew.bat assembleRelease bundleRelease "-PcskvVersionCode=$VersionCode" "-PcskvVersionName=$VersionName" --no-daemon --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Gradle release build failed.' }
        $artifacts = @(
            @{ From = 'app\build\outputs\apk\release\app-release.apk'; To = "ban-do-cskv-$VersionName-$VersionCode.apk" },
            @{ From = 'app\build\outputs\bundle\release\app-release.aab'; To = "ban-do-cskv-$VersionName-$VersionCode.aab" }
        )
    } else {
        & .\gradlew.bat assembleDebug --no-daemon --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed.' }
        $name = if ($Qa) { 'ban-do-cskv-emulator-qa.apk' } else { 'ban-do-cskv-preview.apk' }
        $artifacts = @( @{ From = 'app\build\outputs\apk\debug\app-debug.apk'; To = $name } )
    }
    foreach ($item in $artifacts) {
        $artifact = Join-Path $output $item.To
        Copy-Item -LiteralPath (Join-Path $nativeRoot $item.From) -Destination $artifact
        Get-Item -LiteralPath $artifact | Select-Object FullName,Length
        Get-FileHash -LiteralPath $artifact -Algorithm SHA256
    }
} finally {
    Set-Location $previousLocation
    $env:JAVA_HOME = $previousJava
    $env:ANDROID_HOME = $previousSdk
    $env:VITE_API_BASE_URL = $previousApi
    $env:VITE_PUSH_ENABLED = $previousPush
}
