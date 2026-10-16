# Private Windows -> VPS reverse SSH gateway for five read-only MCP tools.
# Does not proxy or bypass OpenAI access controls. Neither service binds public IPs.
[CmdletBinding()]
param(
    [ValidateSet("start", "test", "stop", "status")][string]$Action = "status",
    [string]$VpsHost = "",
    [string]$VpsUser = "",
    [int]$SshPort = 22,
    [string]$HostKey = "",
    [int]$GatewayPort = 17423,
    [string]$PlinkPath = "C:\Program Files\PuTTY\plink.exe",
    [switch]$SkipRemoteUpload
)
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $env:LOCALAPPDATA "RdcWorkstationHarness\desktop-agent\mcp"
$StateDir = Join-Path $env:LOCALAPPDATA "RdcWorkstationHarness\gateway"
$TokenDir = Join-Path $env:USERPROFILE ".chatgpt-desktop-agent"
$TokenFile = Join-Path $TokenDir "vps-gateway.token"
$StateFile = Join-Path $StateDir "processes.json"
$GatewayServer = Join-Path $Runtime "readonly_gateway_server.mjs"
$PlinkArgs = @("-batch", "-agent", "-hostkey", $HostKey, "-P", "$SshPort")
if ($GatewayPort -lt 1024 -or $GatewayPort -gt 65535) { throw "Invalid port" }
function Assert-VpsOptions {
    if ($VpsHost -notmatch '^[a-zA-Z0-9.-]+$' -or $VpsUser -notmatch '^[a-zA-Z0-9_-]+$') {
        throw "Supply valid -VpsHost and -VpsUser (hostnames/IPs only)"
    }
    if ($HostKey -notmatch '^(ssh-|ecdsa-).{12,120}$') { throw "Supply a pinned -HostKey fingerprint" }
    if (-not (Test-Path -LiteralPath $PlinkPath)) { throw "plink.exe not found" }
}
function Ensure-Token {
    New-Item -ItemType Directory -Path $TokenDir, $StateDir -Force | Out-Null
    if (-not (Test-Path $TokenFile)) {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $value = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
        [IO.File]::WriteAllText($TokenFile, $value, [Text.UTF8Encoding]::new($false))
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        $acl = New-Object System.Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true, $false)
        $acl.SetOwner($identity.User)
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($identity.Name, 'FullControl', 'Allow'))
        [IO.File]::SetAccessControl($TokenFile, $acl)
    }
    if ((Get-Content -LiteralPath $TokenFile -Raw).Trim().Length -lt 32) {
        throw "Invalid gateway token"
    }
}
function Deploy-File([string]$LocalFile, [string]$RemoteName) {
    # Send bytes over pinned SSH stdin. No secrets in CLI arguments or git.
    $remote = "umask 077; mkdir -p ~/.config/rdc-workstation-harness; cat > ~/.config/rdc-workstation-harness/$RemoteName; chmod 600 ~/.config/rdc-workstation-harness/$RemoteName"
    Get-Content -LiteralPath $LocalFile -Raw | & $PlinkPath @PlinkArgs "$VpsUser@$VpsHost" $remote | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "SSH deployment failed: $RemoteName" }
}
function Read-State {
    if (-not (Test-Path $StateFile)) { return $null }
    try { return (Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json) } catch { return $null }
}
function Active([int]$Id) { return ($Id -gt 0 -and $null -ne (Get-Process -Id $Id -ErrorAction SilentlyContinue)) }
switch ($Action) {
    "start" {
        Assert-VpsOptions
        if (-not (Test-Path -LiteralPath $GatewayServer)) {
            throw "Runtime server missing. Run scripts/install.ps1 or copy MCP sources before gateway start."
        }
        Ensure-Token
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        if (-not $SkipRemoteUpload) {
            Deploy-File $TokenFile "gateway.token"
            Deploy-File (Join-Path $RepoRoot "tools\vps_gateway_stdio.mjs") "stdio.mjs"
            Deploy-File (Join-Path $RepoRoot "tools\vps_gateway_smoke.mjs") "smoke.mjs"
            Deploy-File (Join-Path $RepoRoot "tools\vps_gateway_stdio_smoke.mjs") "smoke_stdio.mjs"
        }
        $state = Read-State
        $serverId = 0
        $sshId = 0
        if ($null -ne $state) {
            if (Active ([int]$state.server_pid)) { $serverId = [int]$state.server_pid }
            if (Active ([int]$state.ssh_pid)) { $sshId = [int]$state.ssh_pid }
        }
        if (-not $serverId) {
            $env:RDC_GATEWAY_TOKEN_FILE = $TokenFile
            $env:RDC_GATEWAY_PORT = "$GatewayPort"
            $server = Start-Process -FilePath $node -ArgumentList ('"' + $GatewayServer + '"') -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $StateDir "server.stderr.log")
            $serverId = $server.Id
            Remove-Item Env:\RDC_GATEWAY_TOKEN_FILE -ErrorAction SilentlyContinue
            Remove-Item Env:\RDC_GATEWAY_PORT -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            if (-not (Active $serverId)) { throw "Gateway server exited; inspect server.stderr.log" }
        }
        if (-not $sshId) {
            $sshArguments = '-batch -agent -hostkey "' + $HostKey + '" -P ' + $SshPort + ' -N -R "127.0.0.1:' + $GatewayPort + ':127.0.0.1:' + $GatewayPort + '" ' + $VpsUser + '@' + $VpsHost
            $ssh = Start-Process -FilePath $PlinkPath -ArgumentList $sshArguments -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $StateDir "plink.stderr.log")
            $sshId = $ssh.Id
            Start-Sleep -Seconds 2
            if (-not (Active $sshId)) { throw "SSH forward exited; inspect plink.stderr.log" }
        }
        [IO.File]::WriteAllText($StateFile, (@{server_pid=$serverId; ssh_pid=$sshId; port=$GatewayPort} | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        Write-Output "GATEWAY_SERVER_RUNNING=True"
        Write-Output "GATEWAY_SSH_REVERSE_RUNNING=True"
        Write-Output "GATEWAY_BIND=127.0.0.1:$GatewayPort"
        & $PlinkPath @PlinkArgs "$VpsUser@$VpsHost" "node ~/.config/rdc-workstation-harness/smoke.mjs"
        if ($LASTEXITCODE -ne 0) { throw "VPS smoke test failed" }
        & $PlinkPath @PlinkArgs "$VpsUser@$VpsHost" "node ~/.config/rdc-workstation-harness/smoke_stdio.mjs"
        if ($LASTEXITCODE -ne 0) { throw "VPS stdio smoke test failed" }
    }
    "test" {
        Assert-VpsOptions
        & $PlinkPath @PlinkArgs "$VpsUser@$VpsHost" "node ~/.config/rdc-workstation-harness/smoke.mjs"
        if ($LASTEXITCODE -ne 0) { throw "VPS smoke test failed" }
        & $PlinkPath @PlinkArgs "$VpsUser@$VpsHost" "node ~/.config/rdc-workstation-harness/smoke_stdio.mjs"
        if ($LASTEXITCODE -ne 0) { throw "VPS stdio smoke test failed" }
    }
    "status" {
        $state = Read-State
        $serverId = if ($null -ne $state) { [int]$state.server_pid } else {0}
        $sshId = if ($null -ne $state) { [int]$state.ssh_pid } else {0}
        Write-Output ('GATEWAY_SERVER_RUNNING=' + (Active $serverId))
        Write-Output ('GATEWAY_SSH_REVERSE_RUNNING=' + (Active $sshId))
        Write-Output ('TOKEN_FILE_PRESENT=' + (Test-Path $TokenFile))
        Write-Output ('OPENAI_TUNNEL_NOT_MANAGED=True')
    }
    "stop" {
        $state = Read-State
        if ($null -ne $state) {
            foreach ($id in @([int]$state.ssh_pid, [int]$state.server_pid)) {
                $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
                if ($proc -and ($proc.Name -eq "plink.exe" -or $proc.Name -eq "node.exe")) {
                    Stop-Process -Id $id -ErrorAction SilentlyContinue
                }
            }
        }
        Remove-Item -LiteralPath $StateFile -ErrorAction SilentlyContinue
        Write-Output "GATEWAY_STOPPED=True"
    }
}