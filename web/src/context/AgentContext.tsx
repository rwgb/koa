import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { fetchStatus } from '../api.js';
import type { AgentStatus, SessionUsageStats } from '../types.js';

interface AgentContextValue {
  isThinking: boolean;
  activeTool: string | null;
  usage: SessionUsageStats | null;
  agentStatus: AgentStatus | null;
  setIsThinking: Dispatch<SetStateAction<boolean>>;
  setActiveTool: Dispatch<SetStateAction<string | null>>;
  setUsage: Dispatch<SetStateAction<SessionUsageStats | null>>;
  setAgentStatus: Dispatch<SetStateAction<AgentStatus | null>>;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [isThinking, setIsThinking] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [usage, setUsage] = useState<SessionUsageStats | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);

  useEffect(() => {
    fetchStatus()
      .then(s => {
        setAgentStatus(s);
        if (s.usage) setUsage(s.usage);
      })
      .catch(err => console.error('Failed to load agent status:', err));
  }, []);

  return (
    <AgentContext.Provider value={{ isThinking, activeTool, usage, agentStatus, setIsThinking, setActiveTool, setUsage, setAgentStatus }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used inside AgentProvider');
  return ctx;
}
