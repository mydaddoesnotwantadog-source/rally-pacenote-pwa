$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://*:8080/")
$listener.Start()
Write-Host "Listening on http://*:8080/ (accessible from other devices on your local network)"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        try {
            $localPath = $request.Url.LocalPath
            if ($localPath -eq "/") {
                $localPath = "/index.html"
            }
            
            $filePath = Join-Path $PWD.Path $localPath.Replace("/", "\")
            
            if (Test-Path $filePath -PathType Leaf) {
                $content = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentLength64 = $content.Length
                
                $ext = [System.IO.Path]::GetExtension($filePath)
                switch ($ext) {
                    ".html" { $response.ContentType = "text/html" }
                    ".css"  { $response.ContentType = "text/css" }
                    ".js"   { $response.ContentType = "application/javascript" }
                    ".json" { $response.ContentType = "application/json" }
                    ".ogg"  { $response.ContentType = "audio/ogg" }
                    ".png"  { $response.ContentType = "image/png" }
                    ".svg"  { $response.ContentType = "image/svg+xml" }
                    default { $response.ContentType = "application/octet-stream" }
                }
                
                $response.OutputStream.Write($content, 0, $content.Length)
            } else {
                $response.StatusCode = 404
            }
        } catch {
            # Ignore connection aborted errors
        } finally {
            $response.Close()
        }
    }
} finally {
    $listener.Stop()
}
