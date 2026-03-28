/**
 * Integration tests for the main App component.
 *
 * @vis.gl/react-google-maps is mocked — it loads the Google Maps SDK
 * which is unavailable in jsdom and would crash on init.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

// ── Mock @vis.gl/react-google-maps ────────────────────────────────────────────
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

// ── Fixtures ──────────────────────────────────────────────────────────────────
const VALID_KEY = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ12345';

const FLEET = {
  ambulances: [
    { id: 'amb-1', unit_code: 'AMB-001', unit_type: 'ALS', fuel_pct: 90, crew_hours: 2, lat: 12.9352, lng: 77.6245 },
  ],
  hospitals: [
    { id: 'hosp-1', name: 'Fortis Hospital', trauma_level: 1, available_beds: 10, is_diverting: false, lat: 12.9716, lng: 77.5946 },
  ],
};

const INCIDENT = {
  incident_id: 'inc-test-001',
  incident_number: 'INC-001',
  status: 'new',
  extracted: {
    incident_type: 'cardiac_arrest',
    severity: 'critical',
    location_raw: 'Koramangala 5th Block',
    location_confidence: 'high',
    lat: 12.935,
    lng: 77.624,
    special_notes: 'Patient unresponsive.',
  },
};

const RECOMMENDATION = {
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

const CONFIRM = {
  status: 'en_route',
  route_waypoints: [
    { lat: 12.9352, lng: 77.6245 },
    { lat: 12.9400, lng: 77.6280 },
  ],
  journey: [
    { id: 'e1', event_type: 'reported',           actor_name: 'Caller',  narrative: 'Emergency reported.', timestamp: new Date().toISOString() },
    { id: 'e2', event_type: 'ai_parsed',           actor_name: 'AmbulAI', narrative: 'AI analysed.',       timestamp: new Date().toISOString() },
    { id: 'e3', event_type: 'ambulance_assigned',  actor_name: 'AMB-001', narrative: 'Unit assigned.',     timestamp: new Date().toISOString() },
    { id: 'e4', event_type: 'en_route',            actor_name: 'AMB-001', narrative: 'En route.',          timestamp: new Date().toISOString() },
  ],
};

// ── Fetch mock builder ────────────────────────────────────────────────────────
type FetchOverrides = Record<string, unknown>;

function makeFetch(overrides: FetchOverrides = {}) {
  const defaults: FetchOverrides = {
    '/api/v1/config':           { maps_api_key: VALID_KEY },
    '/api/v1/fleet':            FLEET,
    '/api/v1/incidents/active': [],
  };
  const map = { ...defaults, ...overrides };

  return vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method === 'POST' || !init) && url.includes('/api/v1/incidents') &&
        !url.includes('/journey') && !url.includes('/active')) {
      return { ok: true, json: async () => INCIDENT };
    }
    if (url.includes('/journey')) {
      return { ok: true, json: async () => ({ journey: CONFIRM.journey.slice(0, 2) }) };
    }
    if (url.includes('/dispatch/recommend')) {
      return { ok: true, json: async () => RECOMMENDATION };
    }
    if (url.includes('/dispatch/confirm')) {
      return { ok: true, json: async () => CONFIRM };
    }
    for (const [key, value] of Object.entries(map)) {
      if (url.includes(key)) {
        return { ok: true, json: async () => value };
      }
    }
    return { ok: false, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Renders app and waits for the initial config load to finish. */
