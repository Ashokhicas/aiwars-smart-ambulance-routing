param (
    [Parameter(Mandatory=$true)]
    [string]$ProjectId,

    [Parameter(Mandatory=$false)]
    [string]$GeminiApiKey = "",

    [Parameter(Mandatory=$false)]
    [string]$MapsApiKey = "",

    [string]$Region = "us-central1",
    [string]$RepoName = "ambulai-artifacts",
    [string]$BackendService = "ambulai-backend",
    [string]$FrontendService = "ambulai-frontend"
)

# ---------------------------------------------------------------------------
# Helper: parse KEY=VALUE lines from a .env file
# ---------------------------------------------------------------------------
function Read-EnvFile {
    param([string]$Path)
    $vars = @{}
    if (Test-Path $Path) {
        Get-Content $Path | ForEach-Object {
            # Skip blank lines and comments
            if ($_ -match '^\s*([^#\s][^=]*?)\s*=\s*(.*?)\s*$') {
                $vars[$matches[1]] = $matches[2]
            }
        }
    }
    return $vars
}

# ---------------------------------------------------------------------------
# Resolve API keys: CLI param > .env file > error
# ---------------------------------------------------------------------------
$envFile = Join-Path $PSScriptRoot ".env"
$envVars = Read-EnvFile -Path $envFile

if (-not $GeminiApiKey) {
    $GeminiApiKey = $envVars["GEMINI_API_KEY"]
}
if (-not $MapsApiKey) {
    $MapsApiKey = $envVars["MAPS_API_KEY"]
}

if (-not $GeminiApiKey) {
    Write-Host "ERROR: GEMINI_API_KEY not found. Pass -GeminiApiKey or set it in .env" -ForegroundColor Red
    exit 1
}
if (-not $MapsApiKey) {
    Write-Host "WARNING: MAPS_API_KEY not set. Map features will require the key to be configured later." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Starting GCP Deployment for AmbulAI" -ForegroundColor Cyan
Write-Host "  Project : $ProjectId" -ForegroundColor Gray
Write-Host "  Region  : $Region" -ForegroundColor Gray
Write-Host "  Gemini  : $($GeminiApiKey.Substring(0, [Math]::Min(8, $GeminiApiKey.Length)))..." -ForegroundColor Gray
Write-Host "  Maps    : $(if ($MapsApiKey) { $MapsApiKey.Substring(0, [Math]::Min(8, $MapsApiKey.Length)) + '...' } else { '(not set)' })" -ForegroundColor Gray
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Set Project & enable required APIs
# ---------------------------------------------------------------------------
Write-Host "=> Setting GCP Project" -ForegroundColor Yellow
gcloud config set project $ProjectId
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com

# ---------------------------------------------------------------------------
# 2. Ensure Artifact Registry repository exists
# ---------------------------------------------------------------------------
Write-Host "=> Configuring Artifact Registry" -ForegroundColor Yellow
$repoExists = gcloud artifacts repositories describe $RepoName --location=$Region --format="value(name)" 2>$null
if (-not $repoExists) {
    gcloud artifacts repositories create $RepoName `
        --repository-format=docker `
        --location=$Region `
        --description="AmbulAI Container Registry"
    Write-Host "   Created repository: $RepoName" -ForegroundColor Green
}

gcloud auth configure-docker "${Region}-docker.pkg.dev" --quiet

# ---------------------------------------------------------------------------
# 3. Build & Deploy Backend
# ---------------------------------------------------------------------------
$BackendImage = "${Region}-docker.pkg.dev/${ProjectId}/${RepoName}/${BackendService}:latest"

Write-Host "=> Building Backend image via Cloud Build" -ForegroundColor Yellow
gcloud builds submit --tag $BackendImage ./backend --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend build failed. Aborting." -ForegroundColor Red
    exit 1
}

Write-Host "=> Deploying Backend to Cloud Run" -ForegroundColor Yellow
gcloud run deploy $BackendService `
    --image=$BackendImage `
    --region=$Region `
    --allow-unauthenticated `
    --port=8080 `
    --max-instances=5 `
    --memory=512Mi `
    --cpu=1 `
    --set-env-vars="GEMINI_API_KEY=$GeminiApiKey,MAPS_API_KEY=$MapsApiKey"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend deployment failed. Aborting." -ForegroundColor Red
    exit 1
}

$BackendUrl = gcloud run services describe $BackendService --platform managed --region $Region --format="value(status.url)"
Write-Host "   Backend live: $BackendUrl" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Build & Deploy Frontend
# ---------------------------------------------------------------------------
$FrontendImage = "${Region}-docker.pkg.dev/${ProjectId}/${RepoName}/${FrontendService}:latest"

Write-Host "=> Building Frontend image via Cloud Build" -ForegroundColor Yellow
gcloud builds submit --tag $FrontendImage ./frontend --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed. Aborting." -ForegroundColor Red
    exit 1
}

Write-Host "=> Deploying Frontend to Cloud Run" -ForegroundColor Yellow
gcloud run deploy $FrontendService `
    --image=$FrontendImage `
    --region=$Region `
    --allow-unauthenticated `
    --port=8080 `
    --max-instances=3 `
    --memory=256Mi `
    --cpu=1 `
    --set-env-vars="BACKEND_URL=$BackendUrl"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend deployment failed." -ForegroundColor Red
    exit 1
}

$FrontendUrl = gcloud run services describe $FrontendService --platform managed --region $Region --format="value(status.url)"

Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host "  AMBULAI DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host "Backend  : $BackendUrl" -ForegroundColor Cyan
Write-Host "Frontend : $FrontendUrl" -ForegroundColor Cyan
Write-Host ""
