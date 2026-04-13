import React, { useMemo, useState } from 'react';
import { overpassFacilityAdapter } from './overpassAdapter';

const BOT_AVATAR = '🤖';

const ScrubAdvisorChatbot = ({ adapter = overpassFacilityAdapter, mcpCapabilities = [] }) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState('');
  const [recommendations, setRecommendations] = useState([]);
  const [answers, setAnswers] = useState({ scrubNeed: '', draft: '', loa: '', location: '' });

  const canSearch = useMemo(() => {
    const draft = Number(answers.draft);
    const loa = Number(answers.loa);
    return !!answers.scrubNeed && !!answers.location.trim() && Number.isFinite(draft) && draft > 0 && Number.isFinite(loa) && loa > 0;
  }, [answers]);

  const onInput = (key, value) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setError('');
  };

  const runSearch = async () => {
    if (!canSearch) return;
    setIsLoading(true);
    setError('');
    try {
      const payload = await adapter.searchFacilities({
        scrubNeed: answers.scrubNeed,
        draft: Number(answers.draft),
        loa: Number(answers.loa),
        location: answers.location.trim(),
      });
      setOrigin(payload.origin?.label || answers.location.trim());
      setRecommendations(payload.facilities || []);
    } catch (err) {
      setError(err.message || 'Could not load facilities. Try a nearby postcode or town.');
      setRecommendations([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fieldStyle = {
    width: '100%',
    border: '1px solid #cbd5e1',
    borderRadius: '10px',
    padding: '8px 10px',
    fontSize: '13px',
    color: '#0f172a',
    background: '#ffffff',
  };

  return (
    <aside style={{ position: 'fixed', right: '18px', bottom: '18px', zIndex: 1200, width: isMinimized ? '220px' : '380px', transition: 'width 0.2s ease' }}>
      <div style={{ borderRadius: '14px', border: '1px solid #bae6fd', background: '#ffffff', boxShadow: '0 14px 40px rgba(15,23,42,0.2)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', background: 'linear-gradient(135deg, #0ea5e9, #0369a1)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{BOT_AVATAR}</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700 }}>Scrub Planner Assistant</div>
            </div>
          </div>
          <button onClick={() => setIsMinimized((v) => !v)} style={{ border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: '8px', cursor: 'pointer', padding: '4px 10px', fontWeight: 700 }}>
            {isMinimized ? 'Open' : 'Minimise'}
          </button>
        </div>

        {!isMinimized && (
          <div style={{ padding: '12px', display: 'grid', gap: '10px' }}>
            <div style={{ fontSize: '13px', color: '#334155', background: '#f8fafc', borderRadius: '10px', padding: '10px', border: '1px solid #e2e8f0' }}>
              Tell me your scrub-off needs and I’ll find nearby UK marinas/clubs/boatyards from OpenStreetMap via Overpass.
            </div>

            <label style={{ display: 'grid', gap: '5px', fontSize: '12px', color: '#334155' }}>
              1) How soon do you need scrubbing off?
              <select value={answers.scrubNeed} onChange={(e) => onInput('scrubNeed', e.target.value)} style={fieldStyle}>
                <option value="">Select...</option>
                <option value="urgent">Urgent (next available)</option>
                <option value="planned">Planned (best match)</option>
              </select>
            </label>

            <label style={{ display: 'grid', gap: '5px', fontSize: '12px', color: '#334155' }}>
              2) What is your vessel draft (m)?
              <input type="number" min="0" step="0.1" value={answers.draft} onChange={(e) => onInput('draft', e.target.value)} placeholder="e.g. 1.8" style={fieldStyle} />
            </label>

            <label style={{ display: 'grid', gap: '5px', fontSize: '12px', color: '#334155' }}>
              3) What is your vessel LOA (m)?
              <input type="number" min="0" step="0.1" value={answers.loa} onChange={(e) => onInput('loa', e.target.value)} placeholder="e.g. 11.5" style={fieldStyle} />
            </label>

            <label style={{ display: 'grid', gap: '5px', fontSize: '12px', color: '#334155' }}>
              4) Where in the UK are you?
              <input value={answers.location} onChange={(e) => onInput('location', e.target.value)} placeholder="Postcode or town (e.g. SO14 3QN, Plymouth)" style={fieldStyle} />
            </label>

            <button
              onClick={runSearch}
              disabled={!canSearch || isLoading}
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid #0284c7',
                background: !canSearch || isLoading ? '#bae6fd' : '#0ea5e9',
                color: '#ffffff',
                fontWeight: 700,
                cursor: !canSearch || isLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {isLoading ? 'Searching...' : 'Find best facilities'}
            </button>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '8px', display: 'grid', gap: '8px' }}>
              <div style={{ fontSize: '12px', color: '#0f172a', fontWeight: 700 }}>Best options (nearest + capable first)</div>
              {origin && <div style={{ fontSize: '11px', color: '#475569' }}>Search origin: {origin}</div>}
              {error && <div style={{ fontSize: '12px', color: '#b91c1c' }}>{error}</div>}
              {!error && recommendations.length === 0 && !isLoading && (
                <div style={{ fontSize: '12px', color: '#64748b' }}>Complete all answers and search to generate recommendations.</div>
              )}
              {recommendations.map((facility, idx) => (
                <div key={facility.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '8px', background: idx === 0 ? '#ecfeff' : '#f8fafc' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{idx + 1}. {facility.name}</div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>{facility.type} • {facility.distanceKm.toFixed(1)} km away</div>
                  <div style={{ fontSize: '11px', color: '#334155' }}>Max draft {facility.maxDraft}m • Max LOA {facility.maxLoa}m</div>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
              <div style={{ fontSize: '11px', color: '#475569', marginBottom: '4px' }}>MCP handoff capabilities</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {mcpCapabilities.map((capability) => (
                  <span key={capability} style={{ fontSize: '10px', background: '#e0f2fe', color: '#075985', padding: '2px 6px', borderRadius: '999px', border: '1px solid #bae6fd' }}>{capability}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default ScrubAdvisorChatbot;
