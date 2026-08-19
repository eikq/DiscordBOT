import { isReminderCapabilityId, isReminderReadCapability } from '../../automation/constants';
import { isResearchCapabilityId } from '../../research/constants';
import { isPrivateResearchCapabilityId } from '../../research/private/constants';
import { isWorkspaceCapabilityId } from '../../workspace/constants';
import {
  APPLICATIONS_STATUS,
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_SETTINGS,
  DESKTOP_OPEN_TRUSTED_URL,
  JARVIS_HEALTH_CHECK,
  JARVIS_RESTART_SERVICE,
  JARVIS_RUNTIME_STATUS,
  JARVIS_START_SERVICE,
  JARVIS_STOP_SERVICE,
  SYSTEM_BATTERY_STATUS,
  SYSTEM_NETWORK_STATUS,
  SYSTEM_STATUS,
} from './constants';
import { applicationById, projectById } from './allowlists';
import { serviceRecord } from './services/catalog';
import { loadSettingsAllowlist, settingsById } from './settingsAllowlist';
import type { ActionProposal, DesktopAllowlists, PermissionDecision } from './types';
import { classifyOpenUrl } from './urlSafety';

export class PermissionPolicy {
  public evaluate(proposal: ActionProposal, lists: DesktopAllowlists): PermissionDecision {
    const base = {
      capabilityId: proposal.capabilityId,
      proposalId: proposal.proposalId,
    };

    if (proposal.capabilityId === SYSTEM_STATUS) {
      return {
        ...base,
        decision: 'allow',
        reasonCode: 'READ_ONLY',
        userMessage: 'Read-only system status.',
        risk: 'READ_ONLY',
      };
    }

    if (proposal.capabilityId === DESKTOP_OPEN_APPLICATION) {
      const applicationId = String(proposal.normalizedArguments.applicationId ?? '');
      const app = applicationById(lists, applicationId);
      if (!app) {
        return {
          ...base,
          decision: 'deny',
          reasonCode: 'UNKNOWN_APPLICATION',
          userMessage: 'That application is not on the allowlist.',
          risk: 'BLOCKED',
        };
      }
      if (!app.installed) {
        return {
          ...base,
          decision: 'deny',
          reasonCode: 'NOT_INSTALLED',
          userMessage: `${app.displayName} is not installed or the configured path is missing.`,
          risk: 'LOW_RISK_ACTION',
        };
      }
      return {
        ...base,
        decision: 'allow',
        reasonCode: 'ALLOWLISTED_APPLICATION',
        userMessage: `Open ${app.displayName}.`,
        risk: 'LOW_RISK_ACTION',
      };
    }

    if (proposal.capabilityId === DESKTOP_OPEN_PROJECT) {
      const projectId = String(proposal.normalizedArguments.projectId ?? '');
      const project = projectById(lists, projectId);
      if (!project) {
        return {
          ...base,
          decision: 'deny',
          reasonCode: 'UNKNOWN_PROJECT',
          userMessage: 'That project is not on the allowlist.',
          risk: 'BLOCKED',
        };
      }
      if (!project.installed || !lists.explorerExecutable) {
        return {
          ...base,
          decision: 'deny',
          reasonCode: project.installed ? 'EXPLORER_UNAVAILABLE' : 'PROJECT_UNAVAILABLE',
          userMessage: project.installed
            ? 'File Explorer is not available.'
            : `${project.displayName} path is not available.`,
          risk: 'LOW_RISK_ACTION',
        };
      }
      return {
        ...base,
        decision: 'allow',
        reasonCode: 'ALLOWLISTED_PROJECT',
        userMessage: `Reveal ${project.displayName}.`,
        risk: 'LOW_RISK_ACTION',
      };
    }

    if (proposal.capabilityId === DESKTOP_OPEN_TRUSTED_URL) {
      const url = String(proposal.normalizedArguments.url ?? '');
      const classified = classifyOpenUrl(url, lists);
      if (!classified.ok) {
        return {
          ...base,
          decision: 'deny',
          reasonCode: classified.reasonCode || 'BLOCKED_URL',
          userMessage: 'That URL is not allowed.',
          risk: 'BLOCKED',
        };
      }
      if (!lists.explorerExecutable) {
        return {
          ...base,
          decision: 'deny',
          reasonCode: 'EXPLORER_UNAVAILABLE',
          userMessage: 'A trusted URL opener is not available.',
          risk: classified.risk || 'CONFIRM_REQUIRED',
        };
      }
      if (classified.risk === 'LOW_RISK_ACTION') {
        return {
          ...base,
          decision: 'allow',
          reasonCode: 'TRUSTED_LOCAL_URL',
          userMessage: 'Open a trusted local Jarvis URL.',
          risk: 'LOW_RISK_ACTION',
        };
      }
      return {
        ...base,
        decision: 'confirm',
        reasonCode: 'EXTERNAL_HTTPS',
        userMessage: 'This opens an external website.',
        risk: 'CONFIRM_REQUIRED',
      };
    }

    if (proposal.capabilityId === SYSTEM_BATTERY_STATUS || proposal.capabilityId === SYSTEM_NETWORK_STATUS || proposal.capabilityId === APPLICATIONS_STATUS || proposal.capabilityId === JARVIS_RUNTIME_STATUS || proposal.capabilityId === JARVIS_HEALTH_CHECK) {
      return {
        ...base,
        decision: 'allow',
        reasonCode: 'READ_ONLY',
        userMessage: 'Read-only status.',
        risk: 'READ_ONLY',
      };
    }

    if (proposal.capabilityId === DESKTOP_OPEN_SETTINGS) {
      const settingsId = String(proposal.normalizedArguments.settingsId ?? '');
      const page = settingsById(loadSettingsAllowlist(), settingsId);
      if (!page) {
        return {
          ...base,
          decision: 'deny',
          reasonCode: 'UNKNOWN_SETTINGS',
          userMessage: 'That settings page is not on the allowlist.',
          risk: 'BLOCKED',
        };
      }
      if (!lists.explorerExecutable) {
        return {
          ...base,
          decision: 'deny',
          reasonCode: 'EXPLORER_UNAVAILABLE',
          userMessage: 'File Explorer is not available.',
          risk: 'LOW_RISK_ACTION',
        };
      }
      return {
        ...base,
        decision: 'allow',
        reasonCode: 'ALLOWLISTED_SETTINGS',
        userMessage: `Open ${page.displayName} settings.`,
        risk: 'LOW_RISK_ACTION',
      };
    }

    if (isReminderCapabilityId(proposal.capabilityId)) {
      const read = isReminderReadCapability(proposal.capabilityId);
      return {
        ...base,
        decision: 'allow',
        reasonCode: read ? 'READ_ONLY' : 'REMINDER_MUTATION',
        userMessage: read ? 'Read Jarvis reminders.' : 'Update a Jarvis reminder.',
        risk: read ? 'READ_ONLY' : 'LOW_RISK_ACTION',
      };
    }

    if (isPrivateResearchCapabilityId(proposal.capabilityId)) {
      return {
        ...base,
        decision: 'confirm',
        reasonCode: 'PRIVATE_BROWSER',
        userMessage: 'This uses the isolated private browser route. It will not use your Chrome or Edge profile.',
        risk: 'CONFIRM_REQUIRED',
      };
    }

    if (isResearchCapabilityId(proposal.capabilityId)) {
      return {
        ...base,
        decision: 'allow',
        reasonCode: 'READ_ONLY',
        userMessage: 'Read-only public web research.',
        risk: 'READ_ONLY',
      };
    }

    if (isWorkspaceCapabilityId(proposal.capabilityId)) {
      return {
        ...base,
        decision: 'allow',
        reasonCode: 'READ_ONLY',
        userMessage: 'Read-only local workspace intelligence.',
        risk: 'READ_ONLY',
      };
    }

    if (proposal.capabilityId === JARVIS_START_SERVICE || proposal.capabilityId === JARVIS_STOP_SERVICE || proposal.capabilityId === JARVIS_RESTART_SERVICE) {
      const serviceId = String(proposal.normalizedArguments.serviceId ?? '');
      const service = serviceRecord(serviceId);
      if (!service) {
        return {
          ...base,
          decision: 'deny',
          reasonCode: 'UNKNOWN_SERVICE',
          userMessage: 'Unknown Jarvis service.',
          risk: 'BLOCKED',
        };
      }
      const allowed = proposal.capabilityId === JARVIS_START_SERVICE
        ? service.startAllowed
        : proposal.capabilityId === JARVIS_STOP_SERVICE
          ? service.stopAllowed
          : service.restartAllowed;
      if (!allowed) {
        return {
          ...base,
          decision: 'deny',
          reasonCode: 'SERVICE_ACTION_NOT_SUPPORTED',
          userMessage: `${service.displayName} does not allow that lifecycle action.`,
          risk: 'BLOCKED',
        };
      }
      if (proposal.capabilityId === JARVIS_START_SERVICE) {
        return {
          ...base,
          decision: 'allow',
          reasonCode: 'REGISTERED_SERVICE_START',
          userMessage: `Start ${service.displayName}.`,
          risk: 'LOW_RISK_ACTION',
        };
      }
      return {
        ...base,
        decision: 'confirm',
        reasonCode: proposal.capabilityId === JARVIS_STOP_SERVICE ? 'SERVICE_STOP' : 'SERVICE_RESTART',
        userMessage: proposal.capabilityId === JARVIS_STOP_SERVICE
          ? `This stops ${service.displayName}.`
          : `This restarts ${service.displayName}.`,
        risk: 'CONFIRM_REQUIRED',
      };
    }

    return {
      ...base,
      decision: 'deny',
      reasonCode: 'UNKNOWN_CAPABILITY',
      userMessage: 'Unknown capability.',
      risk: 'BLOCKED',
    };
  }
}

