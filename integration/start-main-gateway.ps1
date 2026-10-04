param([Parameter(Mandatory=$true)][string]$SettingsPath, [switch]$WaitForExit)
$ErrorActionPreference = 'Stop'
$taskSettingsFull = (Resolve-Path -LiteralPath $SettingsPath).Path
$taskStateDir = Split-Path -Parent $taskSettingsFull
$taskGatewayScript = Join-Path $PSScriptRoot 'main-gateway.mjs'
$taskNodePath = 'C:\Program Files\nodejs\node.exe'
$taskPidPath = Join-Path $taskStateDir 'gateway.pid'
if (Test-Path -LiteralPath $taskPidPath) {
    $taskPriorPid = [int](Get-Content -LiteralPath $taskPidPath -Raw)
    $taskPriorProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskPriorPid"
    if ($taskPriorProcess) {
        if ($taskPriorProcess.Name -ne 'node.exe' -or -not $taskPriorProcess.CommandLine.Contains($taskGatewayScript) -or -not $taskPriorProcess.CommandLine.Contains($taskSettingsFull)) { throw 'Prior PID is owned by another process' }
        [Console]::WriteLine('Owned gateway process already running; no second process started')
        exit 0
    }
}
if ($WaitForExit) {
    # Own the native process handle so a failing child cannot become task exit0.
    $taskStartInfo = [Diagnostics.ProcessStartInfo]::new()
    $taskStartInfo.FileName = $taskNodePath
    $taskStartInfo.Arguments = '"{0}" "{1}"' -f $taskGatewayScript,$taskSettingsFull
    $taskStartInfo.UseShellExecute = $false
    $taskStartInfo.CreateNoWindow = $true
    $taskStartInfo.RedirectStandardOutput = $true
    $taskStartInfo.RedirectStandardError = $true
    $taskProcess = [Diagnostics.Process]::new()
    $taskProcess.StartInfo = $taskStartInfo
    $null = $taskProcess.Start()
    $taskStdout = $taskProcess.StandardOutput.ReadToEndAsync()
    $taskStderr = $taskProcess.StandardError.ReadToEndAsync()
} else {
    $taskProcess = Start-Process -FilePath $taskNodePath -ArgumentList @(('"{0}"' -f $taskGatewayScript), ('"{0}"' -f $taskSettingsFull)) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskStateDir 'gateway-stdout.log') -RedirectStandardError (Join-Path $taskStateDir 'gateway-stderr.log')
}
[IO.File]::WriteAllText($taskPidPath, [string]$taskProcess.Id)
[Console]::WriteLine('Gateway process started; verify listener before changing Desktop routing')
if ($WaitForExit) {
    $taskProcess.WaitForExit()
    [IO.File]::WriteAllText((Join-Path $taskStateDir 'gateway-stdout.log'),$taskStdout.GetAwaiter().GetResult())
    [IO.File]::WriteAllText((Join-Path $taskStateDir 'gateway-stderr.log'),$taskStderr.GetAwaiter().GetResult())
    $taskExitCode = $taskProcess.ExitCode
    $taskProcess.Dispose()
    exit $taskExitCode
}
