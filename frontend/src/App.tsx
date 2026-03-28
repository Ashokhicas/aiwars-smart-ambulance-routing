/// <reference types="vite/client" />
import React, { useState, useEffect, useRef } from 'react';
import { Bot, Map as MapIcon, Mic, Navigation, ShieldAlert, Activity, Route, Camera, AlertCircle, PlaySquare, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { APIProvider, Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';

// Sub-component: Real-time Traffic Layer
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

// Sub-component: Route Plotter
function DirectionsPlotter({ origin, destination }: { origin: {lat: number, lng: number}, destination: {lat: number, lng: number} }) {
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
      polylineOptions: { strokeColor: '#4f46e5', strokeWeight: 6, strokeOpacity: 0.8 } 
    }));
  }, [routesLib, map]);

  useEffect(() => {
    if (!directionsService || !directionsRenderer || !origin || !destination) return;
    directionsService.route({
      origin,
      destination,
      travelMode: window.google.maps.TravelMode.DRIVING,
      drivingOptions: { departureTime: new Date(), trafficModel: window.google.maps.TrafficModel.BEST_GUESS }
    }).then(response => {
      directionsRenderer.setDirections(response);
    }).catch(e => console.error("Directions Error", e));
  }, [directionsService, directionsRenderer, origin, destination]);

  return null;
}

type AppMode = 'dispatch' | 'public';

