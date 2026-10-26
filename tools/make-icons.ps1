# Draws the app icon (a photo with mountains and a sun, and a Badger-orange brush across it)
# and writes icons\icon-192.png, icons\icon-512.png and icons\maskable-512.png.
param([string]$Out = (Join-Path (Split-Path $PSScriptRoot) 'icons'))
Add-Type -AssemblyName System.Drawing

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function Color([int]$r, [int]$g, [int]$b, [int]$a = 255) { [System.Drawing.Color]::FromArgb($a, $r, $g, $b) }

# Draws the 256-unit design into $g at scale $s, offset ($ox, $oy)
function Draw-Icon($g, [float]$s, [float]$ox, [float]$oy) {
    $g.TranslateTransform($ox, $oy)
    $g.ScaleTransform($s, $s)
    # the photo: white frame, sky, sun, two steel-blue mountains
    $frame = New-RoundRect 14 34 212 172 16
    $g.FillPath((New-Object System.Drawing.SolidBrush (Color 255 255 255)), $frame)
    $g.DrawPath((New-Object System.Drawing.Pen (Color 110 118 130), 6), $frame)
    $sky = New-Object System.Drawing.Drawing2D.LinearGradientBrush ((New-Object System.Drawing.PointF 0, 50)), ((New-Object System.Drawing.PointF 0, 190)), (Color 120 180 235), (Color 214 234 250)
    $inner = New-RoundRect 30 50 180 140 6
    $g.FillPath($sky, $inner)
    $g.SetClip($inner)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush (Color 255 196 61)), 150, 64, 38, 38)
    $back = New-Object System.Drawing.Drawing2D.GraphicsPath
    $back.AddPolygon([System.Drawing.PointF[]]@((New-Object System.Drawing.PointF 70, 196), (New-Object System.Drawing.PointF 150, 98), (New-Object System.Drawing.PointF 230, 196)))
    $g.FillPath((New-Object System.Drawing.SolidBrush (Color 92 108 128)), $back)
    $front = New-Object System.Drawing.Drawing2D.GraphicsPath
    $front.AddPolygon([System.Drawing.PointF[]]@((New-Object System.Drawing.PointF 10, 196), (New-Object System.Drawing.PointF 88, 112), (New-Object System.Drawing.PointF 168, 196)))
    $g.FillPath((New-Object System.Drawing.SolidBrush (Color 52 62 76)), $front)
    $g.ResetClip()
    # the brush: orange handle, steel ferrule, dark tip, laid diagonally over the corner
    $g.TranslateTransform(196, 188)
    $g.RotateTransform(-45)
    $g.FillPath((New-Object System.Drawing.SolidBrush (Color 210 88 0)), (New-RoundRect -12 -112 24 92 10))
    $g.FillRectangle((New-Object System.Drawing.SolidBrush (Color 190 196 204)), -14, -24, 28, 22)
    $tip = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tip.AddBezier((New-Object System.Drawing.PointF -14, -2), (New-Object System.Drawing.PointF -16, 24), (New-Object System.Drawing.PointF -4, 40), (New-Object System.Drawing.PointF 0, 50))
    $tip.AddBezier((New-Object System.Drawing.PointF 0, 50), (New-Object System.Drawing.PointF 4, 40), (New-Object System.Drawing.PointF 16, 24), (New-Object System.Drawing.PointF 14, -2))
    $tip.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush (Color 34 36 40)), $tip)
    $g.DrawPath((New-Object System.Drawing.Pen (Color 255 255 255), 3), $tip)
    $g.ResetTransform()
}

function Save-Icon([int]$size, [string]$path, [bool]$maskable) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    if ($maskable) {
        # full-bleed dark steel square; the design sits inside the 80% safe zone
        $g.Clear((Color 27 29 32))
        $s = $size * 0.62 / 256
        Draw-Icon $g $s (($size - 256 * $s) / 2) (($size - 256 * $s) / 2)
    } else {
        Draw-Icon $g ($size / 256.0) 0 0
    }
    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

New-Item -ItemType Directory -Force $Out | Out-Null
Save-Icon 192 (Join-Path $Out 'icon-192.png') $false
Save-Icon 512 (Join-Path $Out 'icon-512.png') $false
Save-Icon 512 (Join-Path $Out 'maskable-512.png') $true
Write-Host "Wrote icons to $Out"
