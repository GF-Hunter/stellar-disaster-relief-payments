import React, { useState, useEffect, useRef } from 'react';
import { EmergencyFund, NetworkConfig } from '../../sdk/src/types';
import { AidClient } from '../../sdk/src/aidClient';
import { ErrorMessage, friendlyError } from './ErrorMessage';
import { ConfirmDialog } from './ConfirmDialog';
import { FormField } from './FormField';
import { useNotifications } from './NotificationSystem';
import {
  useFormValidation,
  type FieldRules,
  compose,
  disasterType as validateDisasterType,
  futureDate,
  identifier,
  isInteger,
  isPositiveNumber,
  maxLength,
  maxValue,
  minValue,
  required,
} from '../validation';

interface EmergencyDeployerProps {
  aidClient: AidClient;
  config: NetworkConfig;
  adminKey: string;
}

type FundFields = {
  fundId: string;
  name: string;
  description: string;
  totalAmount: string;
  disasterType: string;
  geographicScope: string;
  expiresAt: string;
  requiredSignatures: string;
};

type RapidFields = {
  disasterId: string;
  disasterType: string;
  affectedArea: string;
  totalBudget: string;
};

type RapidFormState = RapidFields & {
  categories: { name: string; percentage: number; description: string }[];
};

const fundRules: FieldRules<FundFields> = {
  fundId: compose(required('Fund ID'), identifier('Fund ID')),
  name: compose(required('Fund name'), maxLength(120, 'Fund name')),
  description: compose(required('Description'), maxLength(500, 'Description')),
  totalAmount: compose(required('Total amount'), isPositiveNumber('Total amount')),
  disasterType: compose(required('Disaster type'), validateDisasterType),
  geographicScope: compose(required('Geographic scope'), maxLength(160, 'Geographic scope')),
  expiresAt: compose(required('Expiry date'), futureDate('Expiry date')),
  requiredSignatures: compose(
    required('Required signatures'),
    isInteger('Required signatures'),
    minValue(1, 'Required signatures'),
    maxValue(10, 'Required signatures')
  ),
};

const rapidRules: FieldRules<RapidFields> = {
  disasterId: compose(required('Disaster ID'), identifier('Disaster ID')),
  disasterType: compose(required('Disaster type'), validateDisasterType),
  affectedArea: compose(required('Affected area'), maxLength(160, 'Affected area')),
  totalBudget: compose(required('Total budget'), isPositiveNumber('Total budget')),
};

type FundStatus = {
  label: string;
  icon: string;
  className: string;
  badgeClassName: string;
};

/**
 * Contract timestamps are seconds, while some SDK-created records use
 * milliseconds. Normalise both so status badges and dates are correct.
 */
const toMillis = (timestamp: number): number =>
  timestamp > 0 && timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;

/** Map a fund to a status that is conveyed by text and icon, not colour alone. */
const getFundStatus = (fund: EmergencyFund): FundStatus => {
  const now = Date.now();
  const expiresAt = toMillis(fund.expiresAt);
  if (!fund.isActive) {
    return {
      label: 'Inactive',
      icon: '○',
      className: 'text-gray-700',
      badgeClassName: 'bg-gray-100 text-gray-800',
    };
  }
  if (now > expiresAt) {
    return {
      label: 'Expired',
      icon: '✕',
      className: 'text-red-700',
      badgeClassName: 'bg-red-100 text-red-800',
    };
  }
  if (now > expiresAt - 7 * 24 * 60 * 60 * 1000) {
    return {
      label: 'Expiring soon',
      icon: '!',
      className: 'text-yellow-700',
      badgeClassName: 'bg-yellow-100 text-yellow-800',
    };
  }
  return {
    label: 'Active',
    icon: '✓',
    className: 'text-green-700',
    badgeClassName: 'bg-green-100 text-green-800',
  };
};

