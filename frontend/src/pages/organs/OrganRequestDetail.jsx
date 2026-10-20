import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { organApi, referenceApi } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Badge, BloodChip, Card, ConfirmDialog, DataState, Detail, Disclaimer, EmptyState,
  PageHeader, ScoreBar, Spinner, fmt,
} from '../../components/ui/index.jsx';
import { ROLES } from '../../constants/index.js';

/** Shows how the weighted score was composed, straight from the stored columns. */
function ScoreBreakdown({ match, weights }) {
  const parts = [
    { label: 'Blood compatibility', value: match.bloodScore, weight: weights.organ_weight_blood },
    { label: 'Urgency', value: match.urgencyScore, weight: weights.organ_weight_urgency },
    { label: 'Medical priority', value: match.priorityScore, weight: weights.organ_weight_priority },
    { label: 'Location', value: match.locationScore, weight: weights.organ_weight_location },
    { label: 'Donor age closeness', value: match.ageScore, weight: weights.organ_weight_age },
  ];
  return (
    <dl className="space-y-1.5">
      {parts.map((part) => (
        <div key={part.label} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-2">
          <dt className="text-xs text-slate-600">
            {part.label}
            {part.weight != null && <span className="text-slate-400"> ({Number(part.weight).toFixed(0)}%)</span>}
          </dt>
          <dd><ScoreBar value={part.value} /></dd>
          <dd className="text-xs tabular-nums text-slate-500 text-right">
            {part.weight != null ? `+${((part.value * part.weight) / 100).toFixed(1)}` : ''}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function OrganRequestDetail() {
  const { id } = useParams();
  const { hasRole } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(() => organApi.request(id), [id]);
  const { data: config } = useApi(() => referenceApi.matchingConfig(), []);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const weights = Object.fromEntries((config ?? []).map((c) => [c.configKey, c.configValue]));
  const canMatch = hasRole(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.TRANSPLANT_CENTER);
  const canDecide = hasRole(ROLES.ADMIN, ROLES.TRANSPLANT_CENTER, ROLES.HOSPITAL);

  const runMatching = async () => {
    setBusy(true);
    try {
      const result = await organApi.runMatching(id);
      if (result.matchCount > 0) toast.success(`${result.matchCount} candidate organ(s) scored.`);
      else toast.warn('No compatible organ currently meets the minimum match score.');
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const decide = async () => {
    setBusy(true);
    try {
      await organApi.setMatchStatus(confirm.matchId, confirm.status);
      toast.success(`Match ${confirm.status.toLowerCase()}.`);
      setConfirm(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <DataState loading={loading} error={error} onRetry={reload} loadingRows={8}>
      {data && (
        <>
          <PageHeader
            title={data.requestCode}
            subtitle={`${data.organType} · raised ${fmt.dateTime(data.requestDate)}`}
            actions={(
              <>
                <Link to="/app/organs/requests" className="btn-ghost btn-sm">← All requests</Link>
                {canMatch && !['CANCELLED', 'REJECTED', 'EXPIRED', 'TRANSPLANT_COMPLETED'].includes(data.status) && (
                  <button className="btn-organ btn-sm" onClick={runMatching} disabled={busy}>
                    {busy && <Spinner className="h-4 w-4 text-white" />} Run matching
                  </button>
                )}
              </>
            )}
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Request" className="lg:col-span-2">
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Detail label="Organ type">{data.organType}</Detail>
                <Detail label="Recipient">{data.recipientName}</Detail>
                <Detail label="Blood group"><BloodChip group={data.bloodGroup} /></Detail>
                <Detail label="Recipient age">{data.recipientAge}</Detail>
                <Detail label="Urgency"><Badge value={data.urgency} /></Detail>
                <Detail label="Medical priority">{data.medicalPriority} / 100</Detail>
                <Detail label="Status"><Badge value={data.status} /></Detail>
                <Detail label="Hospital">{data.hospital}</Detail>
                <Detail label="City">{data.city}, {data.region}</Detail>
                {data.notes && <Detail label="Clinical notes" className="col-span-2 sm:col-span-3">{data.notes}</Detail>}
              </dl>
            </Card>

            <Card title="Matching algorithm" subtitle="Weights read from the matching_config table">
              <dl className="space-y-1.5 text-sm">
                {(config ?? []).filter((c) => c.configKey.startsWith('organ_weight_')).map((c) => (
                  <div key={c.configKey} className="flex justify-between gap-2">
                    <dt className="text-slate-600 capitalize">{c.configKey.replace('organ_weight_', '').replace(/_/g, ' ')}</dt>
                    <dd className="font-medium tabular-nums">{Number(c.configValue).toFixed(0)}%</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-2 pt-1.5 border-t border-slate-200">
                  <dt className="text-slate-600">Minimum score to propose</dt>
                  <dd className="font-medium tabular-nums">{Number(weights.organ_min_match_score ?? 0).toFixed(0)}</dd>
                </div>
              </dl>
              <p className="hint mt-3">
                Blood-incompatible organs are excluded outright rather than scored low.
              </p>
            </Card>
          </div>

          <Card title={`Candidate organs (${data.matches.length})`}
                subtitle="Ranked by weighted compatibility score. Expand a row to see how the score was composed."
                className="mt-4">
            {data.matches.length === 0 ? (
              <EmptyState icon="🔍" title="No matches yet"
                          message="Run matching to score every listed, viable organ of this type against the request."
                          action={canMatch && <button className="btn-organ btn-sm" onClick={runMatching} disabled={busy}>Run matching</button>} />
            ) : (
              <ul className="space-y-2.5">
                {data.matches.map((match) => {
                  const open = expanded === match.matchId;
                  return (
                    <li key={match.matchId} className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="p-3 sm:p-4 flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="text-center shrink-0">
                            <p className="text-2xl font-semibold text-organ-600 tabular-nums leading-none">
                              {Number(match.compatibilityScore).toFixed(1)}
                            </p>
                            <p className="text-[0.65rem] uppercase tracking-wide text-slate-400 mt-0.5">score</p>
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">
                              <span className="font-mono text-xs text-slate-500 mr-2">{match.organCode}</span>
                              <BloodChip group={match.organBloodGroup} />
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              Donor age {match.donorAge} · {match.holdingCenter}, {match.organCity} ·
                              viable until {fmt.dateTime(match.viableUntil)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge value={match.organStatus} />
                          <Badge value={match.matchStatus} />
                          <button className="btn-ghost btn-sm" onClick={() => setExpanded(open ? null : match.matchId)}
                                  aria-expanded={open}>
                            {open ? 'Hide' : 'Why?'}
                          </button>
                        </div>
                      </div>

                      {open && (
                        <div className="border-t border-slate-200 bg-slate-50 p-3 sm:p-4 space-y-3">
                          <ScoreBreakdown match={match} weights={weights} />
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-1">Reasons recorded</p>
                            <ul className="text-sm text-slate-700 space-y-0.5">
                              {match.matchReason.split(' | ').map((reason, index) => (
                                <li key={index} className="flex gap-1.5">
                                  <span className="text-organ-600" aria-hidden="true">•</span>{reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                          {canDecide && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {match.matchStatus === 'PROPOSED' && (
                                <>
                                  <button className="btn-organ btn-sm"
                                          onClick={() => setConfirm({ matchId: match.matchId, status: 'ACCEPTED',
                                            title: 'Accept this match?',
                                            message: `Accepting records a clinical decision for organ ${match.organCode}. You can then allocate it.` })}>
                                    Accept
                                  </button>
                                  <button className="btn-danger btn-sm"
                                          onClick={() => setConfirm({ matchId: match.matchId, status: 'REJECTED',
                                            title: 'Reject this match?', message: 'The organ stays available for other requests.' })}>
                                    Reject
                                  </button>
                                </>
                              )}
                              {match.matchStatus === 'ACCEPTED' && (
                                <button className="btn-organ btn-sm"
                                        onClick={() => setConfirm({ matchId: match.matchId, status: 'ALLOCATED',
                                          title: 'Allocate this organ?',
                                          message: `Organ ${match.organCode} is reserved for this request and every other proposal for it is cancelled. This runs in a transaction and cannot be undone casually.` })}>
                                  Allocate organ
                                </button>
                              )}
                              {match.matchStatus === 'ALLOCATED' && (
                                <button className="btn-organ btn-sm"
                                        onClick={() => setConfirm({ matchId: match.matchId, status: 'COMPLETED',
                                          title: 'Mark transplant complete?',
                                          message: 'The organ is marked TRANSPLANTED and the request closes as completed. This is final.' })}>
                                  Mark transplant complete
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Disclaimer className="mt-4" />

          <ConfirmDialog open={Boolean(confirm)} busy={busy} tone="organ"
                         title={confirm?.title} message={confirm?.message}
                         confirmLabel="Confirm"
                         onCancel={() => setConfirm(null)} onConfirm={decide} />
        </>
      )}
    </DataState>
  );
}
