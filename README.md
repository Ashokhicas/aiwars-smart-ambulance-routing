# AmbulAI — Smart Ambulance Routing System

*An AI-powered emergency dispatch platform that reduces response times by unifying incident intake, fleet assignment, and hospital selection into a single Gemini-powered dashboard.*

---

## Chosen Vertical

**Emergency Medical Services (EMS) & Healthcare**

Emergency dispatchers today toggle between fragmented tools — radio feeds, separate map screens, and manual hospital availability checks. This fragmentation causes delays in ambulance assignment and poor handoff preparation for receiving hospitals. AmbulAI solves this by combining multimodal incident intake, AI-driven fleet dispatch, and live Google Maps routing into one unified workstation.

---

## Approach and Logic

AmbulAI uses **Google Gemini 2.0 Flash** as its reasoning core across two distinct decision stages:

### 1. Multimodal Incident Intake (Gemini Vision + Text)
When a 911 call comes in, the system accepts **text, voice audio, or a scene photo** (or all three). Gemini analyzes the combined input and returns structured JSON containing:
- Incident type (`trauma`, `cardiac_arrest`, `stroke`, `violent_crime`, etc.)
- Triage severity (`P1` critical → `P3` minor)
- Precise GPS coordinates inferred from the description
- 3 nearest real-world hospitals and 1 nearest police station (Gemini geographic reasoning)

### 2. AI Dispatch Optimization (Gemini Fleet Scoring)
Gemini receives the live fleet telemetry (GPS, fuel %, crew shift hours) and hospital network (trauma level, bed count, diversion status) and returns a ranked recommendation of the **top 2 ambulance units** with:
- Realistic ETA estimates based on lat/lng distance
- Confidence scores
- Natural language rationale explaining why each unit was chosen over others
- Optimal receiving hospital matched to trauma level

Both stages include **graceful offline fallback** so the app remains functional even without an API key.

---

## How the Solution Works

### Architecture

```
[Public Reporter / Dispatcher]
        │
        ▼
[React 18 Frontend] ──── /api/ ────► [FastAPI Backend]
   Google Maps SDK                        │
   Traffic Layer                    Gemini 2.0 Flash
   Directions API                         │
                                    SQLite (incidents,
                                    ambulances, hospitals)
```

### User Workflow

**Public Mode:**
1. Citizen opens the public portal and types, records voice, or takes a photo
2. The AI extracts location, severity, and nearby services
3. The view automatically switches to the dispatch workstation

**Dispatch Mode:**
1. Dispatcher sees the incident pinned on a live Google Maps satellite view with real-time traffic overlay
2. Gemini recommends the top 2 ambulance units ranked by ETA, fuel, and crew fatigue
3. Recommended hospital is pre-selected based on trauma level matching
4. Dispatcher clicks **Execute Protocols** — the map draws the live-traffic-aware route polyline from the ambulance to the incident
5. An HL7-style pre-alert is marked as sent to the receiving hospital; police station is paged

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, TailwindCSS, Shadcn UI |
| Maps | `@vis.gl/react-google-maps` — Google Maps, Traffic Layer, Directions API |
| Backend | FastAPI (Python 3.12), SQLAlchemy, SQLite |
| AI | Google Gemini 2.0 Flash (`google-generativeai` SDK) |
| Deployment | Google Cloud Run (backend + frontend), Artifact Registry |
| CI | GitHub Actions (pytest + pnpm build) |

### Google Services Used

- **Gemini 2.0 Flash** — multimodal incident parsing, dispatch optimization, geographic hospital discovery
- **Google Maps JavaScript API** — satellite map rendering, real-time traffic layer
- **Google Maps Directions API** — live-traffic-aware route polyline from ambulance to incident
- **Google Cloud Run** — containerized deployment of both backend and frontend
- **Google Artifact Registry** — Docker image storage
- **Google Cloud Build** — image build pipeline

---

## Running Locally

### Prerequisites
- Python 3.12+
- Node.js 20+ with pnpm (`npm install -g pnpm`)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/)
- A Google Maps API key from [Google Cloud Console](https://console.cloud.google.com/) (enable Maps JavaScript API + Directions API)

### Setup

**1. Environment Variables**

Copy `.env.example` to `.env` in the repo root and fill in your keys:
```
GEMINI_API_KEY=your_gemini_key_here
MAPS_API_KEY=your_maps_key_here
```

**2. Backend**
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**3. Frontend**
```powershell
cd frontend
pnpm install
pnpm run dev
```

Visit `http://localhost:3000`

### Running Tests
```powershell
cd backend
pytest tests/ -v
```

---

## Deploying to GCP

Add these GitHub Actions secrets to your repository:
- `GCP_PROJECT_ID`
- `GCP_REGION` (e.g. `us-central1`)
- `GCP_CREDENTIALS` (service account JSON)
- `GEMINI_API_KEY`
- `MAPS_API_KEY`

Push to `main` — the CI/CD pipeline in `.github/workflows/deploy-gcp.yml` builds and deploys automatically.

For manual deployment:
```powershell
.\deploy-gcp.ps1 -ProjectId your-project-id -GeminiApiKey your-key -MapsApiKey your-maps-key
```

---

## Assumptions Made

- **API Availability**: Assumes Gemini and Google Maps APIs are reachable. Both have offline fallbacks.
- **Location Inference**: Gemini infers GPS coordinates from natural language descriptions. Accuracy depends on how specific the caller's description is.
- **Fleet Telemetry**: Ambulance positions are seeded as realistic Bangalore coordinates. In production these would update via WebSocket telemetry.
- **Hospital Capacity**: Bed counts and diversion status are seeded mock values. Production would poll live hospital APIs.
- **ER Pre-Alert**: The "HL7 Data Sent" state simulates the handoff. A real integration would POST to an HL7 FHIR endpoint.
- **Desktop-first UI**: The dispatch workstation is optimized for wide screens (≥1080px). The public reporter form is fully responsive.
