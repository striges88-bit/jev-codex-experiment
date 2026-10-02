$ErrorActionPreference = 'Stop'
$taskSecretPath = Join-Path $env:LOCALAPPDATA 'JevLayerExperiment\typesafe-key.clixml'
$taskOriginalKey = $env:TYPESAFE_API_KEY
try {
    if (Test-Path -LiteralPath $taskSecretPath) {
        $taskCredential = Import-Clixml -LiteralPath $taskSecretPath
        if ($taskCredential -isnot [System.Management.Automation.PSCredential]) { throw 'Invalid encrypted key file' }
        $env:TYPESAFE_API_KEY = $taskCredential.GetNetworkCredential().Password
    }
    & 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'mcp.mjs')
    $taskExitCode = $LASTEXITCODE
} catch {
    # Do not propagate raw credential or runtime diagnostics through the launcher.
    [Console]::Error.WriteLine('Jev launcher unavailable')
    $taskExitCode = 1
} finally {
    $env:TYPESAFE_API_KEY = $taskOriginalKey
    $taskCredential = $null
}
exit $taskExitCode
