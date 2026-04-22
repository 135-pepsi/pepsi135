param(
  [string]$RuntimeConfigPath = "config.runtime.js",
  [string]$SupabaseUrl = "",
  [string]$AnonKey = "",
  [string]$OutputFile = "seed-data.js",
  [int]$PageSize = 1000
)

$ErrorActionPreference = "Stop"

function Get-ConfigValue {
  param(
    [string]$Content,
    [string]$Name
  )
  $pattern = "$Name\s*:\s*`"([^`"]+)`""
  $match = [regex]::Match($Content, $pattern)
  if ($match.Success) { return $match.Groups[1].Value.Trim() }
  return ""
}

function Normalize-DateOnly {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) { return "" }
  $m = [regex]::Match($text.Trim(), "^(\d{4}-\d{2}-\d{2})")
  if ($m.Success) { return $m.Groups[1].Value }
  try {
    return ([DateTime]::Parse($text)).ToString("yyyy-MM-dd")
  } catch {
    return $text.Trim()
  }
}

function Split-NoteAndMeta {
  param([string]$NoteText)
  $note = [string]$NoteText
  $step = ""
  $proc = ""
  $done = ""

  $stepMatch = [regex]::Match($note, "\[STEP:([^\]]*)\]")
  if ($stepMatch.Success) { $step = $stepMatch.Groups[1].Value.Trim() }
  $procMatch = [regex]::Match($note, "\[PROC:([^\]]*)\]")
  if ($procMatch.Success) { $proc = $procMatch.Groups[1].Value.Trim() }
  $doneMatch = [regex]::Match($note, "\[DONE:([^\]]*)\]")
  if ($doneMatch.Success) { $done = (Normalize-DateOnly $doneMatch.Groups[1].Value) }

  $clean = [regex]::Replace($note, "\s*\[(STEP|PROC|DONE):[^\]]*\]\s*", " ")
  $clean = [regex]::Replace($clean, "\s+", " ").Trim()
  return @{
    note = $clean
    processName = $proc
    processStepCurrent = $step
    completionDate = $done
  }
}

function Convert-OrderRow {
  param([pscustomobject]$Row)

  $now = (Get-Date).ToString("o")
  $parsed = Split-NoteAndMeta ([string]$Row.note)
  $dueDate = Normalize-DateOnly $Row.due_date
  $status = [string]$Row.status
  $isDelayed = ""
  if ($dueDate) {
    try {
      $due = [DateTime]::ParseExact("$dueDate 23:59:59", "yyyy-MM-dd HH:mm:ss", [Globalization.CultureInfo]::InvariantCulture)
      if ((Get-Date) -gt $due) { $isDelayed = "延期" } else { $isDelayed = "正常" }
    } catch {
      $isDelayed = ""
    }
  }

  $createdAt = $now
  if ($Row.created_at) {
    $createdAt = [string]$Row.created_at
  } elseif ($Row.updated_at) {
    $createdAt = [string]$Row.updated_at
  }

  $updatedAt = $now
  if ($Row.updated_at) {
    $updatedAt = [string]$Row.updated_at
  } elseif ($Row.created_at) {
    $updatedAt = [string]$Row.created_at
  }

  $programNo = [string]$Row.program_no

  [pscustomobject]@{
    id = if ($Row.id) { [string]$Row.id } else { [Guid]::NewGuid().ToString() }
    createdAt = $createdAt
    updatedAt = $updatedAt
    orderNo = [string]$Row.order_no
    drawingNo = [string]$Row.drawing_no
    customer = [string]$Row.customer
    name = [string]$Row.item_name
    qty = if ($null -eq $Row.qty) { "" } else { [double]$Row.qty }
    programNo = $programNo
    processName = [string]$parsed.processName
    processStepCurrent = [string]$parsed.processStepCurrent
    plannedHours = if ($null -eq $Row.planned_hours) { "" } else { [double]$Row.planned_hours }
    machine = [string]$Row.machine
    lathe = [string]$Row.lathe
    surface = [string]$Row.surface
    status = $status
    startTime = Normalize-DateOnly $Row.start_time
    completionDate = [string]$parsed.completionDate
    dueDate = $dueDate
    isDelayed = $isDelayed
    note = [string]$parsed.note
  }
}

function Convert-MaterialRow {
  param([pscustomobject]$Row)

  $now = (Get-Date).ToString("o")
  $createdAt = $now
  if ($Row.created_at) {
    $createdAt = [string]$Row.created_at
  } elseif ($Row.updated_at) {
    $createdAt = [string]$Row.updated_at
  }

  $updatedAt = $now
  if ($Row.updated_at) {
    $updatedAt = [string]$Row.updated_at
  } elseif ($Row.created_at) {
    $updatedAt = [string]$Row.created_at
  }

  [pscustomobject]@{
    id = if ($Row.id) { [string]$Row.id } else { [Guid]::NewGuid().ToString() }
    createdAt = $createdAt
    updatedAt = $updatedAt
    orderNo = [string]$Row.order_no
    customer = [string]$Row.customer
    material = [string]$Row.material
    spec = [string]$Row.spec
    quantity = if ($null -eq $Row.quantity) { "" } else { [double]$Row.quantity }
    amount = if ($null -eq $Row.amount) { "" } else { [double]$Row.amount }
    isReady = [string]$Row.is_ready
  }
}

function Invoke-SupabasePaged {
  param(
    [string]$BaseUrl,
    [string]$ApiKey,
    [string]$TableName,
    [int]$Limit = 1000
  )

  $offset = 0
  $all = @()

  while ($true) {
    $query = "select=*"
    $uri = "$BaseUrl/rest/v1/$TableName?$query"
    $rangeEnd = $offset + $Limit - 1
    $headers = @{
      apikey = $ApiKey
      Authorization = "Bearer $ApiKey"
      Accept = "application/json"
      Range = "$offset-$rangeEnd"
      "Range-Unit" = "items"
    }

    $resp = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
    $batch = @()
    if ($resp -is [System.Array]) {
      $batch = $resp
    } elseif ($null -ne $resp) {
      $batch = @($resp)
    }

    if ($batch.Count -eq 0) { break }
    $all += $batch
    if ($batch.Count -lt $Limit) { break }
    $offset += $batch.Count
  }

  return $all
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimePath = Join-Path $projectRoot $RuntimeConfigPath

if ([string]::IsNullOrWhiteSpace($SupabaseUrl) -or [string]::IsNullOrWhiteSpace($AnonKey)) {
  if (-not (Test-Path $runtimePath)) {
    throw "Cannot find runtime config file: $runtimePath"
  }
  $runtimeContent = Get-Content -Path $runtimePath -Raw -Encoding UTF8
  if ([string]::IsNullOrWhiteSpace($SupabaseUrl)) { $SupabaseUrl = Get-ConfigValue -Content $runtimeContent -Name "SUPABASE_URL" }
  if ([string]::IsNullOrWhiteSpace($AnonKey)) { $AnonKey = Get-ConfigValue -Content $runtimeContent -Name "SUPABASE_ANON_KEY" }
}

$SupabaseUrl = [string]$SupabaseUrl
$AnonKey = [string]$AnonKey
if ([string]::IsNullOrWhiteSpace($SupabaseUrl) -or [string]::IsNullOrWhiteSpace($AnonKey)) {
  throw "SUPABASE_URL or SUPABASE_ANON_KEY is empty. Please pass params or fill config.runtime.js."
}

$SupabaseUrl = $SupabaseUrl.Trim().TrimEnd("/")
Write-Host "Exporting from: $SupabaseUrl"

$orderRowsDb = Invoke-SupabasePaged -BaseUrl $SupabaseUrl -ApiKey $AnonKey -TableName "mes_orders" -Limit $PageSize
$materialRowsDb = Invoke-SupabasePaged -BaseUrl $SupabaseUrl -ApiKey $AnonKey -TableName "mes_materials" -Limit $PageSize

$orderRows = @($orderRowsDb | ForEach-Object { Convert-OrderRow $_ })
$materialRows = @($materialRowsDb | ForEach-Object { Convert-MaterialRow $_ })

$seedObject = [ordered]@{
  version = (Get-Date).ToString("yyyyMMddHHmmss")
  markerKey = "__mes_static_seed_version__"
  keys = [ordered]@{
    mini_mes_orders_v1 = $orderRows
    mini_mes_materials_v2 = $materialRows
  }
}

$json = $seedObject | ConvertTo-Json -Depth 20 -Compress
$outputPath = Join-Path $projectRoot $OutputFile
$content = "window.__MES_STATIC_SEED__ = $json;"
[System.IO.File]::WriteAllText($outputPath, $content, [System.Text.UTF8Encoding]::new($false))

Write-Host "Export completed."
Write-Host "Orders: $($orderRows.Count)"
Write-Host "Materials: $($materialRows.Count)"
Write-Host "Seed file: $outputPath"
