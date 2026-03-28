/// <reference types="vite/client" />
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot, Map as MapIcon, Mic, Navigation, ShieldAlert, Activity, Route,
  Camera, AlertCircle, PlaySquare, StopCircle, Radio, Hospital, Shield,
  CheckCircle2, Clock, Ambulance,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { APIProvider, Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';

// ---------------------------------------------------------------------------
// Sub-component: Real-time Traffic Layer
// ---------------------------------------------------------------------------
function TrafficLayerOverlay() {
  const map = useMap();
  useEffect(() => {
    if (!map || !window.google) return;
    const trafficLayer = new window.google.maps.TrafficLayer();
    trafficLayer.setMap(map);
    return () => trafficLayer.setMap(null);
  }, [map]);
  return null;
}

// ---------------------------------------------------------------------------
// Sub-component: Route Plotter (dispatcher-confirmed route)
// ---------------------------------------------------------------------------
function DirectionsPlotter({ origin, destination }: { origin: { lat: number; lng: number }; destination: { lat: number; lng: number } }) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const [directionsService, setDirectionsService] = useState<google.maps.DirectionsService>();
  const [directionsRenderer, setDirectionsRenderer] = useState<google.maps.DirectionsRenderer>();

  useEffect(() => {
    if (!routesLib || !map) return;
    setDirectionsService(new routesLib.DirectionsService());
    setDirectionsRenderer(new routesLib.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: { strokeColor: '#4f46e5', strokeWeight: 6, strokeOpacity: 0.8 },
    }));
  }, [routesLib, map]);

  useEffect(() => {
    if (!directionsService || !directionsRenderer || !origin || !destination) return;
    directionsService.route({
      origin,
      destination,
      travelMode: window.google.maps.TravelMode.DRIVING,
      drivingOptions: { departureTime: new Date(), trafficModel: window.google.maps.TrafficModel.BEST_GUESS },
    }).then(r => directionsRenderer.setDirections(r)).catch(e => console.error('Directions Error', e));
  }, [directionsService, directionsRenderer, origin, destination]);

  return null;
}

// ---------------------------------------------------------------------------
// Journey timeline event config
// ---------------------------------------------------------------------------
const EVENT_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  reported:           { label: 'Reported',            color: 'bg-slate-400',   icon: <Radio className="w-3 h-3" /> },
  ai_parsed:          { label: 'AI Analysed',         color: 'bg-indigo-500',  icon: <Bot className="w-3 h-3" /> },
  ambulance_assigned: { label: 'Unit Assigned',       color: 'bg-blue-500',    icon: <Ambulance className="w-3 h-3" /> },
  hospital_selected:  { label: 'Hospital Pre-alerted',color: 'bg-emerald-500', icon: <Hospital className="w-3 h-3" /> },
  police_notified:    { label: 'Police Notified',     color: 'bg-sky-500',     icon: <Shield className="w-3 h-3" /> },
  en_route:           { label: 'En Route',            color: 'bg-rose-500',    icon: <Navigation className="w-3 h-3" /> },
  arrived_scene:      { label: 'Arrived Scene',       color: 'bg-orange-500',  icon: <Activity className="w-3 h-3" /> },
  patient_handoff:    { label: 'Patient Handoff',     color: 'bg-purple-500',  icon: <Hospital className="w-3 h-3" /> },
  completed:          { label: 'Completed',           color: 'bg-green-500',   icon: <CheckCircle2 className="w-3 h-3" /> },
};

