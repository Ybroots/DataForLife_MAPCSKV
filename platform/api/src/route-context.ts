import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DirectoryRepository } from './types.js';
import { readOfficerSessionCookie, verifyOfficerSession, type OfficerCredential } from './officer-auth.js';
import { verifyCitizenSession, readCitizenSessionCookie, type CitizenCredential } from './citizen-auth.js';
import type { AssistantPlanner } from './map-assistant.js';
import type { PushStore } from './push.js';
import { headerIdentity } from './request-parsing.js';

export interface AppOptions {
  corsOrigin: string;
  enableLocalWorkflows?: boolean;
  officerSessionSecret?: string;
  officerCredentials?: readonly OfficerCredential[];
  secureCookies?: boolean;
  allowTestAuthHeaders?: boolean;
  citizenSessionSecret?: string;
  citizenCredentials?: readonly CitizenCredential[];
  releaseValidation?: boolean;
  assistantPlanner?: AssistantPlanner;
  assistantDailyLimit?: number;
  /** Kho thiết bị nhận thông báo đẩy. Mặc định là kho trong bộ nhớ (fixture, kiểm thử). */
  pushStore?: PushStore;
  /** true khi máy chủ có khóa FCM và thật sự gửi được thông báo đẩy. */
  pushEnabled?: boolean;
  /** Test hooks and tuning for the in-process abuse limits. Defaults are pilot proposals, not policy. */
  limits?: {
    clock?: () => number;
    loginAccountFailures?: number;
    sosPerWindow?: number;
    incidentsPerWindow?: number;
  };
}

/** Những gì mọi nhóm route cùng dùng: kho dữ liệu, tùy chọn, cách nhận diện người gửi và cổng tắt workflow. */
export interface RouteContext {
  app: FastifyInstance;
  repository: DirectoryRepository;
  options: AppOptions;
  localWorkflowMeta: { workflowMode: 'local_sandbox'; authentication: 'http_only_session'; emergencyDispatchConnected: boolean };
  officerIdentity: (request: FastifyRequest) => string | null;
  citizenIdentity: (request: FastifyRequest) => string | null;
  workflowDisabled: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export function createRouteContext(app: FastifyInstance, repository: DirectoryRepository, options: AppOptions): RouteContext {
  const localWorkflowMeta = {
    workflowMode: 'local_sandbox' as const,
    authentication: 'http_only_session' as const,
    emergencyDispatchConnected: false,
  };

  const officerIdentity = (request: FastifyRequest): string | null => {
    if (options.allowTestAuthHeaders) {
      const testIdentity = headerIdentity(request.headers['x-officer-id']);
      if (testIdentity) return testIdentity;
    }
    if (!options.officerSessionSecret) return null;
    const token = readOfficerSessionCookie(request.headers.cookie);
    return verifyOfficerSession(token, options.officerSessionSecret);
  };

  const citizenIdentity = (request: FastifyRequest): string | null => {
    if (options.allowTestAuthHeaders) {
      const testIdentity = headerIdentity(request.headers['x-citizen-id']);
      if (testIdentity) return testIdentity;
    }
    if (!options.citizenSessionSecret) return null;
    return verifyCitizenSession(readCitizenSessionCookie(request.headers.cookie), options.citizenSessionSecret);
  };

  const workflowDisabled = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (options.enableLocalWorkflows !== false) return undefined;
    await reply.code(503).send({
      error: 'WORKFLOW_DISABLED',
      message: 'Workflow nghiệp vụ local đang tắt.',
    });
  };

  return { app, repository, options, localWorkflowMeta, officerIdentity, citizenIdentity, workflowDisabled };
}
