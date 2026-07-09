import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp, Clock3, HelpCircle, ListChecks, Pause, Play, ShieldCheck, Target } from 'lucide-react';
import type { DailyPlanBlock, FloatWindowApi, StudySession } from '../../shared/types';
import {
  getSessionElapsedSeconds,
  hasExceededDragThreshold,
  shouldSuppressActivationAfterDrag
} from './float-behavior';
import './float-styles.css';

declare global {
  interface Window {
    floatApp: FloatWindowApi;
  }
}

type FloatState = 'collapsed' | 'expanded';

const FLOAT_WIDTH = 420;
const FLOAT_COLLAPSED_HEIGHT = 56;
const FLOAT_EXPANDED_HEIGHT = 300;

function FloatApp(): React.JSX.Element {
  const [floatState, setFloatState] = useState<FloatState>(() => {
    try {
      return window.localStorage.getItem('study.float.state') === 'expanded' ? 'expanded' : 'collapsed';
    } catch {
      return 'collapsed';
    }
  });
  const [session, setSession] = useState<StudySession | null>(null);
  const [block, setBlock] = useState<DailyPlanBlock | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragOriginRef = useRef({ x: 0, y: 0 });
  const dragLastRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const lastDragEndedAtRef = useRef<number | null>(null);

  useEffect(() => {
    loadActiveSession();
    const cleanup = window.floatApp.session.onStateChanged((data) => {
      setSession(data.session);
      setBlock(data.block);
      if (data.session) {
        setNote(data.session.notes ?? '');
      }
    });
    return cleanup;
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('study.float.state', floatState);
    } catch {
      // ignore storage failures in the floating window
    }
    void window.floatApp.float.resize(
      FLOAT_WIDTH,
      floatState === 'expanded' ? FLOAT_EXPANDED_HEIGHT : FLOAT_COLLAPSED_HEIGHT
    );
  }, [floatState]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (session?.status === 'active' && session.startedAt) {
      const compute = () => getSessionElapsedSeconds(session);
      setElapsed(compute());
      timerRef.current = setInterval(() => setElapsed(compute()), 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
    if (session?.status === 'paused' && session.durationMinutes != null) {
      setElapsed(getSessionElapsedSeconds(session));
    }
  }, [session?.status, session?.startedAt, session?.durationMinutes]);

  async function loadActiveSession(): Promise<void> {
    try {
      const data = await window.floatApp.session.getActive();
      if (data) {
        setSession(data.session);
        setBlock(data.block);
        setNote(data.session.notes ?? '');
      }
    } catch {
      // ignore
    }
  }

  function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  async function handlePause(): Promise<void> {
    if (!session || session.status !== 'active') return;
    try { await window.floatApp.session.pause(session.id); } catch { /* ignore */ }
  }

  async function handleResume(): Promise<void> {
    if (!session?.blockId) return;
    try { await window.floatApp.session.resume(session.blockId); } catch { /* ignore */ }
  }

  async function handleComplete(): Promise<void> {
    if (!session) return;
    try { await window.floatApp.session.complete(session.id, note); } catch { /* ignore */ }
  }

  async function handleOpenMain(): Promise<void> {
    try { await window.floatApp.float.openMain(); } catch { /* ignore */ }
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('textarea') || target.closest('input')) return;

    e.preventDefault();
    dragOriginRef.current = { x: e.screenX, y: e.screenY };
    dragLastRef.current = { x: e.screenX, y: e.screenY };
    isDraggingRef.current = false;

    const handleMouseMove = (ev: MouseEvent) => {
      const current = { x: ev.screenX, y: ev.screenY };
      if (hasExceededDragThreshold(dragOriginRef.current, current)) {
        isDraggingRef.current = true;
      }
      const dx = ev.screenX - dragLastRef.current.x;
      const dy = ev.screenY - dragLastRef.current.y;
      dragLastRef.current = current;
      void window.floatApp.float.move(dx, dy);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        suppressClickRef.current = true;
        lastDragEndedAtRef.current = Date.now();
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClickRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClickRef.current = false;
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (shouldSuppressActivationAfterDrag(lastDragEndedAtRef.current, Date.now())) return;
    void handleOpenMain();
  }, []);

  function toggleExpand(): void {
    setFloatState((current) => (current === 'collapsed' ? 'expanded' : 'collapsed'));
  }

  if (!session) {
    return (
      <div className="float-container float-empty">
        <span>无活跃学习会话</span>
      </div>
    );
  }

  const isActive = session.status === 'active';
  const isPaused = session.status === 'paused';
  const statusColor = isActive ? 'active' : isPaused ? 'paused' : 'done';

  return (
    <div
      className={`float-container ${floatState === 'expanded' ? 'expanded' : 'collapsed'} status-${statusColor}`}
      onMouseDown={handleMouseDown}
      onClickCapture={handleClickCapture}
      onDoubleClick={handleDoubleClick}
    >
      <div className="float-header">
        <span className={`status-dot ${statusColor}`} />
        <span className="float-title" title={block?.objective ?? ''}>
          {block?.objective ?? '学习中'}
        </span>
        <span className="float-timer">
          <Clock3 size={14} />
          {formatTime(elapsed)}
        </span>
        <div className="float-header-actions">
          {isActive && (
            <button className="float-btn float-btn-pause" onClick={handlePause} title="暂停">
              <Pause size={14} />
            </button>
          )}
          {isPaused && (
            <button className="float-btn float-btn-resume" onClick={handleResume} title="继续">
              <Play size={14} />
            </button>
          )}
          <button
            className="float-btn float-btn-expand"
            onClick={toggleExpand}
            title={floatState === 'expanded' ? '收起' : '展开'}
          >
            {floatState === 'expanded' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
      </div>

      {floatState === 'expanded' && (
        <div className="float-body">
          <button className="float-detail-row" type="button" onClick={handleOpenMain}>
            <ListChecks size={22} />
            <span>
              <strong>当前步骤</strong>
              {block?.objective ?? '当前任务'}
            </span>
            <ChevronRight size={16} />
          </button>
          <button className="float-detail-row" type="button" onClick={handleOpenMain}>
            <Target size={22} />
            <span>
              <strong>操作摘要</strong>
              {block?.action ?? '-'}
            </span>
            <ChevronRight size={16} />
          </button>
          <button className="float-detail-row" type="button" onClick={handleOpenMain}>
            <ShieldCheck size={22} />
            <span>
              <strong>完成标准</strong>
              {block?.successCheck ?? '-'}
            </span>
            <ChevronRight size={16} />
          </button>
          <div className="float-detail-row question-row">
            <HelpCircle size={22} />
            <span>
              <strong>快速提问入口</strong>
              遇到问题？快速向学习管家提问
            </span>
            <button className="float-small-link" type="button" onClick={handleOpenMain}>去提问</button>
          </div>
          <div className="float-actions">
            <button className="float-action-btn primary" onClick={handleComplete}>
              <Check size={16} />
              标记完成
            </button>
            <button className="float-action-btn secondary" onClick={handleOpenMain}>
              <ArrowLeft size={16} />
              返回主应用
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const root = document.getElementById('float-root');
if (root) {
  createRoot(root).render(<FloatApp />);
}