function relativeTime(isoTimestamp: string): string {
  const diff = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AppMode = 'dispatch' | 'public';
type ViewState = 'idle' | 'dispatching' | 'dispatched';

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
function App() {
  const [appMode, setAppMode] = useState<AppMode>('dispatch');
  const [incidentText, setIncidentText] = useState('');
  const [recommendations, setRecommendations] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeIncident, setActiveIncident] = useState<any>(null);
  const [viewState, setViewState] = useState<ViewState>('idle');
  const [fleet, setFleet] = useState<{ ambulances: any[]; hospitals: any[] }>({ ambulances: [], hospitals: [] });
  const [mapCenter, setMapCenter] = useState({ lat: 12.9724, lng: 77.6169 });
  const [dynamicMapKey, setDynamicMapKey] = useState<string>('');
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  // Only true when we actually have a validated, non-placeholder API key.
  // APIProvider must NOT be rendered until this is true — an invalid/empty key
  // triggers InvalidKeyMapError and crashes the Google Maps SDK.
  const [hasValidMapKey, setHasValidMapKey] = useState(false);

  // Journey tracking
  const [journey, setJourney] = useState<any[]>([]);

  // Multimodal voice
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Multimodal image
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Live ambulance animation
  const [liveAmbPos, setLiveAmbPos] = useState<{ lat: number; lng: number } | null>(null);
  const animIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waypointRef = useRef<{ lat: number; lng: number }[]>([]);
  const waypointIdxRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------
  const startAmbulanceAnimation = useCallback((waypoints: { lat: number; lng: number }[]) => {
    if (animIntervalRef.current) clearInterval(animIntervalRef.current);
    if (!waypoints.length) return;
    waypointRef.current = waypoints;
    waypointIdxRef.current = 0;
    setLiveAmbPos(waypoints[0]);

    animIntervalRef.current = setInterval(() => {
      waypointIdxRef.current += 1;
      if (waypointIdxRef.current >= waypointRef.current.length) {
        clearInterval(animIntervalRef.current!);
        animIntervalRef.current = null;
        return;
      }
      setLiveAmbPos(waypointRef.current[waypointIdxRef.current]);
    }, 1400);
  }, []);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => { if (animIntervalRef.current) clearInterval(animIntervalRef.current); };
  }, []);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------
  const fetchFleet = () => {
    fetch('/api/v1/fleet').then(r => r.json()).then(setFleet).catch(console.error);
  };

  const fetchActiveIncidents = useCallback(() => {
    fetch('/api/v1/incidents/active')
      .then(r => r.json())
      .then((incidents: any[]) => {
        if (!incidents.length) return;
        const demo = incidents[0];
        setActiveIncident(demo);
        setJourney(demo.journey || []);

        // Auto-build recommendation from assigned actors
        if (demo.assigned_ambulance && demo.assigned_hospital) {
          setRecommendations({
            incident_id: demo.incident_id,
            recommendations: [{
              unit_id: demo.assigned_ambulance.id,
              unit_code: demo.assigned_ambulance.unit_code,
              unit_type: demo.assigned_ambulance.unit_type,
              lat: demo.assigned_ambulance.lat,
              lng: demo.assigned_ambulance.lng,
              eta_minutes: 5.8,
              score: 0.97,
              rationale: 'Pre-assigned by Gemini Dispatch Engine.',
            }],
            recommended_hospital: {
              hospital_id: demo.assigned_hospital.id,
              name: demo.assigned_hospital.name,
              trauma_level: demo.assigned_hospital.trauma_level,
              eta_from_scene_minutes: 8.2,
              is_diverting: false,
              lat: demo.assigned_hospital.lat,
              lng: demo.assigned_hospital.lng,
            },
          });
          setViewState('dispatched');
          if (demo.route_waypoints?.length > 0) {
            startAmbulanceAnimation(demo.route_waypoints);
          }
        }

        if (demo.extracted?.lat && demo.extracted?.lng) {
          setMapCenter({ lat: demo.extracted.lat, lng: demo.extracted.lng });
        }
      })
      .catch(console.error);
  }, [startAmbulanceAnimation]);

  useEffect(() => {
    // Fallback: mark config as loaded after 3s so the rest of the UI isn't blocked
    // even if the backend is slow, but do NOT set hasValidMapKey — that only happens
    // when we can confirm a real key was returned.
    const timeout = setTimeout(() => setIsConfigLoaded(true), 3000);

    const isValid = (k: unknown): k is string =>
      typeof k === 'string' && k.trim().length > 10 &&
      !k.startsWith('your_') && k !== 'API_KEY_REQUIRED' && !k.includes('placeholder');

    fetch('/api/v1/config')
      .then(r => r.ok ? r.json() : {})
      .then((data: any) => {
        const backendKey = data?.maps_api_key;
        const localKey = import.meta.env.VITE_MAPS_API_KEY;
        const key = isValid(backendKey) ? backendKey : (isValid(localKey) ? localKey : null);
        if (key) {
          setDynamicMapKey(key);
          setHasValidMapKey(true);
        }
        setIsConfigLoaded(true);
      })
      .catch(() => {
        const localKey = import.meta.env.VITE_MAPS_API_KEY;
        if (isValid(localKey)) {
          setDynamicMapKey(localKey);
          setHasValidMapKey(true);
        }
        setIsConfigLoaded(true);
      });

    fetchFleet();
    fetchActiveIncidents();
    return () => clearTimeout(timeout);
  }, [fetchActiveIncidents]);

  // ---------------------------------------------------------------------------
  // Voice recording
  // ---------------------------------------------------------------------------
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => setAudioBlob(new Blob(chunks, { type: 'audio/webm' }));
        mediaRecorderRef.current = recorder;
        recorder.start();
        setIsRecording(true);
        setAudioBlob(null);
      } catch {
        alert('Microphone access denied or unavailable.');
      }
    }
  };

  const handleImageCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  // ---------------------------------------------------------------------------
  // Submit incident
  // ---------------------------------------------------------------------------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incidentText && !audioBlob && !imageFile) return alert('Please provide text, voice, or a photo.');
    setLoading(true);
    try {
      const fd = new FormData();
      if (incidentText) fd.append('raw_input', incidentText);
      if (audioBlob) fd.append('audio', audioBlob, 'voice.webm');
      if (imageFile) fd.append('image', imageFile);

      const res = await fetch('/api/v1/incidents', { method: 'POST', body: fd });
      const data = await res.json();
      setActiveIncident(data);
      setJourney([]);
      setLiveAmbPos(null);

      if (data?.extracted?.lat && data?.extracted?.lng) {
        setMapCenter({ lat: data.extracted.lat, lng: data.extracted.lng });
      }
      if (appMode === 'public') setAppMode('dispatch');

      // Fetch initial journey events
      fetch(`/api/v1/incidents/${data.incident_id}/journey`)
        .then(r => r.json())
        .then((j: any) => setJourney(j.journey || []))
        .catch(console.error);

      fetchFleet();

      const recRes = await fetch(`/api/v1/dispatch/recommend?incident_id=${data.incident_id}`, { method: 'POST' });
      const recData = await recRes.json();
      setRecommendations(recData);
      setViewState('dispatching');

      setIncidentText('');
      setAudioBlob(null);
      setImageFile(null);
      setImagePreview(null);
    } catch {
      alert('Failed to connect to backend.');
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Confirm dispatch
  // ---------------------------------------------------------------------------
  const handleDispatch = async () => {
    const ambulanceId = recommendations?.recommendations?.[0]?.unit_id;
    const hospitalId = recommendations?.recommended_hospital?.hospital_id;
    const incidentId = activeIncident?.incident_id;

    if (incidentId && ambulanceId && hospitalId) {
      try {
        const res = await fetch(
          `/api/v1/dispatch/confirm?incident_id=${incidentId}&ambulance_id=${ambulanceId}&hospital_id=${hospitalId}`,
          { method: 'POST' },
        );
        const data = await res.json();
        setJourney(data.journey || []);
        if (data.route_waypoints?.length > 0) {
          startAmbulanceAnimation(data.route_waypoints);
        }
      } catch (err) {
        console.error('Dispatch confirm error:', err);
      }
    }
    setViewState('dispatched');
  };

  // ===========================================================================
  // PUBLIC REPORTER UI
  // ===========================================================================
  if (appMode === 'public') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div
          className="absolute top-4 right-4 text-white p-2 border border-slate-700 rounded-md cursor-pointer hover:bg-slate-800"
          onClick={() => setAppMode('dispatch')}
          role="button"
          aria-label="Switch to dispatcher view"
        >
          Admin / Dispatch Login
        </div>
        <Card className="w-full max-w-lg bg-white overflow-hidden shadow-2xl rounded-2xl border-0">
          <div className="bg-rose-600 p-6 text-center text-white">
            <Activity className="w-12 h-12 mx-auto mb-2 animate-pulse" aria-hidden="true" />
            <h1 className="text-2xl font-black tracking-tight">Public Emergency AI</h1>
            <p className="text-rose-100 text-sm mt-1">
              Report emergencies instantly using text, voice, or photos.
            </p>
          </div>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6" aria-label="Emergency report form">
              <div className="space-y-2">
                <label htmlFor="incident-text" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Describe Incident (Optional if using Voice/Photo)
                </label>
                <textarea
                  id="incident-text"
                  rows={3}
                  value={incidentText}
                  onChange={e => setIncidentText(e.target.value)}
                  placeholder="e.g. Car crash at 4th and Main..."
                  className="w-full rounded-xl border-2 border-slate-200 p-3 text-sm focus:outline-none focus:border-rose-500 transition-colors resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Button
                  type="button"
                  variant={isRecording ? 'destructive' : 'outline'}
                  className={`h-24 rounded-xl flex flex-col items-center justify-center gap-2 border-2 transition-all ${audioBlob && !isRecording ? 'border-emerald-500 bg-emerald-50 hover:bg-emerald-100' : ''}`}
                  onClick={toggleRecording}
                  aria-label={isRecording ? 'Stop voice recording' : audioBlob ? 'Voice recording attached' : 'Start voice recording'}
                  aria-pressed={isRecording}
                >
                  {isRecording
                    ? <StopCircle className="w-8 h-8 animate-pulse" aria-hidden="true" />
                    : audioBlob
                    ? <PlaySquare className="w-8 h-8 text-emerald-600" aria-hidden="true" />
                    : <Mic className="w-8 h-8" aria-hidden="true" />}
                  <span className="text-xs font-bold">
                    {isRecording ? 'Recording...' : audioBlob ? 'Voice Attached' : 'Tap to Speak'}
                  </span>
                </Button>

                <div className="relative">
                  <input type="file" accept="image/*" capture="environment" id="cameraInput"
                    className="hidden" onChange={handleImageCapture} />
                  <label htmlFor="cameraInput"
                    className={`h-24 rounded-xl flex flex-col items-center justify-center gap-2 border-2 cursor-pointer transition-all hover:bg-slate-50 ${imagePreview ? 'border-emerald-500 bg-emerald-50' : ''}`}
                    aria-label="Capture or upload scene photo">
                    {imagePreview && (
                      <img src={imagePreview} className="w-full h-full object-cover rounded-lg absolute inset-0 opacity-40" alt="Scene preview" />
                    )}
                    <Camera className="w-8 h-8 z-10" aria-hidden="true" />
                    <span className="text-xs font-bold z-10">{imagePreview ? 'Photo Added' : 'Take Photo'}</span>
                  </label>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading || (!incidentText && !audioBlob && !imageFile)}
                className="w-full h-14 text-lg font-bold bg-rose-600 hover:bg-rose-700 rounded-xl shadow-lg"
                aria-label="Submit emergency report to dispatch AI"
              >
                {loading ? 'Transmitting to AI Server...' : 'Dispatch Help Now'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ===========================================================================
  // DISPATCHER UI
  // ===========================================================================
  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans overflow-hidden">

      {/* ===== LEFT PANEL ===== */}
      <div className="w-[340px] border-r bg-white flex flex-col shadow-sm z-10">
        <div className="p-4 border-b bg-slate-900 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-rose-500" aria-hidden="true" />
            <h1 className="text-xl font-bold tracking-tight">AmbulAI Central</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setAppMode('public')}
            className="text-xs text-slate-400 hover:text-white">Portal</Button>
        </div>

        {/* Intake form */}
        <div className="p-4 bg-slate-50 border-b">
          <h3 className="text-xs font-semibold mb-2 text-slate-600 uppercase tracking-wider">
            Manual Incident Intake
          </h3>
          <form onSubmit={handleSubmit} className="space-y-2" aria-label="Dispatcher incident intake">
            <textarea
              rows={2}
              value={incidentText}
              onChange={e => setIncidentText(e.target.value)}
              placeholder="Type emergency location & details..."
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
              aria-label="Incident description"
            />
            <Button type="submit" disabled={loading} className="w-full bg-rose-600 hover:bg-rose-700">
              {loading ? 'Processing...' : 'Intake Incident'}
            </Button>
          </form>
        </div>

        {/* Active incident card */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3"
          role="status" aria-live="polite" aria-label="Active incident status">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex justify-between">
            Active Incident
            {activeIncident && <Badge variant="destructive" className="ml-2">Live</Badge>}
          </h3>

          {activeIncident ? (
            <Card className="border-l-4 border-l-rose-500 shadow-md">
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <Badge variant="destructive" className="shrink-0">
                    {activeIncident?.extracted?.severity || 'P1'} · {activeIncident?.extracted?.incident_type}
                  </Badge>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    activeIncident?.extracted?.location_confidence === 'high' ? 'bg-emerald-100 text-emerald-700' :
                    activeIncident?.extracted?.location_confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {activeIncident?.extracted?.location_confidence || 'low'} confidence
                  </span>
                </div>

                {activeIncident?.extracted?.incident_title && (
                  <p className="text-sm font-extrabold text-slate-900 leading-tight">
                    {activeIncident.extracted.incident_title}
                  </p>
                )}

                <p className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{activeIncident?.extracted?.location_raw}</span>
                  &nbsp;({activeIncident.extracted?.lat?.toFixed(4)}, {activeIncident.extracted?.lng?.toFixed(4)})
                </p>

                {activeIncident?.extracted?.transcription && (
                  <div className="text-xs bg-indigo-50 border border-indigo-100 p-2 rounded-md">
                    <span className="font-bold text-indigo-700 uppercase tracking-wide text-[10px]">Voice Transcript</span>
                    <p className="mt-0.5 text-slate-700 italic">"{activeIncident.extracted.transcription}"</p>
                  </div>
                )}

                {activeIncident?.extracted?.visual_description && (
                  <div className="text-xs bg-amber-50 border border-amber-100 p-2 rounded-md">
                    <span className="font-bold text-amber-700 uppercase tracking-wide text-[10px]">Scene Analysis</span>
                    <p className="mt-0.5 text-slate-700">{activeIncident.extracted.visual_description}</p>
                  </div>
                )}

                <div className="text-xs text-slate-600 bg-slate-100 p-2 rounded-md border text-justify">
                  <strong>AI Notes:</strong> {activeIncident?.extracted?.special_notes}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center p-8 text-slate-400 border-2 border-dashed rounded-lg">
              <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-20" aria-hidden="true" />
              <p className="text-sm">Awaiting 911 Calls...</p>
            </div>
          )}
        </div>
      </div>

      {/* ===== CENTER PANEL — LIVE MAP ===== */}
      <div className="flex-1 relative bg-slate-200 overflow-hidden">
        {!isConfigLoaded ? (
          /* Still waiting for /api/v1/config response */
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-500">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-400 mb-4" role="status" aria-label="Loading map configuration" />
            <p className="text-sm">Checking Map License...</p>
          </div>
        ) : !hasValidMapKey ? (
          /* Config loaded but no valid API key was found */
          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 text-slate-500 gap-3 p-8">
            <MapIcon className="w-16 h-16 opacity-20" aria-hidden="true" />
            <p className="text-base font-semibold text-slate-700">Google Maps API Key Required</p>
            <p className="text-sm text-center max-w-xs">
              Set <code className="bg-slate-200 px-1 rounded text-xs">MAPS_API_KEY</code> in your Cloud Run backend environment variables and redeploy,
              or add it to your <code className="bg-slate-200 px-1 rounded text-xs">.env</code> file for local development.
            </p>
            <p className="text-xs text-slate-400 text-center max-w-xs">
              Enable: Maps JavaScript API + Directions API in Google Cloud Console.
            </p>
            {/* Incident & dispatch panels still fully work without the map */}
          </div>
        ) : (
          <APIProvider apiKey={dynamicMapKey}>
            <Map
              center={mapCenter}
              zoom={14}
              gestureHandling="greedy"
              disableDefaultUI={true}
              mapId="DEMO_MAP_ID"
              className="w-full h-full"
              aria-label="Live emergency map"
            >
              <TrafficLayerOverlay />

              {/* Confirmed route polyline */}
              {viewState === 'dispatched' && recommendations?.recommendations?.[0] && activeIncident && (
                <DirectionsPlotter
                  origin={{ lat: recommendations.recommendations[0].lat, lng: recommendations.recommendations[0].lng }}
                  destination={{ lat: activeIncident.extracted.lat, lng: activeIncident.extracted.lng }}
                />
              )}

              {/* Static fleet ambulances */}
              {fleet.ambulances.map((amb, i) => (
                <AdvancedMarker key={`amb-${i}`} position={{ lat: amb.lat, lng: amb.lng }} title={amb.unit_code}>
                  <Pin
                    background="#2563eb"
                    glyphColor="#fff"
                    borderColor="#1e40af"
                    scale={recommendations?.recommendations?.[0]?.unit_id === amb.id ? 1.4 : 1.0}
                  />
                </AdvancedMarker>
              ))}

              {/* Hospitals */}
              {fleet.hospitals.map((hosp, i) => (
                <AdvancedMarker key={`hosp-${i}`} position={{ lat: hosp.lat, lng: hosp.lng }} title={hosp.name}>
                  <Pin background="#10b981" glyphColor="#fff" borderColor="#064e3b" />
                </AdvancedMarker>
              ))}

              {/* Police station */}
              {activeIncident?.extracted?.nearest_police_station && (
                <AdvancedMarker
                  position={{ lat: activeIncident.extracted.nearest_police_station.lat, lng: activeIncident.extracted.nearest_police_station.lng }}
                  title="Police Station"
                >
                  <Pin background="#0ea5e9" glyphColor="#fff" borderColor="#0369a1" />
                </AdvancedMarker>
              )}

              {/* Incident pin */}
              {activeIncident?.extracted?.lat && (
                <AdvancedMarker
                  position={{ lat: activeIncident.extracted.lat, lng: activeIncident.extracted.lng }}
                  title="Incident Location"
                >
                  <Pin background="#e11d48" glyphColor="#fff" borderColor="#881337" scale={1.3} />
                </AdvancedMarker>
              )}

              {/* ── LIVE AMBULANCE (animated) ── */}
              {liveAmbPos && (
                <AdvancedMarker position={liveAmbPos} zIndex={200} title="Ambulance En Route">
                  <div className="relative flex flex-col items-center">
                    <div className="w-10 h-10 bg-rose-600 rounded-full flex items-center justify-center text-xl shadow-xl border-2 border-white animate-bounce">
                      🚑
                    </div>
                    <div className="mt-0.5 bg-rose-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow whitespace-nowrap">
                      EN ROUTE
                    </div>
                  </div>
                </AdvancedMarker>
              )}
            </Map>
          </APIProvider>
        )}

        {/* Overlay: Dispatching */}
        {viewState === 'dispatching' && recommendations && (
          <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none z-20">
            <div className="relative w-full max-w-2xl bg-indigo-900/90 backdrop-blur-md rounded-2xl shadow-2xl p-8 text-center animate-in fade-in zoom-in duration-500">
              <Route className="w-16 h-16 text-indigo-400 mb-4 mx-auto" aria-hidden="true" />
              <h3 className="text-2xl font-bold text-white mb-2">Simulating Live Traffic & Fleet Assignment</h3>
              <p className="text-indigo-200 mb-6">
                Gemini Dispatch Engine predicting optimal intercept path for {activeIncident?.extracted?.location_raw}
              </p>
              <div className="w-64 h-2 bg-indigo-950 rounded-full overflow-hidden mx-auto">
                <div className="w-full h-full bg-indigo-400 animate-pulse rounded-full" />
              </div>
            </div>
          </div>
        )}

        {/* Overlay: Dispatched */}
        {viewState === 'dispatched' && liveAmbPos && (
          <div className="absolute top-4 right-4 z-20 pointer-events-none">
            <div className="bg-white/95 backdrop-blur px-4 py-2 rounded-xl shadow-xl text-sm font-bold flex items-center gap-2 border-2 border-rose-100 animate-in fade-in duration-500">
              <span className="text-lg">🚑</span>
              <span className="text-rose-600">{recommendations?.recommendations?.[0]?.unit_code}</span>
              <span className="text-slate-600">En Route — Optimized Path Active</span>
            </div>
          </div>
        )}

        {/* Map legend */}
        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-2 rounded-lg shadow min-w-[200px] z-10 pointer-events-none border border-slate-200">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-1">
            <MapIcon className="w-4 h-4 text-indigo-600" aria-hidden="true" /> Live Agentic Satellite
          </div>
          <div className="text-[10px] text-slate-500 flex items-center gap-1 uppercase tracking-wider">
            <Activity className="w-3 h-3 text-emerald-500" aria-hidden="true" /> Real-time Traffic Layers Enabled
          </div>
        </div>
      </div>

      {/* ===== RIGHT PANEL ===== */}
      <div className="w-[380px] border-l bg-slate-50 flex flex-col shadow-sm z-10">
        <div className="p-4 border-b bg-white">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Bot className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Dispatch Intelligence
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5"
          role="region" aria-label="Dispatch recommendations and incident journey" aria-live="polite">

          {viewState === 'idle' && journey.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-slate-400">
              <Bot className="w-12 h-12 mb-4 opacity-20" aria-hidden="true" />
              <p className="text-sm text-center">Awaiting incoming telemetry...</p>
            </div>
          ) : (
            <>
              {/* ── Assigned Unit ── */}
              {recommendations?.recommendations?.[0] && (
                <div>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Targeted Asset</h3>
                  <Card className="border-indigo-500 bg-indigo-50 shadow-md">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-extrabold text-xl text-slate-900">
                          {recommendations.recommendations[0].unit_code}
                        </span>
                        <div className="text-right">
                          <div className="font-black text-xl text-indigo-600">
                            {recommendations.recommendations[0].eta_minutes}m
                          </div>
                          <div className="text-[10px] uppercase font-bold text-indigo-400">ETA</div>
                        </div>
                      </div>
                      <p className="text-xs text-indigo-900/80 leading-relaxed">
                        {recommendations.recommendations[0].rationale}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* ── Receiving Hospital ── */}
              {recommendations?.recommended_hospital && (
                <div>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Receiving Medical Centre</h3>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                          <Activity className="w-5 h-5 text-rose-600" aria-hidden="true" />
                        </div>
                        <div>
                          <div className="font-bold text-sm leading-tight">
                            {recommendations.recommended_hospital.name}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Level {recommendations.recommended_hospital.trauma_level} Trauma · {recommendations.recommended_hospital.eta_from_scene_minutes}m from scene
                          </div>
                        </div>
                      </div>
                      {viewState === 'dispatched' && (
                        <div className="mt-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs px-2 py-1.5 rounded font-semibold flex items-center gap-2">
                          <AlertCircle className="w-3 h-3" aria-hidden="true" /> HL7 Pre-Alert Transmitted
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* ── Journey Timeline ── */}
              {journey.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                    Incident Journey · {journey.length} Events
                  </h3>
                  <div className="relative">
                    {/* Vertical line */}
                    <div className="absolute left-3.5 top-0 bottom-0 w-px bg-slate-200" aria-hidden="true" />
                    <div className="space-y-4">
                      {journey.map((ev, i) => {
                        const cfg = EVENT_CONFIG[ev.event_type] || EVENT_CONFIG['reported'];
                        const isLast = i === journey.length - 1;
                        return (
                          <div key={ev.id} className="flex gap-3 relative">
                            {/* Dot */}
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0 z-10 shadow-sm ${cfg.color} ${isLast ? 'ring-2 ring-offset-1 ring-rose-300 animate-pulse' : ''}`}
                              aria-label={cfg.label}>
                              {cfg.icon}
                            </div>
                            <div className="flex-1 min-w-0 pb-1">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs font-bold text-slate-800">{cfg.label}</span>
                                <span className="text-[10px] text-slate-400 flex items-center gap-0.5 shrink-0">
                                  <Clock className="w-2.5 h-2.5" aria-hidden="true" />
                                  {relativeTime(ev.timestamp)}
                                </span>
                              </div>
                              <p className="text-[10px] font-semibold text-indigo-700 mb-0.5">{ev.actor_name}</p>
                              <p className="text-[10px] text-slate-600 leading-relaxed">{ev.narrative}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Dispatch CTA */}
        {viewState === 'dispatching' && (
          <div className="p-4 bg-white border-t">
            <Button
              onClick={handleDispatch}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg h-14 text-lg font-bold"
              aria-label="Confirm and dispatch selected ambulance unit"
            >
              Execute Protocols <Navigation className="w-5 h-5 ml-2" aria-hidden="true" />
            </Button>
          </div>
        )}

        {viewState === 'dispatched' && journey.length > 0 && (
          <div className="p-3 bg-white border-t flex items-center gap-2 text-xs text-emerald-700 font-semibold">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            Protocols Activated · {journey.length} events recorded
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
