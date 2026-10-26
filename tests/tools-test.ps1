# Tools test: every tool, the Image / Layer / Select commands, copy and paste, and every
# adjustment and filter, each checked by what it did to the pixels or the document.
#   powershell -ExecutionPolicy Bypass -File tests\tools-test.ps1 [-Out tests\out\tools]
param(
    [string]$Out = (Join-Path $PSScriptRoot 'out\tools'),
    [int]$Port = 8131
)
. (Join-Path $PSScriptRoot 'harness.ps1')
New-Item -ItemType Directory -Force $Out | Out-Null
Start-App -Out $Out -Port $Port

function Size() { Js "photoEditor.app.doc.width + 'x' + photoEditor.app.doc.height" }
function Rgb($s) { $s -split ',' | ForEach-Object { [int]$_ } }
function Arrow($name, $mods = 0) {
    $vk = @{ ArrowLeft = 37; ArrowUp = 38; ArrowRight = 39; ArrowDown = 40 }[$name]
    Invoke-Cdp $e 'Input.dispatchKeyEvent' @{ type = 'rawKeyDown'; key = $name; code = $name; windowsVirtualKeyCode = $vk; modifiers = $mods } | Out-Null
    Invoke-Cdp $e 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = $name; code = $name; windowsVirtualKeyCode = $vk; modifiers = $mods } | Out-Null
}
function Path($pts) {
    $a = At $pts[0][0] $pts[0][1]
    Mouse 'mouseMoved' $a[0] $a[1] 0 'none'
    Mouse 'mousePressed' $a[0] $a[1]
    foreach ($p in $pts) { $s = At $p[0] $p[1]; Mouse 'mouseMoved' $s[0] $s[1] }
    $s = At $pts[-1][0] $pts[-1][1]
    Mouse 'mouseReleased' $s[0] $s[1]
}

