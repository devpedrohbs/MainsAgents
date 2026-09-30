import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { useWorkspaces } from '../../../app/WorkspaceProvider';
import { useLanguage } from '../../../app/LanguageProvider';
import { Icon } from '../../common/Icon';
import { useCanvas } from '../CanvasProvider';
import type { CanvasFlowNode } from '../canvasTypes';

interface TerminalEvent {
  type: 'started' | 'output' | 'finished' | 'failed' | 'cancelled';
  text?: string;
  cwd?: string;
  code?: number | null;
  message?: string;
  sequence?: number;
}

export function TerminalNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const { currentWorkspaceId } = useWorkspaces();
  const { updateNodeData } = useCanvas();
  const { t } = useLanguage();
  const workspaceId = String(data.workspaceId ?? currentWorkspaceId);
  const running = data.terminalStatus === 'running';
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followOutput = useRef(true);
  const eventCursor = useRef(data.terminalEventCursor ?? -1);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const savedDraft = useRef('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [actionError, setActionError] = useState('');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shell = String(data.terminalShell ?? (navigator.platform.includes('Win') ? 'powershell.exe' : 'sh'));
  const powershell = /(?:powershell|pwsh)/i.test(shell);
  const shellName = powershell ? 'PowerShell' : shell.split(/[\\/]/).pop() || 'Shell';
  const cwd = String(data.terminalCwd ?? '~');
  const prompt = `${powershell ? 'PS ' : ''}${cwd}${powershell ? '>' : ' $'}`;
  const command = String(data.command ?? '');
  const output = String(data.terminalOutput ?? '');
  const history = data.terminalHistory ?? [];

  const watchExecution = useCallback(async (executionId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/canvas/executions/${encodeURIComponent(executionId)}/events`, { signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? t('Terminal run is unavailable.'));
    }
    if (!response.body) throw new Error(t('Could not read terminal output.'));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const receive = (event: TerminalEvent) => {
      // The server replays the run when a Canvas is reopened. Keep the existing
      // scrollback and consume only new events instead of duplicating its output.
      if (event.sequence !== undefined && event.sequence <= eventCursor.current) return;
      if (event.sequence !== undefined) eventCursor.current = event.sequence;
      const cursor = { terminalEventCursor: eventCursor.current };
      if (event.type === 'started' && event.cwd) updateNodeData(workspaceId, id, { ...cursor, terminalCwd: event.cwd });
      if (event.type === 'output') updateNodeData(workspaceId, id, current => ({
        ...current, ...cursor, terminalOutput: `${current.terminalOutput ?? ''}${event.text ?? ''}`.slice(-30_000),
      }));
      if (event.type === 'finished') updateNodeData(workspaceId, id, {
        ...cursor, terminalStatus: event.code === 0 ? 'finished' : 'error', terminalExitCode: event.code,
        meta: t('Exited with code {{code}}', { code: event.code ?? 'unknown' }),
      });
      if (event.type === 'failed') updateNodeData(workspaceId, id, current => ({
        ...current, ...cursor, terminalStatus: 'error', meta: event.message,
        terminalOutput: `${current.terminalOutput ?? ''}\n${event.message ?? t('Terminal run is unavailable.')}\n`.slice(-30_000),
      }));
      if (event.type === 'cancelled') updateNodeData(workspaceId, id, {
        ...cursor, terminalStatus: 'cancelled', meta: t('Command cancelled'),
      });
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const line = chunk.split(/\r?\n/).find(item => item.startsWith('data: '));
        if (line) receive(JSON.parse(line.slice(6)) as TerminalEvent);
      }
      if (done) break;
    }
  }, [id, t, updateNodeData, workspaceId]);

  useEffect(() => {
    const executionId = String(data.terminalExecutionId ?? '');
    if (!executionId || !running) return;
    const controller = new AbortController();
    void watchExecution(executionId, controller.signal).catch(error => {
      if (!controller.signal.aborted) updateNodeData(workspaceId, id, {
        terminalStatus: 'error', meta: error instanceof Error ? error.message : t('Terminal run is unavailable.'),
      });
    });
    return () => controller.abort();
  }, [data.terminalExecutionId, running, id, t, updateNodeData, watchExecution, workspaceId]);

  useEffect(() => {
    const element = outputRef.current;
    if (element && followOutput.current) element.scrollTop = element.scrollHeight;
  }, [output, running]);
  useEffect(() => {
    const element = inputRef.current;
    if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 100)}px`; }
  }, [command]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const runCommand = async (event: FormEvent) => {
    event.preventDefault();
    const submitted = command.trim();
    if (!submitted || running) return;
    followOutput.current = true;
    eventCursor.current = -1;
    setHistoryIndex(-1);
    setActionError('');
    updateNodeData(workspaceId, id, current => ({
      ...current, command: '', terminalStatus: 'running', terminalExecutionId: undefined, terminalExitCode: undefined, terminalEventCursor: -1,
      terminalHistory: [...(current.terminalHistory ?? []).filter(item => item !== submitted), submitted].slice(-50),
      terminalOutput: `${current.terminalOutput ?? ''}${current.terminalOutput && !current.terminalOutput.endsWith('\n') ? '\n' : ''}${prompt} ${submitted}\n`.slice(-30_000),
      meta: t('Starting…'),
    }));
    try {
      const response = await fetch('/api/canvas/executions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: submitted, workspaceId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t('Could not start the command.'));
      updateNodeData(workspaceId, id, {
        terminalExecutionId: String(result.id), terminalStatus: 'running',
        terminalCwd: String(result.cwd ?? ''), terminalShell: String(result.shell ?? shell), meta: String(result.cwd ?? ''),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('Could not start the command.');
      updateNodeData(workspaceId, id, current => ({
        ...current, terminalStatus: 'error', meta: message,
        terminalOutput: `${current.terminalOutput ?? ''}${message}\n`.slice(-30_000),
      }));
    }
  };

  const cancelCommand = async () => {
    const executionId = String(data.terminalExecutionId ?? '');
    if (!executionId) return;
    try {
      const response = await fetch(`/api/canvas/executions/${encodeURIComponent(executionId)}/cancel`, { method: 'POST' });
      if (!response.ok) throw new Error(t('Could not stop the command.'));
    } catch { setActionError(t('Could not stop the command.')); }
  };
  const clearOutput = () => { followOutput.current = true; updateNodeData(workspaceId, id, { terminalOutput: '' }); };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); clearOutput(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && running && !window.getSelection()?.toString()) {
      event.preventDefault(); void cancelCommand(); return;
    }
    if (running) return;
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); return; }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !command.includes('\n') && history.length) {
      event.preventDefault();
      if (historyIndex === -1) savedDraft.current = command;
      const next = event.key === 'ArrowUp' ? Math.min(historyIndex + 1, history.length - 1) : Math.max(-1, historyIndex - 1);
      setHistoryIndex(next);
      updateNodeData(workspaceId, id, { command: next === -1 ? savedDraft.current : history[history.length - 1 - next] });
    }
  };
  const copyOutput = async () => {
    try { await navigator.clipboard.writeText(output); setCopyState('copied'); }
    catch { setCopyState('error'); }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState('idle'), 2000);
  };
  const state = running ? t('Running') : data.terminalStatus === 'cancelled' ? t('Command cancelled')
    : data.terminalStatus === 'error' ? t('Error') : data.terminalStatus === 'finished'
      ? t('Exit {{code}}', { code: data.terminalExitCode ?? '—' }) : t('Ready');

  return <article className={`flow-node terminal ${selected ? 'selected' : ''}`} aria-label={t('Terminal')}>
    <NodeResizer isVisible={selected} minWidth={340} minHeight={250} color="#767676" />
    <Handle className="flow-handle" type="target" position={Position.Left} />
    <header className="terminal-window-header">
      <div className="terminal-window-tab"><Icon name="terminal" /><span>{shellName}</span></div>
      <div className="terminal-window-tools nodrag">
        <button type="button" onClick={() => void copyOutput()} title={t(copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Could not copy output.' : 'Copy output')} aria-label={t('Copy output')} disabled={!output}><Icon name="copy" /></button>
        <button type="button" onClick={clearOutput} title={t('Clear terminal')} aria-label={t('Clear terminal')}><Icon name="trash" /></button>
      </div>
    </header>
    <div className="terminal-screen nodrag nowheel" ref={outputRef} onScroll={event => {
      const element = event.currentTarget; followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    }}>
      {output ? <pre className="terminal-transcript">{output}</pre> : <div className="terminal-welcome">{shellName}<br />{t('Enter a command to get started.')}</div>}
    </div>
    <form className="terminal-prompt-form nodrag nowheel" onSubmit={event => void runCommand(event)}>
      <div className="terminal-prompt-line">
        <span className="terminal-prompt-path" title={cwd}>{prompt}</span>
        <textarea ref={inputRef} className="terminal-input nodrag nowheel" aria-label={t('Run a local command')} value={command}
          onChange={event => { setHistoryIndex(-1); updateNodeData(workspaceId, id, { command: event.target.value }); }}
          onKeyDown={onKeyDown} placeholder={running ? t('Command is running…') : t('Type a command…')}
          spellCheck={false} autoCorrect="off" autoCapitalize="off" rows={1} readOnly={running} />
      </div>
      {running ? <button className="terminal-execute nodrag" type="button" disabled={!data.terminalExecutionId} onClick={() => void cancelCommand()} title={t('Stop')} aria-label={t('Stop')}><Icon name="stop" /></button>
        : <button className="terminal-execute nodrag" type="submit" disabled={!command.trim()} title={t('Run')} aria-label={t('Run')}><Icon name="play" /></button>}
    </form>
    <footer className="terminal-statusline">
      <span className={`terminal-status ${data.terminalStatus ?? 'idle'}`} role="status">{actionError || state}</span>
      <span title={t('Each command starts a new shell in the workspace folder.')}>{running ? 'Ctrl+C' : 'Enter ↵ · Shift+Enter'}</span>
    </footer>
    <Handle className="flow-handle" type="source" position={Position.Right} />
  </article>;
}
