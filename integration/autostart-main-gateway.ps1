param([Parameter(Mandatory=$true)][ValidateSet('Install','Remove','Status')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$SettingsPath)
$ErrorActionPreference = 'Stop'
$taskName = 'JEV-LAYER-MainGateway'
$taskDescription = 'JEV-LAYER owned main-context gateway; loopback only; current user; no provider retries'
$taskSettingsFull = (Resolve-Path -LiteralPath $SettingsPath).Path
$taskLauncher = Join-Path $PSScriptRoot 'start-main-gateway.ps1'
$taskPowerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$taskUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -SettingsPath "{1}" -WaitForExit' -f $taskLauncher,$taskSettingsFull
$taskExisting = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($taskExisting) {
    $taskAction = @($taskExisting.Actions)
    $taskExistingSid = try {
        [Security.Principal.SecurityIdentifier]::new($taskExisting.Principal.UserId).Value
    } catch {
        ([Security.Principal.NTAccount]::new($taskExisting.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    if ($taskExisting.Description -ne $taskDescription -or $taskAction.Count -ne 1 -or
        $taskAction[0].Execute -ne $taskPowerShell -or $taskAction[0].Arguments -ne $taskArguments -or
        $taskExistingSid -ne $taskUserSid -or $taskExisting.Principal.RunLevel -ne 'Limited' -or
        $taskExisting.Principal.LogonType -ne 'Interactive') {
        throw 'Existing task ownership differs; refusing to replace or remove it'
    }
}
if ($Mode -eq 'Install') {
    if (-not $taskExisting) {
        $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUserSid
        $taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskUserSid -LogonType Interactive -RunLevel Limited
        $taskAction = New-ScheduledTaskAction -Execute $taskPowerShell -Argument $taskArguments -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
        $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Description $taskDescription -Trigger $taskTrigger -Principal $taskPrincipal -Action $taskAction -Settings $taskSettings | Out-Null
    }
    [Console]::WriteLine('Owned logon task installed; start it after checking the current listener')
} elseif ($Mode -eq 'Remove') {
    if ($taskExisting) { Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false }
    [Console]::WriteLine('Owned logon task removed; existing gateway process unchanged')
} else {
    [Console]::WriteLine($(if ($taskExisting) {'Owned logon task present'} else {'Owned logon task absent'}))
}
