# Shared by the tests: starts the local server and an invisible Edge (own temporary profile,
# never on screen), and drives the app with simulated mouse and keyboard input inside that Edge.
# Dot-source it, then:  Start-App -Out <folder> ;  ... ;  Stop-App
$root = Split-Path $PSScriptRoot
. (Join-Path $root 'tools\cdp.ps1')
$log = New-Object System.Collections.Generic.List[string]
$fail = 0
function Log($m) { $log.Add($m); Write-Host $m }
function Check($ok, $m) { if ($ok) { Log "PASS  $m" } else { $script:fail++; Log "FAIL  $m" } }

function Start-App([string]$Out, [int]$Port = 8131, [string]$Downloads) {
    $script:server = Start-Job -ScriptBlock { param($s, $p, $o) & powershell -ExecutionPolicy Bypass -File $s -Port $p -Out $o } -ArgumentList (Join-Path $root 'tools\serve.ps1'), $Port, $Out
    Start-Sleep 2
    $script:e = Start-Cdp -Width 1440 -Height 900
    $script:port = $Port
    Invoke-Cdp $e 'Page.navigate' @{ url = "http://localhost:$Port/" } | Out-Null
    Start-Sleep 2
    if ($Downloads) { Invoke-Cdp $e 'Page.setDownloadBehavior' @{ behavior = 'allow'; downloadPath = $Downloads } | Out-Null }
    # no Save dialog in the tests (files go to the download folder), and nothing touches the real clipboard
    Js @"
window.showSaveFilePicker = undefined;
Object.defineProperty(navigator, 'clipboard', { value: { write: () => Promise.reject(new Error('test')), read: () => Promise.reject(new Error('test')) } });
window.T = { s(x, y) { const r = document.getElementById('view').getBoundingClientRect(); const v = photoEditor.app.doc.view; return [r.left + v.ox + x * v.zoom, r.top + v.oy + y * v.zoom]; } };
1
"@ | Out-Null
}

function Stop-App {
    Stop-Cdp $e
    try { Invoke-RestMethod "http://localhost:$port/__stop" -TimeoutSec 3 | Out-Null } catch { }
    Stop-Job $server -ErrorAction SilentlyContinue; Remove-Job $server -Force -ErrorAction SilentlyContinue
}
function Js($code) { Eval-Cdp $e $code 300 }
function Mouse($type, $x, $y, $mods = 0, $button = 'left') {
    $buttons = if ($type -eq 'mouseReleased' -or $button -eq 'none') { 0 } else { 1 }
    Invoke-Cdp $e 'Input.dispatchMouseEvent' @{ type = $type; x = [double]$x; y = [double]$y; button = $button; buttons = $buttons; clickCount = 1; modifiers = $mods } | Out-Null
}
# document pixels -> page coordinates
function At($x, $y) { (Js "JSON.stringify(T.s($x, $y))") | ConvertFrom-Json }
function Drag($x1, $y1, $x2, $y2, $mods = 0, $steps = 12) {
    $a = At $x1 $y1; $b = At $x2 $y2
    Mouse 'mouseMoved' $a[0] $a[1] $mods 'none'
    Mouse 'mousePressed' $a[0] $a[1] $mods
    for ($i = 1; $i -le $steps; $i++) { Mouse 'mouseMoved' ($a[0] + ($b[0] - $a[0]) * $i / $steps) ($a[1] + ($b[1] - $a[1]) * $i / $steps) $mods }
    Mouse 'mouseReleased' $b[0] $b[1] $mods
}
function Click($x, $y, $mods = 0) { $a = At $x $y; Mouse 'mouseMoved' $a[0] $a[1] $mods 'none'; Mouse 'mousePressed' $a[0] $a[1] $mods; Mouse 'mouseReleased' $a[0] $a[1] $mods }
function Key($key, $mods = 0) {
    $code = if ($key.Length -eq 1 -and $key -match '[a-zA-Z]') { 'Key' + $key.ToUpper() } elseif ($key -eq 'Enter') { 'Enter' } elseif ($key -eq 'Escape') { 'Escape' } elseif ($key -eq 'Delete') { 'Delete' } else { $key }
    $vk = if ($key.Length -eq 1) { [int][char]$key.ToUpper() } else { @{ Enter = 13; Escape = 27; Delete = 46 }[$key] }
    $k = if ($key.Length -eq 1 -and ($mods -band 8)) { $key.ToUpper() } else { $key }
    Invoke-Cdp $e 'Input.dispatchKeyEvent' @{ type = 'rawKeyDown'; key = $k; code = $code; windowsVirtualKeyCode = $vk; modifiers = $mods } | Out-Null
    Invoke-Cdp $e 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = $k; code = $code; windowsVirtualKeyCode = $vk; modifiers = $mods } | Out-Null
}
function WaitFor($cond, $sec = 30) {
    for ($i = 0; $i -lt $sec * 5; $i++) { if (Js $cond) { return $true }; Start-Sleep -Milliseconds 200 }
    return $false
}
function Hist() { Js "(() => { const d = photoEditor.app.doc; return d.history[d.hIndex].label + ' #' + d.hIndex; })()" }
$CTRL = 2; $SHIFT = 8; $ALT = 1

function SetColor($hex) { Js "(() => { const h = document.getElementById('c-hex'); h.value = '$hex'; h.dispatchEvent(new Event('change')); return 1; })()" | Out-Null }
function Pixel($layer, $x, $y) { Js "Array.from(photoEditor.app.doc.layers[$layer].canvas.getContext('2d').getImageData($x, $y, 1, 1).data).join(',')" }
function Menu($menu, $item) { Js "(() => { document.querySelector('[data-menu=$menu]').click(); const b = [...document.querySelectorAll('#menu button')].find(b => b.textContent.startsWith('$item')); if (!b) throw new Error('no menu item $item'); b.click(); return 1; })()" | Out-Null; Start-Sleep -Milliseconds 300 }
function DialogOk { Js "document.querySelector('.dialog .btn.primary').click(); 1" | Out-Null }