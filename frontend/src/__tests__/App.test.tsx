/**
 * Integration tests for the main App component.
 *
 * Strategy:
 *  - fetch is mocked globally so no real network calls are made
 *  - @vis.gl/react-google-maps is mocked because it loads the
 *    Google Maps JS SDK which is unavailable in jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mock @vis.gl/react-google-maps ───────────────────────────────────────────
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="maps-api-provider">{children}</div>
  ),
  Map: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="google-map">{children}</div>
  ),
  AdvancedMarker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="advanced-marker">{children}</div>
  ),
  Pin: () => <div data-testid="pin" />,
  useMap: () => null,
  useMapsLibrary: () => null,
}));

// ── Default API responses ────────────────────────────────────────────────────
const VALID_KEY = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ12345';

const DEFAULT_CONFIG = { maps_api_key: VALID_KEY };

const DEFAULT_FLEET = {
  ambulances: [
    { id: 'amb-1', unit_code: 'AMB-001', unit_type: 'ALS', fuel_pct: 90, crew_hours: 2, lat: 12.9352, lng: 77.6245 },
  ],
  hospitals: [
    { id: 'hosp-1', name: 'Fortis Hospital', trauma_level: 1, available_beds: 10, is_diverting: false, lat: 12.9716, lng: 77.5946 },
  ],
};

const DEFAULT_ACTIVE_INCIDENTS: unknown[] = [];

const INCIDENT_RESPONSE = {
  incident_id: 'inc-test-001',
  incident_number: 'INC-001',
  status: 'new',
  extracted: { incident_type: 'cardiac_arrest', severity: 'critical', lat: 12.935, lng: 77.624 },
};

const RECOMMENDATION_RESPONSE = {
  incident_id: 'inc-test-001',
  recommendations: [
    {
      unit_id: 'amb-1',
      unit_code: 'AMB-001',
      unit_type: 'ALS',
      lat: 12.9352,
      lng: 77.6245,
      eta_minutes: 4.2,
      score: 0.95,
      rationale: 'Closest ALS unit with full fuel.',
    },
  ],
  recommended_hospital: {
    hospital_id: 'hosp-1',
    name: 'Fortis Hospital',
    trauma_level: 1,
    eta_from_scene_minutes: 6.5,
    is_diverting: false,
    lat: 12.9716,
    lng: 77.5946,
  },
};

const CONFIRM_RESPONSE = {
  status: 'en_route',
  route_waypoints: [
    { lat: 12.9352, lng: 77.6245 },
    { lat: 12.9400, lng: 77.6280 },
    { lat: 12.9450, lng: 77.6310 },
  ],
  journey: [
    { event_type: 'reported',           actor_name: 'Caller',     narrative: 'Emergency reported.', timestamp: new Date().toISOString() },
    { event_type: 'ai_parsed',          actor_name: 'AmbulAI',    narrative: 'AI analysed.',        timestamp: new Date().toISOString() },
    { event_type: 'ambulance_assigned', actor_name: 'AMB-001',    narrative: 'Unit assigned.',      timestamp: new Date().toISOString() },
    { event_type: 'en_route',           actor_name: 'AMB-001',    narrative: 'En route.',           timestamp: new Date().toISOString() },
  ],
};

// ── Helper: build a fetch mock ────────────────────────────────────────────────
function buildFetch(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    '/api/v1/config':           DEFAULT_CONFIG,
    '/api/v1/fleet':            DEFAULT_FLEET,
    '/api/v1/incidents/active': DEFAULT_ACTIVE_INCIDENTS,
  };
  const map = { ...defaults, ...overrides };

  return vi.fn(async (url: string, init?: RequestInit) => {
    // POST /api/v1/incidents
    if (init?.method === undefined && url.includes('/api/v1/incidents') && !url.includes('/journey') && !url.includes('/active')) {
      return { ok: true, json: async () => INCIDENT_RESPONSE };
    }
    if (init?.method === 'POST' && url.includes('/api/v1/incidents')) {
      return { ok: true, json: async () => INCIDENT_RESPONSE };
    }
    // POST /api/v1/dispatch/recommend
    if (url.includes('/api/v1/dispatch/recommend')) {
      return { ok: true, json: async () => RECOMMENDATION_RESPONSE };
    }
    // POST /api/v1/dispatch/confirm
    if (url.includes('/api/v1/dispatch/confirm')) {
      return { ok: true, json: async () => CONFIRM_RESPONSE };
    }
    // Static map lookups
    for (const [key, value] of Object.entries(map)) {
      if (url.includes(key)) {
        return { ok: true, json: async () => value };
      }
    }
    return { ok: false, json: async () => ({}) };
  });
}

// ── Import App after mocks are in place ──────────────────────────────────────
const { default: App } = await import('../App');

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('App — initial render', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = buildFetch() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the AmbulAI heading', async () => {
    render(<App />);
    expect(screen.getByText('AmbulAI')).toBeInTheDocument();
  });

  it('shows the Report Incident panel heading', async () => {
    render(<App />);
    expect(screen.getByText(/report incident/i)).toBeInTheDocument();
  });

  it('renders dispatch and public mode tabs', async () => {
    render(<App />);
    expect(screen.getByText(/dispatcher/i)).toBeInTheDocument();
    expect(screen.getByText(/public/i)).toBeInTheDocument();
  });

  it('renders the incident text area input', async () => {
    render(<App />);
    expect(screen.getByPlaceholderText(/describe the emergency/i)).toBeInTheDocument();
  });
});

// ── Maps API key handling ─────────────────────────────────────────────────────
describe('App — Google Maps key handling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the map provider once a valid key is returned from config', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = buildFetch() as unknown as typeof fetch;

    render(<App />);
    vi.advanceTimersByTime(500);

    await waitFor(() => {
      expect(screen.getByTestId('maps-api-provider')).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('shows a "no key" fallback when config returns a placeholder', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = buildFetch({
      '/api/v1/config': { maps_api_key: 'API_KEY_REQUIRED' },
    }) as unknown as typeof fetch;

    render(<App />);
    vi.advanceTimersByTime(3500);

    await waitFor(() => {
      expect(screen.getByText(/google maps api key required/i)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('shows a "no key" fallback when config fetch fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;

    render(<App />);
    vi.advanceTimersByTime(3500);

    await waitFor(() => {
      expect(screen.getByText(/google maps api key required/i)).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});

// ── Mode switching ────────────────────────────────────────────────────────────
describe('App — mode switching', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = buildFetch() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('switches to Public Reporter mode when that tab is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<App />);

    const publicTab = screen.getByText(/public/i);
    await user.click(publicTab);

    await waitFor(() => {
      expect(screen.getByText(/public reporter/i)).toBeInTheDocument();
    });
  });

  it('switches back to Dispatcher mode', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<App />);

    const publicTab = screen.getByText(/public/i);
    await user.click(publicTab);
    const dispatchTab = screen.getByText(/dispatcher/i);
    await user.click(dispatchTab);

    await waitFor(() => {
      expect(screen.getByText(/report incident/i)).toBeInTheDocument();
    });
  });
});

// ── Incident form submission ──────────────────────────────────────────────────
describe('App — incident form submission', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = buildFetch() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('submits incident text and shows recommendation results', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<App />);

    const textarea = screen.getByPlaceholderText(/describe the emergency/i);
    await user.type(textarea, 'Cardiac arrest at Koramangala 5th Block');

    const submitBtn = screen.getByRole('button', { name: /analyze & dispatch/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/AMB-001/i)).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('shows the recommended hospital name after recommendation loads', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<App />);

    const textarea = screen.getByPlaceholderText(/describe the emergency/i);
    await user.type(textarea, 'Stroke at MG Road');

    const submitBtn = screen.getByRole('button', { name: /analyze & dispatch/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Fortis Hospital/i)).toBeInTheDocument();
    }, { timeout: 4000 });
  });
});

// ── Dispatch confirmation ─────────────────────────────────────────────────────
describe('App — dispatch confirmation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = buildFetch() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows EN ROUTE state after confirming dispatch', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<App />);

    // Submit incident
    await user.type(
      screen.getByPlaceholderText(/describe the emergency/i),
      'Car crash at Indiranagar'
    );
    await user.click(screen.getByRole('button', { name: /analyze & dispatch/i }));

    // Wait for recommendation panel
    await waitFor(() => screen.getByText(/AMB-001/i), { timeout: 4000 });

    // Confirm dispatch
    const confirmBtn = screen.getByRole('button', { name: /confirm dispatch/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(/en.?route/i)).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('renders journey timeline events after dispatch confirmation', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<App />);

    await user.type(
      screen.getByPlaceholderText(/describe the emergency/i),
      'Fire at BTM Layout'
    );
    await user.click(screen.getByRole('button', { name: /analyze & dispatch/i }));
    await waitFor(() => screen.getByText(/AMB-001/i), { timeout: 4000 });
    await user.click(screen.getByRole('button', { name: /confirm dispatch/i }));

    await waitFor(() => {
      // Journey timeline should show at least one of the known event labels
      expect(screen.getByText(/AI Analysed|Unit Assigned|En Route|Reported/i)).toBeInTheDocument();
    }, { timeout: 4000 });
  });
});

// ── Demo / active incident auto-load ─────────────────────────────────────────
describe('App — demo incident auto-load', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('auto-loads a pre-dispatched demo incident on startup', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const demoIncident = {
      incident_id: 'demo-inc-001',
      incident_number: 'INC-DEMO',
      status: 'en_route',
      extracted: { incident_type: 'cardiac_arrest', severity: 'critical', lat: 12.935, lng: 77.624 },
      journey: [
        { event_type: 'reported',  actor_name: 'Caller',  narrative: 'Cardiac arrest reported.', timestamp: new Date().toISOString() },
        { event_type: 'en_route',  actor_name: 'AMB-001', narrative: 'Ambulance en route.',       timestamp: new Date().toISOString() },
      ],
      assigned_ambulance: { id: 'amb-1', unit_code: 'AMB-001', unit_type: 'ALS', lat: 12.935, lng: 77.624 },
      assigned_hospital: { id: 'hosp-1', name: 'Fortis Hospital', trauma_level: 1, lat: 12.9716, lng: 77.5946 },
      route_waypoints: [{ lat: 12.935, lng: 77.624 }, { lat: 12.940, lng: 77.628 }],
    };

    global.fetch = buildFetch({
      '/api/v1/incidents/active': [demoIncident],
    }) as unknown as typeof fetch;

    render(<App />);
    vi.advanceTimersByTime(500);

    await waitFor(() => {
      expect(screen.getByText(/Fortis Hospital/i)).toBeInTheDocument();
    }, { timeout: 4000 });
  });
});

// ── Fleet panel ───────────────────────────────────────────────────────────────
describe('App — fleet panel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = buildFetch() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the fleet panel', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/fleet/i)).toBeInTheDocument();
    });
  });

  it('shows ambulance unit code from fleet data', async () => {
    render(<App />);
    vi.advanceTimersByTime(200);
    await waitFor(() => {
      expect(screen.getByText(/AMB-001/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
