# UI test: serves the app, opens it in an invisible Edge (own profile, never on screen), and uses
# it with simulated mouse and keyboard input inside that Edge only: opens a picture, paints, adds
# layers and a shape, selects, runs filters, undoes and redoes, transforms, types text, then saves
# PSD, PNG, JPEG, WebP, BMP and PDF and opens the saved PSD again. Screenshots go to the output folder.
#   powershell -ExecutionPolicy Bypass -File tests\ui-test.ps1 [-Out tests\out\ui]
param(
    [string]$Out = (Join-Path $PSScriptRoot 'out\ui'),
    [int]$Port = 8131
)
. (Join-Path $PSScriptRoot 'harness.ps1')
New-Item -ItemType Directory -Force $Out | Out-Null
$saved = Join-Path $Out 'saved'
New-Item -ItemType Directory -Force $saved | Out-Null
Get-ChildItem $saved -File | Remove-Item
Start-App -Out $Out -Port $Port -Downloads $saved
try {
    # 1. open a picture by dropping it on the window
    Js "(async () => { const b = await (await fetch('assets/badger-logo.png')).blob(); const dt = new DataTransfer(); dt.items.add(new File([b], 'badger-logo.png', { type: 'image/png' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return 1; })()" | Out-Null
    Check (WaitFor "photoEditor.app.docs.length === 1") 'dropped picture opens as a document'
    $size = Js "photoEditor.app.doc.width + ' x ' + photoEditor.app.doc.height"
    Log "      size $size"
    # put a white layer under the logo so the paint and filters show up well
    Js "(() => { const d = photoEditor.app.doc; const l = photoEditor.newLayer(d.width, d.height, 'Paper'); const g = l.canvas.getContext('2d'); g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, d.width, d.height); d.layers.unshift(l); d.active = 1; d.commit('Add paper'); return 1; })()" | Out-Null
    Js "photoEditor.recenter(); 1" | Out-Null
    Start-Sleep 1
    Shot-Cdp $e (Join-Path $Out '1-opened.png')

    # 2. paint a brush stroke in Badger orange on a new layer
    Js "document.getElementById('l-new').click(); 1" | Out-Null
    Js "(() => { const h = document.getElementById('c-hex'); h.value = '#e8650f'; h.dispatchEvent(new Event('change')); return 1; })()" | Out-Null
    Key 'b'
    Check ((Js "photoEditor.app.tool") -eq 'brush') "B selects the brush"
    Drag 40 300 560 340 0 30
    Check ((Hist) -like 'Brush*') "brush stroke recorded: $(Hist)"
    $px = Js "(() => { const d = photoEditor.app.doc; return Array.from(d.layer.canvas.getContext('2d').getImageData(300, 320, 1, 1).data).join(','); })()"
    $c = $px -split ','
    Check ([Math]::Abs($c[0] - 232) -le 3 -and [Math]::Abs($c[1] - 101) -le 3 -and [Math]::Abs($c[2] - 15) -le 3 -and $c[3] -gt 250) "stroke painted orange on the new layer ($px)"

    # 3. a shape on its own layer
    Key 'u'
    Js "(() => { photoEditor.app.opts.shape.kind = 'ellipse'; photoEditor.app.opts.shape.fill = 'fg'; photoEditor.app.opts.shape.stroke = 'none'; return 1; })()" | Out-Null
    Js "(() => { const h = document.getElementById('c-hex'); h.value = '#2563eb'; h.dispatchEvent(new Event('change')); return 1; })()" | Out-Null
    Drag 380 40 560 200
    Check ((Js "photoEditor.app.doc.layers.length") -eq 4) "shape tool added a layer: $(Js "photoEditor.app.doc.layers.map(l => l.name).join(' / ')")"

    # 4. selection, then an adjustment limited to it
    Key 'm'
    Drag 360 20 470 230
    Check (Js "!!photoEditor.app.doc.sel") 'marquee made a selection'
    Key 'i' $CTRL
    WaitFor "photoEditor.app.doc.history[photoEditor.app.doc.hIndex].label === 'Invert'" | Out-Null
    Check ((Hist) -like 'Invert*') "Ctrl+I inverted inside the selection: $(Hist)"
    $inside = Js "Array.from(photoEditor.app.doc.layer.canvas.getContext('2d').getImageData(420, 120, 1, 1).data).join(',')"
    $outside = Js "Array.from(photoEditor.app.doc.layer.canvas.getContext('2d').getImageData(520, 120, 1, 1).data).join(',')"
    Check ($inside -ne $outside -and $outside -like '37,99,235,*') "only the selected part changed (inside $inside, outside $outside)"
    Shot-Cdp $e (Join-Path $Out '2-selection.png')

    # 5. Gaussian Blur from the Filter menu, through its dialog
    Js "photoEditor.ops.deselect(); 1" | Out-Null
    Js "document.querySelector('[data-menu=Filter]').click(); 1" | Out-Null
    Start-Sleep -Milliseconds 300
    Shot-Cdp $e (Join-Path $Out '3-filter-menu.png')
    Js "[...document.querySelectorAll('#menu button')].find(b => b.textContent.startsWith('Gaussian Blur')).click(); 1" | Out-Null
    Start-Sleep -Milliseconds 500
    Js "(() => { const n = document.querySelector('.dialog input[type=number]'); n.value = 6; n.dispatchEvent(new Event('input')); return 1; })()" | Out-Null
    Start-Sleep 2
    Shot-Cdp $e (Join-Path $Out '4-blur-dialog.png')
    Js "document.querySelector('.dialog .btn.primary').click(); 1" | Out-Null
    Check (WaitFor "photoEditor.app.doc.history[photoEditor.app.doc.hIndex].label === 'Gaussian Blur'") "Gaussian Blur applied: $(Hist)"

    # 6. undo twice, redo twice
    $before = Js "photoEditor.app.doc.hIndex"
    Key 'z' $CTRL; Key 'z' $CTRL
    $mid = Js "photoEditor.app.doc.hIndex"
    Key 'z' ($CTRL + $SHIFT); Key 'z' ($CTRL + $SHIFT)
    $after = Js "photoEditor.app.doc.hIndex"
    Check (($mid -eq $before - 2) -and ($after -eq $before)) "undo/redo: $before -> $mid -> $after"

    # 7. free transform the shape layer: drag a corner out, then Enter
    Js "photoEditor.app.doc.active = 3; 1" | Out-Null
    Key 't' $CTRL
    Check (Js "photoEditor.app.session?.tool === 'transform'") 'Ctrl+T starts Free Transform'
    $corner = Js "(() => { const t = photoEditor.app.session.t; return JSON.stringify([t.cx + t.w0 / 2, t.cy + t.h0 / 2]); })()" | ConvertFrom-Json
    Drag $corner[0] $corner[1] ($corner[0] + 60) ($corner[1] + 40)
    Start-Sleep -Milliseconds 300
    Shot-Cdp $e (Join-Path $Out '5-transform.png')
    Key 'Enter'
    Check ((Hist) -like 'Free Transform*') "transform applied: $(Hist)"

    # 8. text on a new layer
    Js "(() => { const h = document.getElementById('c-hex'); h.value = '#1b1d20'; h.dispatchEvent(new Event('change')); photoEditor.app.opts.text.size = 64; photoEditor.app.opts.text.bold = true; return 1; })()" | Out-Null
    Key 't'
    Click 30 300
    Start-Sleep -Milliseconds 300
    Invoke-Cdp $e 'Input.insertText' @{ text = 'Made in the USA' } | Out-Null
    Start-Sleep -Milliseconds 200
    Key 'Enter' $CTRL
    Check ((Hist) -like 'Text*') "text placed: $(Hist)"
    Key 'v'
    Start-Sleep 1
    Shot-Cdp $e (Join-Path $Out '6-edited.png')
    $names = Js "photoEditor.app.doc.layers.map(l => l.name).join(' / ')"
    Log "      layers: $names"

    # 9. save in every format through File > Save As (downloads, since this test has no Save dialog)
    foreach ($fmt in 'psd', 'png', 'jpeg', 'webp', 'bmp', 'pdf') {
        Js "document.querySelector('[data-menu=File]').click(); [...document.querySelectorAll('#menu button')].find(b => b.textContent.startsWith('Save As')).click(); 1" | Out-Null
        Start-Sleep -Milliseconds 300
        Js "(() => { const s = document.querySelector('.dialog select'); s.value = '$fmt'; s.dispatchEvent(new Event('change')); document.querySelector('.dialog .btn.primary').click(); return 1; })()" | Out-Null
        $ok = WaitFor "/^Saved/.test(document.getElementById('st-msg').textContent)" 30
        Check $ok "save $fmt : $(Js "document.getElementById('st-msg').textContent")"
        Js "document.getElementById('st-msg').textContent = ''; 1" | Out-Null
    }
    Start-Sleep 2
    $files = Get-ChildItem $saved -File
    Log ("      saved: " + (($files | ForEach-Object { "$($_.Name) ($([Math]::Round($_.Length / 1KB)) KB)" }) -join ', '))

    # 10. the saved PSD opens again with the same layers
    $psd = $files | Where-Object Extension -eq '.psd' | Select-Object -First 1
    # served by the test server from the output folder
    $rel = (Resolve-Path $psd.FullName).Path.Substring($root.Length + 1).Replace('\', '/')
    Js "(async () => { const b = await (await fetch('$rel')).blob(); await photoEditor.openFiles([new File([b], 'reopened.psd')]); return 1; })()" | Out-Null
    Check (WaitFor "photoEditor.app.docs.length === 2") 'saved PSD opens again'
    $names2 = Js "photoEditor.app.doc.layers.map(l => l.name).join(' / ')"
    Check ($names2 -eq $names) "reopened PSD has the same layers: $names2"
    $diff = Js "(() => { const [a, b] = photoEditor.app.docs; let max = 0; for (let i = 0; i < a.layers.length; i++) { const p = a.layers[i].canvas.getContext('2d').getImageData(0, 0, a.width, a.height).data, q = b.layers[i].canvas.getContext('2d').getImageData(0, 0, b.width, b.height).data; for (let k = 0; k < p.length; k += 4) { if (p[k + 3] === 0 && q[k + 3] === 0) continue; for (let c = 0; c < 4; c++) max = Math.max(max, Math.abs(p[k + c] - q[k + c])); } } return max; })()"
    Check ($diff -le 1) "reopened PSD pixels match the original layers (largest difference $diff)"
    Start-Sleep 1
    Shot-Cdp $e (Join-Path $Out '7-reopened-psd.png')

    # 11. a few more dialogs for the screenshots
    Js "photoEditor.runFilterUI('curves'); 1" | Out-Null
    Start-Sleep 1
    Shot-Cdp $e (Join-Path $Out '8-curves.png')
    Js "document.querySelector('.dialog .btn:not(.primary)').click(); 1" | Out-Null
    Start-Sleep -Milliseconds 300
    Js "document.querySelector('[data-menu=Image]').click(); [...document.querySelectorAll('#menu button')].find(b => b.textContent.startsWith('Canvas Size')).click(); 1" | Out-Null
    Start-Sleep -Milliseconds 400
    Shot-Cdp $e (Join-Path $Out '9-canvas-size.png')
    Key 'Escape'

    $errs = Js "JSON.stringify(window.__errors)"
    Check ($errs -eq '[]') "no errors in the page: $errs"
}
catch { $fail++; Log "ERROR: $_" }
finally { Stop-App }

# independent checks of the saved files
$psd = Get-ChildItem $saved -Filter *.psd | Select-Object -First 1
if ($psd) { & (Join-Path $PSScriptRoot 'check-psd.ps1') $psd.FullName | ForEach-Object { Log "      $_" } }
$png = Get-ChildItem $saved -Filter *.png | Select-Object -First 1
$jpg = Get-ChildItem $saved -Filter *.jpg | Select-Object -First 1
$bmp = Get-ChildItem $saved -Filter *.bmp | Select-Object -First 1
Add-Type -AssemblyName System.Drawing
foreach ($f in $png, $jpg, $bmp) {
    if (-not $f) { $fail++; Log "FAIL  missing a saved picture"; continue }
    try { $im = [System.Drawing.Image]::FromFile($f.FullName); Check ($true) "$($f.Name) opens in Windows ($($im.Width) x $($im.Height))"; $im.Dispose() }
    catch { $fail++; Log "FAIL  $($f.Name) doesn't open in Windows: $_" }
}
$pdf = Get-ChildItem $saved -Filter *.pdf | Select-Object -First 1
if ($pdf) { $head = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($pdf.FullName)); Check ($head.StartsWith('%PDF-1.4') -and $head.Contains('/Subtype /Image') -and $head.TrimEnd().EndsWith('%%EOF')) "$($pdf.Name) looks like a complete PDF" }
Log "$fail failure(s)"
$log | Set-Content (Join-Path $Out 'log.txt') -Encoding utf8
