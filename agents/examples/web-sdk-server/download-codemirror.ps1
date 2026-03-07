# Download CodeMirror libraries locally
$baseUrl = "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16"
$targetDir = "src\main\resources\static\apps\terminal\libs\codemirror"

# Create directories
New-Item -ItemType Directory -Force -Path "$targetDir\css" | Out-Null
New-Item -ItemType Directory -Force -Path "$targetDir\js" | Out-Null
New-Item -ItemType Directory -Force -Path "$targetDir\mode" | Out-Null
New-Item -ItemType Directory -Force -Path "$targetDir\addon" | Out-Null
New-Item -ItemType Directory -Force -Path "$targetDir\theme" | Out-Null

Write-Host "Downloading CodeMirror libraries..."

# CSS files
Write-Host "Downloading CSS..."
Invoke-WebRequest -Uri "$baseUrl/codemirror.min.css" -OutFile "$targetDir\css\codemirror.min.css"
Invoke-WebRequest -Uri "$baseUrl/theme/monokai.min.css" -OutFile "$targetDir\theme\monokai.min.css"

# Core JS
Write-Host "Downloading core JS..."
Invoke-WebRequest -Uri "$baseUrl/codemirror.min.js" -OutFile "$targetDir\js\codemirror.min.js"

# Language modes
Write-Host "Downloading language modes..."
$modes = @(
    "javascript/javascript.min.js",
    "xml/xml.min.js",
    "css/css.min.js",
    "htmlmixed/htmlmixed.min.js",
    "python/python.min.js",
    "markdown/markdown.min.js",
    "yaml/yaml.min.js",
    "shell/shell.min.js",
    "sql/sql.min.js",
    "clike/clike.min.js",
    "php/php.min.js",
    "ruby/ruby.min.js",
    "go/go.min.js",
    "rust/rust.min.js",
    "swift/swift.min.js",
    "properties/properties.min.js"
)

foreach ($mode in $modes) {
    $modeName = Split-Path $mode -Parent
    New-Item -ItemType Directory -Force -Path "$targetDir\mode\$modeName" | Out-Null
    Write-Host "  - $mode"
    Invoke-WebRequest -Uri "$baseUrl/mode/$mode" -OutFile "$targetDir\mode\$mode"
}

# Addons
Write-Host "Downloading addons..."
$addons = @(
    "edit/matchbrackets.min.js",
    "edit/closebrackets.min.js",
    "selection/active-line.min.js",
    "search/match-highlighter.min.js",
    "search/matchesonscrollbar.min.js",
    "search/matchesonscrollbar.css"
)

foreach ($addon in $addons) {
    $addonDir = Split-Path $addon -Parent
    New-Item -ItemType Directory -Force -Path "$targetDir\addon\$addonDir" | Out-Null
    Write-Host "  - $addon"
    Invoke-WebRequest -Uri "$baseUrl/addon/$addon" -OutFile "$targetDir\addon\$addon"
}

Write-Host "✅ All CodeMirror libraries downloaded successfully!"