async function renderApp(overrides: FetchOverrides = {}) {
  global.fetch = makeFetch(overrides);
  render(<App />);
  // Wait until the spinner "Checking Map License..." is gone
  await waitFor(
    () => expect(screen.queryByText('Checking Map License...')).not.toBeInTheDocument(),
    { timeout: 5000 },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('App — initial render', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the AmbulAI Central heading', async () => {
    await renderApp();
    expect(screen.getByText('AmbulAI Central')).toBeInTheDocument();
  });

  it('renders the Manual Incident Intake section', async () => {
    await renderApp();
    expect(screen.getByText(/Manual Incident Intake/i)).toBeInTheDocument();
  });

  it('renders the incident description textarea', async () => {
    await renderApp();
    expect(
      screen.getByPlaceholderText(/type emergency location & details/i),
    ).toBeInTheDocument();
  });

  it('renders the Dispatch Intelligence panel heading', async () => {
    await renderApp();
    expect(screen.getByText(/Dispatch Intelligence/i)).toBeInTheDocument();
  });

  it('renders the Intake Incident submit button', async () => {
    await renderApp();
    expect(
      screen.getByRole('button', { name: /intake incident/i }),
    ).toBeInTheDocument();
  });
});

// ── Maps API key handling ─────────────────────────────────────────────────────
describe('App — Google Maps key handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the map provider when a valid key is returned from config', async () => {
    await renderApp();
    expect(screen.getByTestId('maps-api-provider')).toBeInTheDocument();
  });

  it('shows the no-key fallback when config returns a placeholder', async () => {
    global.fetch = makeFetch({ '/api/v1/config': { maps_api_key: 'API_KEY_REQUIRED' } });
    render(<App />);
    await waitFor(
      () => expect(screen.getByText(/Google Maps API Key Required/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('shows the no-key fallback when config fetch fails', async () => {
    // Only reject the config call; let fleet/incidents succeed to avoid noisy errors
    const baseF = makeFetch();
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if ((url as string).includes('/api/v1/config')) {
        return Promise.reject(new Error('Network error'));
      }
      return (baseF as Function)(url, init);
    }) as unknown as typeof fetch;

    render(<App />);
    await waitFor(
      () => expect(screen.getByText(/Google Maps API Key Required/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });
});

// ── Mode switching ────────────────────────────────────────────────────────────
describe('App — mode switching', () => {
  afterEach(() => vi.restoreAllMocks());

  it('switches to Public Emergency AI mode via the Portal button', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('button', { name: /portal/i }));

    await waitFor(() =>
      expect(screen.getByText(/Public Emergency AI/i)).toBeInTheDocument(),
    );
  });

  it('returns to dispatcher view from public mode', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('button', { name: /portal/i }));
    await waitFor(() => screen.getByText(/Public Emergency AI/i));

    await user.click(screen.getByRole('button', { name: /switch to dispatcher view/i }));

    await waitFor(() =>
      expect(screen.getByText(/AmbulAI Central/i)).toBeInTheDocument(),
    );
  });
});

