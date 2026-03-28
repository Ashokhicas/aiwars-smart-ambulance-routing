param (
    [Parameter(Mandatory=$true)]
    [string]$ProjectId,

    [Parameter(Mandatory=$true)]
    [string]$GeminiApiKey,

    [Parameter(Mandatory=$false)]
    [string]$MapsApiKey = "",

    [string]$Region = "us-central1",
    [string]$RepoName = "ambulai-artifacts",
    [string]$BackendService = "ambulai-backend",
    [string]$FrontendService = "ambulai-frontend"
)

Write-Host "Starting GCP Deployment for AmbulAI" -ForegroundColor Cyan

# 1. Set Project
Write-Host "=> Setting GCP Project" -ForegroundColor Yellow
gcloud config set project $ProjectId
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com

# 2. Check/Create Artifact Registry Repository
Write-Host "=> Configuring Artifact Registry" -ForegroundColor Yellow
$repoExists = gcloud artifacts repositories describe $RepoName --location=$Region --format="value(name)" 2>$null
if (-not $repoExists) {
    gcloud artifacts repositories create $RepoName `
        --repository-format=docker `
        --location=$Region `
        --description="AmbulAI Container Registry"
    Write-Host "   Created repository: $RepoName" -ForegroundColor Green
}

# Configure Docker auth for Artifact Registry
gcloud auth configure-docker "${Region}-docker.pkg.dev" --quiet

# 3. Build & Deploy Backend
$BackendImage = "${Region}-docker.pkg.dev/${ProjectId}/${RepoName}/${BackendService}:latest"
Write-Host "=> Submitting Backend to Google Cloud Build" -ForegroundColor Yellow
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
Write-Host "   Backend is live at: $BackendUrl" -ForegroundColor Green

# 4. Build & Deploy Frontend
$FrontendImage = "${Region}-docker.pkg.dev/${ProjectId}/${RepoName}/${FrontendService}:latest"
Write-Host "=> Submitting Frontend to Google Cloud Build" -ForegroundColor Yellow
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
Write-Host "`n===============================================" -ForegroundColor Green
Write-Host "  AMBULAI DEPLOYMENT COMPLETED" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host "Backend API: $BackendUrl" -ForegroundColor Cyan
Write-Host "Frontend Portal: $FrontendUrl" -ForegroundColor Cyan
Write-Host "Click the Frontend Portal link above to launch your application in production." -ForegroundColor Yellow
