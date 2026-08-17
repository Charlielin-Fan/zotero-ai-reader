param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [switch]$UseImageGenBackground
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Common -ErrorAction SilentlyContinue

$docsAssets = Join-Path $Root 'docs/assets'
$xhsImages = Join-Path $Root 'release/xiaohongshu/images'
$xhsSource = Join-Path $Root 'release/xiaohongshu/source'
New-Item -ItemType Directory -Force -Path $docsAssets, $xhsImages, $xhsSource | Out-Null

function New-Font([string]$family, [float]$size, [System.Drawing.FontStyle]$style = [System.Drawing.FontStyle]::Regular) {
  try { return [System.Drawing.Font]::new($family, $size, $style) }
  catch { return [System.Drawing.Font]::new('Arial', $size, $style) }
}

function New-Canvas([int]$width, [int]$height, [string]$left, [string]$right) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $rect = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
  $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, [System.Drawing.ColorTranslator]::FromHtml($left), [System.Drawing.ColorTranslator]::FromHtml($right), 35)
  $graphics.FillRectangle($brush, $rect)
  $brush.Dispose()
  return @($bitmap, $graphics)
}

function Save-Png($bitmap, [string]$path) {
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

function Draw-Text($g, [string]$text, [float]$x, [float]$y, [float]$size, [string]$color = '#F7F9FF', [bool]$bold = $false, [int]$maxWidth = 900) {
  $font = New-Font 'Microsoft YaHei' $size ($(if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }))
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($color))
  $format = [System.Drawing.StringFormat]::new()
  $g.DrawString($text, $font, $brush, [System.Drawing.RectangleF]::new($x, $y, $maxWidth, 1800), $format)
  $format.Dispose(); $brush.Dispose(); $font.Dispose()
}

function Draw-Pill($g, [string]$text, [float]$x, [float]$y, [float]$width) {
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#57D9BF'), 3)
  Draw-RoundedRect $g $pen ([System.Drawing.RectangleF]::new($x, $y, $width, 56)) 28
  $pen.Dispose()
  Draw-Text $g $text ($x + 22) ($y + 12) 22 '#B9FFF0' $false ($width - 36)
}

function Draw-RoundedRect($g, $pen, [System.Drawing.RectangleF]$rect, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  $g.DrawPath($pen, $path)
  $path.Dispose()
}

function New-Card([int]$index, [string]$title, [string]$body, [string]$footer, [string]$left = '#0B1020', [string]$right = '#293D77') {
  $parts = New-Canvas -width 1080 -height 1440 -left $left -right $right; $bmp = $parts[0]; $g = $parts[1]
  $g.FillEllipse([System.Drawing.Brushes]::Transparent, 0, 0, 1, 1)
  Draw-Pill $g 'OPEN-SOURCE · SYNTHETIC DEMO' 92 82 650
  Draw-Text $g $title 92 235 62 '#FFFFFF' $true 900
  Draw-Text $g $body 92 500 34 '#DCE5FF' $false 900
  $linePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#5FB236'), 10)
  $g.DrawLine($linePen, 92, 1100, 360, 1100); $linePen.Dispose()
  Draw-Text $g $footer 92 1160 22 '#AEBEE5' $false 900
  $path = Join-Path $xhsImages ('{0:D2}-{1}.png' -f $index, @('cover','problem','result','how-it-works','full-paper','features','safety','use','open-source')[$index])
  Save-Png $bmp $path; $g.Dispose()
}

