# Reads a .psd with its own small parser (nothing shared with the app) and checks that every
# section adds up: header, layer records, channel data lengths, and the RLE row counts of the
# flattened picture against the end of the file. Prints what it finds; "PASS"/"FAIL" lines.
#   powershell -File tests\check-psd.ps1 file.psd
param([string]$Path)
$b = [IO.File]::ReadAllBytes($Path)
$script:p = 0
function U8 { $v = $b[$script:p]; $script:p += 1; $v }
function U16 { $v = ([int]$b[$script:p] -shl 8) -bor $b[$script:p + 1]; $script:p += 2; $v }
function I16 { $v = U16; if ($v -ge 32768) { $v - 65536 } else { $v } }
function U32 { $v = ([uint32]$b[$script:p] -shl 24) -bor ([uint32]$b[$script:p + 1] -shl 16) -bor ([uint32]$b[$script:p + 2] -shl 8) -bor [uint32]$b[$script:p + 3]; $script:p += 4; [int64]$v }
function I32 { $v = U32; if ($v -ge 2147483648) { $v - 4294967296 } else { $v } }
function Str($n) { $s = [Text.Encoding]::ASCII.GetString($b, [int]$script:p, $n); $script:p += $n; $s }
$ok = $true
function Expect($cond, $msg) { if ($cond) { "PASS  psd: $msg" } else { $script:ok = $false; "FAIL  psd: $msg" } }

Expect ((Str 4) -eq '8BPS') 'signature 8BPS'
$ver = U16; $script:p += 6
$ch = U16; $h = U32; $w = U32; $depth = U16; $mode = U16
Expect ($ver -eq 1 -and $depth -eq 8 -and $mode -eq 3) "version $ver, $w x $h, $ch channels, depth $depth, mode $mode (RGB)"
$n = U32; $script:p += $n               # color mode data
$resLen = U32; $script:p += $resLen     # image resources
$lmiLen = U32; $lmiEnd = $script:p + $lmiLen
$liLen = U32; $liEnd = $script:p + $liLen
Expect ($liLen % 2 -eq 0) "layer info length $liLen is even"
$count = [Math]::Abs((I16))
$layers = @()
for ($i = 0; $i -lt $count; $i++) {
    $t = I32; $l = I32; $bt = I32; $r = I32
    $nch = U16
    $chs = @(); for ($c = 0; $c -lt $nch; $c++) { $chs += , @((I16), (U32)) }
    $sig = Str 4; $blend = Str 4; $op = U8; $clip = U8; $flags = U8; $script:p += 1
    $extra = U32; $extraEnd = $script:p + $extra
    $n = U32; $script:p += $n; $n = U32; $script:p += $n   # mask, blending ranges
    $nl = U8; $name = Str $nl
    $script:p += (4 - (($nl + 1) % 4)) % 4
    $uname = $null
    while ($script:p + 12 -le $extraEnd) {
        $s = Str 4; $k = Str 4; $n = U32; $at = $script:p
        if ($k -eq 'luni') { $cl = U32; $uname = -join (1..$cl | ForEach-Object { [char](U16) }) }
        $script:p = $at + $n
    }
    Expect ($script:p -eq $extraEnd -and $sig -eq '8BIM') "layer $i record ends where its length says"
    $script:p = $extraEnd
    $layers += [pscustomobject]@{ Name = $(if ($uname) { $uname } else { $name }); Rect = "$l,$t-$r,$bt"; Blend = $blend; Opacity = $op; Hidden = [bool]($flags -band 2); Channels = $chs }
}
foreach ($L in $layers) {
    $rh = ($L.Rect -split '[,-]')
    $lh = [int]$rh[3] - [int]$rh[1]
    foreach ($c in $L.Channels) {
        $start = $script:p
        $comp = U16
        if ($comp -eq 1 -and $lh -gt 0) {
            $sum = 0; for ($y = 0; $y -lt $lh; $y++) { $sum += U16 }
            if (-not (2 + 2 * $lh + $sum -eq $c[1])) { Expect $false "layer '$($L.Name)' channel $($c[0]) RLE counts add up" | Write-Output }
        }
        $script:p = $start + $c[1]
    }
}
"layers ($count, bottom first): " + (($layers | ForEach-Object { "$($_.Name) [$($_.Blend.Trim()) $([Math]::Round($_.Opacity / 2.55))%$(if ($_.Hidden) { ' hidden' })] @ $($_.Rect)" }) -join ' | ')
Expect ($script:p -le $liEnd -and $liEnd - $script:p -le 1) "channel data fills the layer info section exactly ($($liEnd - $script:p) padding byte)"
$script:p = $lmiEnd
$comp = U16
Expect ($comp -eq 1) 'flattened picture is RLE compressed'
$sum = 0
for ($i = 0; $i -lt $ch * $h; $i++) { $sum += U16 }
Expect ($script:p + $sum -eq $b.Length) "flattened picture row counts reach exactly the end of the file ($($script:p + $sum) of $($b.Length) bytes)"
