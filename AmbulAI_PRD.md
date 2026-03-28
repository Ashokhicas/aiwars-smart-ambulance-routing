# AmbulAI — Smart Ambulance Routing System
### Product Requirements Document · v1.0

| Field | Value |
|---|---|
| Version | 1.0.0 — Initial Release |
| Status | Draft for Review |
| Domain | Emergency Medical Services |
| Platform | Web (React + Vite) · API (FastAPI) · GCP |
| Last Updated | 2026-03-28 |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Stakeholders & User Personas](#2-stakeholders--user-personas)
3. [System Architecture](#3-system-architecture)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Data Model](#6-data-model)
7. [API Design](#7-api-design)
8. [Frontend Specification](#8-frontend-specification)
9. [AI Agent Pipeline](#9-ai-agent-pipeline)
10. [Infrastructure & DevOps](#10-infrastructure--devops)
11. [Repository & Project Structure](#11-repository--project-structure)
12. [Delivery Milestones](#12-delivery-milestones)
13. [Risks & Mitigations](#13-risks--mitigations)
14. [Open Questions](#14-open-questions)
15. [Glossary](#15-glossary)

---

## 1. Executive Summary

AmbulAI is an AI-powered ambulance dispatch and routing platform that transforms unstructured emergency incident data — spoken dispatcher descriptions, real-time traffic feeds, weather alerts, and hospital capacity data — into structured, optimized dispatch decisions and dynamic routing guidance.

The system reduces average emergency response time by intelligently selecting the closest available unit, computing the optimal traffic-aware route, and pre-alerting the receiving hospital with a structured patient summary — all within seconds of an incident being logged.

### 1.1 Problem Statement

EMS dispatchers currently rely on fragmented information sources: manual traffic checks, verbal radio communications, static routing software, and siloed hospital systems. This fragmentation directly delays response times, misallocates ambulance units, and results in sub-optimal hospital handoff — consequences that can cost lives in time-critical emergencies such as cardiac arrest, stroke, and trauma.

### 1.2 Solution Overview

AmbulAI introduces a unified dispatcher workstation powered by Google Gemini AI and AutoGen multi-agent orchestration. The system:

- Accepts voice or typed incident description from the dispatcher
- Extracts structured incident metadata using Gemini function calling
- Cross-references live Google Maps traffic and weather data
- Evaluates fleet availability from a real-time database
- Returns a ranked list of optimized ambulance assignments with ETAs
- Auto-generates and delivers an ER pre-alert on dispatch confirmation

### 1.3 Goals & Success Metrics

| Goal | Metric | Target |
|---|---|---|
| Faster dispatch | Time from incident call to ambulance dispatch | < 60 seconds |
| Optimized routing | ETA accuracy vs. actual arrival | ± 2 minutes |
| Fleet efficiency | Reduction in ambulance idle repositioning | > 20% |
| ER pre-alert adoption | % incidents with auto-generated pre-alert sent | > 90% |
| System uptime | Availability SLA | 99.9% |
| AI recommendation acceptance | % dispatches using AI recommendation without override | > 70% |

---

## 2. Stakeholders & User Personas

### 2.1 Primary Stakeholders

| Stakeholder | Role | Primary Interest |
|---|---|---|
| EMS Dispatcher | Primary User | Fast, accurate dispatch recommendations with minimal cognitive load |
| Ambulance Crew | Secondary User | Clear turn-by-turn routing, live traffic updates, and patient pre-info |
| ER Admissions Nurse | Secondary User | Advance patient details to prepare resuscitation bay or trauma team |
| EMS Operations Manager | Admin | Fleet utilization analytics, incident logs, and performance dashboards |
| Hospital IT / Security | Compliance | HIPAA compliance, audit trails, and data retention policies |

### 2.2 User Personas

#### Persona A — Dispatcher Dana
Dana is a 911 EMS dispatcher with 8 years of experience. She manages 12 ambulances simultaneously during peak hours. Her pain points include toggling between 4 different screens, manually checking Google Maps traffic, and reading back hospital availability over the phone. She needs a single unified workstation that gives her smart suggestions without removing her authority to override.

**Key needs:** One-screen view of all units, voice incident intake, sub-60-second dispatch, confidence in AI suggestions.

#### Persona B — Paramedic Sam
Sam drives an Advanced Life Support unit. He needs real-time route updates when traffic changes mid-response, automated ER pre-alerts so the receiving team is ready on arrival, and a simple mobile-friendly interface that works with one hand while his partner treats the patient.

**Key needs:** Live rerouting, ER pre-alert confirmation, clear status updates, minimal UI interaction while driving.

#### Persona C — ER Charge Nurse Rachel
Rachel manages the ER's incoming patient flow. She needs structured, early patient information — suspected diagnosis, vitals if available, ETA — so she can staff resources proactively rather than scrambling reactively when the ambulance arrives.

**Key needs:** Structured pre-alert with incident type, ETA, severity, and special notes. Delivered via both in-app notification and SMS.

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        GCP Cloud Run                           │
│                                                                │
│  ┌──────────────────┐          ┌────────────────────────────┐  │
│  │  React Frontend  │◄────────►│     FastAPI Backend        │  │
│  │  (Vite + Shadcn) │  REST /  │  (Python 3.12 + Uvicorn)  │  │
│  │  Zustand         │  WS      │                            │  │
│  │  TanStack Query  │          │  ┌──────────────────────┐  │  │
│  │  Zod             │          │  │  AutoGen Agent Group  │  │  │
│  └──────────────────┘          │  │  ┌────────────────┐  │  │  │
│                                │  │  │  Intake Agent  │  │  │  │
│                                │  │  │  Routing Agent │  │  │  │
│                                │  │  │  Hospital Agent│  │  │  │
│                                │  │  │  PreAlert Agent│  │  │  │
│                                │  │  └────────────────┘  │  │  │
│                                │  └──────────────────────┘  │  │
│                                └────────────┬───────────────┘  │
└─────────────────────────────────────────────┼──────────────────┘
                                              │
          ┌───────────────────────────────────┼──────────────────┐
          │              External Services    │                  │
          │                                   │                  │
          │  ┌──────────────┐  ┌────────────┐ │ ┌─────────────┐  │
          │  │ Gemini 2.0   │  │ Maps Routes│ │ │  Cloud SQL  │  │
          │  │ Flash API    │  │ & Geocoding│ │ │ (PostgreSQL)│  │
          │  └──────────────┘  └────────────┘ │ └─────────────┘  │
          │  ┌──────────────┐  ┌────────────┐ │ ┌─────────────┐  │
          │  │ Speech-to-   │  │  Weather   │ │ │    Redis    │  │
          │  │ Text API     │  │    API     │ │ │(Memorystore)│  │
          │  └──────────────┘  └────────────┘ │ └─────────────┘  │
          │  ┌──────────────┐                 │                  │
          │  │    Twilio    │                 │                  │
          │  │  SMS / Voice │                 │                  │
          │  └──────────────┘                 │                  │
          └───────────────────────────────────┴──────────────────┘
```

### 3.2 Component Breakdown

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React 18 + Vite + Shadcn UI | Dispatcher workstation, live map, fleet status, ER pre-alert composer |
| State Management | Zustand + TanStack Query | Client global state, server state caching, real-time WebSocket sync |
| Form Validation | Zod + React Hook Form | Incident form validation, API response schema validation |
| API Gateway | FastAPI (Python 3.12) | REST + WebSocket endpoints, auth middleware, request routing |
| AI Orchestration | AutoGen + Gemini 2.0 Flash | Multi-agent dispatch pipeline: intake → routing → hospital → pre-alert |
| Database | PostgreSQL 16 + SQLAlchemy 2.0 | Incidents, fleet, hospitals, audit logs, user management |
| Cache / Pub-Sub | Redis (Cloud Memorystore) | Session cache, real-time fleet pub/sub, rate limiting |
| Maps & Routing | Google Maps Routes API | Real-time ETA computation, polyline routing, traffic-aware paths |
| Infra | GCP Cloud Run + Cloud SQL | Serverless containers, managed Postgres, auto-scaling |
| CI/CD | GitHub Actions + Artifact Registry | Build, test, Docker push, Cloud Run deploy on merge to main |

### 3.3 AutoGen Agent Architecture

The AI dispatch pipeline uses four specialized AutoGen agents orchestrated by a `GroupChat` manager. Each agent is backed by Gemini 2.0 Flash and has a clearly scoped responsibility:

```
Dispatcher Input
      │
      ▼
┌─────────────────┐
│  Intake Agent   │  Parses voice/text → IncidentSchema (type, severity, location, notes)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Routing Agent  │  Calls Maps Routes API → scores available units → ranked dispatch list
└────────┬────────┘
         │
         ▼
┌──────────────────────┐
│  Hospital Agent      │  Evaluates ER capacity + trauma level → ranked hospital list
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│  Pre-Alert Agent     │  Generates structured ER pre-alert message → SMS + in-app push
└──────────────────────┘
```

- **Intake Agent** — Parses raw dispatcher voice/text into a validated `IncidentSchema` using Gemini function calling.
- **Routing Agent** — Receives incident location and available fleet. Calls Maps Routes API for per-unit ETAs. Computes composite score weighted by ETA, unit type, crew fatigue, and fuel level.
- **Hospital Selection Agent** — Evaluates ER capacity, trauma level, and proximity. Returns ranked hospital list with estimated handoff ETA.
- **Pre-Alert Agent** — Generates a structured ER pre-alert from incident schema and routing output. Formats for SMS, in-app notification, and voice read-back.

**Pipeline timeout:** 8 seconds total. Partial results returned with UI warning if exceeded.

---

## 4. Functional Requirements

### 4.1 Incident Management

#### FR-INC-01: Voice Incident Intake
The system shall accept voice input from the dispatcher via browser microphone. Audio shall be streamed to the FastAPI backend and transcribed using Google Cloud Speech-to-Text API. Transcribed text is passed to the Intake Agent.

- Supported languages: English (v1.0); Hindi, Tamil, Telugu (v1.1)
- Minimum recognizable audio: 3 seconds
- Transcription latency target: < 1.5 seconds to first token

#### FR-INC-02: Text Incident Intake
Dispatchers shall be able to type a free-form incident description. Minimum 10 characters required before submission. Input validated using Zod schema client-side before API call.

#### FR-INC-03: Structured Incident Extraction
The Intake Agent shall extract and return a validated JSON object conforming to `IncidentSchema`:

| Field | Type | Description |
|---|---|---|
| `incident_type` | Enum | `cardiac_arrest` \| `trauma` \| `stroke` \| `respiratory` \| `other` |
| `severity` | Enum | `P1` (life-threatening) \| `P2` (urgent) \| `P3` (non-urgent) |
| `location_raw` | String | Raw address or landmark as spoken by caller |
| `location_coords` | LatLng | Geocoded coordinates from Maps Geocoding API |
| `patient_count` | Integer | Number of patients. Default: 1 |
| `caller_name` | String? | Caller name if mentioned. Nullable. |
| `special_notes` | String? | Hazmat, weapons, pediatric, etc. Nullable. |

#### FR-INC-04: Incident Status Lifecycle
Each incident shall pass through the following states:

```
new → dispatched → on_scene → transporting → closed
                                              ↑
                                         (cancelled)
```

### 4.2 Dispatch Recommendation

#### FR-DISP-01: Ambulance Selection
The Routing Agent shall evaluate all available ambulances and return a ranked list of up to 3 recommended units. Ranking criteria (priority order):

1. **ETA** — computed via Google Maps Routes API with live traffic
2. **Unit type match** — ALS required for P1 cardiac/trauma; BLS acceptable for P3
3. **Crew shift hours** — prefer crews with < 8 hours on shift when ETAs are within 90 seconds of each other
4. **Fuel level** — exclude units below 20% fuel unless no alternatives exist

#### FR-DISP-02: Route Visualization
Selected route shall render as a polyline on the embedded Google Maps component. The map shall display: incident pin, ambulance origin, route polyline, ETA badge, and destination hospital. Route updates automatically when traffic changes shift ETA by more than 60 seconds.

#### FR-DISP-03: Dispatcher Override
Dispatchers shall be able to override the AI recommendation and manually assign any available unit. Override events are logged with a mandatory reason field:

- `operationally_aware` — dispatcher has local knowledge not captured by system
- `unit_capability` — specific equipment needed
- `crew_request` — specific crew requested by scene
- `other` — free-text reason required

### 4.3 Real-Time Fleet Tracking

#### FR-FLEET-01: Live Location Updates
Each ambulance unit shall transmit GPS coordinates every 10 seconds via WebSocket to the backend. The backend broadcasts updated positions to all connected dispatcher clients via Redis pub/sub. Frontend map reflects position updates within 2 seconds of transmission.

#### FR-FLEET-02: Unit Status States

| Status | Description |
|---|---|
| `available` | At station or cleared from last call |
| `dispatched` | En route to incident |
| `on_scene` | At incident location |
| `transporting` | En route to hospital with patient |
| `at_hospital` | Transferring patient to ER |
| `offline` | Out of service |

#### FR-FLEET-03: Stale Location Alert
If a unit has not sent a GPS ping for more than 60 seconds while in an active status, the dispatcher workstation shall display a stale location warning badge on that unit's card.

### 4.4 Hospital Pre-Alert

#### FR-HOSP-01: Auto-Generated Pre-Alert
Upon dispatch confirmation, the Pre-Alert Agent shall generate a structured pre-alert within 5 seconds containing: incident type, severity, estimated patient count, suspected primary diagnosis, ETA, receiving unit ID, and special notes.

#### FR-HOSP-02: Pre-Alert Delivery
Pre-alerts shall be delivered via:
- In-app push notification to the receiving hospital's AmbulAI dashboard
- SMS to the ER charge nurse on-call (via Twilio Messaging)
- Optional voice announcement via Google Cloud Text-to-Speech

#### FR-HOSP-03: Hospital Capacity Feed
Hospital capacity data (available beds, diversion status, trauma activation) shall be polled from hospital webhook endpoints every 60 seconds and cached in Redis. Diversion status shall be displayed prominently in the hospital selection panel with a red `DIVERT` badge.

### 4.5 Incident Lifecycle & Audit

#### FR-AUD-01: Full Audit Log
Every state change in an incident shall be persisted to `audit_log` with: actor ID, UTC timestamp, previous state, new state, and optional notes. Audit logs are immutable and retained for minimum 7 years per HIPAA requirements.

#### FR-AUD-02: Incident Closure
Dispatchers shall close incidents after patient handoff is confirmed. Closed incidents prompt for a post-incident summary (minimum 20 characters), stored and flagged for QA review.

---

## 5. Non-Functional Requirements

### 5.1 Performance

| Metric | Requirement |
|---|---|
| Dispatch recommendation latency | < 4 seconds end-to-end from incident submission to ranked recommendations |
| Voice transcription latency | < 1.5 seconds to first token; complete in < 4 seconds |
| Map initial render time | < 800ms on a standard 4G connection |
| WebSocket fleet update propagation | < 2 seconds from GPS transmission to dispatcher map update |
| API p95 response time (non-AI endpoints) | < 500ms |
| Concurrent dispatcher sessions | 200 simultaneous sessions without degradation |

### 5.2 Reliability & Availability

- **Uptime SLA:** 99.9% (< 8.7 hours downtime per year)
- All Cloud Run services: minimum 2 instances, auto-scale to 20
- **Database:** Cloud SQL with high-availability failover replica in secondary zone
- **Graceful degradation:** if Gemini is unavailable, system falls back to manual dispatch mode with explicit UI warning banner
- **Circuit breakers** on all external API calls (Maps, Weather, Gemini) using Python `tenacity` library with exponential backoff

### 5.3 Security

- All API endpoints protected by JWT Bearer token authentication via FastAPI dependency injection
- **RBAC roles:** `Dispatcher` | `Crew` | `Hospital` | `Admin` | `ReadOnly`
- All data encrypted in transit (TLS 1.3) and at rest (AES-256 via Cloud SQL and GCS defaults)
- Patient data fields (name, notes) encrypted at application layer using Fernet symmetric encryption before database write
- API keys for Maps, Gemini, and Twilio stored in **GCP Secret Manager** — never in environment files or source code
- CORS restricted to known frontend origins; CSP headers enforced on all responses
- Rate limiting: 60 requests/minute per authenticated user on AI endpoints (enforced via Redis + `slowapi`)

### 5.4 Compliance

- **HIPAA:** Audit logs for all PHI access, BAA agreements with GCP and Twilio, data retention policies enforced via Cloud Scheduler cleanup jobs
- **GDPR:** Right to erasure implemented via anonymization (not deletion) of completed incidents on request
- Incident data classified as Protected Health Information (PHI) — raw patient details never written to application logs

### 5.5 Observability

- Structured JSON logging via `structlog` to Google Cloud Logging
- Metrics to Cloud Monitoring: request latency histograms, AI agent call durations, WebSocket connection count, dispatch recommendation acceptance rate
- Distributed tracing with OpenTelemetry to Cloud Trace across frontend, API, and AI agent calls
- **Alerting:** PagerDuty integration for P1 alerts — error rate > 5%, p95 latency > 4s, uptime check failure
- Sentry integration on React frontend for client-side error tracking and session replay

---

## 6. Data Model

### 6.1 `incidents`

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID PK | No | Primary key, auto-generated |
| `incident_number` | VARCHAR(20) | No | Human-readable ID e.g. `INC-2024-00042` |
| `incident_type` | ENUM | No | `cardiac_arrest` \| `trauma` \| `stroke` \| `respiratory` \| `other` |
| `severity` | ENUM | No | `P1` \| `P2` \| `P3` |
| `status` | ENUM | No | `new` \| `dispatched` \| `on_scene` \| `transporting` \| `closed` \| `cancelled` |
| `location_raw` | TEXT | No | Original address string from intake |
| `lat` | FLOAT8 | No | Geocoded latitude |
| `lng` | FLOAT8 | No | Geocoded longitude |
| `assigned_unit_id` | UUID FK | Yes | References `ambulances.id` |
| `assigned_hospital_id` | UUID FK | Yes | References `hospitals.id` |
| `patient_count` | INT | No | Default: 1 |
| `special_notes_enc` | BYTEA | Yes | Fernet-encrypted special notes |
| `ai_recommendation` | JSONB | Yes | Full AI agent output stored for audit |
| `override_reason` | VARCHAR(100) | Yes | Set when dispatcher overrides AI |
| `dispatcher_id` | UUID FK | No | References `users.id` |
| `closed_summary` | TEXT | Yes | Post-incident summary on closure |
| `created_at` | TIMESTAMPTZ | No | UTC creation time |
| `updated_at` | TIMESTAMPTZ | No | UTC last update, auto-updated via trigger |

### 6.2 `ambulances`

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID PK | No | Primary key |
| `unit_code` | VARCHAR(20) | No | e.g. `AMB-07`, displayed in UI |
| `unit_type` | ENUM | No | `ALS` \| `BLS` \| `First_Responder` |
| `status` | ENUM | No | `available` \| `dispatched` \| `on_scene` \| `transporting` \| `at_hospital` \| `offline` |
| `lat` | FLOAT8 | Yes | Last known latitude |
| `lng` | FLOAT8 | Yes | Last known longitude |
| `fuel_pct` | FLOAT4 | No | Fuel level 0–100% |
| `crew_hours` | FLOAT4 | No | Hours on current shift |
| `last_ping_at` | TIMESTAMPTZ | Yes | Last GPS update timestamp |
| `station_id` | UUID FK | Yes | Home station reference |

### 6.3 `hospitals`

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID PK | No | Primary key |
| `name` | VARCHAR(200) | No | Hospital name |
| `lat` | FLOAT8 | No | Location latitude |
| `lng` | FLOAT8 | No | Location longitude |
| `trauma_level` | INT | No | 1 (highest) – 5 |
| `available_beds` | INT | Yes | Last polled bed count |
| `is_diverting` | BOOLEAN | No | ER diversion status. Default: false |
| `last_capacity_update` | TIMESTAMPTZ | Yes | Timestamp of last capacity poll |
| `pre_alert_webhook_url` | TEXT | Yes | Hospital's pre-alert webhook endpoint |
| `charge_nurse_phone` | VARCHAR(20) | Yes | Encrypted. SMS pre-alert target |

### 6.4 `users`

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID PK | No | Primary key |
| `email` | VARCHAR(255) | No | Unique login email |
| `hashed_password` | VARCHAR(255) | No | Bcrypt hashed |
| `full_name` | VARCHAR(200) | No | Display name |
| `role` | ENUM | No | `dispatcher` \| `crew` \| `hospital` \| `admin` \| `readonly` |
| `unit_id` | UUID FK | Yes | For crew role — linked ambulance |
| `hospital_id` | UUID FK | Yes | For hospital role — linked hospital |
| `is_active` | BOOLEAN | No | Soft disable without deletion |
| `created_at` | TIMESTAMPTZ | No | UTC creation time |

### 6.5 `audit_log`

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | BIGSERIAL PK | No | Auto-increment primary key |
| `entity_type` | VARCHAR(50) | No | `incident` \| `ambulance` \| `user` |
| `entity_id` | UUID | No | ID of affected entity |
| `actor_id` | UUID | No | User who triggered the change |
| `action` | VARCHAR(50) | No | e.g. `STATUS_CHANGE`, `DISPATCH`, `OVERRIDE`, `CLOSE` |
| `prev_state` | JSONB | Yes | Previous entity state snapshot |
| `new_state` | JSONB | Yes | New entity state snapshot |
| `notes` | TEXT | Yes | Optional actor notes (e.g. override reason) |
| `created_at` | TIMESTAMPTZ | No | Immutable. No update trigger. |

### 6.6 Key Indexes

```sql
-- Hot query paths
CREATE INDEX idx_incidents_status ON incidents(status) WHERE status != 'closed';
CREATE INDEX idx_incidents_created ON incidents(created_at DESC);
CREATE INDEX idx_ambulances_status ON ambulances(status);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
```

---

## 7. API Design

### 7.1 REST Endpoints

All endpoints are prefixed `/api/v1`. All responses use `application/json`. Authentication via `Authorization: Bearer <jwt>`.

| Method | Path | Auth Role | Description |
|---|---|---|---|
| `POST` | `/auth/token` | Public | JWT token exchange (username + password) |
| `POST` | `/auth/refresh` | Authenticated | Refresh expired JWT using refresh token |
| `POST` | `/incidents` | Dispatcher | Create new incident from unstructured input |
| `GET` | `/incidents` | Dispatcher | List active incidents with filters (`status`, `severity`, `date`) |
| `GET` | `/incidents/{id}` | Dispatcher | Get full incident detail with AI recommendation output |
| `PATCH` | `/incidents/{id}` | Dispatcher | Update incident status or assignment |
| `POST` | `/incidents/{id}/dispatch` | Dispatcher | Confirm dispatch — triggers pre-alert |
| `POST` | `/incidents/{id}/close` | Dispatcher | Close incident with summary |
| `POST` | `/dispatch/recommend` | Dispatcher | Trigger AI recommendation pipeline (idempotent) |
| `POST` | `/intake/transcribe` | Dispatcher | Upload audio blob for Speech-to-Text transcription |
| `GET` | `/fleet` | Dispatcher | List all units with current status and location |
| `PATCH` | `/fleet/{id}/status` | Crew | Crew updates own unit status |
| `GET` | `/hospitals` | Dispatcher | List hospitals with capacity and diversion status |
| `GET` | `/analytics/summary` | Admin | Dashboard metrics: response times, fleet utilization |
| `GET` | `/audit/{entity_type}/{entity_id}` | Admin | Full audit log for an entity |

### 7.2 WebSocket Endpoints

| Endpoint | Direction | Payload | Description |
|---|---|---|---|
| `/ws/dispatcher/{session_id}` | Server → Client | `FleetUpdateEvent`, `IncidentUpdateEvent`, `AlertEvent` | Real-time fleet positions, incident updates, new alerts |
| `/ws/unit/{unit_id}` | Client → Server | `GpsPingPayload` | Ambulance GPS pings every 10 seconds |
| `/ws/hospital/{hospital_id}` | Bidirectional | `PreAlertEvent`, `CapacityUpdatePayload` | Pre-alert push and capacity updates |

### 7.3 Key Request / Response Schemas

#### `POST /incidents` — Request
```json
{
  "raw_input": "Car accident on MG Road near Trinity Circle, 2 victims, one unconscious",
  "input_type": "text"
}
```

#### `POST /incidents` — Response
```json
{
  "incident_id": "550e8400-e29b-41d4-a716-446655440000",
  "incident_number": "INC-2024-00042",
  "extracted": {
    "incident_type": "trauma",
    "severity": "P1",
    "location_raw": "MG Road near Trinity Circle",
    "location_coords": { "lat": 12.9716, "lng": 77.5946 },
    "patient_count": 2,
    "special_notes": "one patient unconscious"
  },
  "status": "new",
  "created_at": "2024-03-28T10:23:45Z"
}
```

#### `POST /dispatch/recommend` — Response
```json
{
  "incident_id": "550e8400-e29b-41d4-a716-446655440000",
  "recommendations": [
    {
      "rank": 1,
      "unit_id": "amb-007",
      "unit_code": "AMB-07",
      "unit_type": "ALS",
      "eta_minutes": 4.2,
      "route_polyline": "encoded_polyline_string",
      "score": 0.94,
      "rationale": "Closest ALS unit with 4.2 min ETA. Crew at 5.5h shift. Fuel 78%."
    },
    {
      "rank": 2,
      "unit_id": "amb-003",
      "unit_code": "AMB-03",
      "unit_type": "ALS",
      "eta_minutes": 6.1,
      "route_polyline": "encoded_polyline_string",
      "score": 0.81,
      "rationale": "Second closest ALS. 6.1 min ETA. Crew at 3h shift. Fuel 92%."
    }
  ],
  "recommended_hospital": {
    "hospital_id": "hosp-001",
    "name": "St. John's Medical Center",
    "trauma_level": 1,
    "eta_from_scene_minutes": 8,
    "available_beds": 4,
    "is_diverting": false
  }
}
```

### 7.4 Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "incident_type must be one of: cardiac_arrest, trauma, stroke, respiratory, other",
    "field": "incident_type",
    "request_id": "req_abc123"
  }
}
```

---

## 8. Frontend Specification

### 8.1 Page & View Structure

| Route | View | Auth Roles |
|---|---|---|
| `/login` | Login page | Public |
| `/dispatch` | Main dispatcher workstation | Dispatcher, Admin |
| `/dispatch/incidents/:id` | Incident detail & AI output panel | Dispatcher, Admin |
| `/fleet` | Fleet management board | Dispatcher, Admin |
| `/hospitals` | Hospital capacity overview | Dispatcher, Admin, Hospital |
| `/analytics` | Operations dashboard | Admin |
| `/settings` | User preferences, notifications | All authenticated |

### 8.2 Dispatcher Workstation Layout

The main workstation (`/dispatch`) uses a three-panel layout:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Header: AmbulAI logo | Active incidents count | User menu | Status  │
├─────────────────┬───────────────────────────┬────────────────────────┤
│  LEFT PANEL     │     CENTRE PANEL          │    RIGHT PANEL         │
│  (320px fixed)  │     (flex, min 480px)     │    (380px fixed)       │
│                 │                           │                        │
│  Active         │   Google Maps embed       │  Incident Detail       │
│  Incidents      │   ─ Unit pins (coloured   │  ─ AI recommendation   │
│  ─────────────  │     by status)            │    ranked list         │
│  [P1] INC-042   │   ─ Incident pin          │  ─ ETA per unit        │
│  Trauma · 2min  │   ─ Route polyline        │  ─ Hospital suggestion │
│  MG Road        │   ─ ETA badge             │  ─ Pre-alert preview   │
│  ─────────────  │   ─ Hospital marker       │                        │
│  [P2] INC-041   │                           │  [Confirm Dispatch]    │
│  Cardiac · 8min │   Map controls:           │  [Override & Assign]   │
│  ...            │   ─ Traffic layer toggle  │                        │
│                 │   ─ Weather overlay        │                        │
│  [+ New Incident│   ─ Hospital markers      │                        │
│    Voice | Type]│                           │                        │
└─────────────────┴───────────────────────────┴────────────────────────┘
```

### 8.3 Component Architecture

```
src/
├── components/              # Shared reusable UI
│   ├── ui/                  # Shadcn primitives (Button, Badge, Card, Dialog...)
│   ├── MapEmbed/            # Google Maps wrapper with route + pins
│   ├── VoiceCapture/        # Mic recording → audio blob → API
│   └── StatusBadge/         # Severity + status coloured badges
│
├── features/
│   ├── incidents/
│   │   ├── IncidentList/    # Left panel list with cards
│   │   ├── IncidentForm/    # New incident intake (voice + text)
│   │   ├── IncidentDetail/  # Right panel detail drawer
│   │   └── DispatchPanel/   # AI recommendation + confirm flow
│   ├── fleet/
│   │   ├── FleetBoard/      # Grid view of all units
│   │   └── UnitCard/        # Single unit status card
│   ├── hospitals/
│   │   └── HospitalList/    # Capacity table with diversion indicators
│   └── analytics/
│       └── Dashboard/       # Charts: response times, fleet utilization
│
├── stores/                  # Zustand stores
│   ├── authStore.ts
│   ├── incidentStore.ts
│   ├── fleetStore.ts
│   └── mapStore.ts
│
├── hooks/                   # TanStack Query hooks
│   ├── useIncidents.ts
│   ├── useFleet.ts
│   ├── useDispatchRecommend.ts
│   └── useHospitals.ts
│
├── schemas/                 # Zod validation schemas
│   ├── incident.schema.ts
│   ├── dispatch.schema.ts
│   └── auth.schema.ts
│
└── api/                     # HTTP + WS clients
    ├── client.ts            # Axios instance with JWT interceptors
    └── wsManager.ts         # WebSocket connection manager with reconnect
```

### 8.4 State Management Strategy

**Zustand stores** manage client-owned global state:

| Store | State Slice | Description |
|---|---|---|
| `authStore` | `user`, `tokens`, `role` | JWT tokens, current user, RBAC role |
| `incidentStore` | `incidents[]`, `selectedId` | Active incidents list and selection |
| `fleetStore` | `units{}` | All unit positions and statuses — updated via WebSocket |
| `mapStore` | `viewport`, `layers`, `routePolyline` | Map state, active layers, rendered route |

**TanStack Query** manages all server state:

| Query Key | Stale Time | Refetch Strategy |
|---|---|---|
| `['incidents']` | 30 seconds | Background refetch on window focus |
| `['incident', id]` | 10 seconds | Real-time via WebSocket invalidation |
| `['hospitals']` | 60 seconds | Poll interval 60 seconds |
| `['recommend', incidentId]` | ∞ (manual) | Invalidated only on explicit re-run |

### 8.5 Zod Validation Schemas

```typescript
// Key schemas — full definitions in src/schemas/

const incidentIntakeSchema = z.object({
  raw_input: z.string().min(10, "Describe the incident in at least 10 characters"),
  input_type: z.enum(["text", "voice"]),
});

const dispatchOverrideSchema = z.object({
  unit_id: z.string().uuid(),
  reason: z.enum(["operationally_aware", "unit_capability", "crew_request", "other"]),
  notes: z.string().optional(),
});

const incidentCloseSchema = z.object({
  closed_summary: z.string().min(20, "Provide at least a 20-character summary"),
});

// API response validation (catches backend schema drift)
const recommendationResponseSchema = z.object({
  incident_id: z.string().uuid(),
  recommendations: z.array(z.object({
    rank: z.number().int(),
    unit_id: z.string(),
    unit_code: z.string(),
    unit_type: z.enum(["ALS", "BLS", "First_Responder"]),
    eta_minutes: z.number(),
    score: z.number().min(0).max(1),
    rationale: z.string(),
  })),
  recommended_hospital: z.object({
    hospital_id: z.string(),
    name: z.string(),
    trauma_level: z.number().int().min(1).max(5),
    eta_from_scene_minutes: z.number(),
    is_diverting: z.boolean(),
  }),
});
```

---

## 9. AI Agent Pipeline

### 9.1 Intake Agent

**Model:** Gemini 2.0 Flash with function calling

**System prompt context:** EMS domain expert. Extracts structured incident data from dispatcher free-text or transcribed voice. Always geocodes location using Maps Geocoding API. Infers severity from incident type and description cues.

**Fallback:** If Gemini returns a malformed response after 2 retries, the incident routes to a manual intake form pre-populated with whatever fields were successfully extracted.

### 9.2 Routing Agent — Scoring Algorithm

The Routing Agent computes a composite dispatch score for each available unit:

```
Score = (1 / ETA_minutes) × type_weight × (1 - crew_fatigue_penalty) × fuel_factor
```

Where:
- `type_weight` = `1.0` if unit type matches requirement; `0.7` if acceptable alternative; `0.3` if mismatch
- `crew_fatigue_penalty` = `min(crew_hours / 16, 0.4)` — linear penalty up to 40% for 16+ hour shifts
- `fuel_factor` = `1.0` if fuel > 40%; `0.8` if 20–40%; `0.0` if < 20% (unit excluded)

Units with `fuel_factor = 0.0` are excluded from recommendations unless no other units are available.

### 9.3 Hospital Selection Agent

Ranks hospitals using a weighted composite:

```
Hospital Score = (1 / ETA_from_scene) × trauma_match_weight × (1 - diversion_penalty) × capacity_factor
```

- `trauma_match_weight` = `1.0` if trauma level matches incident severity; `0.5` otherwise
- `diversion_penalty` = `0.9` if diverting (effectively deprioritizes but does not exclude)
- `capacity_factor` = `min(available_beds / 10, 1.0)`

### 9.4 Pre-Alert Agent

**Output format** (sent to hospital dashboard + SMS):

```
🚨 INCOMING PATIENT — ETA 8 MIN

Unit:     AMB-07 (ALS)
Incident: Trauma — Motor Vehicle Accident
Severity: P1 — Life Threatening
Patients: 2 (1 unconscious)
Location: MG Road near Trinity Circle

ETA to your facility: 08:31 (approx. 8 minutes)
Dispatched at: 10:23 AM

Special: One patient unconscious at scene. Possible TBI.

— AmbulAI Dispatch System | INC-2024-00042
```

### 9.5 AutoGen GroupChat Configuration

```python
# Pseudocode — full implementation in backend/app/agents/

group_chat = GroupChat(
    agents=[intake_agent, routing_agent, hospital_agent, prealert_agent],
    messages=[],
    max_round=4,
    speaker_selection_method="round_robin",
)

manager = GroupChatManager(
    groupchat=group_chat,
    llm_config={"model": "gemini-2.0-flash", "timeout": 8},
)
```

---

## 10. Infrastructure & DevOps

### 10.1 Docker Compose (Local Development)

```yaml
# docker-compose.yml — service summary

services:
  frontend:
    build: ./frontend          # Node 20 build → nginx serve
    ports: ["3000:80"]
    depends_on: [backend]

  backend:
    build: ./backend           # Python 3.12-slim multi-stage
    ports: ["8000:8000"]
    environment:
      - DATABASE_URL=postgresql://...
      - REDIS_URL=redis://redis:6379
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - MAPS_API_KEY=${MAPS_API_KEY}
    depends_on: [db, redis, migrate]

  migrate:
    build: ./backend
    command: alembic upgrade head
    depends_on: [db]

  db:
    image: postgres:16-alpine   # Local dev only; prod → Cloud SQL
    volumes: [pg_data:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine       # Local dev only; prod → Cloud Memorystore
```

### 10.2 Dockerfile — Backend (Multi-Stage)

```dockerfile
# backend/Dockerfile

# Stage 1: dependency builder
FROM python:3.12-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: runtime
FROM python:3.12-slim AS runtime
WORKDIR /app
COPY --from=builder /install /usr/local
COPY ./app ./app
COPY alembic.ini .

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

### 10.3 Dockerfile — Frontend (Multi-Stage)

```dockerfile
# frontend/Dockerfile

# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: serve
FROM nginx:alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### 10.4 GCP Production Services

| GCP Service | Usage | Configuration |
|---|---|---|
| Cloud Run (frontend) | React app serving | Min 1, max 10 instances · 512MB · us-central1 |
| Cloud Run (backend) | FastAPI API | Min 2, max 20 instances · 1GB · concurrency 80 |
| Cloud SQL (PostgreSQL 16) | Primary database | `db-n1-standard-2` · HA replica · daily auto-backups |
| Cloud Memorystore (Redis) | Cache + pub/sub | Basic tier 1GB · same region as Cloud Run |
| Artifact Registry | Docker image storage | Repos: `ambulai/frontend`, `ambulai/backend` |
| Secret Manager | API keys + secrets | `DB_URL`, `GEMINI_API_KEY`, `MAPS_API_KEY`, `JWT_SECRET`, `TWILIO_*` |
| Cloud Scheduler | Cron jobs | Hospital capacity poll (1 min), HIPAA cleanup (nightly) |
| Cloud Storage | Audio + exports | Voice recordings (30-day retention), incident report exports |
| Cloud Logging + Monitoring | Observability | Structured logs, uptime checks, alert policies |
| Cloud Trace | Distributed tracing | OpenTelemetry → Cloud Trace for end-to-end request tracing |

### 10.5 GitHub Actions CI/CD Pipeline

#### Workflow 1: `pull_request → main`
```yaml
name: CI — Pull Request

on:
  pull_request:
    branches: [main]

jobs:
  backend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r backend/requirements-dev.txt
      - run: pytest backend/tests/ --cov=app --cov-fail-under=80

  frontend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci --prefix frontend
      - run: npm run typecheck --prefix frontend
      - run: npm run lint --prefix frontend
      - run: npm run test --prefix frontend

  docker-build:
    runs-on: ubuntu-latest
    needs: [backend-test, frontend-test]
    steps:
      - uses: actions/checkout@v4
      - run: docker build ./backend --tag ambulai/backend:pr-${{ github.sha }}
      - run: docker build ./frontend --tag ambulai/frontend:pr-${{ github.sha }}
```

#### Workflow 2: `push to main` (post-merge deploy)
```yaml
name: CD — Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # Workload Identity Federation — no service account keys
      contents: read
    steps:
      - uses: actions/checkout@v4

      - id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_SA_EMAIL }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Build and push images
        run: |
          gcloud auth configure-docker ${{ vars.REGION }}-docker.pkg.dev
          docker build ./backend -t $BACKEND_IMAGE:$SHA -t $BACKEND_IMAGE:latest
          docker build ./frontend -t $FRONTEND_IMAGE:$SHA -t $FRONTEND_IMAGE:latest
          docker push $BACKEND_IMAGE:$SHA
          docker push $FRONTEND_IMAGE:$SHA

      - name: Run DB migrations
        run: |
          gcloud run jobs execute migrate-job --region=${{ vars.REGION }} --wait

      - name: Deploy backend (canary → full)
        run: |
          gcloud run deploy ambulai-backend \
            --image=$BACKEND_IMAGE:$SHA \
            --region=${{ vars.REGION }} \
            --tag=canary \
            --no-traffic
          # Wait 5 min, check error rate, then shift 100% traffic
          sleep 300
          gcloud run services update-traffic ambulai-backend --to-latest

      - name: Deploy frontend
        run: |
          gcloud run deploy ambulai-frontend \
            --image=$FRONTEND_IMAGE:$SHA \
            --region=${{ vars.REGION }}

      - name: Smoke tests
        run: |
          curl --fail https://api.ambulai.app/api/v1/health

      - name: Notify Slack
        if: always()
        uses: slackapi/slack-github-action@v1
        with:
          payload: '{"text": "Deploy ${{ job.status }}: ${{ github.sha }}"}'
```

---

## 11. Repository & Project Structure

```
ambulai/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # PR checks: test, lint, build
│       ├── cd.yml                    # Main branch deploy to GCP
│       └── release.yml               # Semantic version tag → GH Release
│
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── ui/                   # Shadcn components
│       │   ├── MapEmbed/
│       │   ├── VoiceCapture/
│       │   └── StatusBadge/
│       ├── features/
│       │   ├── incidents/
│       │   │   ├── IncidentList/
│       │   │   ├── IncidentForm/
│       │   │   ├── IncidentDetail/
│       │   │   └── DispatchPanel/
│       │   ├── fleet/
│       │   │   ├── FleetBoard/
│       │   │   └── UnitCard/
│       │   ├── hospitals/
│       │   └── analytics/
│       ├── stores/
│       │   ├── authStore.ts
│       │   ├── incidentStore.ts
│       │   ├── fleetStore.ts
│       │   └── mapStore.ts
│       ├── hooks/
│       │   ├── useIncidents.ts
│       │   ├── useFleet.ts
│       │   ├── useDispatchRecommend.ts
│       │   └── useHospitals.ts
│       ├── schemas/
│       │   ├── incident.schema.ts
│       │   ├── dispatch.schema.ts
│       │   └── auth.schema.ts
│       └── api/
│           ├── client.ts             # Axios + JWT interceptors
│           └── wsManager.ts          # WS manager with reconnect + backoff
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/                 # Migration files
│   ├── app/
│   │   ├── main.py                   # FastAPI app factory
│   │   ├── core/
│   │   │   ├── config.py             # Pydantic Settings from env/Secret Manager
│   │   │   ├── database.py           # SQLAlchemy async engine + session
│   │   │   ├── security.py           # JWT encode/decode, password hashing
│   │   │   ├── logging.py            # structlog configuration
│   │   │   └── dependencies.py       # FastAPI dependency injections (auth, db)
│   │   ├── api/
│   │   │   ├── v1/
│   │   │   │   ├── router.py
│   │   │   │   ├── incidents.py
│   │   │   │   ├── dispatch.py
│   │   │   │   ├── fleet.py
│   │   │   │   ├── hospitals.py
│   │   │   │   ├── auth.py
│   │   │   │   ├── analytics.py
│   │   │   │   └── intake.py
│   │   │   └── websockets/
│   │   │       ├── dispatcher_ws.py
│   │   │       ├── unit_ws.py
│   │   │       └── hospital_ws.py
│   │   ├── agents/
│   │   │   ├── group_chat.py         # AutoGen GroupChat setup
│   │   │   ├── intake_agent.py
│   │   │   ├── routing_agent.py
│   │   │   ├── hospital_agent.py
│   │   │   └── prealert_agent.py
│   │   ├── models/
│   │   │   ├── incident.py
│   │   │   ├── ambulance.py
│   │   │   ├── hospital.py
│   │   │   ├── user.py
│   │   │   └── audit_log.py
│   │   ├── schemas/
│   │   │   ├── incident.py
│   │   │   ├── dispatch.py
│   │   │   ├── fleet.py
│   │   │   └── auth.py
│   │   ├── services/
│   │   │   ├── dispatch_service.py   # Orchestrates agent pipeline
│   │   │   ├── routing_service.py    # Unit scoring + Maps API calls
│   │   │   ├── prealert_service.py   # Pre-alert formatting + delivery
│   │   │   └── audit_service.py      # Audit log writes
│   │   └── integrations/
│   │       ├── gemini_client.py
│   │       ├── maps_client.py
│   │       ├── speech_client.py
│   │       └── twilio_client.py
│   └── tests/
│       ├── conftest.py
│       ├── api/
│       ├── agents/
│       ├── services/
│       └── integrations/
│
├── docker-compose.yml               # Local dev
├── docker-compose.prod.yml          # Production overrides
├── .env.example                     # Template — never commit .env
├── README.md
└── CHANGELOG.md
```

---

## 12. Delivery Milestones

| Phase | Timeline | Milestone | Key Deliverables |
|---|---|---|---|
| **0 — Foundation** | Days 1–2 | Infra & scaffolding | Monorepo setup, Docker Compose working, CI pipeline skeleton, DB schema + Alembic migrations, auth endpoints, GCP project provisioned |
| **1 — Core MVP** | Days 3–6 | Working dispatch | Text incident intake, Intake Agent extraction, Routing Agent scoring, basic dispatch recommendation UI, fleet status board |
| **2 — Real-Time Layer** | Days 7–10 | Live operations | WebSocket fleet tracking, live map with unit pins, voice intake via Speech-to-Text, hospital pre-alert delivery (in-app + SMS) |
| **3 — Production Hardening** | Days 11–14 | Production-ready | Security audit, HIPAA audit log, GCP Cloud Run deploy, Cloud Monitoring alerting, performance load testing (k6) |
| **4 — Analytics & Polish** | Days 15–18 | v1.0 Release | Operations dashboard, multi-language scaffold, UAT with EMS staff, Sentry integration, v1.0 tag + release notes |

---

## 13. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Gemini API latency spikes under load | 🔴 High | Circuit breaker with fallback to manual dispatch mode; async pipeline with 8s hard timeout |
| Google Maps quota exhaustion during mass casualty event | 🔴 High | Pre-cached routing for common corridors; quota monitoring alert at 70%; fallback to last cached route |
| Dispatcher habitually rejects AI recommendation | 🟡 Medium | Log all override reasons; tune scoring algorithm monthly based on override patterns; UX research session at Phase 4 |
| HIPAA audit scope creep | 🟡 Medium | Data classification matrix defined pre-build; legal review gate at Phase 2 completion |
| GPS spoofing or unit location drift | 🟡 Medium | Validate GPS against last known position; flag and alert on jumps > 500m in 10 seconds |
| WebSocket drop during active incident | 🟢 Low | Auto-reconnect with exponential backoff; last-known fleet state served from Redis on reconnect |
| Hospital webhook integration delays | 🟡 Medium | Manual capacity update fallback UI; hospital staff can update their own status via the hospital dashboard role |

---

## 14. Open Questions

| Question | Owner | Target Decision |
|---|---|---|
| Should the system support multi-hospital city networks in v1 or defer to v2? | Product Lead | Phase 0 |
| What is the target hospital integration protocol — HL7 FHIR, custom webhook, or manual updates? | Integration Lead | Phase 1 |
| Does the crew mobile interface need to work offline in poor-connectivity zones? | Engineering Lead | Phase 1 |
| Is a dedicated crew native mobile app required, or is a PWA sufficient for v1? | Product Lead | Phase 0 |
| Which Twilio product for pre-alert SMS — Messaging API or Notify? | Backend Lead | Phase 0 |
| Should voice recordings be retained for QA (storage + compliance cost) or discarded post-transcription? | Legal / Product | Phase 0 |

---

## 15. Glossary

| Term | Definition |
|---|---|
| **ALS** | Advanced Life Support — highest-capability ambulance unit with paramedic and full cardiac intervention equipment |
| **BLS** | Basic Life Support — standard ambulance with EMT-level crew |
| **EMS** | Emergency Medical Services — the broader system of pre-hospital emergency care |
| **ETA** | Estimated Time of Arrival |
| **HIPAA** | Health Insurance Portability and Accountability Act — US federal law governing PHI privacy and security |
| **PHI** | Protected Health Information — any patient data covered by HIPAA |
| **P1 / P2 / P3** | Incident severity tiers: P1 = life-threatening, P2 = urgent, P3 = non-urgent |
| **Diversion** | When a hospital ER is at capacity and requests that non-critical ambulances route to alternate facilities |
| **AutoGen** | Microsoft's multi-agent framework for orchestrating cooperative AI agents |
| **Workload Identity Federation** | GCP authentication method that allows GitHub Actions to authenticate without storing service account key files |
| **Fernet** | Symmetric authenticated encryption scheme from the Python `cryptography` library, used for PHI field encryption |
| **WIF** | Workload Identity Federation — keyless authentication from GitHub Actions to GCP |

---

*AmbulAI PRD v1.0 — Confidential, Internal Use Only*
*Prepared: March 2026*
