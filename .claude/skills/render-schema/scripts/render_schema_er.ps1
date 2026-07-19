<#
.SYNOPSIS
Re-renders docs/schema-er.png from the mermaid ER diagram embedded in
docs/schema.md.

.NOTES
Needs @mermaid-js/mermaid-cli (`mmdc`) installed and on PATH
(`npm install -g @mermaid-js/mermaid-cli`) - confirmed already installed on
this machine as of 2026-07-19, pulling in Puppeteer/Chromium as a
dependency (first install elsewhere may take a while / need Chromium to
download).

Settings were determined by matching the file already committed to the repo
(9536x2792px, ~768KB, mermaid's default theme/background/width/height) -
`-s 12` (Puppeteer's device-scale factor) is what reproduces that
resolution; everything else is mmdc's plain default, no other flags needed.
Don't "clean up" this scale value down to something smaller without a
reason - it's not arbitrary, it's what makes the re-render match the
established look instead of coming out blurry/small (mmdc's scale-1
default renders at roughly 1/12th this size for this diagram).

mmdc's markdown-input mode (`-i docs/schema.md`, letting it extract the
```mermaid fenced block itself rather than us maintaining a separate .mmd
copy that could drift from the doc) always appends "-1" to the output
filename, one per diagram found, even when there's only one - this script
renders to a temp name then renames the "-1" result to the real
docs/schema-er.png, so callers don't need to know about that quirk.

.EXAMPLE
.claude\skills\render-schema\scripts\render_schema_er.ps1
#>
$repoRoot = Join-Path $PSScriptRoot "..\..\..\.."
$schemaFile = Join-Path $repoRoot "docs\schema.md"
$outputFile = Join-Path $repoRoot "docs\schema-er.png"
$tempBase = Join-Path $repoRoot "docs\schema-er-render-tmp.png"
$tempActual = Join-Path $repoRoot "docs\schema-er-render-tmp-1.png"

if (-not (Test-Path $schemaFile)) {
    Write-Error "docs/schema.md not found at $schemaFile"
    exit 1
}

mmdc -i $schemaFile -s 12 -o $tempBase

if (-not (Test-Path $tempActual)) {
    Write-Error "mmdc did not produce the expected output at $tempActual - check its output above (missing mmdc on PATH? no mermaid code block found in docs/schema.md?)."
    exit 1
}

Move-Item -Path $tempActual -Destination $outputFile -Force
Write-Output "Re-rendered $outputFile"
