const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Request failed');
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function fetchWords(search = '', limit, skip, level = 'B2') {
  const params = new URLSearchParams();
  if (level) {
    params.set('level', level);
  }
  if (search.trim()) {
    params.set('search', search.trim());
  }
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    params.set('limit', String(limit));
  }
  if (typeof skip === 'number' && Number.isFinite(skip)) {
    params.set('skip', String(skip));
  }

  const query = params.toString();
  return request(`/words${query ? `?${query}` : ''}`);
}

export function createWord(payload) {
  return request('/words', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateWord(id, payload) {
  return request(`/words/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteWord(id) {
  return request(`/words/${id}`, {
    method: 'DELETE',
  });
}

export function importDocx(file, level = 'B2') {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('level', level);

  return fetch(`${API_BASE_URL}/import-docx`, {
    method: 'POST',
    body: formData,
  }).then(async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || 'Import failed');
    }
    return response.json();
  });
}
