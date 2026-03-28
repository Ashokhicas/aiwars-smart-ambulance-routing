import React, { useState } from 'react';
import { Bot, Map as MapIcon, Mic, Navigation, ShieldAlert, Activity, AlertTriangle, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

function App() {
  const [incidentText, setIncidentText] = useState('');
  const [recommendations, setRecommendations] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeIncident, setActiveIncident] = useState<any>(null);
  const [viewState, setViewState] = useState<'idle' | 'dispatching' | 'dispatched'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (incidentText.length < 10) return alert('Please enter at least 10 characters');

    setLoading(true);
    try {
      // Step 1: Create incident (using stub MVP backend)
      const res = await fetch('/api/v1/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_input: incidentText, input_type: 'text' }),
      });
      const data = await res.json();
      setActiveIncident(data);
      
      // Step 2: Get recommendation
      const recRes = await fetch(`/api/v1/dispatch/recommend?incident_id=${data.incident_id}`, {
        method: 'POST',
      });
      const recData = await recRes.json();
      setRecommendations(recData);
      setViewState('dispatching');
      
    } catch (err) {
      console.error(err);
      alert('Failed to connect to backend. Please ensure the backend is running via Docker.');
    } finally {
      setLoading(false);
    }
  };

  const handleDispatch = () => {
    setViewState('dispatched');
    alert("Ambulance dispatched successfully! ER Pre-alert sent.");
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* LEFT PANEL */}
      <div className="w-[340px] border-r bg-white flex flex-col shadow-sm z-10">
        <div className="p-4 border-b bg-slate-900 text-white flex items-center gap-2">
          <Activity className="w-6 h-6 text-rose-500" />
          <h1 className="text-xl font-bold tracking-tight">AmbulAI Dispatch</h1>
        </div>
        
        <div className="p-4 bg-slate-50 border-b">
          <h3 className="text-sm font-semibold mb-3 text-slate-600 uppercase tracking-wider">New Incident Intake</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea 
              rows={4}
              value={incidentText}
              onChange={(e) => setIncidentText(e.target.value)}
              placeholder="e.g. Car accident on MG Road near Trinity Circle, 2 victims..."
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 transition-all resize-none"
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => alert("Voice intake requires microphone permissions and backend API.")}>
                <Mic className="w-4 h-4 mr-2" />
                Voice
              </Button>
              <Button type="submit" disabled={loading} className="flex-1 bg-rose-600 hover:bg-rose-700">
                {loading ? 'Processing...' : 'Intake AI'}
              </Button>
            </div>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">Active Incidents</h3>
          
          {activeIncident ? (
            <Card className="border-l-4 border-l-rose-500 shadow-md">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <Badge variant="destructive">P1 TRAUMA</Badge>
                  <span className="text-xs text-slate-500">{new Date().toLocaleTimeString()}</span>
                </div>
                <p className="text-sm font-medium">{activeIncident?.extracted?.location_raw || 'MG Road, Trinity Circle'}</p>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{incidentText}</p>
              </CardContent>
            </Card>
          ) : (
             <div className="text-center p-8 text-slate-400 border-2 border-dashed rounded-lg">
                <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No active incidents</p>
             </div>
          )}
        </div>
      </div>

      {/* CENTER PANEL (MAP MOCK) */}
      <div className="flex-1 relative bg-slate-200 overflow-hidden">
        {/* Decorative Mock Map Background */}
        <div className="absolute inset-0 opacity-40 bg-[url('https://api.maptiler.com/maps/basic-v2/256/0/0/0.png')] bg-repeat" style={{ backgroundSize: '500px' }} />
        
        {viewState === 'dispatching' && recommendations && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="relative w-full max-w-2xl aspect-video bg-blue-50/80 backdrop-blur-md rounded-2xl border-2 border-blue-200 shadow-2xl overflow-hidden flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-500">
                <Route className="w-16 h-16 text-blue-500 mb-4" />
                <h3 className="text-2xl font-bold text-slate-800 mb-2">Optimizing Route & Fleet Assignment</h3>
                <p className="text-slate-600 mb-6">AmbulAI is analyzing live traffic patterns, crew fatigue, and ER hospital capacities for {activeIncident?.extracted?.location_raw || 'the incident location'}.</p>
                <div className="w-64 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div className="w-full h-full bg-blue-500 animate-pulse rounded-full" />
                </div>
            </div>
          </div>
        )}

        {viewState === 'dispatched' && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
            <div className="w-12 h-12 bg-rose-600 rounded-full flex items-center justify-center shadow-xl animate-bounce">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div className="bg-white px-4 py-2 rounded-full shadow-lg mt-4 text-sm font-semibold flex items-center gap-2">
              <Navigation className="w-4 h-4 text-rose-600" /> AMB-07 En Route (ETA: 4 min)
            </div>
          </div>
        )}
        
        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur p-2 rounded-lg shadow min-w-[200px]">
           <div className="flex items-center gap-2 text-sm font-medium mb-1"><MapIcon className="w-4 h-4"/> Live Tracker View</div>
           <div className="text-xs text-slate-500">Google Maps Integration Placeholder</div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="w-[380px] border-l bg-slate-50 flex flex-col shadow-sm z-10">
        <div className="p-4 border-b bg-white">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Bot className="w-5 h-5 text-indigo-600" /> AI Recommendation
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {viewState === 'idle' ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <Bot className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm text-center">Submit an incident report to receive AI-powered dispatch recommendations.</p>
            </div>
          ) : recommendations ? (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
              
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Ranked Fleet (Top 2)</h3>
                <div className="space-y-3">
                  {recommendations.recommendations?.map((rec: any, i: number) => (
                    <Card key={i} className={i === 0 ? "border-indigo-200 bg-indigo-50/50" : ""}>
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-lg text-slate-800">{rec.unit_code}</span>
                            <Badge variant={i === 0 ? "default" : "secondary"}>{rec.unit_type}</Badge>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-indigo-600">{rec.eta_minutes} min</div>
                            <div className="text-xs text-slate-500">ETA</div>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">{rec.rationale}</p>
                      </CardContent>
                    </Card>
                  )) || (
                    <Card className="border-indigo-200 bg-indigo-50/50">
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-lg text-slate-800">AMB-07</span>
                            <Badge variant="default">ALS</Badge>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-indigo-600">4.2 min</div>
                            <div className="text-xs text-slate-500">ETA</div>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">Closest ALS unit. Crew at 5.5h shift. Fuel 78%.</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Receiving Hospital</h3>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
                        <Activity className="w-5 h-5 text-rose-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{recommendations.recommended_hospital?.name || "St. John's Medical Center"}</div>
                        <div className="text-xs text-slate-500">Trauma Level {recommendations.recommended_hospital?.trauma_level || 1} • {recommendations.recommended_hospital?.eta_from_scene_minutes || 8} min from scene</div>
                      </div>
                    </div>
                    {viewState === 'dispatched' && (
                       <Badge variant="success" className="mt-2 text-xs">Pre-alert delivered to ER</Badge>
                    )}
                  </CardContent>
                </Card>
              </div>

            </div>
          ) : (
             <div className="h-full flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
             </div>
          )}
        </div>

        {viewState === 'dispatching' && (
          <div className="p-4 bg-white border-t">
            <Button onClick={handleDispatch} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg h-12 text-md">
              Confirm & Dispatch <Navigation className="w-4 h-4 ml-2" />
            </Button>
            <Button variant="ghost" className="w-full mt-2 text-slate-500">
              Manual Override
            </Button>
          </div>
        )}
      </div>

    </div>
  );
}

export default App;
