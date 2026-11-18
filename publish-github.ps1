param(
    [switch]$Publish,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')]
    [string]$Repository = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $root 'package.json'))) {
    throw 'Запускайте скрипт из готовой папки проекта рядом с package.json.'
}
if (-not $Repository) { $Repository = Split-Path -Leaf $root }
$allowed = @('README.md', 'GITHUB.md', 'DESIGN.md', 'PRODUCT.md', '.gitignore', 'package.json', 'start.bat', 'server.js', 'engine.js', 'public', 'examples', 'docs', 'publish-github.ps1')
$entries = @($allowed | Where-Object { Test-Path -LiteralPath (Join-Path $root $_) })
Write-Host "Приватный репозиторий: $Repository"
Write-Host ('Файлы и папки: ' + ($entries -join ', '))
Write-Host 'data/, .env, журналы и материалы разработки не добавляются.'
if (-not $Publish) {
    Write-Host 'Режим просмотра: файлы не изменены, запросов к GitHub нет.'
    Write-Host 'Для загрузки после авторизации повторите команду с -Publish.'
    exit 0
}
foreach ($command in @('git', 'gh')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Установите $command, затем повторите команду. См. GITHUB.md." }
}
if (Test-Path -LiteralPath (Join-Path $root '.git')) {
    throw 'В папке уже есть Git. Скрипт предназначен для первой загрузки чистой папки. Для продолжения используйте команды из GITHUB.md.'
}
foreach ($entry in $entries) {
    $item = Get-Item -LiteralPath (Join-Path $root $entry) -Force
    $items = @($item)
    if ($item.PSIsContainer) { $items += @(Get-ChildItem -LiteralPath $item.FullName -Recurse -Force) }
    foreach ($candidate in $items) {
        if ($candidate.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Ссылка не включается в загрузку: $($candidate.FullName)" }
        if ($candidate.Name -match '^(\.env(?:\..*)?|data|node_modules|.*\.(?:log|pem|key|pfx))$') { throw "Проверьте лишний файл: $($candidate.FullName)" }
    }
}
Push-Location -LiteralPath $root
try {
    & gh auth status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Сначала выполните gh auth login, затем повторите команду.' }
    $gitName = & git config user.name
    $gitEmail = & git config user.email
    if (-not $gitName -or -not $gitEmail) { throw 'Укажите имя и email для Git по инструкции GITHUB.md. Скрипт не меняет глобальные настройки.' }
    & git init -b main
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать локальный Git-репозиторий.' }
    & git add -- $entries
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить файлы для коммита.' }
    & git commit -m 'Initial portfolio project'
    if ($LASTEXITCODE -ne 0) { throw 'Коммит не создан. Исправьте указанную Git ошибку; см. GITHUB.md.' }
    & gh repo create $Repository --private --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { throw 'Загрузка не завершена. Локальный коммит сохранён. Проверьте сообщение GitHub и раздел «Если загрузка прервалась» в GITHUB.md.' }
    Write-Host 'Проект загружен в приватный репозиторий. Приглашения другим людям не отправлялись.'
} finally { Pop-Location }
