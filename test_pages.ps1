$urls = @(
    'http://localhost:3000',
    'http://localhost:3000/login',
    'http://localhost:3000/privacy',
    'http://localhost:3000/terms'
)

foreach ($url in $urls) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
        Write-Host "OK $($r.StatusCode) - $url - $($r.Content.Length) bytes"
    } catch {
        Write-Host "FAIL - $url - $($_.Exception.Message)"
    }
}