New-Card -index 0 -title "让 Zotero 批注`n从浏览到复核" -body '原生高亮 · 完整阅读 · 精确定位' -footer 'Zotero AI Reader · independent community project' -left '#0B1020' -right '#263B73'
New-Card -index 1 -title '问题：摘要不等于全文' -body '正文里的方法、实验、限制和反例，不应该被 Abstract 遮住。' -footer '先覆盖全文，再决定是否写入。' -left '#152C3B' -right '#4B3067'
New-Card -index 2 -title '结果：写入前先过三道门' -body '全文覆盖 → exact quote → 唯一结果 + 坐标 + sortIndex' -footer '重复文本不会静默选第一个。' -left '#12283C' -right '#1A4D5B'
New-Card -index 3 -title '怎么做到的？' -body '读取 Zotero 已安装的 PDF.js，保留 Reader 字符语义，再从字符几何合成 rects。' -footer '后台处理，不依赖鼠标、键盘或前台 PDF 标签。' -left '#161329' -right '#342F70'
New-Card -index 4 -title '全文优先' -body "purpose / gap / method / result`n每个证据单元带原文、页码、章节和中文摘要。" -footer '颜色是分类提示，不替代研究判断。' -left '#1A2F45' -right '#3E5F75'
New-Card -index 5 -title '核心能力' -body "Background extraction`nUTF-16 aware mapping`nMulti-line geometry`nContext disambiguation`nDuplicate protection" -footer 'Node.js · Zotero 9.0.6 · local bridge' -left '#172036' -right '#503E67'
New-Card -index 6 -title '安全边界' -body "不改 zotero.sqlite`n不上传 PDF`n不使用 OCR`n不执行 GUI 自动化`n写入前先 dry-run" -footer 'Native write 仍会改变你的 Zotero 库，请先备份。' -left '#172A38' -right '#4A3158'
New-Card -index 7 -title '三步开始' -body "安装 Zotero 与 bridge`n运行 doctor + dry-run`n人工确认后再 --apply`n`nnode src/doctor.mjs --json" -footer 'Windows-first public release · exact versions in README.' -left '#20213F' -right '#5A4529'
New-Card -index 8 -title '开源发布' -body "MIT License · clean public history · synthetic assets`n`n欢迎反馈：定位正确性、覆盖门、边界案例。" -footer 'Independent community project · not official Zotero/OpenAI.' -left '#0F1F38' -right '#2A5E65'

function Draw-Box($g, [float]$x, [float]$y, [float]$w, [float]$h, [string]$fill, [string]$stroke, [string]$label, [string]$detail) {
  $fillBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($fill))
  $g.FillRectangle($fillBrush, $x, $y, $w, $h); $fillBrush.Dispose()
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($stroke), 3)
  $g.DrawRectangle($pen, $x, $y, $w, $h); $pen.Dispose()
  Draw-Text $g $label ($x + 24) ($y + 35) 28 '#FFFFFF' $true ($w - 48)
  Draw-Text $g $detail ($x + 24) ($y + 100) 20 '#DCE5FF' $false ($w - 48)
}