try {
    # File > New through its dialog
    Menu 'File' 'New'
    Js "(() => { const n = document.querySelectorAll('.dialog input[type=number]'); n[0].value = 400; n[0].dispatchEvent(new Event('input')); n[1].value = 300; n[1].dispatchEvent(new Event('input')); return 1; })()" | Out-Null
    Shot-Cdp $e (Join-Path $Out '1-new-dialog.png')
    DialogOk
    Check ((WaitFor "photoEditor.app.doc?.width === 400") -and (Size) -eq '400x300') "File > New made a 400 x 300 picture"
    # a test picture: red left half, blue right half, a white circle in the middle
    Js "(() => { const d = photoEditor.app.doc; const g = d.editable(d.layers[0]); g.fillStyle = '#cc2222'; g.fillRect(0, 0, 200, 300); g.fillStyle = '#2244cc'; g.fillRect(200, 0, 200, 300); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(200, 150, 50, 0, 7); g.fill(); d.commit('Test picture'); return 1; })()" | Out-Null

    # magic wand
    Key 'w'
    Click 50 50
    Check (Js "(() => { const s = photoEditor.app.doc.sel; return !!s && s.mask[50 * 400 + 50] === 255 && s.mask[50 * 400 + 300] === 0 && s.mask[150 * 400 + 200] === 0; })()") 'magic wand selects only the red area'
    # Shift-click adds
    Click 300 50 $SHIFT
    Check (Js "photoEditor.app.doc.sel.mask[50 * 400 + 300] === 255") 'Shift-click with the wand adds to the selection'
    Key 'd' $CTRL

    # paint bucket (Shift+G switches from gradient to the bucket)
    SetColor '#22aa44'
    Key 'g'
    Key 'g' $SHIFT
    Check ((Js "photoEditor.app.tool") -eq 'bucket') 'Shift+G switches to the paint bucket'
    Click 300 50
    Check ((Pixel 0 300 50) -eq '34,170,68,255' -and (Pixel 0 50 50) -eq '204,34,34,255') "bucket filled the blue area only ($(Pixel 0 300 50))"

    # eyedropper
    SetColor '#000000'
    Key 'i'
    Click 300 60
    Check ((Js "photoEditor.app.fg") -eq '#22aa44') "eyedropper picked $(Js 'photoEditor.app.fg')"

    # freehand lasso and polygonal lasso
    Key 'l'
    Path @(@(20, 20), @(120, 20), @(120, 120), @(20, 120), @(20, 25))
    Check (Js "(() => { const s = photoEditor.app.doc.sel; return !!s && s.mask[70 * 400 + 70] > 200 && s.mask[200 * 400 + 200] === 0; })()") 'freehand lasso selects the area drawn around'
    Js "photoEditor.app.opts.lasso.kind = 'poly'; 1" | Out-Null
    Click 250 200; Click 350 200; Click 300 280
    Key 'Enter'
    Check (Js "(() => { const s = photoEditor.app.doc.sel; return !!s && s.mask[240 * 400 + 300] > 200 && s.mask[70 * 400 + 70] === 0; })()") 'polygonal lasso: click corners, Enter closes'
    Js "photoEditor.app.opts.lasso.kind = 'free'; 1" | Out-Null
    Key 'd' $CTRL

    # gradient on a new layer
    Key 'n' ($CTRL + $SHIFT)
    Check ((Js "photoEditor.app.doc.layers.length") -eq 2) 'Ctrl+Shift+N adds a layer'
    SetColor '#000000'
    Js "(() => { photoEditor.app.bg = '#ffffff'; photoEditor.app.opts.gradient.colors = 'fg-bg'; photoEditor.app.opts.gradient.kind = 'linear'; return 1; })()" | Out-Null
    Key 'g'
    Key 'g' $SHIFT
    Check ((Js "photoEditor.app.tool") -eq 'gradient') 'G picks the bucket used last, Shift+G goes back to the gradient'
    Drag 0 10 400 10
    $l = Rgb (Pixel 1 2 100); $r = Rgb (Pixel 1 397 100); $m = Rgb (Pixel 1 200 100)
    Check ($l[0] -lt 10 -and $r[0] -gt 245 -and $m[0] -gt 100 -and $m[0] -lt 155) "gradient runs black to white (left $($l[0]), middle $($m[0]), right $($r[0]))"
    Shot-Cdp $e (Join-Path $Out '2-gradient.png')

    # eraser, then pencil on the gradient layer
    Key 'e'
    Js "photoEditor.app.opts.eraser.size = 30; photoEditor.app.opts.eraser.hardness = 100; 1" | Out-Null
    Drag 50 250 350 250
    Check ((Rgb (Pixel 1 200 250))[3] -eq 0 -and (Rgb (Pixel 1 200 200))[3] -eq 255) 'eraser clears pixels along the stroke only'
    Key 'b'
    Key 'b' $SHIFT
    Check ((Js "photoEditor.app.tool") -eq 'pencil') 'Shift+B switches to the pencil'
    SetColor '#ff00ff'
    Js "photoEditor.app.opts.pencil.size = 1; 1" | Out-Null
    Drag 100.5 30.5 300.5 30.5
    Check ((Pixel 1 200 30) -eq '255,0,255,255' -and (Rgb (Pixel 1 200 31))[0] -lt 250) "pencil draws a 1-pixel hard line ($(Pixel 1 200 30) / $(Pixel 1 200 31))"

    # clone stamp on the bottom layer: copy the red area onto the green one
    Js "photoEditor.app.doc.layers[1].visible = false; photoEditor.app.doc.active = 0; photoEditor.app.doc.changed(); 1" | Out-Null
    Key 's'
    Js "photoEditor.app.opts.clone.size = 30; photoEditor.app.opts.clone.hardness = 100; 1" | Out-Null
    Click 60 60 $ALT
    Drag 300 60 330 60
    Check ((Rgb (Pixel 0 315 60))[0] -gt 180 -and (Rgb (Pixel 0 315 60))[1] -lt 60) "clone stamp copied red onto the green ($(Pixel 0 315 60))"

    # blur, sharpen and dodge/burn brushes
    Key 'r'
    Js "photoEditor.app.opts.blur.size = 40; photoEditor.app.opts.blur.strength = 100; 1" | Out-Null
    $before = Pixel 0 199 30
    for ($k = 0; $k -lt 4; $k++) { Drag 199 10 199 60 }
    Check ((Pixel 0 199 30) -ne $before) "blur tool softens the red/green edge ($before -> $(Pixel 0 199 30))"
    Key 'o'
    Js "photoEditor.app.opts.dodge.kind = 'dodge'; photoEditor.app.opts.dodge.exposure = 80; 1" | Out-Null
    $before = Rgb (Pixel 0 60 250)
    Drag 40 250 80 250
    $after = Rgb (Pixel 0 60 250)
    Check ($after[1] -gt $before[1]) "dodge lightens (green $($before[1]) -> $($after[1]))"
    Js "photoEditor.app.opts.dodge.kind = 'burn'; 1" | Out-Null
    Drag 40 270 80 270
    Check ((Rgb (Pixel 0 60 270))[0] -lt 204) "burn darkens ($(Pixel 0 60 270))"
    Js "photoEditor.app.doc.layers[1].visible = true; photoEditor.app.doc.changed(); 1" | Out-Null

    # move tool: drag a selection's pixels, then nudge with the arrow keys
    Key 'm'
    Drag 20 150 80 210
    Key 'v'
    $src = Pixel 0 30 160
    Drag 50 180 90 180
    Check ((Hist) -like 'Move*' -and (Pixel 0 70 160) -eq $src) "moving the selection moves its pixels 40 px ($src)"
    Arrow 'ArrowRight' $SHIFT
    Check ((Hist) -like 'Nudge*' -and (Pixel 0 80 160) -eq $src) 'Shift+Right nudges 10 px'
    Key 'd' $CTRL

    # copy and paste the app's own way (the test never touches the real clipboard)
    Key 'm'
    Drag 210 160 260 200
    Key 'c' $CTRL
    Js "document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: new DataTransfer() })); 1" | Out-Null
    Check ((WaitFor "photoEditor.app.doc.layers.some(l => l.name.startsWith('Pasted'))") -and (Hist) -like 'Paste*') "copy + paste puts the pixels on a new layer: $(Js "photoEditor.app.doc.layers.map(l => l.name).join(' / ')")"

    # selection menu
    Menu 'Select' 'All'
    Check ((Hist) -like 'Select All*') 'Select > All'
    Menu 'Select' 'Inverse'
    Check (Js "photoEditor.app.doc.sel === null") 'Select > Inverse of everything is nothing'
    Menu 'Select' 'Reselect'
    Check (Js "!!photoEditor.app.doc.sel") 'Select > Reselect brings it back'
    Key 'm'; Drag 100 100 200 200
    Menu 'Select' 'Expand'; Js "(() => { const n = document.querySelector('.dialog input'); n.value = 10; n.dispatchEvent(new Event('input')); return 1; })()" | Out-Null; DialogOk
    Check (Js "photoEditor.app.doc.sel.mask[95 * 400 + 95] === 255") 'Select > Expand grows by 10 px'
    Menu 'Select' 'Contract'; Js "(() => { const n = document.querySelector('.dialog input'); n.value = 20; n.dispatchEvent(new Event('input')); return 1; })()" | Out-Null; DialogOk
    Check (Js "photoEditor.app.doc.sel.mask[95 * 400 + 95] === 0 && photoEditor.app.doc.sel.mask[150 * 400 + 150] === 255") 'Select > Contract shrinks'
    Menu 'Select' 'Feather'; DialogOk
    Check (Js "(() => { const m = photoEditor.app.doc.sel.mask; return m[110 * 400 + 150] > 0 && m[110 * 400 + 150] < 255; })()") 'Select > Feather softens the edge'
    Key 'd' $CTRL

    # every adjustment and filter (OK in each dialog)
    $ids = Js "(async () => Object.keys((await import('./js/filters.js')).FILTERS).join(','))()"
    Js "photoEditor.app.doc.active = 0; 1" | Out-Null
    foreach ($id in $ids -split ',') {
        $name = Js "(async () => (await import('./js/filters.js')).FILTERS['$id'].name)()"
        $n0 = Js "photoEditor.app.doc.hIndex"
        $t0 = Get-Date
        Js "photoEditor.runFilterUI('$id'); 1" | Out-Null
        Start-Sleep -Milliseconds 400
        if (Js "!!document.querySelector('.dialog')") {
            if ($id -eq 'curves') {
                # bend the curve: drag the middle of the graph up
                Js "(() => { const c = document.querySelector('canvas.curves'); const r = c.getBoundingClientRect(); const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerId: 1 })); ev('pointerdown', 128, 128); ev('pointermove', 128, 80); ev('pointerup', 128, 80); return 1; })()" | Out-Null
            } else {
                # move the first slider away from its default so the filter does something
                Js "(() => { const r = document.querySelector('.dialog input[type=range]'); if (r) { r.value = (+r.min + +r.max) * 0.7; r.dispatchEvent(new Event('input')); } return 1; })()" | Out-Null
            }
            Start-Sleep -Milliseconds 300
            DialogOk
        }
        $ok = WaitFor "photoEditor.app.doc.hIndex > $n0 && photoEditor.app.doc.history[photoEditor.app.doc.hIndex].label === '$name'" 60
        Check $ok ("filter {0,-20} {1,5:n1} s" -f $name, ((Get-Date) - $t0).TotalSeconds)
    }
    Shot-Cdp $e (Join-Path $Out '3-after-filters.png')
    Key 'z' $CTRL

    # layers panel: duplicate, rename, blend mode, opacity, hide, lock, reorder, merge, delete
    $n = Js "photoEditor.app.doc.layers.length"
    Key 'j' $CTRL
    Check ((Js "photoEditor.app.doc.layers.length") -eq $n + 1 -and (Js "photoEditor.app.doc.layer.name") -like '* copy') 'Ctrl+J duplicates the layer'
    Js "(() => { const n = document.querySelector('.layer.on .name'); n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); const i = document.querySelector('.layer input.rename'); i.value = 'Renamed'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()" | Out-Null
    Check ((Js "photoEditor.app.doc.layer.name") -eq 'Renamed') 'double-click renames a layer'
    Js "(() => { const s = document.getElementById('l-blend'); s.value = 'multiply'; s.dispatchEvent(new Event('change')); const o = document.getElementById('l-opacity'); o.value = 50; o.dispatchEvent(new Event('input')); o.dispatchEvent(new Event('change')); return 1; })()" | Out-Null
    Check ((Js "photoEditor.app.doc.layer.blend + ' ' + photoEditor.app.doc.layer.opacity") -eq 'multiply 0.5') 'blend mode and opacity change'
    Js "document.querySelector('.layer.on .eye').click(); 1" | Out-Null
    Check ((Js "photoEditor.app.doc.layer.visible") -eq $false) 'the eye hides a layer'
    Js "document.querySelector('.layer.on .eye').click(); document.getElementById('l-lock').click(); 1" | Out-Null
    Key 'b'
    $h0 = Js "photoEditor.app.doc.hIndex"
    Drag 10 10 100 100
    Check ((Js "photoEditor.app.doc.hIndex") -eq $h0 -and (Js "document.getElementById('st-msg').textContent") -like '*locked*') 'a locked layer refuses painting and says why'
    Js "document.getElementById('l-lock').click(); 1" | Out-Null
    $idx = Js "photoEditor.app.doc.active"
    Js "document.getElementById('l-up').click(); 1" | Out-Null
    Check ((Js "photoEditor.app.doc.active") -eq $idx + 1) 'move layer up'
    Key 'e' $CTRL
    Check ((Hist) -like 'Merge Down*') 'Ctrl+E merges down'
    Js "document.getElementById('l-del').click(); 1" | Out-Null
    Check ((Hist) -like 'Delete Layer*') 'delete layer'
    Shot-Cdp $e (Join-Path $Out '4-layers.png')

    # image commands
    Key 'c'
    Drag 20 20 380 280
    Shot-Cdp $e (Join-Path $Out '5-crop.png')
    Key 'Enter'
    Check ((Size) -eq '360x260') "crop to 360 x 260: $(Size)"
    Menu 'Image' 'Image Size'
    Js "(() => { const n = document.querySelectorAll('.dialog input[type=number]'); n[1].value = 180; n[1].dispatchEvent(new Event('input')); return 1; })()" | Out-Null
    DialogOk
    Check ((Size) -eq '180x130') "Image Size keeps proportions: $(Size)"
    Menu 'Image' 'Canvas Size'
    Js "(() => { const n = document.querySelectorAll('.dialog input[type=number]'); n[0].value = 200; n[0].dispatchEvent(new Event('input')); n[1].value = 150; n[1].dispatchEvent(new Event('input')); return 1; })()" | Out-Null
    DialogOk
    Check ((Size) -eq '200x150' -and (Rgb (Pixel 0 2 2))[3] -eq 0) "Canvas Size adds a transparent border: $(Size)"
    Menu 'Image' 'Trim'
    Check ((Size) -eq '180x130') "Trim removes it again: $(Size)"
    Menu 'Image' 'Rotate 90'
    Check ((Size) -eq '130x180') "rotate 90 degrees: $(Size)"
    Menu 'Image' 'Flip Canvas Horizontal'
    Check ((Hist) -like 'Flip Canvas Horizontal*') 'flip canvas'
    Menu 'Image' 'Rotate Arbitrary'
    DialogOk
    Check ((Size) -ne '130x180') "rotate 15 degrees grows the canvas: $(Size)"
    Key 'm'; Drag 20 20 80 90
    Menu 'Image' 'Crop to Selection'
    Check ((Size) -eq '60x70') "crop to selection: $(Size)"
    Menu 'Layer' 'Merge Visible'
    Menu 'Layer' 'Flatten Image'
    Check ((Js "photoEditor.app.doc.layers.length") -eq 1) 'flatten leaves one layer'

    # history panel: jump back to the start and forward again
    $last = Js "photoEditor.app.doc.hIndex"
    Js "document.querySelector('#history-list div').click(); 1" | Out-Null
    Check ((Size) -eq '400x300' -and (Js "photoEditor.app.doc.hIndex") -eq 0) 'clicking the first history step goes back to the start'
    Js "[...document.querySelectorAll('#history-list div')].pop().click(); 1" | Out-Null
    Check ((Js "photoEditor.app.doc.hIndex") -eq $last -and (Size) -eq '60x70') 'and the last step brings everything back'
    Js "photoEditor.app.doc.restore(5); 1" | Out-Null
    Js "document.querySelector('[data-menu=View]').click(); [...document.querySelectorAll('#menu button')].find(b => b.textContent.startsWith('Fit')).click(); 1" | Out-Null
    Start-Sleep 1
    Shot-Cdp $e (Join-Path $Out '6-history.png')

    # zoom with the wheel, pan with Space held, and the warning about unsaved changes
    $z0 = Js "photoEditor.app.doc.view.zoom"
    $c = At 30 30
    Invoke-Cdp $e 'Input.dispatchMouseEvent' @{ type = 'mouseWheel'; x = $c[0]; y = $c[1]; deltaX = 0; deltaY = -300 } | Out-Null
    Start-Sleep -Milliseconds 200
    $z1 = Js "photoEditor.app.doc.view.zoom"
    $c2 = At 30 30
    Check ($z1 -gt $z0 * 1.5 -and [Math]::Abs($c2[0] - $c[0]) -lt 1) "mouse wheel zooms in around the pointer ($z0 -> $z1)"
    $ox = Js "photoEditor.app.doc.view.ox"
    Invoke-Cdp $e 'Input.dispatchKeyEvent' @{ type = 'rawKeyDown'; key = ' '; code = 'Space'; windowsVirtualKeyCode = 32 } | Out-Null
    Mouse 'mouseMoved' 600 400 0 'none'; Mouse 'mousePressed' 600 400; Mouse 'mouseMoved' 650 420; Mouse 'mouseMoved' 700 440; Mouse 'mouseReleased' 700 440
    Invoke-Cdp $e 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = ' '; code = 'Space'; windowsVirtualKeyCode = 32 } | Out-Null
    Check ([Math]::Abs((Js "photoEditor.app.doc.view.ox") - $ox - 100) -lt 0.01 -and (Js "photoEditor.app.doc.hIndex") -eq 5) "holding Space pans instead of using the tool (ox $ox -> $(Js 'photoEditor.app.doc.view.ox'), step $(Js 'photoEditor.app.doc.hIndex'), space $(Js 'photoEditor.app.spaceHand'))"
    Check (Js "(() => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; })()") 'closing the window with unsaved changes asks first'
    Key '0' $CTRL

    $errs = Js "JSON.stringify(window.__errors)"
    Check ($errs -eq '[]') "no errors in the page: $errs"
}
catch { $fail++; Log "ERROR: $_" }
finally { Stop-App }
Log "$fail failure(s)"
$log | Set-Content (Join-Path $Out 'log.txt') -Encoding utf8