export const EmergencyDeployer: React.FC<EmergencyDeployerProps> = ({
  aidClient,
  config,
  adminKey
}) => {
  const { notify } = useNotifications();
  const [funds, setFunds] = useState<EmergencyFund[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showRapidForm, setShowRapidForm] = useState(false);
  const [selectedFund, setSelectedFund] = useState<EmergencyFund | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Form states
  const [fundForm, setFundForm] = useState<FundFields>({
    fundId: '',
    name: '',
    description: '',
    totalAmount: '',
    disasterType: '',
    geographicScope: '',
    expiresAt: '',
    requiredSignatures: '1'
  });

  const [rapidForm, setRapidForm] = useState<RapidFormState>({
    disasterId: '',
    disasterType: '',
    affectedArea: '',
    totalBudget: '',
    categories: [
      { name: 'Food', percentage: 40, description: 'Emergency food supplies' },
      { name: 'Medical', percentage: 30, description: 'Medical supplies and care' },
      { name: 'Shelter', percentage: 20, description: 'Emergency shelter materials' },
      { name: 'Water', percentage: 10, description: 'Clean water and sanitation' }
    ]
  });

  const fundValidation = useFormValidation<FundFields>(fundRules);
  const rapidValidation = useFormValidation<RapidFields>(rapidRules);

  const fundError = (field: keyof FundFields) =>
    fundValidation.touched[field] ? fundValidation.errors[field] : undefined;

  const rapidError = (field: keyof RapidFields) =>
    rapidValidation.touched[field] ? rapidValidation.errors[field] : undefined;

  useEffect(() => {
    loadActiveFunds();
  }, []);

  useEffect(() => {
    if (!selectedFund) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedFund(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFund]);

  const loadActiveFunds = async () => {
    try {
      setLoading(true);
      const activeFunds = await aidClient.listActiveFunds();
      setFunds(activeFunds);
    } catch (error) {
      console.error('Failed to load funds:', error);
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFund = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);

    if (!fundValidation.validateAll(fundForm)) {
      return;
    }

    try {
      setLoading(true);
      await aidClient.deployEmergencyFund(
        adminKey,
        fundForm.fundId,
        fundForm.name,
        fundForm.description,
        fundForm.totalAmount,
        fundForm.disasterType,
        fundForm.geographicScope,
        new Date(fundForm.expiresAt).getTime(),
        [adminKey], // Simplified - would use multi-sig in production
        parseInt(fundForm.requiredSignatures)
      );
      
      setShowCreateForm(false);
      setFundForm({
        fundId: '',
        name: '',
        description: '',
        totalAmount: '',
        disasterType: '',
        geographicScope: '',
        expiresAt: '',
        requiredSignatures: '1'
      });
      fundValidation.reset();
      loadActiveFunds();
      setStatus(`Emergency fund "${fundForm.name}" created and active.`);
      notify({ type: 'success', title: 'Emergency fund created', message: `Fund "${fundForm.name}" is now active.` });
    } catch (error) {
      console.error('Failed to create fund:', error);
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleRapidDeployment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);

    if (!rapidValidation.validateAll(rapidForm)) {
      return;
    }

    try {
      setLoading(true);
      const fundIds = await aidClient.deployRapidResponse(
        adminKey,
        rapidForm.disasterId,
        rapidForm.disasterType,
        rapidForm.affectedArea,
        rapidForm.totalBudget,
        rapidForm.categories
      );
      
      setShowRapidForm(false);
      setRapidForm({
        disasterId: '',
        disasterType: '',
        affectedArea: '',
        totalBudget: '',
        categories: rapidForm.categories
      });
      rapidValidation.reset();
      loadActiveFunds();
      setStatus(`Created ${fundIds.length} emergency funds for rapid response.`);
      notify({
        type: 'success',
        title: 'Rapid response deployed',
        message: `${fundIds.length} emergency funds are now active.`,
      });
    } catch (error) {
      console.error('Failed to deploy rapid response:', error);
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleMonitorFund = async (fundId: string) => {
    try {
      const fund = await aidClient.getFund(fundId);
      if (fund) {
        setSelectedFund(fund);
      }
    } catch (error) {
      setError(friendlyError(error));
    }
  };

  const handleCleanupExpired = async () => {
    setError(null);
    setStatus(null);
    try {
      setLoading(true);
      await aidClient.cleanupExpiredFunds(adminKey);
      loadActiveFunds();
      setStatus('Expired funds cleaned up successfully.');
      notify({
        type: 'success',
        title: 'Cleanup complete',
        message: 'Expired emergency funds were removed.',
      });
    } catch (error) {
      console.error('Failed to cleanup expired funds:', error);
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (amount: string) => {
    return new Intl.NumberFormat().format(parseInt(amount) || 0);
  };

  const formatDate = (timestamp: number) => {
    return new Date(toMillis(timestamp)).toLocaleDateString();
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Emergency Fund Deployer</h1>
        <p className="text-gray-600 mb-6">
          Rapid deployment and monitoring of emergency relief funds
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Create Emergency Fund
          </button>
          <button
            type="button"
            onClick={() => setShowRapidForm(!showRapidForm)}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Rapid Disaster Response
          </button>
          <button
            type="button"
            onClick={() => setConfirmCleanup(true)}
            disabled={loading}
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 disabled:opacity-60"
          >
            Cleanup Expired
          </button>
        </div>

        <ErrorMessage error={error} onDismiss={() => setError(null)} className="mb-4" />
        {status && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
          >
            {status}
          </div>
        )}

        <ConfirmDialog
          isOpen={confirmCleanup}
          title="Clean up expired funds?"
          message="This will permanently remove all expired emergency funds. This action cannot be undone."
          confirmLabel="Yes, clean up"
          variant="danger"
          onConfirm={() => {
            setConfirmCleanup(false);
            void handleCleanupExpired();
          }}
          onCancel={() => setConfirmCleanup(false)}
        />

        {/* Create Fund Form */}
        {showCreateForm && (
          <div className="bg-gray-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Create Emergency Fund</h2>
            <form onSubmit={handleCreateFund} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="fund-id"
                  label="Fund ID"
                  required
                  error={fundError('fundId')}
                >
                  <input
                    id="fund-id"
                    name="fundId"
                    type="text"
                    value={fundForm.fundId}
                    onChange={(e) => setFundForm({...fundForm, fundId: e.target.value})}
                    onBlur={() => fundValidation.validateField('fundId', fundForm.fundId)}
                    aria-invalid={fundError('fundId') ? true : undefined}
                    aria-describedby={fundError('fundId') ? 'fund-id-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="fund-name"
                  label="Fund name"
                  required
                  error={fundError('name')}
                >
                  <input
                    id="fund-name"
                    name="name"
                    type="text"
                    value={fundForm.name}
                    onChange={(e) => setFundForm({...fundForm, name: e.target.value})}
                    onBlur={() => fundValidation.validateField('name', fundForm.name)}
                    aria-invalid={fundError('name') ? true : undefined}
                    aria-describedby={fundError('name') ? 'fund-name-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
              </div>
              
              <FormField
                id="fund-description"
                label="Description"
                required
                error={fundError('description')}
              >
                <textarea
                  id="fund-description"
                  name="description"
                  value={fundForm.description}
                  onChange={(e) => setFundForm({...fundForm, description: e.target.value})}
                  onBlur={() => fundValidation.validateField('description', fundForm.description)}
                  aria-invalid={fundError('description') ? true : undefined}
                  aria-describedby={fundError('description') ? 'fund-description-error' : undefined}
                  className="w-full px-3 py-2 border rounded"
                  rows={3}
                  required
                />
              </FormField>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="fund-total-amount"
                  label="Total amount"
                  required
                  error={fundError('totalAmount')}
                >
                  <input
                    id="fund-total-amount"
                    name="totalAmount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={fundForm.totalAmount}
                    onChange={(e) => setFundForm({...fundForm, totalAmount: e.target.value})}
                    onBlur={() => fundValidation.validateField('totalAmount', fundForm.totalAmount)}
                    aria-invalid={fundError('totalAmount') ? true : undefined}
                    aria-describedby={fundError('totalAmount') ? 'fund-total-amount-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="fund-disaster-type"
                  label="Disaster type"
                  required
                  error={fundError('disasterType')}
                >
                  <select
                    id="fund-disaster-type"
                    name="disasterType"
                    value={fundForm.disasterType}
                    onChange={(e) => setFundForm({...fundForm, disasterType: e.target.value})}
                    onBlur={() => fundValidation.validateField('disasterType', fundForm.disasterType)}
                    aria-invalid={fundError('disasterType') ? true : undefined}
                    aria-describedby={fundError('disasterType') ? 'fund-disaster-type-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  >
                    <option value="">Select disaster type</option>
                    <option value="earthquake">Earthquake</option>
                    <option value="flood">Flood</option>
                    <option value="hurricane">Hurricane</option>
                    <option value="wildfire">Wildfire</option>
                    <option value="drought">Drought</option>
                  </select>
                </FormField>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="fund-geographic-scope"
                  label="Geographic scope"
                  required
                  error={fundError('geographicScope')}
                >
                  <input
                    id="fund-geographic-scope"
                    name="geographicScope"
                    type="text"
                    value={fundForm.geographicScope}
                    onChange={(e) => setFundForm({...fundForm, geographicScope: e.target.value})}
                    onBlur={() => fundValidation.validateField('geographicScope', fundForm.geographicScope)}
                    aria-invalid={fundError('geographicScope') ? true : undefined}
                    aria-describedby={fundError('geographicScope') ? 'fund-geographic-scope-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="fund-expires-at"
                  label="Expires at"
                  required
                  error={fundError('expiresAt')}
                >
                  <input
                    id="fund-expires-at"
                    name="expiresAt"
                    type="datetime-local"
                    value={fundForm.expiresAt}
                    onChange={(e) => setFundForm({...fundForm, expiresAt: e.target.value})}
                    onBlur={() => fundValidation.validateField('expiresAt', fundForm.expiresAt)}
                    aria-invalid={fundError('expiresAt') ? true : undefined}
                    aria-describedby={fundError('expiresAt') ? 'fund-expires-at-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
              </div>

              <FormField
                id="fund-required-signatures"
                label="Required signatures"
                required
                hint="Enter a whole number from 1 to 10."
                error={fundError('requiredSignatures')}
              >
                <input
                  id="fund-required-signatures"
                  name="requiredSignatures"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="10"
                  value={fundForm.requiredSignatures}
                  onChange={(e) => setFundForm({...fundForm, requiredSignatures: e.target.value})}
                  onBlur={() => fundValidation.validateField('requiredSignatures', fundForm.requiredSignatures)}
                  aria-invalid={fundError('requiredSignatures') ? true : undefined}
                  aria-describedby={
                    fundError('requiredSignatures')
                      ? 'fund-required-signatures-hint fund-required-signatures-error'
                      : 'fund-required-signatures-hint'
                  }
                  className="w-full px-3 py-2 border rounded"
                  required
                />
              </FormField>
              
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  {loading ? 'Creating...' : 'Create Fund'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Rapid Response Form */}
        {showRapidForm && (
          <div className="bg-red-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Rapid Disaster Response</h2>
            <form onSubmit={handleRapidDeployment} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="rapid-disaster-id"
                  label="Disaster ID"
                  required
                  error={rapidError('disasterId')}
                >
                  <input
                    id="rapid-disaster-id"
                    name="disasterId"
                    type="text"
                    value={rapidForm.disasterId}
                    onChange={(e) => setRapidForm({...rapidForm, disasterId: e.target.value})}
                    onBlur={() => rapidValidation.validateField('disasterId', rapidForm.disasterId)}
                    aria-invalid={rapidError('disasterId') ? true : undefined}
                    aria-describedby={rapidError('disasterId') ? 'rapid-disaster-id-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="rapid-disaster-type"
                  label="Disaster type"
                  required
                  error={rapidError('disasterType')}
                >
                  <select
                    id="rapid-disaster-type"
                    name="disasterType"
                    value={rapidForm.disasterType}
                    onChange={(e) => setRapidForm({...rapidForm, disasterType: e.target.value})}
                    onBlur={() => rapidValidation.validateField('disasterType', rapidForm.disasterType)}
                    aria-invalid={rapidError('disasterType') ? true : undefined}
                    aria-describedby={rapidError('disasterType') ? 'rapid-disaster-type-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  >
                    <option value="">Select disaster type</option>
                    <option value="earthquake">Earthquake</option>
                    <option value="flood">Flood</option>
                    <option value="hurricane">Hurricane</option>
                    <option value="wildfire">Wildfire</option>
                    <option value="drought">Drought</option>
                  </select>
                </FormField>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="rapid-affected-area"
                  label="Affected area"
                  required
                  error={rapidError('affectedArea')}
                >
                  <input
                    id="rapid-affected-area"
                    name="affectedArea"
                    type="text"
                    value={rapidForm.affectedArea}
                    onChange={(e) => setRapidForm({...rapidForm, affectedArea: e.target.value})}
                    onBlur={() => rapidValidation.validateField('affectedArea', rapidForm.affectedArea)}
                    aria-invalid={rapidError('affectedArea') ? true : undefined}
                    aria-describedby={rapidError('affectedArea') ? 'rapid-affected-area-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="rapid-total-budget"
                  label="Total budget"
                  required
                  error={rapidError('totalBudget')}
                >
                  <input
                    id="rapid-total-budget"
                    name="totalBudget"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={rapidForm.totalBudget}
                    onChange={(e) => setRapidForm({...rapidForm, totalBudget: e.target.value})}
                    onBlur={() => rapidValidation.validateField('totalBudget', rapidForm.totalBudget)}
                    aria-invalid={rapidError('totalBudget') ? true : undefined}
                    aria-describedby={rapidError('totalBudget') ? 'rapid-total-budget-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
              </div>
              
              <div className="space-y-2">
                <h3 className="font-semibold">Fund categories</h3>
                <ul className="space-y-2" aria-label="Planned fund categories">
                  {rapidForm.categories.map((category, index) => (
                    <li key={index} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="w-24">{category.name}</span>
                      <span className="w-20 font-medium">{category.percentage}%</span>
                      <span className="text-sm text-gray-600">{category.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
              
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
                >
                  {loading ? 'Deploying...' : 'Deploy Rapid Response'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRapidForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Active Funds List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Active Emergency Funds</h2>
          
          {loading ? (
            <div className="text-center py-4">Loading...</div>
          ) : funds.length === 0 ? (
            <div className="text-gray-500 text-center py-4">No active funds found</div>
          ) : (
            <div className="grid gap-4">
              {funds.map((fund) => {
                const fundStatus = getFundStatus(fund);
                return (
                <div key={fund.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{fund.name}</h3>
                      <p className="text-gray-600">{fund.description}</p>
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>ID:</strong> {fund.id}</p>
                        <p><strong>Disaster:</strong> {fund.disasterType}</p>
                        <p><strong>Area:</strong> {fund.geographicScope}</p>
                        <p><strong>Created:</strong> {formatDate(fund.createdAt)}</p>
                        <p><strong>Expires:</strong> {formatDate(fund.expiresAt)}</p>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className={`inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold ${fundStatus.badgeClassName}`}>
                        <span aria-hidden="true">{fundStatus.icon}</span>
                        Status: {fundStatus.label}
                      </div>
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>Total:</strong> {formatAmount(fund.totalAmount)}</p>
                        <p><strong>Released:</strong> {formatAmount(fund.releasedAmount)}</p>
                        <p><strong>Remaining:</strong> {formatAmount(
                          (parseInt(fund.totalAmount) - parseInt(fund.releasedAmount)).toString()
                        )}</p>
                      </div>
                      
                      <div className="mt-4 space-x-2">
                        <button
                          type="button"
                          onClick={() => handleMonitorFund(fund.id)}
                          className="bg-blue-500 text-white px-3 py-1 text-sm rounded hover:bg-blue-600"
                        >
                          Monitor
                        </button>
                        <button
                          type="button"
                          onClick={() => aidClient.generateFundQRCode(fund.id, fund)}
                          className="bg-green-500 text-white px-3 py-1 text-sm rounded hover:bg-green-600"
                        >
                          QR Code
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Fund Details Modal */}
        {selectedFund && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4">
            <div
              className="bg-white rounded-lg p-4 sm:p-6 max-w-2xl w-full max-h-screen overflow-y-auto"
              role="dialog"
              aria-modal="true"
              aria-labelledby="fund-details-title"
            >
              <h2 id="fund-details-title" className="text-2xl font-bold mb-4">{selectedFund.name}</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Fund Details</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <p><strong>ID:</strong> {selectedFund.id}</p>
                    <p><strong>Status:</strong> {getFundStatus(selectedFund).label}</p>
                    <p><strong>Total Amount:</strong> {formatAmount(selectedFund.totalAmount)}</p>
                    <p><strong>Released Amount:</strong> {formatAmount(selectedFund.releasedAmount)}</p>
                    <p><strong>Created:</strong> {formatDate(selectedFund.createdAt)}</p>
                    <p><strong>Expires:</strong> {formatDate(selectedFund.expiresAt)}</p>
                  </div>
                </div>
                
                <div>
                  <h3 className="font-semibold">Description</h3>
                  <p className="text-gray-600">{selectedFund.description}</p>
                </div>
                
                <div>
                  <h3 className="font-semibold">Disaster Information</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <p><strong>Type:</strong> {selectedFund.disasterType}</p>
                    <p><strong>Geographic Scope:</strong> {selectedFund.geographicScope}</p>
                  </div>
                </div>
              </div>
              
              <div className="mt-6 flex justify-end">
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => setSelectedFund(null)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