function New-DocsArchitecture {
  $parts = New-Canvas -width 1600 -height 900 -left '#0B1020' -right '#182A58'; $bmp=$parts[0];$g=$parts[1]
  Draw-Text $g 'Zotero AI Reader' 100 80 52 '#FFFFFF' $true 1300
  Draw-Text $g 'synthetic release architecture' 100 150 25 '#AAB9E7' $false 1300
  Draw-Box $g 100 300 260 190 '#223568' '#7D96FF' 'Extract' 'whole text layer'
  Draw-Box $g 470 300 260 190 '#1A4D5B' '#57D9BF' 'Cover' 'coverage gate'
  Draw-Box $g 840 300 260 190 '#503E67' '#DB9CFF' 'Locate' 'quote -> geometry'
  Draw-Box $g 1210 300 260 190 '#5E492A' '#FFD27A' 'Save' 'native Zotero path'
  $pen=[System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#8EA8FF'),4); $g.DrawLine($pen,365,395,455,395);$g.DrawLine($pen,735,395,825,395);$g.DrawLine($pen,1105,395,1195,395);$pen.Dispose()
  Draw-Text $g 'Ambiguity is reported · library writes are gated · no GUI automation' 100 680 24 '#D9E3FF' $false 1400
  $path=Join-Path $docsAssets 'architecture.png'; Save-Png $bmp $path; $g.Dispose()
}

function New-DocsAnnotationDemo {
  $parts = New-Canvas -width 1600 -height 1000 -left '#11192B' -right '#263C63'; $bmp=$parts[0];$g=$parts[1]
  Draw-Text $g 'Native geometry, not a screenshot' 90 70 42 '#FFFFFF' $true 1400
  Draw-Text $g 'synthetic PDF page · fictional text · exact rectangles' 90 125 23 '#AEBEE5' $false 1400
  $paper=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#FFFDF6'));$g.FillRectangle($paper,170,205,880,670);$paper.Dispose()
  $line=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#DFE3E9')); for($i=0;$i -lt 11;$i++){ $g.FillRectangle($line,220,326+($i*39),770-(($i%4)*70),18) };$line.Dispose()
  $highlight=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#5FB236'));$g.FillRectangle($highlight,345,396,520,34);$highlight.Dispose()
  Draw-Text $g 'a reproducible synthetic highlight' 355 400 21 '#24341D' $false 500
  $bubble=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F2F6FF'));$g.FillRectangle($bubble,1130,270,340,210);$bubble.Dispose()
  Draw-Text $g 'Annotation' 1170 315 22 '#283B73' $true 290
  Draw-Text $g "pageIndex: 0`nrects: [x1,y1,x2,y2]`nsortIndex: native" 1170 360 19 '#425478' $false 280
  Draw-Text $g 'The visual is illustrative; no real paper, quote, item, or library data is included.' 170 930 23 '#D4E0FF' $false 1300
  $path=Join-Path $docsAssets 'annotation-demo.png'; Save-Png $bmp $path; $g.Dispose()
}

function New-DocsWorkflow {
  $parts = New-Canvas -width 1600 -height 900 -left '#171329' -right '#342F70'; $bmp=$parts[0];$g=$parts[1]
  Draw-Text $g 'A safe annotation workflow' 100 75 50 '#FFFFFF' $true 1400
  Draw-Text $g 'inspect -> plan -> locate -> verify' 100 140 25 '#C9C6EE' $false 1400
  $centers=@(230,590,950,1310);$labels=@('INSPECT','PLAN','LOCATE','VERIFY');$details=@('read all usable pages','keep quote + context','resolve geometry','review before write')
  for($i=0;$i -lt 4;$i++){ $brush=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml(@('#2C2861','#254E5B','#4B3067','#5A4529')[$i]));$g.FillEllipse($brush,$centers[$i]-125,325,250,250);$brush.Dispose();Draw-Text $g $labels[$i] ($centers[$i]-90) 425 28 '#FFFFFF' $true 180;Draw-Text $g $details[$i] ($centers[$i]-100) 475 17 '#D7D4FF' $false 210 }
  $pen=[System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#F2C671'),4);$g.DrawLine($pen,365,450,455,450);$g.DrawLine($pen,725,450,815,450);$g.DrawLine($pen,1085,450,1175,450);$pen.Dispose()
  Draw-Text $g 'Repeated matches stop for human review; no first-result guessing.' 100 760 23 '#DDD8FF' $false 1400
  $path=Join-Path $docsAssets 'workflow.png'; Save-Png $bmp $path; $g.Dispose()
}

New-DocsArchitecture
New-DocsAnnotationDemo
New-DocsWorkflow

Copy-Item (Join-Path $Root 'docs/assets/architecture.svg') (Join-Path $xhsSource 'architecture.svg') -Force
Copy-Item (Join-Path $Root 'docs/assets/annotation-demo.svg') (Join-Path $xhsSource 'annotation-demo.svg') -Force
Copy-Item (Join-Path $Root 'docs/assets/workflow.svg') (Join-Path $xhsSource 'workflow.svg') -Force

foreach ($name in @('architecture','workflow','annotation-demo')) {
  $source = Join-Path $docsAssets "$name.svg"
  $target = Join-Path $docsAssets "$name.png"
  $convert = Get-Command 'rsvg-convert' -ErrorAction SilentlyContinue
  if ($convert) { & $convert.Source -w 1600 -h 1000 $source -o $target }
}

Write-Output "Rendered XHS cards to $xhsImages"
Write-Output 'If a system SVG renderer is available, it was used for docs/assets PNGs; otherwise keep SVG sources and render them in the release preview.'
