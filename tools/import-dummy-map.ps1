param(
    [string]$InputPath = "G:\dnfsifu\假人\Config\地图.json",
    [string]$OutputPath = ".\auction_dummy_spawn_zone_import.sql"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $InputPath)) {
    throw "map config not found: $InputPath"
}

function Escape-Sql([string]$s) {
    if ($null -eq $s) { return "" }
    return $s.Replace("\", "\\").Replace("'", "''")
}

$json = Get-Content -Raw -LiteralPath $InputPath -Encoding UTF8
$maps = $json | ConvertFrom-Json

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("USE frida;")
$lines.Add("START TRANSACTION;")
$lines.Add("CREATE TABLE IF NOT EXISTS auction_dummy_spawn_zone (id int AUTO_INCREMENT PRIMARY KEY, village int NOT NULL, area int NOT NULL, name varchar(64) DEFAULT NULL, min_level int NOT NULL DEFAULT 0, x_min int NOT NULL, x_max int NOT NULL, y_min int NOT NULL, y_max int NOT NULL, weight int NOT NULL DEFAULT 100, enabled tinyint NOT NULL DEFAULT 1, source varchar(32) DEFAULT 'dummy_map', updated_at datetime DEFAULT NULL, UNIQUE KEY uniq_zone (village, area), KEY idx_enabled_level (enabled, min_level)) ENGINE=InnoDB DEFAULT CHARSET=utf8;")

$count = 0
$enabled = 0
foreach ($map in $maps) {
    $village = [int]$map.VillID
    $area = [int]$map.aID
    $name = Escape-Sql ([string]$map.Name)
    $minLevel = [int]$map.Level
    $isEnabled = if ([bool]$map.IsUse) { 1 } else { 0 }
    $xMin = [int]$map.XMin
    $xMax = [int]$map.XMax
    $yMin = [int]$map.YMin
    $yMax = [int]$map.YMax

    if ($xMax -lt $xMin) {
        $tmp = $xMin
        $xMin = $xMax
        $xMax = $tmp
    }
    if ($yMax -lt $yMin) {
        $tmp = $yMin
        $yMin = $yMax
        $yMax = $tmp
    }

    $lines.Add("INSERT INTO auction_dummy_spawn_zone (village, area, name, min_level, x_min, x_max, y_min, y_max, weight, enabled, source, updated_at) VALUES ($village, $area, '$name', $minLevel, $xMin, $xMax, $yMin, $yMax, 100, $isEnabled, 'dummy_map', NOW()) ON DUPLICATE KEY UPDATE name = VALUES(name), min_level = VALUES(min_level), x_min = VALUES(x_min), x_max = VALUES(x_max), y_min = VALUES(y_min), y_max = VALUES(y_max), enabled = VALUES(enabled), source = VALUES(source), updated_at = NOW();")
    $count++
    if ($isEnabled -eq 1) { $enabled++ }
}

$lines.Add("COMMIT;")
$lines.Add("-- Parsed zones: $count")
$lines.Add("-- Enabled zones: $enabled")

[System.IO.File]::WriteAllLines((Join-Path (Get-Location) $OutputPath), $lines, [System.Text.Encoding]::UTF8)
Write-Host "Generated $OutputPath with $count zones; enabled zones: $enabled"
