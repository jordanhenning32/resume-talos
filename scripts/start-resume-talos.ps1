# Resume Talos launcher with splash screen.
# Shows a dark-themed loading window immediately, starts the Next.js dev
# server in a minimized child window, polls until the server responds,
# then opens the browser and closes the splash.

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$iconPath = Join-Path $here 'resume-talos-mark.ico'
$devCmd   = Join-Path $here '_dev-server.cmd'
$port     = 3200
$url      = "http://localhost:$port/applications"
$probeUrl = "http://localhost:$port"
$slowStartAttempt = 240

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Fast path: server already running -> just open the browser.
try {
    Invoke-WebRequest -Uri $probeUrl -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop | Out-Null
    Start-Process $url
    return
} catch {}

# --- Splash form ---
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'FixedSingle'
$form.ControlBox = $false
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size 460, 240
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$form.TopMost = $true
$form.ShowInTaskbar = $true
$form.Text = 'Resume Talos'
if (Test-Path $iconPath) {
    try { $form.Icon = New-Object System.Drawing.Icon $iconPath } catch {}
}

# Title
$title = New-Object System.Windows.Forms.Label
$title.Text = 'Resume Talos'
$title.Font = New-Object System.Drawing.Font('Cambria', 22, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
$title.AutoSize = $false
$title.TextAlign = 'MiddleCenter'
$title.SetBounds(0, 40, 460, 40)
$form.Controls.Add($title)

# Subtitle (UseMnemonic=false so the '&' renders literally)
$subtitle = New-Object System.Windows.Forms.Label
$subtitle.UseMnemonic = $false
$subtitle.Text = 'Multi-agent resume & cover letter factory'
$subtitle.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(100, 116, 139)
$subtitle.AutoSize = $false
$subtitle.TextAlign = 'MiddleCenter'
$subtitle.SetBounds(0, 84, 460, 20)
$form.Controls.Add($subtitle)

# Status line
$status = New-Object System.Windows.Forms.Label
$status.Text = 'Starting dev server...'
$status.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$status.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$status.AutoSize = $false
$status.TextAlign = 'MiddleCenter'
$status.SetBounds(0, 128, 460, 24)
$form.Controls.Add($status)

# Progress (marquee = indeterminate)
$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Style = 'Marquee'
$progress.MarqueeAnimationSpeed = 30
$progress.SetBounds(70, 168, 320, 8)
$form.Controls.Add($progress)

# Amber accent line matching the icon
$accent = New-Object System.Windows.Forms.Panel
$accent.BackColor = [System.Drawing.Color]::FromArgb(245, 158, 11)
$accent.SetBounds(200, 200, 60, 3)
$form.Controls.Add($accent)

# Start the dev server as a minimized child process.
try {
    $serverProc = Start-Process -FilePath $devCmd -WindowStyle Minimized -PassThru
} catch {
    $status.ForeColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
    $status.Text = "Could not start dev server: $($_.Exception.Message)"
    $progress.Style = 'Continuous'
    $progress.Value = 100
    [void]$form.ShowDialog()
    return
}

# Poll for readiness
$script:attempts = 0
$script:canDismiss = $false
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
    $script:attempts++

    # Dev server died before we got a response
    if ($serverProc.HasExited) {
        $status.ForeColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
        $status.Text = 'Dev server exited. Restore the Dev Server window for details.'
        $progress.Style = 'Continuous'
        $progress.Value = 100
        $timer.Stop()
        return
    }

    # Progress messaging
    if ($script:attempts -eq 6)  { $status.Text = 'Compiling routes...' }
    if ($script:attempts -eq 20) { $status.Text = 'Still compiling (first build is the slow one)...' }
    if ($script:attempts -eq 60) { $status.Text = 'Taking longer than usual...' }
    if ($script:attempts -eq $slowStartAttempt) {
        $script:canDismiss = $true
        $status.ForeColor = [System.Drawing.Color]::FromArgb(251, 191, 36)
        $status.Text = 'Still waiting. Click here to dismiss, or check Dev Server logs.'
    }

    # Try the port
    try {
        Invoke-WebRequest -Uri $probeUrl -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop | Out-Null
        $status.ForeColor = [System.Drawing.Color]::FromArgb(134, 239, 172)
        $status.Text = 'Ready. Opening browser...'
        $progress.Style = 'Continuous'
        $progress.Value = 100
        $timer.Stop()
        Start-Sleep -Milliseconds 350
        Start-Process $url
        $form.Close()
        return
    } catch { }

    # Keep polling while the dev server is alive. Next.js first compiles can run
    # past two minutes on cold caches, and stopping here creates a false failure.
})

$form.Add_Shown({ $timer.Start() })
$form.Add_FormClosed({ $timer.Stop() })

# Allow click anywhere on the splash to dismiss after an error or a long wait.
$dismiss = { if ((-not $timer.Enabled) -or $script:canDismiss) { $form.Close() } }
$form.Add_Click($dismiss)
$title.Add_Click($dismiss)
$subtitle.Add_Click($dismiss)
$status.Add_Click($dismiss)

[void]$form.ShowDialog()
