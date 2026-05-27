param(
    [string]$InputPath = ".\iteminfo.dat",
    [string]$OutputPath = ".\auction_item_profile_import.sql"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $InputPath)) {
    throw "iteminfo.dat not found: $InputPath"
}

function Escape-Sql([string]$s) {
    if ($null -eq $s) { return "" }
    return $s.Replace("\", "\\").Replace("'", "''")
}

function Get-Category([int]$rawCode) {
    if ($rawCode -ge 10000 -and $rawCode -lt 12000) { return "equipment" }
    if ($rawCode -ge 12000 -and $rawCode -lt 13000) { return "consumable" }
    if ($rawCode -ge 13000 -and $rawCode -lt 14000) { return "material" }
    if ($rawCode -ge 31000 -and $rawCode -lt 32000) { return "rare" }
    return "junk"
}

function Get-Tier([string]$category) {
    if ($category -eq "material" -or $category -eq "consumable") { return "B" }
    return "C"
}

$encoding = [System.Text.Encoding]::GetEncoding(950)
$text = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $InputPath), $encoding)
$pattern = '^\s*(\d+)\s+(.+?)\s+`([^`]*)`\s+`([^`]*)`\s+(\d+)\s*$'

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("USE frida;")
$lines.Add("START TRANSACTION;")

$count = 0
$bad = 0
foreach ($line in ($text -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $m = [regex]::Match($line, $pattern)
    if (!$m.Success) {
        $bad++
        continue
    }

    $itemId = [int]$m.Groups[1].Value
    $name = Escape-Sql $m.Groups[3].Value
    $rawCode = [int]$m.Groups[5].Value
    $category = Get-Category $rawCode
    $tier = Get-Tier $category

    $maxListings = if ($tier -eq "B") { 5 } else { 2 }
    $maxQty = if ($tier -eq "B") { 20 } else { 3 }
    $volatility = if ($category -eq "equipment") { "0.35" } elseif ($category -eq "rare") { "0.50" } elseif ($category -eq "material") { "0.12" } else { "0.20" }
    $botWeight = if ($category -eq "junk") { "0.05" } elseif ($tier -eq "B") { "0.20" } else { "0.10" }
    $rotation = if ($tier -eq "B") { "0.20" } else { "0.03" }

    $lines.Add("INSERT INTO auction_item_profile (item_id, cname, category, raw_category_code, market_tier, base_price, min_listings, max_listings, min_total_quantity, max_total_quantity, preferred_stack_min, preferred_stack_max, volatility, bot_trade_weight, system_trade_weight, rotation_weight, enabled, source, category_source, classification_confidence, updated_at) VALUES ($itemId, '$name', '$category', $rawCode, '$tier', 1000, 0, $maxListings, 0, $maxQty, 1, 1, $volatility, $botWeight, 0.00, $rotation, 1, 'iteminfo', 'raw_code', 0.50, NOW()) ON DUPLICATE KEY UPDATE cname = IF(cname IS NULL OR cname = '', VALUES(cname), cname), raw_category_code = VALUES(raw_category_code);")
    $count++
}

$lines.Add("COMMIT;")
$lines.Add("-- Parsed rows: $count")
$lines.Add("-- Bad rows: $bad")

[System.IO.File]::WriteAllLines((Join-Path (Get-Location) $OutputPath), $lines, [System.Text.Encoding]::UTF8)
Write-Host "Generated $OutputPath with $count rows; bad rows: $bad"
