# Waits for the Resume Talos server to answer on the given port, then opens
# the browser to the applications page. Launched detached + minimized by
# deploy-resume-talos.cmd so the deploy console stays focused on server logs.
param([int]$Port = 3200)

$probe = "http://localhost:$Port"
$open  = "http://localhost:$Port/applications"

# Poll up to ~5 minutes (600 * 500ms). First production start is the slow one.
for ($i = 0; $i -lt 600; $i++) {
    try {
        Invoke-WebRequest -Uri $probe -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop | Out-Null
        Start-Process $open
        break
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
