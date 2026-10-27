$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Este script precisa de permissao de administrador para liberar a porta 4173 no Firewall." -ForegroundColor Yellow
    Write-Host "Abra o PowerShell como administrador e execute novamente este script."
    exit 1
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$ruleName = 'Menuza servidor local TCP 4173'
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existingRule) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4173 -Profile Private | Out-Null
    Write-Host "Regra de Firewall criada para a porta TCP 4173." -ForegroundColor Green
} else {
    Write-Host "A regra de Firewall do Menuza ja existe." -ForegroundColor Green
}

$ipv4 = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi' -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1 -ExpandProperty IPAddress

if ($ipv4) {
    Write-Host ""
    Write-Host "No celular, conectado ao mesmo Wi-Fi, abra: http://$($ipv4):4173" -ForegroundColor Cyan
} else {
    Write-Host "Nao consegui detectar o IP do Wi-Fi automaticamente. Confira com ipconfig." -ForegroundColor Yellow
}

Write-Host "Iniciando o servidor Menuza. Mantenha esta janela aberta." -ForegroundColor Cyan
npm start
