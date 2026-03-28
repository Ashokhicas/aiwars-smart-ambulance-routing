# AmbulAI — Smart Ambulance Routing System 🚑

*An AI-powered emergency dispatch operations platform designed to reduce emergency response times and streamline hospital handoffs.*

## 🏥 Chosen Vertical
**Emergency Medical Services (EMS) & Healthcare**

Emergency dispatchers rely on highly fragmented tools—toggling between map screens, radio communication, and hospital availability charts. This fragmentation leads to suboptimal ambulance choices, delays, and poor advanced warning for receiving hospitals. AmbulAI solves this by unifying dispatch intelligence into one seamless dashboard powered by multi-agent AI.

---

## 🧠 Approach and Logic
AmbulAI leverages a **Multi-Agent orchestration model** using **AutoGen** and **Google's Gemini 2.0**. Instead of a single monolithic prompt, we utilize highly specialized sub-agents working together in a `GroupChat` flow:

1. **Intake Agent**: Accepts raw disaster/medical descriptions (voice or text), extracts structured data (e.g., event type, severity, specific symptoms, location).
2. **Routing Agent**: Evaluates the entire active ambulance fleet. It ranks units using a composite score based on: ETA (via Maps APIs), unit type readiness (e.g., ALS vs. BLS), crew shift hours (combatting fatigue), and fuel percentage.
3. **Hospital Selection Agent**: Selects the optimal receiving Emergency Room based on proximity, matching trauma capability level, dynamic bed capacity, and diversion status.
4. **Pre-Alert Agent**: Auto-generates a standardized hand-off summary delivered via SMS and push notifications to the scheduled ER nurse immediately upon ambulance dispatch.

---

## 💡 How the Solution Works
### **Technology Stack**
- **Frontend**: React 18, Vite, and **Shadcn UI** (TailwindCSS) rendering a hyper-responsive 3-pane workstation.
- **Backend API**: **FastAPI** (Python 3.12) acting as the integration layer.
- **AI Core**: **PyAutoGen** communicating with **Gemini Flash**.
- **State & Data**: PostgreSQL for structured events and Redis for real-time WebSocket vehicle tracking (for production).

### **User Workflow (MVP)**
1. The dispatcher enters the details of an incident to the platform (e.g., *"Car accident on MG Road near Trinity Circle, 2 victims..."*).
2. The UI pushes the structured event down to the FastAPI backend.
3. The AutoGen agents collaborate to parse the data, evaluate the mock fleet list, and return top-2 recommendations.
4. The dispatcher visualizes the fastest assigned route mapped on the UI and clicks **"Confirm & Dispatch"**.
5. The system transitions into a deployed state, firing off a generated ER PRE-ALERT to the selected hospital.

---

## ⚠️ Assumptions Made for the MVP
- **API Availability**: Assumes full availability of downstream Google Maps Routes API (Stubbed in the MVP frontend iteration).
- **Hospital Capability Webhooks**: Assumes ER intake teams have a compatible system to read incoming capability polling (Bed count, Diversion flag) in real-time. Wait time is simulated.
- **Vehicle Telemetry**: Assumes the ambulance fleet constantly transmits valid GPS lat/long updates via a stable 4G/5G WebSocket layer every 10 seconds.
- **Hardware Profile**: Assumes dispatchers are working on modern desktop browsers with >1080p width to fully utilize the parallel panel workflow. 
- **Bypass NLP Processing Limits**: We assume the initial unstructured intake provided over noisy EMS radios can be accurately translated by the front-end speech-to-text integration before hitting the Intake AI agent.

---

## 🚀 Getting Started

To run the local MVP environment (natively on Windows):

**1. API Backend (Python)**
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**2. Dispatcher Frontend (Node/React)**
```powershell
cd frontend
pnpm install
pnpm run dev
```

Visit `http://localhost:3000` to dive into the dispatch view.