function App() {
  const [appMode, setAppMode] = useState<AppMode>('dispatch');
  const [incidentText, setIncidentText] = useState('');
  const [recommendations, setRecommendations] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeIncident, setActiveIncident] = useState<any>(null);
  const [viewState, setViewState] = useState<'idle' | 'dispatching' | 'dispatched'>('idle');
  const [fleet, setFleet] = useState<{ambulances: any[], hospitals: any[]}>({ambulances: [], hospitals: []});
  const [mapCenter, setMapCenter] = useState({ lat: 12.9724, lng: 77.6169 });
  const [dynamicMapKey, setDynamicMapKey] = useState<string>("API_KEY_REQUIRED");
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);

  // Multimodal Voice Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Multimodal Image State
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const fetchFleet = () => {
    fetch('/api/v1/fleet')
      .then(r => r.json())
      .then(setFleet)
      .catch(console.error);
  };

  useEffect(() => {
    // Failsafe timeout to force map rendering even if backend hangs
    const timeout = setTimeout(() => setIsConfigLoaded(true), 2000);

    fetch('/api/v1/config')
      .then(r => r.ok ? r.json() : {})
      .then(data => {
         const backendKey = (data as any)?.maps_api_key;
         const localKey = import.meta.env.VITE_MAPS_API_KEY;
         
         const isValid = (k: string) => k && k.trim() !== "" && !k.startsWith("your_") && k !== "API_KEY_REQUIRED";
         const key = isValid(backendKey) ? backendKey : (isValid(localKey) ? localKey : null);
         
         console.warn("AmbulAI Configuration Resolved Key:", key ? `${key.substring(0, 8)}...` : "NONE");
         if (key) {
            setDynamicMapKey(key);
         }
         setIsConfigLoaded(true);
      })
      .catch((err) => {
         console.error("Config fetch failed:", err);
         const localKey = import.meta.env.VITE_MAPS_API_KEY;
         if (localKey && !localKey.startsWith("your_")) setDynamicMapKey(localKey);
         setIsConfigLoaded(true);
      });
      
    fetchFleet();
    return () => clearTimeout(timeout);
  }, []);

  // Voice Controls
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
        setAudioBlob(null); // Reset old
      } catch (err) {
        alert("Microphone access denied or unavailable.");
      }
    }
  };

  // Image Controls
  const handleImageCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incidentText && !audioBlob && !imageFile) return alert('Please provide text, voice, or a photo.');

    setLoading(true);
    try {
      // Build native FormData for FastAPI Multimodal
      const fd = new FormData();
      if (incidentText) fd.append('raw_input', incidentText);
      if (audioBlob) fd.append('audio', audioBlob, 'voice.webm');
      if (imageFile) fd.append('image', imageFile);

      const res = await fetch('/api/v1/incidents', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      setActiveIncident(data);
      
      // Auto-center map on AI derived coordinates
      if (data?.extracted?.lat && data?.extracted?.lng) {
         setMapCenter({ lat: data.extracted.lat, lng: data.extracted.lng });
      }
      
      // Instantly swap to Dispatch view if submitted by Public
      if (appMode === 'public') setAppMode('dispatch');

      // Re-fetch fleet locally to render newly found agentic hospitals/police
      fetchFleet();
      
      const recRes = await fetch(`/api/v1/dispatch/recommend?incident_id=${data.incident_id}`, {
        method: 'POST',
      });
      const recData = await recRes.json();
      setRecommendations(recData);
      setViewState('dispatching');
      
      // Reset Multimodal State
      setIncidentText('');
      setAudioBlob(null);
      setImageFile(null);
      setImagePreview(null);
      
    } catch (err) {
      console.error(err);
      alert('Failed to connect to backend.');
    } finally {
      setLoading(false);
    }
  };

  const handleDispatch = () => {
    setViewState('dispatched');
    alert("AmbulAI Agentic Orchestration Activated:\n1. Ambulance Route Locked\n2. ER Pre-alert delivered to hospital\n3. Alert paged to local Police Precinct.");
  };

  // ---------------- PUBLIC REPORTER UI ----------------
  if (appMode === 'public') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="absolute top-4 right-4 text-white p-2 border border-slate-700 rounded-md cursor-pointer hover:bg-slate-800" onClick={() => setAppMode('dispatch')}>
           Admin / Dispatch Login
        </div>
        <Card className="w-full max-w-lg bg-white overflow-hidden shadow-2xl rounded-2xl border-0">
          <div className="bg-rose-600 p-6 text-center text-white">
            <Activity className="w-12 h-12 mx-auto mb-2 animate-pulse" />
            <h1 className="text-2xl font-black tracking-tight">Public Emergency AI</h1>
            <p className="text-rose-100 text-sm mt-1">Report emergencies instantly using text, voice, or photos. Our Gemini AI deeply analyzes media to dispatch Ambulance & Police.</p>
          </div>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Describe Incident (Optional if using Voice/Photo)</label>
                <textarea 
                  rows={3}
                  value={incidentText}
                  onChange={(e) => setIncidentText(e.target.value)}
                  placeholder="e.g. Car crash at 4th and Main..."
                  className="w-full rounded-xl border-2 border-slate-200 p-3 text-sm focus:outline-none focus:border-rose-500 transition-colors resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                 {/* Voice Capture */}
                 <Button 
                   type="button" 
                   variant={isRecording ? "destructive" : "outline"}
                   className={`h-24 rounded-xl flex flex-col items-center justify-center gap-2 border-2 transition-all ${audioBlob && !isRecording ? "border-emerald-500 bg-emerald-50 hover:bg-emerald-100" : ""}`}
                   onClick={toggleRecording}
                 >
                   {isRecording ? <StopCircle className="w-8 h-8 animate-pulse" /> : audioBlob ? <PlaySquare className="w-8 h-8 text-emerald-600" /> : <Mic className="w-8 h-8" />}
                   <span className="text-xs font-bold">{isRecording ? "Recording..." : audioBlob ? "Voice Attached" : "Tap to Speak"}</span>
                 </Button>

                 {/* Photo Capture */}
                 <div className="relative">
                   <input type="file" accept="image/*" capture="environment" id="cameraInput" className="hidden" onChange={handleImageCapture} />
                   <label htmlFor="cameraInput" className={`h-24 rounded-xl flex flex-col items-center justify-center gap-2 border-2 cursor-pointer transition-all hover:bg-slate-50 ${imagePreview ? "border-emerald-500 bg-emerald-50" : ""}`}>
                     {imagePreview ? (
                       <img src={imagePreview} className="w-full h-full object-cover rounded-lg absolute inset-0 opacity-40" alt="Preview"/>
                     ) : null}
                     <Camera className="w-8 h-8 z-10" />
                     <span className="text-xs font-bold z-10">{imagePreview ? "Photo Added" : "Take Photo"}</span>
                   </label>
                 </div>
              </div>

              <Button type="submit" disabled={loading || (!incidentText && !audioBlob && !imageFile)} className="w-full h-14 text-lg font-bold bg-rose-600 hover:bg-rose-700 rounded-xl shadow-lg">
                {loading ? 'Transmitting to AI Server...' : 'Dispatch Help Now'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---------------- DISPATCHER APARATUS GUI ----------------
  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans overflow-hidden">
      
      {/* LEFT PANEL */}
      <div className="w-[340px] border-r bg-white flex flex-col shadow-sm z-10">
        <div className="p-4 border-b bg-slate-900 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-rose-500" />
            <h1 className="text-xl font-bold tracking-tight">AmbulAI Central</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setAppMode('public')} className="text-xs text-slate-400 hover:text-white">Portal</Button>
        </div>
        
        <div className="p-4 bg-slate-50 border-b">
          <h3 className="text-xs font-semibold mb-2 text-slate-600 uppercase tracking-wider">Manual Incident Intake</h3>
          <form onSubmit={handleSubmit} className="space-y-2">
            <textarea 
              rows={2}
              value={incidentText}
              onChange={(e) => setIncidentText(e.target.value)}
              placeholder="e.g. Type emergency location & details..."
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            <Button type="submit" disabled={loading} className="w-full bg-rose-600 hover:bg-rose-700">
              {loading ? 'Processing...' : 'Intake Incident'}
            </Button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex justify-between">
            Active Incidents {activeIncident && <Badge variant="destructive" className="ml-2">Live</Badge>}
          </h3>
          
          {activeIncident ? (
            <Card className="border-l-4 border-l-rose-500 shadow-md">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <Badge variant="destructive">P{activeIncident?.extracted?.severity?.replace(/\D/g,'') || 1} {activeIncident?.extracted?.incident_type}</Badge>
                  <span className="text-xs text-slate-500 text-right font-medium">Lat: {activeIncident.extracted.lat?.toFixed(3)}<br/>Lng: {activeIncident.extracted.lng?.toFixed(3)}</span>
                </div>
                <p className="text-sm font-bold text-slate-800 mb-1">{activeIncident?.extracted?.location_raw}</p>
                <div className="text-xs text-slate-600 bg-slate-100 p-2 rounded-md border text-justify">
                  <strong>AI Analysis:</strong> {activeIncident?.extracted?.special_notes || incidentText}
                </div>
              </CardContent>
            </Card>
          ) : (
             <div className="text-center p-8 text-slate-400 border-2 border-dashed rounded-lg">
                <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">Awaiting 911 Calls...</p>
             </div>
          )}
        </div>
      </div>

      {/* CENTER PANEL (LIVE MAP with ROUTES & TRAFFIC) */}
      <div className="flex-1 relative bg-slate-200 overflow-hidden">
        {isConfigLoaded ? (
          <APIProvider apiKey={dynamicMapKey}>
            <Map 
              center={mapCenter} 
              zoom={14} 
              gestureHandling={'greedy'} 
              disableDefaultUI={true}
              mapId="DEMO_MAP_ID"
              className="w-full h-full"
            >
              {/* Layer 1: Real-time traffic overlay */}
              <TrafficLayerOverlay />

              {/* Layer 2: Routing Polyline */}
              {viewState === 'dispatched' && recommendations?.recommendations?.[0] && activeIncident && (
                  <DirectionsPlotter 
                      origin={{lat: recommendations.recommendations[0].lat, lng: recommendations.recommendations[0].lng}}
                      destination={{lat: activeIncident.extracted.lat, lng: activeIncident.extracted.lng}}
                  />
              )}

              {/* Layer 3: Render Fleet */}
              {fleet.ambulances.map((amb, i) => (
                <AdvancedMarker key={`amb-${i}`} position={{lat: amb.lat, lng: amb.lng}} title={amb.unit_code}>
                   <Pin background={'#2563eb'} glyphColor={'#fff'} borderColor={'#1e40af'} scale={recommendations?.recommendations?.[0]?.unit_id === amb.unit_id ? 1.4 : 1.0} />
                </AdvancedMarker>
              ))}

              {/* Layer 4: Render All Hospitals */}
              {fleet.hospitals.map((hosp, i) => (
                <AdvancedMarker key={`hosp-${i}`} position={{lat: hosp.lat, lng: hosp.lng}} title={hosp.name}>
                   <Pin background={'#10b981'} glyphColor={'#fff'} borderColor={'#064e3b'} />
                </AdvancedMarker>
              ))}

              {/* Layer 5: Render Police Station (if detected) */}
              {activeIncident?.extracted?.nearest_police_station && (
                <AdvancedMarker position={{lat: activeIncident.extracted.nearest_police_station.lat, lng: activeIncident.extracted.nearest_police_station.lng}}>
                   <Pin background={'#0ea5e9'} glyphColor={'#fff'} borderColor={'#0369a1'} />
                </AdvancedMarker>
              )}

              {/* Layer 6: Render Target Incident */}
              {activeIncident?.extracted?.lat && (
                <AdvancedMarker position={{lat: activeIncident.extracted.lat, lng: activeIncident.extracted.lng}}>
                   <Pin background={'#e11d48'} glyphColor={'#fff'} borderColor={'#881337'} scale={1.2} />
                </AdvancedMarker>
              )}
            </Map>
          </APIProvider>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-500">
             <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-400 mb-4"></div>
             Checking Secure Map License...
          </div>
        )}
        
        {/* Transparent Overlays */}
        {viewState === 'dispatching' && recommendations && (
          <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none z-20">
            <div className="relative w-full max-w-2xl bg-indigo-900/90 backdrop-blur-md rounded-2xl shadow-2xl overflow-hidden flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-500">
                <Route className="w-16 h-16 text-indigo-400 mb-4" />
                <h3 className="text-2xl font-bold text-white mb-2">Simulating Live Traffic & Fleet Assignment</h3>
                <p className="text-indigo-200 mb-6">AmbulAI Agentic Core is predicting Google Maps routing trajectories to find the absolute fastest intercept path for {activeIncident?.extracted?.location_raw}</p>
                <div className="w-64 h-2 bg-indigo-950 rounded-full overflow-hidden">
                  <div className="w-full h-full bg-indigo-400 animate-pulse rounded-full" />
                </div>
            </div>
          </div>
        )}

        {viewState === 'dispatched' && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20 pointer-events-none animate-in fade-in zoom-in duration-1000">
            <div className="w-14 h-14 bg-rose-600 rounded-full flex items-center justify-center shadow-rose-900/50 shadow-2xl animate-bounce">
              <Activity className="w-8 h-8 text-white" />
            </div>
            <div className="bg-white/95 backdrop-blur px-5 py-3 rounded-full shadow-2xl mt-4 text-sm font-bold flex items-center gap-3 border-2 border-rose-100">
              <Navigation className="w-5 h-5 text-rose-600" /> {recommendations?.recommendations?.[0]?.unit_code || "AMB"} En Route using Optimized Path
            </div>
          </div>
        )}
        
        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-2 rounded-lg shadow min-w-[200px] z-10 pointer-events-none border border-slate-200">
           <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-1"><MapIcon className="w-4 h-4 text-indigo-600"/> Live Agentic Satellite</div>
           <div className="text-[10px] text-slate-500 flex items-center gap-1 uppercase tracking-wider"><Activity className="w-3 h-3 text-emerald-500"/> Real-time Traffic Layers Enabled</div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="w-[380px] border-l bg-slate-50 flex flex-col shadow-sm z-10">
        <div className="p-4 border-b bg-white">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Bot className="w-5 h-5 text-indigo-600" /> Dispatch Recommendation
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {viewState === 'idle' ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <Bot className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm text-center">Awaiting incoming telemetry...</p>
            </div>
          ) : recommendations ? (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-500">
              
              <div>
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Targeted Asset</h3>
                <Card className="border-indigo-500 bg-indigo-50 shadow-md">
                   <CardContent className="p-4">
                     <div className="flex justify-between items-start mb-2">
                       <div className="flex items-center gap-2">
                         <span className="font-extrabold text-xl text-slate-900">{recommendations.recommendations?.[0]?.unit_code || 'N/A'}</span>
                       </div>
                       <div className="text-right">
                         <div className="font-black text-xl text-indigo-600">{recommendations.recommendations?.[0]?.eta_minutes || 0}m</div>
                         <div className="text-[10px] uppercase font-bold text-indigo-400">Google ETA</div>
                       </div>
                     </div>
                     <p className="text-xs text-indigo-900/80 leading-relaxed font-medium">Optimal route selected avoiding primary traffic congestion.</p>
                   </CardContent>
                </Card>
              </div>

              <div>
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Receiving Medical Center</h3>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                        <Activity className="w-5 h-5 text-rose-600" />
                      </div>
                      <div>
                        <div className="font-bold text-sm leading-tight">{recommendations.recommended_hospital?.name || "Unknown"}</div>
                        <div className="text-xs text-slate-500 mt-1">Level {recommendations.recommended_hospital?.trauma_level || 1} Trauma Center</div>
                      </div>
                    </div>
                    {viewState === 'dispatched' && (
                       <div className="mt-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs px-2 py-1.5 rounded font-semibold flex items-center gap-2">
                         <AlertCircle className="w-3 h-3" /> HL7 Data Sent
                       </div>
                    )}
                  </CardContent>
                </Card>
              </div>

               {/* Agentic Police Deployment rendering dynamically! */}
               {activeIncident?.extracted?.nearest_police_station && (
                <div>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Law Enforcement Support</h3>
                  <Card className="border-sky-200">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                          <ShieldAlert className="w-5 h-5 text-sky-600" />
                        </div>
                        <div>
                          <div className="font-bold text-sm leading-tight text-slate-800">{activeIncident.extracted.nearest_police_station.name}</div>
                          <div className="text-[10px] uppercase font-bold text-sky-500 mt-1">Local Precinct</div>
                        </div>
                      </div>
                      {viewState === 'dispatched' && (
                        <div className="mt-3 bg-sky-50 border border-sky-200 text-sky-700 text-xs px-2 py-1.5 rounded font-semibold flex items-center gap-2">
                          <AlertCircle className="w-3 h-3" /> Paged Unit Dispatch
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
               )}

            </div>
          ) : (
             <div className="h-full flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
             </div>
          )}
        </div>

        {viewState === 'dispatching' && (
          <div className="p-4 bg-white border-t space-y-2">
            <Button onClick={handleDispatch} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg h-14 text-lg font-bold">
              Execute Protocols <Navigation className="w-5 h-5 ml-2" />
            </Button>
          </div>
        )}
      </div>

    </div>
  );
}

export default App;
