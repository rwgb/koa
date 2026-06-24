import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { fetchStatus } from '../api.js';
import type { AgentStatus, SessionUsageStats, ContextStats } from '../types.js';

interface AgentContextValue {
  isThinking: boolean;
  activeTool: string | null;
  usage: SessionUsageStats | null;
  agentStatus: AgentStatus | null;
  contextStats: ContextStats | null;
  statusError: string | null;
  setIsThinking: Dispatch<SetStateAction<boolean>>;
  setActiveTool: Dispatch<SetStateAction<string | null>>;
  setUsage: Dispatch<SetStateAction<SessionUsageStats | null>>;
  setAgentStatus: Dispatch<SetStateAction<AgentStatus | null>>;
  setContextStats: Dispatch<SetStateAction<ContextStats | null>>;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [isThinking, setIsThinking] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [usage, setUsage] = useState<SessionUsageStats | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus()
      .then(s => {
        setStatusError(null);
        setAgentStatus(s);
        if (s.usage) setUsage(s.usage);
      })
      .catch(err => {
        console.error('Failed to load agent status:', err);
        setStatusError('Could not connect to Koa — check that the server is running.');
      });
  }, []);

  return (
    <AgentContext.Provider value={{ isThinking, activeTool, usage, agentStatus, contextStats, statusError, setIsThinking, setActiveTool, setUsage, setAgentStatus, setContextStats }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used inside AgentProvider');
  return ctx;
}
