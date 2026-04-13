const buildQuery = (params) => {
  const query = new URLSearchParams();
  query.set('location', params.location);
  query.set('scrubNeed', params.scrubNeed);
  query.set('draft', String(params.draft));
  query.set('loa', String(params.loa));
  return query.toString();
};

export const createOverpassFacilityAdapter = ({ baseUrl = '/api/facilities/search' } = {}) => ({
  async searchFacilities({ location, scrubNeed, draft, loa }) {
    const response = await fetch(`${baseUrl}?${buildQuery({ location, scrubNeed, draft, loa })}`, {
      credentials: 'include',
    });

    const bodyText = await response.text();
    let payload = null;
    try {
      payload = bodyText ? JSON.parse(bodyText) : null;
    } catch (_err) {
      throw new Error(`Facility search returned unexpected response (${response.status}). Please retry.`);
    }
    if (!response.ok) {
      throw new Error(payload?.error || 'Unable to load scrub facilities');
    }

    return payload;
  },
});

export const overpassFacilityAdapter = createOverpassFacilityAdapter();
