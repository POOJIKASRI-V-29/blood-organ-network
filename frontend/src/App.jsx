import { Routes, Route, Navigate } from 'react-router-dom';
import PublicLayout from './layouts/PublicLayout.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import RequireAuth from './components/RequireAuth.jsx';

import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Compatibility from './pages/Compatibility.jsx';
import NotFound from './pages/NotFound.jsx';

import Dashboard from './pages/Dashboard.jsx';
import Analytics from './pages/Analytics.jsx';
import Directory from './pages/Directory.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';

import BloodAvailability from './pages/blood/BloodAvailability.jsx';
import BloodRequests from './pages/blood/BloodRequests.jsx';
import NewBloodRequest from './pages/blood/NewBloodRequest.jsx';
import BloodRequestDetail from './pages/blood/BloodRequestDetail.jsx';
import Donations from './pages/blood/Donations.jsx';
import Inventory from './pages/blood/Inventory.jsx';

import OrganAvailability from './pages/organs/OrganAvailability.jsx';
import OrganRequests from './pages/organs/OrganRequests.jsx';
import NewOrganRequest from './pages/organs/NewOrganRequest.jsx';
import OrganRequestDetail from './pages/organs/OrganRequestDetail.jsx';
import MyOrganDonation from './pages/organs/MyOrganDonation.jsx';
import OrganRegistry from './pages/organs/OrganRegistry.jsx';

import AdminUsers from './pages/admin/Users.jsx';
import AuditLog from './pages/admin/AuditLog.jsx';

import { ROLES } from './constants/index.js';

/**
 * Route roles mirror the API's authorize() calls. The server authorises
 * independently -- this only prevents users being shown pages they cannot use.
 */
export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route element={<PublicLayout />}>
        <Route index element={<Landing />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="compatibility" element={<Compatibility />} />
      </Route>

      {/* Authenticated */}
      <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="directory" element={<Directory />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<Profile />} />

        {/* Blood */}
        <Route path="blood/availability" element={<BloodAvailability />} />
        <Route path="blood/requests" element={<BloodRequests />} />
        <Route path="blood/requests/new" element={
          <RequireAuth roles={[ROLES.ADMIN, ROLES.HOSPITAL, ROLES.RECIPIENT]}><NewBloodRequest /></RequireAuth>} />
        <Route path="blood/requests/:id" element={<BloodRequestDetail />} />
        <Route path="blood/donations" element={
          <RequireAuth roles={[ROLES.ADMIN, ROLES.BLOOD_BANK, ROLES.DONOR]}><Donations /></RequireAuth>} />
        <Route path="blood/inventory" element={
          <RequireAuth roles={[ROLES.ADMIN, ROLES.BLOOD_BANK, ROLES.HOSPITAL]}><Inventory /></RequireAuth>} />

        {/* Organs */}
        <Route path="organs/availability" element={<OrganAvailability />} />
        <Route path="organs/requests" element={<OrganRequests />} />
        <Route path="organs/requests/new" element={
          <RequireAuth roles={[ROLES.ADMIN, ROLES.HOSPITAL, ROLES.RECIPIENT, ROLES.TRANSPLANT_CENTER]}>
            <NewOrganRequest />
          </RequireAuth>} />
        <Route path="organs/requests/:id" element={<OrganRequestDetail />} />
        <Route path="organs/my-donation" element={
          <RequireAuth roles={[ROLES.DONOR]}><MyOrganDonation /></RequireAuth>} />
        <Route path="organs/registry" element={
          <RequireAuth roles={[ROLES.ADMIN, ROLES.TRANSPLANT_CENTER]}><OrganRegistry /></RequireAuth>} />

        {/* Administration */}
        <Route path="admin/users" element={
          <RequireAuth roles={[ROLES.ADMIN]}><AdminUsers /></RequireAuth>} />
        <Route path="admin/audit" element={
          <RequireAuth roles={[ROLES.ADMIN]}><AuditLog /></RequireAuth>} />

        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="/dashboard" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