// ── Incident submission ───────────────────────────────────────────────────────
describe('App — incident submission', () => {
  afterEach(() => vi.restoreAllMocks());

  it('submits incident and shows the recommended ambulance unit code', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.type(
      screen.getByPlaceholderText(/type emergency location & details/i),
      'Cardiac arrest at Koramangala 5th Block',
    );
    await user.click(screen.getByRole('button', { name: /intake incident/i }));

    await waitFor(
      () => expect(screen.getByText('AMB-001')).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('shows the recommended hospital name after recommendation loads', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.type(
      screen.getByPlaceholderText(/type emergency location & details/i),
      'Stroke at MG Road',
    );
    await user.click(screen.getByRole('button', { name: /intake incident/i }));

    await waitFor(
      () => expect(screen.getByText(/Fortis Hospital/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('shows the incident severity badge after submission', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.type(
      screen.getByPlaceholderText(/type emergency location & details/i),
      'Fire at BTM Layout',
    );
    await user.click(screen.getByRole('button', { name: /intake incident/i }));

    await waitFor(
      () => expect(screen.getByText(/cardiac_arrest/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });
});

// ── Dispatch confirmation ─────────────────────────────────────────────────────
describe('App — dispatch confirmation', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Submit an incident and wait for the Execute Protocols button to appear. */
  async function submitAndAwaitRecommendation(user: ReturnType<typeof userEvent.setup>) {
    await user.type(
      screen.getByPlaceholderText(/type emergency location & details/i),
      'Car crash at Indiranagar',
    );
    await user.click(screen.getByRole('button', { name: /intake incident/i }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: /execute protocols/i })).toBeInTheDocument(),
      { timeout: 8000 },
    );
  }

  it('shows Execute Protocols CTA after recommendation is ready', async () => {
    const user = userEvent.setup();
    await renderApp();
    await submitAndAwaitRecommendation(user);
    expect(screen.getByRole('button', { name: /execute protocols/i })).toBeInTheDocument();
  });

  it('shows journey timeline events after confirming dispatch', async () => {
    const user = userEvent.setup();
    await renderApp();
    await submitAndAwaitRecommendation(user);
    await user.click(screen.getByRole('button', { name: /execute protocols/i }));

    await waitFor(
      () => expect(screen.getByText(/Reported|AI Analysed|Unit Assigned|En Route/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('shows the protocols activated footer after dispatch', async () => {
    const user = userEvent.setup();
    await renderApp();
    await submitAndAwaitRecommendation(user);
    await user.click(screen.getByRole('button', { name: /execute protocols/i }));

    await waitFor(
      () => expect(screen.getByText(/Protocols Activated/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });
});

// ── Demo incident auto-load ───────────────────────────────────────────────────
describe('App — demo incident auto-load', () => {
  afterEach(() => vi.restoreAllMocks());

  it('auto-loads a pre-dispatched demo incident on startup', async () => {
    const demoIncident = {
      incident_id: 'demo-inc-001',
      incident_number: 'INC-DEMO',
      status: 'en_route',
      extracted: {
        incident_type: 'cardiac_arrest',
        severity: 'critical',
        location_raw: 'Koramangala',
        location_confidence: 'high',
        lat: 12.935,
        lng: 77.624,
      },
      journey: [
        { id: 'e1', event_type: 'reported', actor_name: 'Caller',  narrative: 'Reported.', timestamp: new Date().toISOString() },
        { id: 'e2', event_type: 'en_route', actor_name: 'AMB-001', narrative: 'En route.', timestamp: new Date().toISOString() },
      ],
      assigned_ambulance: { id: 'amb-1', unit_code: 'AMB-001', unit_type: 'ALS', lat: 12.935, lng: 77.624 },
      assigned_hospital: { id: 'hosp-1', name: 'Fortis Hospital', trauma_level: 1, lat: 12.9716, lng: 77.5946 },
      route_waypoints: [{ lat: 12.935, lng: 77.624 }, { lat: 12.940, lng: 77.628 }],
    };

    await renderApp({ '/api/v1/incidents/active': [demoIncident] });

    await waitFor(
      () => expect(screen.getByText(/Fortis Hospital/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it('shows the journey timeline from the demo incident', async () => {
    const demoIncident = {
      incident_id: 'demo-inc-001',
      incident_number: 'INC-DEMO',
      status: 'en_route',
      extracted: { incident_type: 'cardiac_arrest', severity: 'critical', location_raw: 'Koramangala', location_confidence: 'high', lat: 12.935, lng: 77.624 },
      journey: [
        { id: 'e1', event_type: 'reported', actor_name: 'Caller',  narrative: 'Reported.', timestamp: new Date().toISOString() },
        { id: 'e2', event_type: 'en_route', actor_name: 'AMB-001', narrative: 'En route.', timestamp: new Date().toISOString() },
      ],
      assigned_ambulance: { id: 'amb-1', unit_code: 'AMB-001', unit_type: 'ALS', lat: 12.935, lng: 77.624 },
      assigned_hospital: { id: 'hosp-1', name: 'Fortis Hospital', trauma_level: 1, lat: 12.9716, lng: 77.5946 },
      route_waypoints: [],
    };

    await renderApp({ '/api/v1/incidents/active': [demoIncident] });

    await waitFor(
      () => expect(screen.getByText(/Reported|En Route/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });
});
