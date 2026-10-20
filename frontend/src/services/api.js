import axios from 'axios';

const TOKEN_KEY = 'bon.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

const api = axios.create({ baseURL: '/api', timeout: 20000 });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Unwrap the API's { success, data, meta } envelope and normalise every failure
 * into an Error carrying `.message`, `.status` and `.details`, so components
 * never have to dig through axios internals.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      // An expired or invalid session: drop the token and bounce to sign-in.
      if (status === 401 && !window.location.pathname.startsWith('/login')) {
        tokenStore.clear();
        window.dispatchEvent(new CustomEvent('bon:unauthorised'));
      }
      const normalised = new Error(data?.error?.message || `Request failed (${status})`);
      normalised.status = status;
      normalised.details = data?.error?.details;
      return Promise.reject(normalised);
    }
    const offline = new Error(
      error.code === 'ECONNABORTED'
        ? 'The server took too long to respond.'
        : 'Cannot reach the server. Is the backend running on port 4000?',
    );
    offline.status = 0;
    return Promise.reject(offline);
  },
);

const unwrap = (response) => response.data.data;
const unwrapPage = (response) => ({ rows: response.data.data, meta: response.data.meta });

/* --------------------------------------------------------------------------
 * Endpoint wrappers -- one place that knows the URL shapes.
 * ----------------------------------------------------------------------- */
export const authApi = {
  login: (payload) => api.post('/auth/login', payload).then(unwrap),
  register: (payload) => api.post('/auth/register', payload).then(unwrap),
  me: () => api.get('/auth/me').then(unwrap),
  logout: () => api.post('/auth/logout').then(unwrap),
  updateProfile: (payload) => api.patch('/auth/me', payload).then(unwrap),
  changePassword: (payload) => api.post('/auth/change-password', payload).then(unwrap),
};

export const referenceApi = {
  bootstrap: () => api.get('/reference/bootstrap').then(unwrap),
  compatibility: (componentId) => api.get('/reference/compatibility', { params: { componentId } }).then(unwrap),
  matchingConfig: () => api.get('/reference/matching-config').then(unwrap),
};

export const bloodApi = {
  availability: (params) => api.get('/blood/availability', { params }).then(unwrap),
  availabilitySummary: () => api.get('/blood/availability/summary').then(unwrap),
  expiring: () => api.get('/blood/expiring').then(unwrap),
  units: (params) => api.get('/blood/units', { params }).then(unwrapPage),
  donations: (params) => api.get('/blood/donations', { params }).then(unwrapPage),
  donation: (id) => api.get(`/blood/donations/${id}`).then(unwrap),
  createDonation: (payload) => api.post('/blood/donations', payload).then(unwrap),
  setScreening: (id, screeningStatus) => api.patch(`/blood/donations/${id}/screening`, { screeningStatus }).then(unwrap),
  requests: (params) => api.get('/blood/requests', { params }).then(unwrapPage),
  request: (id) => api.get(`/blood/requests/${id}`).then(unwrap),
  createRequest: (payload) => api.post('/blood/requests', payload).then(unwrap),
  previewMatches: (id) => api.get(`/blood/requests/${id}/match`).then(unwrap),
  allocate: (id) => api.post(`/blood/requests/${id}/allocate`).then(unwrap),
  setRequestStatus: (id, status) => api.patch(`/blood/requests/${id}/status`, { status }).then(unwrap),
  runExpiry: () => api.post('/blood/housekeeping/expire').then(unwrap),
};

export const organApi = {
  availability: (params) => api.get('/organs/availability', { params }).then(unwrapPage),
  organ: (id) => api.get(`/organs/${id}`).then(unwrap),
  createOrgan: (payload) => api.post('/organs', payload).then(unwrap),
  setOrganStatus: (id, payload) => api.patch(`/organs/${id}/status`, payload).then(unwrap),
  myDonation: () => api.get('/organs/donors/me').then(unwrap),
  saveMyDonation: (payload) => api.post('/organs/donors/me', payload).then(unwrap),
  requests: (params) => api.get('/organ-requests', { params }).then(unwrapPage),
  request: (id) => api.get(`/organ-requests/${id}`).then(unwrap),
  createRequest: (payload) => api.post('/organ-requests', payload).then(unwrap),
  matches: (id) => api.get(`/organ-requests/${id}/matches`).then(unwrap),
  runMatching: (id) => api.post(`/organ-requests/${id}/match`).then(unwrap),
  setMatchStatus: (matchId, status) => api.patch(`/organ-requests/matches/${matchId}/status`, { status }).then(unwrap),
  setRequestStatus: (id, status) => api.patch(`/organ-requests/${id}/status`, { status }).then(unwrap),
};

export const directoryApi = {
  users: (params) => api.get('/users', { params }).then(unwrapPage),
  setUserStatus: (id, status) => api.patch(`/users/${id}/status`, { status }).then(unwrap),
  deleteUser: (id) => api.delete(`/users/${id}`).then(unwrap),
  donors: (params) => api.get('/donors', { params }).then(unwrapPage),
  recipients: (params) => api.get('/recipients', { params }).then(unwrapPage),
  hospitals: (params) => api.get('/hospitals', { params }).then(unwrapPage),
  bloodBanks: (params) => api.get('/blood-banks', { params }).then(unwrapPage),
  transplantCenters: (params) => api.get('/transplant-centers', { params }).then(unwrapPage),
  setHospitalStatus: (id, status) => api.patch(`/hospitals/${id}/status`, { status }).then(unwrap),
  setBloodBankStatus: (id, status) => api.patch(`/blood-banks/${id}/status`, { status }).then(unwrap),
  setCenterStatus: (id, status) => api.patch(`/transplant-centers/${id}/status`, { status }).then(unwrap),
  auditLogs: (params) => api.get('/audit-logs', { params }).then(unwrapPage),
  notifications: (params) => api.get('/notifications', { params }).then(unwrapPage),
  unreadCount: () => api.get('/notifications/unread-count').then(unwrap),
  markRead: (id) => api.patch(`/notifications/${id}/read`).then(unwrap),
  markAllRead: () => api.patch('/notifications/read-all').then(unwrap),
};

export const analyticsApi = {
  overview: () => api.get('/analytics/overview').then(unwrap),
  blood: (months) => api.get('/analytics/blood', { params: { months } }).then(unwrap),
  organs: () => api.get('/analytics/organs').then(unwrap),
  hospitals: () => api.get('/analytics/hospitals').then(unwrap),
  topDonors: (limit) => api.get('/analytics/top-donors', { params: { limit } }).then(unwrap),
  publicStats: () => api.get('/analytics/public').then(unwrap),
};

export default api;
