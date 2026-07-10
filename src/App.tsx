import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import DOMPurify from 'dompurify';
import * as LucideIcons from 'lucide-react';
import { 
  Search, Bell, Home, Calendar as CalendarIcon, User,
  MoreHorizontal, Play, Clock, CheckCircle2, ChevronRight, ChevronUp, ChevronDown,
  Sparkles, BookOpen, FileText, Presentation, GripVertical,
  Settings, Plus, Send, Loader2, FileQuestion, Image as ImageIcon,
  BrainCircuit, Layers, MessageCircle, MessageSquare, Camera, Database, Archive, Download, FileUp, Headphones, Square, Upload, Paperclip, Shield, LogOut, Trash2,
  MapPin, RefreshCw, ClipboardList, Coffee, Users, Library, Filter, HardDrive, FolderOpen, X,
  Wand2, Grid3x3, Puzzle, Dice5, Map as MapIcon, Layers3, Trophy, ScrollText, AlertCircle, KeyRound, Lock, Pencil,
  Volume2, Shuffle, Swords, Medal, Crown, Flame, Zap, Gift, Undo2, UserPlus, Pause, RotateCcw, Dices, Timer as TimerIcon, Star, Minus, ChevronLeft, Hand, Ticket, Siren,
  Coins, BarChart3, Scale, Megaphone, PartyPopper, CalendarDays, Mail,
  Copy, Youtube, Accessibility, ListChecks, Printer, HeartHandshake, GraduationCap, NotebookPen, Eye, EyeOff
} from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { auth, db, storage, logOut, getFcmToken, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, RecaptchaVerifier, PhoneAuthProvider, linkWithCredential, deleteUser } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch, getDoc, increment, getDocs, query, where, getCountFromServer } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { selectBnccSkills, SUBJECT_OPTIONS } from './bncc-data';
import {
  escapeHtml, shuffleArray, isAdminAccount, canSeedTurmas,
  formatApiError, fmtBytes, fileToBase64, toISODate, guessMimeType,
  AI_PRICING, estimateCostUSD,
} from './utils';
import { INFORMATICA_LESSONS, JOGOS_LESSONS } from './seed-lessons';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("CRITICAL: GEMINI_API_KEY está ausente no ambiente!");
}
const ai = new GoogleGenAI({ apiKey: apiKey || 'fake-key-para-evitar-crash' });

const AI_MODEL = 'gemini-2.5-flash';

const LOADING_MESSAGES = {
  planner: [
    "Dando uma olhada no tema...",
    "Pensando nos objetivos da aula...",
    "Montando a sequência didática...",
    "Definindo como vai fluir a aula...",
    "Escrevendo com atenção...",
    "Adaptando para a turma...",
    "Dando os últimos ajustes...",
    "Quase pronto...",
  ],
  studio: [
    "Criando o cenário...",
    "Pensando nos desafios...",
    "Calibrando a dificuldade...",
    "Encaixando as peças...",
    "Escrevendo os enigmas...",
    "Checando se faz sentido...",
    "Finalizando tudo...",
  ],
  chat: [
    "Lendo aqui com atenção...",
    "Pensando na melhor resposta...",
    "Organizando as ideias...",
    "Checando as informações...",
    "Escrevendo pra você...",
  ],
};

function useFunnyLoadingMessage(isLoading: boolean, context: keyof typeof LOADING_MESSAGES = 'planner'): string {
  const [msg, setMsg] = React.useState('');
  React.useEffect(() => {
    if (!isLoading) { setMsg(''); return; }
    const messages = LOADING_MESSAGES[context];
    let i = 0;
    setMsg(messages[0]);
    const id = setInterval(() => {
      i = Math.min(i + 1, messages.length - 1);
      setMsg(messages[i]);
    }, 3000);
    return () => clearInterval(id);
  }, [isLoading, context]);
  return msg;
}

function renderChatText(text: string, isUser: boolean): React.ReactNode {
  const baseColor = isUser ? 'text-white' : 'text-gray-800';
  return text.split('\n').map((line, li) => {
    const parts: React.ReactNode[] = [];
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      if (m[2] !== undefined) parts.push(<strong key={m.index}>{m[2]}</strong>);
      else if (m[3] !== undefined) parts.push(<em key={m.index}>{m[3]}</em>);
      else if (m[4] !== undefined) parts.push(<code key={m.index} className="bg-black/10 rounded px-1 text-xs font-mono">{m[4]}</code>);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return <React.Fragment key={li}>{parts}{li < text.split('\n').length - 1 && <br />}</React.Fragment>;
  });
}


const withRetry = async <T,>(fn: () => Promise<T>, maxRetries = 4, baseDelayMs = 2000): Promise<T> => {
  let attempt = 0;
  let rateLimit429Attempts = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      let msg = '';
      if (typeof error === 'string') msg = error;
      else if (error instanceof Error) msg = error.message;
      else if (error?.error?.message) msg = error.error.message;
      else if (error?.message) msg = Object.prototype.toString.call(error.message) === '[object String]' ? error.message : JSON.stringify(error.message);
      else { try { msg = JSON.stringify(error); } catch (e) {} }

      const status = error?.status || error?.error?.code || (typeof error?.error === 'object' ? error?.error?.status : null);
      const is503 = status === 503 || msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand');
      const is429 = status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');

      if (is429) {
        rateLimit429Attempts++;
        if (rateLimit429Attempts <= 1) {
          // Wait 30s for per-minute quota window to reset, then try once more
          await new Promise(resolve => setTimeout(resolve, 30000 + Math.random() * 5000));
          continue;
        }
        throw error; // Second 429: quota is exhausted, give up
      } else if (is503 && attempt < maxRetries) {
        const delay = (baseDelayMs * Math.pow(2, attempt - 1)) + (Math.random() * 1000);
        console.warn(`API overloaded (503). Retrying in ${Math.round(delay)}ms... (Attempt ${attempt} of ${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Servidor da IA indisponível após várias tentativas. Tente novamente em alguns minutos.");
};

const withTimeout = <T,>(promise: Promise<T>, ms: number, label = 'operação'): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tempo esgotado em ${label} (${Math.round(ms / 1000)}s). Verifique sua conexão e tente novamente.`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
};

let _pendingInputTokens = 0;
let _pendingOutputTokens = 0;

const generateContentWithRetry = async (params: Parameters<typeof ai.models.generateContent>[0]) => {
  if (!apiKey) {
    throw new Error('Chave da IA não configurada. Contate o suporte.');
  }
  if (!params.model) params.model = AI_MODEL;
  const result = await withRetry(() => withTimeout(ai.models.generateContent(params), 60000, 'geração de conteúdo'));
  const usage = (result as any).usageMetadata;
  if (usage) {
    _pendingInputTokens += usage.promptTokenCount || 0;
    _pendingOutputTokens += usage.candidatesTokenCount || 0;
  }
  return result;
};

function useFirestoreSync<T extends { id: string }>(
  collectionName: string,
  user: any,
  initialData: T[]
): [T[], (data: T[] | ((prev: T[]) => T[])) => void] {
  const [data, setData] = useState<T[]>(initialData);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(collection(db, `users/${user.uid}/${collectionName}`), (snapshot) => {
      const items = snapshot.docs.map(doc => doc.data() as T);
      setData(items);
      setIsLoaded(true);
    }, (error) => {
      console.error(`Error in useFirestoreSync for ${collectionName}:`, error);
    });
    return () => unsubscribe();
  }, [user, collectionName]);

  const updateData = async (newData: T[] | ((prev: T[]) => T[])) => {
    const previousData = data;
    const resolvedData = typeof newData === 'function' ? (newData as Function)(previousData) : newData;
    setData(resolvedData);
    if (!user || !isLoaded) return;
    
    try {
      const operations: { type: 'set' | 'delete', ref: any, data?: any }[] = [];
      const oldDataMap = new Map(previousData.map(item => [item.id, item]));
      const newIds = new Set(resolvedData.map(item => item.id));
      
      // Collect deleted items
      previousData.forEach(item => {
        if (!newIds.has(item.id)) {
          operations.push({ type: 'delete', ref: doc(db, `users/${user.uid}/${collectionName}`, item.id) });
        }
      });
      
      // Collect added/updated items
      resolvedData.forEach(item => {
        const oldItem = oldDataMap.get(item.id);
        if (!oldItem || JSON.stringify(oldItem) !== JSON.stringify(item)) {
          let itemToSave: any = { ...item, uid: user.uid };
          if (itemToSave.attachment) {
            itemToSave.attachment = { name: itemToSave.attachment.name, mimeType: itemToSave.attachment.mimeType };
          }
          Object.keys(itemToSave).forEach(key => itemToSave[key] === undefined && delete itemToSave[key]);
          operations.push({ type: 'set', ref: doc(db, `users/${user.uid}/${collectionName}`, item.id), data: itemToSave });
        }
      });
      
      // Run in safe batches of 450
      const OPERATIONS_LIMIT = 450;
      for (let i = 0; i < operations.length; i += OPERATIONS_LIMIT) {
        const chunk = operations.slice(i, i + OPERATIONS_LIMIT);
        const batch = writeBatch(db);
        chunk.forEach(op => {
          if (op.type === 'delete') batch.delete(op.ref);
          else if (op.data) batch.set(op.ref, op.data);
        });
        await batch.commit();
      }
    } catch (err) {
      console.error(`Error in useFirestoreSync for ${collectionName}:`, err);
      setData(previousData);
      toast.error("A internet cochilou. Suas mudanças não foram salvas. Tente de novo.");
    }
  };

  return [data, updateData];
}

function useFirestoreDoc<T>(
  docPath: string,
  user: any,
  initialData: T
): [T, (data: T | ((prev: T) => T)) => void, boolean] {
  const [data, setData] = useState<T>(initialData);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, docPath), (snapshot) => {
      if (snapshot.exists()) {
        // Realiza um merge seguro para evitar que campos ausentes injetem null/undefined na tipagem
        setData({ ...initialData, ...snapshot.data() } as T);
      }
      setIsLoaded(true);
    }, (error) => {
      console.error(`Error in useFirestoreDoc for ${docPath}:`, error);
    });
    return () => unsubscribe();
  }, [user, docPath]);

  const updateData = async (newData: T | ((prev: T) => T)) => {
    const previousData = data;
    const resolvedData = typeof newData === 'function' ? (newData as Function)(previousData) : newData;
    setData(resolvedData);
    if (!user || !isLoaded) return;
    try {
      await setDoc(doc(db, docPath), { ...resolvedData, uid: user.uid, email: user.email || '' }, { merge: true });
    } catch (err) {
      console.error(`Error in useFirestoreDoc for ${docPath}:`, err);
      setData(previousData);
      toast.error("A internet cochilou. Suas mudanças não foram salvas. Tente de novo.");
    }
  };

  return [data, updateData, isLoaded];
}

// --- Error Boundary ---
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#F8F9FE] flex flex-col items-center justify-center p-6">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-xl border border-red-100">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <img src="https://i.ibb.co/JwXsb4D4/20260521-154229-0000.png" alt="Corujão" className="w-full h-full object-contain" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Ih, o Corujão tropeçou!</h2>
            <p className="text-sm text-gray-500 mb-2">Algo inesperado aconteceu. Seus dados estão salvos na nuvem. Só recarregue a página.</p>
            <p className="text-xs text-red-500 mb-6 bg-red-50 p-2 rounded-xl font-mono break-all">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white rounded-2xl py-3 font-bold text-sm"
            >
              Recarregar o app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Toast System ---
type ToastType = 'error' | 'success' | 'info';
interface Toast { id: string; message: string; type: ToastType; }

let _toastSetter: React.Dispatch<React.SetStateAction<Toast[]>> | null = null;

const toast = {
  show(message: string, type: ToastType = 'info') {
    if (!_toastSetter) { console.warn('[toast]', message); return; }
    const id = Math.random().toString(36).slice(2);
    _toastSetter(prev => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => _toastSetter!(prev => prev.filter(t => t.id !== id)), 4500);
  },
  error(msg: string) { this.show(msg, 'error'); },
  success(msg: string) { this.show(msg, 'success'); },
  info(msg: string) { this.show(msg, 'info'); },
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => { _toastSetter = setToasts; return () => { _toastSetter = null; }; }, []);
  return createPortal(
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 w-full max-w-sm px-4 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -16, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92, y: -8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className={`rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-lg pointer-events-auto flex items-start gap-2 ${
              t.type === 'error' ? 'bg-red-500' : t.type === 'success' ? 'bg-emerald-500' : 'bg-gray-800'
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button onClick={() => setToasts(p => p.filter(x => x.id !== t.id))} className="opacity-70 hover:opacity-100 shrink-0 mt-0.5">✕</button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
};

// --- Helper Components ---
const DynamicIcon = ({ name, size = 20, color = 'currentColor', className = '', style }: { name: string, size?: number, color?: string, className?: string, style?: React.CSSProperties }) => {
  // Normalize icon name (e.g., "BrainCircuit" or "brain-circuit")
  const normalizedName = name.charAt(0).toUpperCase() + name.slice(1).replace(/-([a-z])/g, (g) => g[1].toUpperCase());
  const IconComponent = (LucideIcons as any)[normalizedName] || LucideIcons.HelpCircle;
  return <IconComponent size={size} color={color} className={className} style={style} />;
};

// Seletor padrão do app: trilho branco com pílulas, a ativa preenchida de índigo
// (mesmo estilo das abas do Painel Admin). Use em abas e filtros de tela.
const PillTabs = ({ tabs, active, onChange, layoutKey, className = '' }: {
  tabs: { id: string; label: string; icon?: any; badge?: number }[];
  active: string;
  onChange: (id: string) => void;
  layoutKey: string;
  stretch?: boolean;
  className?: string;
}) => (
  <div className={`flex bg-white p-1 rounded-2xl shadow-sm border border-gray-100 gap-1 overflow-x-auto no-scrollbar ${className}`}>
    {tabs.map(t => {
      const is = active === t.id;
      return (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`relative flex-1 min-w-max px-3 py-2 text-xs font-bold rounded-xl transition-colors whitespace-nowrap flex items-center justify-center gap-1.5 ${is ? 'text-white' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          {is && (
            <motion.div
              layoutId={`pill-tabs-${layoutKey}`}
              className="absolute inset-0 bg-indigo-600 rounded-xl shadow-md z-0"
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-1.5">
            {t.icon && <t.icon size={13} />}
            {t.label}
            {typeof t.badge === 'number' && t.badge > 0 && (
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${is ? 'bg-white/25 text-white' : 'bg-indigo-100 text-indigo-600'}`}>{t.badge}</span>
            )}
          </span>
        </button>
      );
    })}
  </div>
);

const PIXABAY_CACHE_KEY = '__pxcache__';
const pixabayCache = {
  get(k: string): string | undefined {
    try { const s = sessionStorage.getItem(PIXABAY_CACHE_KEY); if (!s) return undefined; return JSON.parse(s)[k]; } catch { return undefined; }
  },
  set(k: string, v: string) {
    try { const s = sessionStorage.getItem(PIXABAY_CACHE_KEY); const obj = s ? JSON.parse(s) : {}; obj[k] = v; sessionStorage.setItem(PIXABAY_CACHE_KEY, JSON.stringify(obj)); } catch { /* quota full — ignore */ }
  },
  has(k: string): boolean { return this.get(k) !== undefined; },
};

const getImageUrl = (query: string | undefined, width: number, height: number) => {
  if (!query || query.trim().length === 0) {
    return `https://picsum.photos/${width}/${height}?random=${Math.random()}`;
  }
  const cleanQuery = encodeURIComponent(query.replace(/,/g, ' ').trim());
  return `https://source.unsplash.com/${width}x${height}/?${cleanQuery}`;
};

const fetchPixabayImage = async (query: string | undefined, width: number, height: number): Promise<string> => {
  const fallback = getImageUrl(query, width, height);
  if (!query || query.trim().length === 0) return fallback;

  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) return fallback;

  const cacheKey = `${query.trim().toLowerCase()}|${width}x${height}`;
  if (pixabayCache.has(cacheKey)) return pixabayCache.get(cacheKey)!;

  try {
    const cleanQuery = encodeURIComponent(query.replace(/,/g, ' ').trim());
    const url = `https://pixabay.com/api/?key=${apiKey}&q=${cleanQuery}&image_type=photo&safesearch=true&orientation=horizontal&per_page=20&min_width=${Math.min(width, 1280)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return fallback;
    const data = await res.json();
    if (!data.hits || data.hits.length === 0) return fallback;
    const pool = data.hits.slice(0, 5);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const chosen = pick.largeImageURL || pick.webformatURL || fallback;
    pixabayCache.set(cacheKey, chosen);
    return chosen;
  } catch {
    return fallback;
  }
};

// --- Types ---
type Screen = 'home' | 'planner' | 'chat' | 'calendar' | 'dayDetail' | 'profile' | 'estudio' | 'biblioteca' | 'admin' | 'gamificacao' | 'ferramentas' | 'acervo';
type PlannerMode = 'plan' | 'activities' | 'slides' | 'exam';

interface PresentationTheme {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  fontTitle: string;
  fontBody: string;
}

interface SlideData {
  slideNumber: number;
  layoutID: 'LAYOUT_COVER' | 'LAYOUT_CONTENT_LEFT' | 'LAYOUT_CONTENT_RIGHT' | 'LAYOUT_CONTENT_TOP' | 'LAYOUT_TOPICS' | 'LAYOUT_REFERENCES' | 'LAYOUT_QUOTE' | 'LAYOUT_TWO_COLUMNS' | 'LAYOUT_FULL_IMAGE' | 'LAYOUT_STATS' | 'LAYOUT_TIMELINE';
  data: {
    title?: string;
    subtitle?: string;
    text?: string;
    topics?: { title: string; content: string; icon: string }[];
    references?: string[];
    imagePrompt?: string;
    imageUrl?: string;
    quote?: string;
    author?: string;
    column1?: string;
    column2?: string;
    stats?: { value: string; label: string; icon?: string }[];
    events?: { year: string; title: string; description: string }[];
  };
}

interface PresentationData {
  presentationTitle: string;
  theme: PresentationTheme;
  slides: SlideData[];
}

interface BackgroundTask {
  id: string;
  type: string;
  title: string;
  status: 'processing' | 'completed' | 'error';
  result?: any;
  error?: string;
  startTime: number;
  meta?: Record<string, any>;
}

const STUDIO_TASK_TYPES = ['story', 'quiz', 'wordsearch', 'crossword', 'bingo', 'escape', 'memory', 'sequencia', 'flashcard'] as const;
const isStudioTaskType = (t: string) => (STUDIO_TASK_TYPES as readonly string[]).includes(t);

interface UserProfile {
  name: string;
  subject?: string;
  photo: string;
  schoolName?: string;
  role?: string;
  email?: string;
  isPro?: boolean;
  createdAt?: string;
  generationsUsed?: number;
  onboarded?: boolean;
}

interface ClassSchedule {
  id: string;
  name: string;
  days: number[];                            // 0-6 (Dom-Sáb)
  time: string;                              // Legacy fallback time
  dayTimes?: Record<number, string>;         // dayIndex → 'HH:MM' (horário real por dia)
  numberOfClasses?: number;                  // Legacy global
  periodsPerDay?: Record<number, number[]>;  // Legacy periods
  color?: string;
  level?: string;
  classProfile?: string;
  subject?: string;
  school?: string;
  shift?: string;
}

interface SavedResource {
  id: string;
  type: 'slides' | 'activities' | 'exam' | 'plan';
  title: string;
  date: number;
  content?: string | PresentationData;
  presentationData?: PresentationData;
}

interface LibraryItem {
  id: string;
  title: string;
  type: 'slides' | 'activities' | 'exam' | 'plan';
  subject: string;
  grade: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  fileSizeBytes: number;
  uploadDate: number;
  downloadCount: number;
}

// ── Library constants ──────────────────────────────────────────────────────────
const LIBRARY_LIMIT_BYTES = Math.floor(4.9 * 1024 * 1024 * 1024); // 4.9 GB hard cap
const DOWNLOAD_LIMIT_PER_DAY = 30;                                 // max downloads/user/day
const DOWNLOAD_MB_PER_DAY    = 500;                                // max MB/user/day

// ─────────────────────────────────────────────────────────────────────────────

interface ClassItem {
  id: string;
  title: string;
  date: string;
  status: 'pending' | 'done' | 'completed';
  className: string;
  timestamp: number;
  resourceIds?: string[];
  topic?: string;  // conteúdo da aula (ex: tópicos vindos da ementa importada)
}

// --- Components ---
const FoxIllustration = ({ className, noBackground }: { className?: string, noBackground?: boolean }) => (
  <div className={`relative flex items-center justify-center overflow-hidden ${!noBackground ? 'bg-indigo-50 rounded-3xl border border-indigo-100/50' : ''} ${className}`}>
    {!noBackground && <div className="absolute top-[-10%] right-[-10%] w-1/2 h-1/2 bg-indigo-200/20 rounded-full blur-2xl" />}
    <svg
      viewBox="0 0 36 36"
      className="w-full h-full relative z-10 drop-shadow-sm p-1"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
    >
      <path fill="#553788" d="M10 12c3 5 0 10.692-3 9.692s-4 2-1 3 9.465-.465 13-4c1-1 2-1 2-1L10 12z"/>
      <path fill="#553788" d="M26 12c-3 5 0 10.692 3 9.692s4 2 1 3-9.465-.465-13-4c-1-1-2-1-2-1L26 12z"/>
      <path fill="#744EAA" d="M30.188 16c-3 5 0 10.692 3 9.692s4 2 1 3-9.465-.465-13-4c-1-1-2-1-2-1l11-7.692zM5.812 16c3 5 0 10.692-3 9.692s-4 2-1 3 9.465-.465 13-4c1-1 2-1 2-1L5.812 16z"/>
      <path fill="#9266CC" d="M33.188 31.375c-2.729.91-6.425-5.626-4.812-10.578C30.022 17.554 31 13.94 31 11c0-7.18-5.82-11-13-11S5 3.82 5 11c0 2.94.978 6.554 2.624 9.797 1.613 4.952-2.083 11.488-4.812 10.578-3-1-4 3-1 4s8.31-.627 12-4c2.189-2 4.189-2 4.189-2s2 0 4.188 2c3.69 3.373 9 5 12 4s1.999-5-1.001-4z"/>
      <circle fill="#292F33" cx="14" cy="21" r="2"/>
      <circle fill="#292F33" cx="22" cy="21" r="2"/>
    </svg>
  </div>
);

const BottomNav = ({ activeScreen, setScreen, isAdmin }: { activeScreen: Screen, setScreen: (s: Screen) => void, isAdmin?: boolean }) => {
  const navItems: { id: Screen; icon: any; label: string }[] = [
    { id: 'home', icon: Home, label: 'Início' },
    { id: 'planner', icon: BookOpen, label: 'Planejar' },
    { id: 'chat', icon: MessageSquare, label: 'Assistente' },
    { id: 'calendar', icon: CalendarIcon, label: 'Agenda' },
    { id: 'gamificacao', icon: Trophy, label: 'Turma' },
  ];

  if (isAdmin) {
    navItems.push({ id: 'admin', icon: Shield, label: 'Admin' });
  }

  const [showLabels, setShowLabels] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTabClick = (id: Screen) => {
    setScreen(id);
    setShowLabels(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowLabels(false), 2000);
  };

  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }, []);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[95%] max-w-sm bg-indigo-600 rounded-[2rem] py-3 px-6 flex justify-between items-center shadow-2xl z-50 transition-all duration-300">
      {navItems.map((item) => {
        const showLabel = activeScreen === item.id && showLabels;
        return (
          <button
            key={item.id}
            onClick={() => handleTabClick(item.id)}
            className={`relative p-2 flex flex-col items-center transition-all duration-300 ${showLabel ? 'gap-1' : 'gap-0'} ${activeScreen === item.id ? 'text-white' : 'text-indigo-300 hover:text-indigo-200'}`}
          >
            <item.icon size={22} strokeWidth={activeScreen === item.id ? 2.5 : 2} className={activeScreen === item.id ? '-translate-y-1 transition-transform' : 'transition-transform'} />
            <span className={`text-[9px] font-bold tracking-wider overflow-hidden transition-all duration-300 ${showLabel ? 'opacity-100 max-h-3' : 'opacity-0 max-h-0'}`}>{item.label}</span>
            {activeScreen === item.id && (
              <motion.div
                layoutId="nav-glow"
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-white rounded-full"
              />
            )}
          </button>
        );
      })}
    </div>
  );
};

const Header = ({ title, subtitle, profile, notifications = [], setNotifications, children, bannerImage, bannerPlaceholder, setScreen, rightAction }: { title: string; subtitle: string; profile: UserProfile; notifications?: any[]; setNotifications?: (n: any[]) => void; children?: React.ReactNode; bannerImage?: string | null; bannerPlaceholder?: string; setScreen?: (s: Screen) => void; rightAction?: React.ReactNode }) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState(
    'Notification' in window ? Notification.permission : 'denied'
  );

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission);
      if (permission === 'granted') {
        new Notification('Notificações ativadas!', {
          body: 'Você receberá avisos sobre suas aulas e planejamentos.',
          icon: profile.photo
        });
      }
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
  <div className="mb-3 relative z-50">
    {typeof bannerImage === 'string' ? (
      <div className="absolute -top-12 -left-6 -right-6 h-36 flex flex-col items-center justify-center z-[-1] shadow-sm overflow-hidden bg-transparent">
        <img src={bannerImage} alt="Banner" className="w-full h-full object-cover top-center" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
      </div>
    ) : bannerPlaceholder ? (
      <div className="absolute -top-12 -left-6 -right-6 h-36 z-[-1] border-b-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center">
        <span className="text-gray-300 text-sm font-bold tracking-widest uppercase">{bannerPlaceholder}</span>
      </div>
    ) : null}

    <div className={`flex justify-between items-start ${typeof bannerImage === 'string' || bannerPlaceholder ? 'pt-28' : 'pt-2'}`}>
      <div className="px-2">
        <p className="text-gray-600 text-sm font-bold uppercase tracking-wider mb-1">{subtitle}</p>
        <h1 className="text-2xl font-black text-gray-900">{title}</h1>
      </div>
      <div className="flex gap-3 relative">
        {children}
      {/* Bell with shake animation when unread */}
      <button onClick={() => setShowNotifications(!showNotifications)} className="w-10 h-10 flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-100 relative">
        <motion.div
          animate={unreadCount > 0 ? { rotate: [0, -18, 18, -12, 12, -6, 6, 0] } : { rotate: 0 }}
          transition={{ duration: 0.6, repeat: unreadCount > 0 ? Infinity : 0, repeatDelay: 4 }}
        >
          <Bell size={20} className="text-gray-600" />
        </motion.div>
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse"
            />
          )}
        </AnimatePresence>
      </button>
      {rightAction !== undefined ? rightAction : (
        <button onClick={() => setScreen?.('profile')} className={`w-10 h-10 p-0 rounded-xl shadow-sm border-2 border-indigo-500 overflow-hidden flex items-center justify-center ${profile.photo ? 'bg-gray-200' : 'bg-indigo-600'}`}>
          {profile.photo ? (
            <img src={profile.photo} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          ) : (
            <User size={20} className="text-white" />
          )}
        </button>
      )}

      <AnimatePresence>
        {showNotifications && (() => {
          const relTime = (d: number) => {
            const m = Math.floor((Date.now() - d) / 60000);
            if (m < 1) return 'Agora';
            if (m < 60) return `Há ${m}min`;
            const h = Math.floor(m / 60);
            if (h < 24) return `Há ${h}h`;
            return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
          };
          const iconCfg: Record<string, { icon: React.ReactNode; bg: string; text: string }> = {
            class:          { icon: <BookOpen size={14} />,      bg: 'bg-indigo-100', text: 'text-indigo-600' },
            holiday:        { icon: <Sparkles size={14} />,      bg: 'bg-amber-100',  text: 'text-amber-600' },
            prep:           { icon: <FileText size={14} />,      bg: 'bg-violet-100', text: 'text-violet-600' },
            admin:          { icon: <ClipboardList size={14} />, bg: 'bg-blue-100',   text: 'text-blue-600' },
            commemorative:  { icon: <Trophy size={14} />,        bg: 'bg-pink-100',   text: 'text-pink-600' },
            manual:         { icon: <Sparkles size={14} />,      bg: 'bg-indigo-100', text: 'text-indigo-600' },
          };
          // Only show: unread auto + all manual; hides read autos so "Limpar" truly clears the panel
          const displayNotifs = notifications.filter(n => !(n.auto && n.read));
          return (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute top-12 right-0 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 origin-top-right z-50"
            >
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-gray-900 text-sm">Notificações</h3>
                {unreadCount > 0 && (
                  <span className="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{unreadCount} nova{unreadCount > 1 ? 's' : ''}</span>
                )}
              </div>

              <div className="space-y-2 mb-3 max-h-[55vh] overflow-y-auto no-scrollbar">
                {displayNotifs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mb-3">
                      <Bell size={22} className="text-gray-400" />
                    </div>
                    <p className="text-sm font-bold text-gray-700">Tudo em dia!</p>
                    <p className="text-xs text-gray-400 mt-0.5">Nenhuma notificação no momento.</p>
                  </div>
                ) : (
                  displayNotifs.map(n => {
                    const cfg = iconCfg[n.auto ? (n.icon || 'class') : 'manual'];
                    const dest: Screen = (!n.auto && n.title === 'Material Salvo') ? 'biblioteca' : 'calendar';
                    return (
                      <motion.div
                        key={n.id}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        onClick={() => {
                          if (setScreen) setScreen(dest);
                          if (setNotifications) setNotifications(notifications.map(x => x.id === n.id ? { ...x, read: true } : x));
                          setShowNotifications(false);
                        }}
                        className={`cursor-pointer p-3 rounded-xl flex items-start gap-3 transition-colors ${n.read ? 'bg-gray-50' : 'bg-indigo-50'}`}
                      >
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${cfg.bg} ${cfg.text}`}>
                          {cfg.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-1">
                            <p className={`text-xs font-bold leading-snug ${n.read ? 'text-gray-700' : 'text-gray-900'}`}>{n.title}</p>
                            <span className="text-[9px] text-gray-400 shrink-0 mt-0.5">{relTime(n.date)}</span>
                          </div>
                          <p className={`text-[11px] mt-0.5 leading-snug ${n.read ? 'text-gray-500' : 'text-gray-600'}`}>{n.message}</p>
                        </div>
                        {!n.read && <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full shrink-0 mt-1.5" />}
                      </motion.div>
                    );
                  })
                )}
              </div>

              {(displayNotifs.length > 0 || unreadCount > 0) && setNotifications && (
                <div className="flex gap-2 mb-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={() => setNotifications(notifications.map(n => ({ ...n, read: true })))}
                      className="flex-1 text-[11px] font-bold bg-indigo-50 text-indigo-600 py-2 rounded-xl"
                    >Marcar lidas</button>
                  )}
                  <button
                    onClick={() => setNotifications([])}
                    className="flex-1 text-[11px] font-bold bg-gray-100 text-gray-600 py-2 rounded-xl"
                  >Limpar tudo</button>
                </div>
              )}

              <button
                onClick={requestNotificationPermission}
                disabled={permissionStatus === 'granted'}
                className="w-full text-[11px] font-bold bg-gray-50 text-gray-500 py-2 rounded-xl disabled:opacity-50 flex items-center justify-center gap-1.5 border border-gray-100"
              >
                <Bell size={12} />
                {permissionStatus === 'granted' ? 'Notificações ativas' : 'Ativar notificações do sistema'}
              </button>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
    </div>
  </div>
  );
};

const ReminderItem = ({ cls, setSelectedDate, setScreen, setClasses, classes }: { cls: ClassItem, setSelectedDate: (d: Date) => void, setScreen: (s: Screen) => void, setClasses: (c: ClassItem[]) => void, classes: ClassItem[] }) => {
  const [isMarked, setIsMarked] = useState(false);

  const handleComplete = () => {
    setIsMarked(true);
    setTimeout(() => {
        setClasses(classes.map(c => c.id === cls.id ? {...c, status: 'completed'} : c));
    }, 400);
  };

  return (
    <div className={`w-full bg-white rounded-2xl p-4 border shadow-sm flex items-center gap-2 group transition-colors ${isMarked ? 'border-emerald-200' : 'border-gray-50 hover:border-indigo-100'}`}>
      <GripVertical className="text-gray-300 group-hover:text-indigo-400 cursor-grab" size={20} />
      <button onClick={() => { setSelectedDate(new Date(cls.timestamp)); setScreen('calendar'); }} className="flex items-center gap-4 flex-1 text-left">
        <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0 ${isMarked ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors'}`}>
          <Clock size={16} className="mb-1 opacity-80" />
          <span className="text-sm font-bold">{cls.date.split(' ')[0]}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-base truncate">{cls.className}</h3>
          <p className="text-gray-400 text-sm mt-0.5 truncate">{cls.title}</p>
        </div>
      </button>
      <button 
        onClick={handleComplete}
        className={`p-3 rounded-xl transition-all duration-300 transform active:scale-90 ${isMarked ? 'bg-emerald-500 text-white scale-110' : 'bg-red-50 text-red-500 hover:bg-red-100'}`}
      >
        <CheckCircle2 size={20} />
      </button>
    </div>
  );
};

const EventItem = ({ e, onComplete, color, onPrepare, onReschedule }: { e: any, onComplete: () => void, color: string, onPrepare?: () => void, onReschedule?: () => void }) => {
  const [isMarked, setIsMarked] = useState(false);
  const handleComplete = () => {
    setIsMarked(true);
    setTimeout(onComplete, 400);
  };
  return (
    <div className={`bg-white rounded-2xl p-4 border shadow-sm flex items-center gap-4 group transition-colors ${isMarked ? 'border-emerald-200' : 'border-gray-50'}`}>
       <GripVertical className="text-gray-300 group-hover:text-indigo-400 cursor-grab" size={20} />
       <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center text-white shrink-0 ${isMarked ? 'bg-emerald-500' : ''}`} style={!isMarked ? { backgroundColor: color } : {}}>
        <Clock size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-gray-900 text-base truncate">{e.title}</h3>
        <p className="text-gray-400 text-sm mt-0.5 truncate">{formatEventDate(e.date)} • {e.type === 'class' ? `Aula${e.className ? ` · ${e.className}` : ''}` : e.type === 'prep' ? 'Tempo de Foco' : e.type === 'holiday' ? 'Feriado Nacional' : e.type === 'commemorative' ? 'Data Comemorativa' : 'Prazo Administrativo'}</p>
        {e.type === 'class' && e.topic && (
          <p className="text-gray-500 text-xs mt-1 line-clamp-2">{e.topic}</p>
        )}
        {e.type === 'class' && e.resourceIds?.length > 0 && (
          <p className="text-indigo-500 text-xs mt-1">{e.resourceIds.length} material{e.resourceIds.length !== 1 ? 'is' : ''} vinculado{e.resourceIds.length !== 1 ? 's' : ''}</p>
        )}
        {e.type === 'class' && (onPrepare || onReschedule) && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {onPrepare && (
              <button onClick={onPrepare} className="text-[11px] font-bold bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full border border-indigo-200 active:scale-95 transition-transform">
                Preparar aula
              </button>
            )}
            {onReschedule && (
              <button onClick={onReschedule} className="text-[11px] font-bold bg-amber-50 text-amber-600 px-2.5 py-1 rounded-full border border-amber-200 active:scale-95 transition-transform">
                Adiar
              </button>
            )}
          </div>
        )}
      </div>
      <button
        onClick={handleComplete}
        className={`p-3 rounded-xl transition-all duration-300 transform active:scale-90 ${isMarked ? 'bg-emerald-500 text-white scale-110' : 'bg-red-50 text-red-500 hover:bg-red-100'}`}
      >
        <CheckCircle2 size={20} />
      </button>
    </div>
  );
};

const HomeScreen = ({ setScreen, setPlannerMode, classes, setClasses, profile, profileLoaded, inboxMessages, notifications, setNotifications, setSelectedDate, openFerramenta, schedules }: { setScreen: (s: Screen) => void, setPlannerMode: (m: PlannerMode) => void, classes: ClassItem[], setClasses: (c: ClassItem[]) => void, profile: UserProfile, profileLoaded?: boolean, inboxMessages: {id: string, role: 'user' | 'model', text: string, date: number, attachment?: { mimeType: string, url: string, data: string, name: string }}[], notifications?: any[], setNotifications?: (n: any[]) => void, setSelectedDate: (d: Date) => void, openFerramenta?: (tool: string | null) => void, schedules?: ClassSchedule[] }) => {
  const quickActions: { title: string; illustration?: string; icon?: any; action: () => void }[] = [
    { title: 'Jogos', illustration: 'https://i.ibb.co/5h18j8Lc/20260520-143227-0000.png', action: () => setScreen('estudio') },
    { title: 'Atividades', illustration: 'https://i.ibb.co/hx6b429b/20260416-183802-0002.png', action: () => { setPlannerMode('activities'); setScreen('planner'); } },
    { title: 'Slides', illustration: 'https://i.ibb.co/fYK9t24q/20260416-184831-0000.png', action: () => { setPlannerMode('slides'); setScreen('planner'); } },
    { title: 'Kit IA', illustration: 'https://i.ibb.co/vCp6TFqs/20260416-185756-0000.png', action: () => openFerramenta?.(null) },
    { title: 'Diário', illustration: 'https://i.ibb.co/Y7df80LZ/1781545849687.png', action: () => openFerramenta?.('diario') },
    { title: 'Biblioteca', illustration: 'https://i.ibb.co/GQMXCYWq/Sem-nome-1300-x-1300-px-20260615-160107-0000.png', action: () => setScreen('biblioteca') },
  ];

  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "Bom dia," : currentHour < 18 ? "Boa tarde," : "Boa noite,";
  
  const getDisplayName = (name: string) => {
    if (!name || name.trim() === '') return 'Professor';
    const parts = name.trim().split(' ');
    if (parts[0].toLowerCase().startsWith('prof') && parts.length > 1) {
      return `${parts[0]} ${parts[1]}`;
    }
    return parts[0];
  };
  
  // Enquanto o Firestore não respondeu (profileLoaded false), não renderizamos
  // um nome — evita o flash do placeholder antes do nome real chegar.
  const firstName = getDisplayName(profile?.name || '');
  const headerTitle = profileLoaded === false && !profile?.name ? 'Prof. Corujão' : `${firstName}!`;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title={headerTitle} subtitle={greeting} profile={profile} notifications={notifications} setNotifications={setNotifications} bannerImage="https://i.ibb.co/ymFbKT6r/20260419-204248-0000.png" />
      
      <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-[2rem] p-6 text-white shadow-lg mb-8 relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen size={24} className="text-indigo-200" />
            <h2 className="text-2xl font-bold">Planejador</h2>
          </div>
          <p className="text-indigo-100 text-base mb-6 w-[206px]">Transforme seus conteúdos em aulas, planos, atividades e slides automaticamente.</p>
          <button onClick={() => { setPlannerMode('plan'); setScreen('planner'); }} className="bg-white text-indigo-600 px-6 py-2.5 rounded-full text-base font-bold shadow-sm">
            Planejar Aula
          </button>
        </div>
        <div className="absolute right-0 bottom-0 w-36 h-36 md:w-40 md:h-40 z-0">
          <img src="https://i.ibb.co/Q4fQx6f/20260419-215411-0000.png" alt="Mascote Mágico" className="w-full h-full object-contain" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4 pl-0 pr-[9px] !pt-[12px] pb-0">Ações Rápidas</h2>
        <div className="grid grid-cols-3 gap-4">
          {quickActions.map((action) => (
            <button key={action.title} onClick={action.action} className="flex flex-col items-center gap-3 relative group">
              <div className={`w-16 h-16 rounded-[1.5rem] overflow-hidden shadow-sm bg-white border-[1.5px] border-indigo-600 flex flex-col items-center justify-center relative`}>
                {action.illustration ? (
                  <img src={action.illustration} alt={action.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
                ) : action.icon ? (
                  <action.icon size={26} className="text-indigo-600" strokeWidth={2.2} />
                ) : null}
              </div>
              <span className="text-sm font-medium text-gray-600 text-center leading-tight">{action.title}</span>
            </button>
          ))}
        </div>
      </div>

      {schedules && schedules.length > 0 && (() => {
        const now = Date.now();
        const progressRows = schedules.map(s => {
          const allLessons = classes.filter(c => c.className === s.name);
          const done = allLessons.filter(c => c.status === 'done').length;
          const total = allLessons.length;
          const overdue = allLessons.filter(c => c.status === 'pending' && c.timestamp < now).length;
          return { s, done, total, overdue };
        }).filter(r => r.total > 0);
        if (!progressRows.length) return null;
        return (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Progresso das Turmas</h2>
            <div className="space-y-2">
              {progressRows.map(({ s, done, total, overdue }) => (
                <div key={s.id} className="bg-white rounded-2xl p-4 border border-gray-50 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-bold text-gray-900 text-sm">{s.name}</p>
                    <p className="text-xs text-gray-500">{done}/{total} aulas</p>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                  </div>
                  {overdue > 0 && <p className="text-xs text-amber-600 mt-1.5">{overdue} aula{overdue !== 1 ? 's' : ''} pendente{overdue !== 1 ? 's' : ''} no passado</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900">Lembretes</h2>
          <button onClick={() => setScreen('calendar')} className="text-indigo-600 text-base font-medium">Ver todos</button>
        </div>
        {(() => {
          const todayStart = new Date(); todayStart.setHours(0,0,0,0);
          const tomorrowStart = new Date(todayStart.getTime() + 86400000);

          const upcoming = classes
            .filter(c => c.status === 'pending' && c.timestamp >= todayStart.getTime())
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(0, 5);

          const dayLabel = (ts: number) => {
            const d = new Date(ts); d.setHours(0,0,0,0);
            const t = d.getTime();
            if (t === todayStart.getTime()) return 'Hoje';
            if (t === tomorrowStart.getTime()) return 'Amanhã';
            return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()];
          };

          const palette = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899'];
          const classColor = (name: string) => {
            let h = 0;
            for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
            return palette[Math.abs(h) % palette.length];
          };

          const todayCount = upcoming.filter(c => {
            const d = new Date(c.timestamp); d.setHours(0,0,0,0);
            return d.getTime() === todayStart.getTime();
          }).length;

          const nextClass = upcoming[0];

          const groups: { label: string; items: typeof upcoming }[] = [];
          for (const cls of upcoming) {
            const lbl = dayLabel(cls.timestamp);
            const last = groups[groups.length - 1];
            if (last && last.label === lbl) last.items.push(cls);
            else groups.push({ label: lbl, items: [cls] });
          }

          if (upcoming.length === 0) return (
            <div className="flex flex-col items-center justify-center py-8 text-center bg-gray-50/50 rounded-3xl border border-gray-100 border-dashed">
              <img src="https://i.ibb.co/FbhRcLsz/Sem-nome-1300-x-1300-px-20260616-150714-0000.png" alt="" className="w-32 h-auto object-contain mb-4 rounded-xl opacity-60" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
              <h3 className="text-gray-600 font-bold mb-1">Sem aulas próximas</h3>
              <p className="text-gray-400 text-sm max-w-[200px]">Adicione aulas no cronograma para ver aqui.</p>
            </div>
          );

          let reminderIdx = 0;
          return (
            <div className="space-y-1">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 mb-3 flex items-start gap-3">
                <div className="w-8 h-8 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles size={15} className="text-indigo-500" />
                </div>
                <p className="text-indigo-700 text-sm leading-snug">
                  {todayCount > 0
                    ? `Você tem ${todayCount} aula${todayCount > 1 ? 's' : ''} hoje. Tudo preparado?`
                    : `Próxima aula: ${nextClass.title}${nextClass.className ? ` (${nextClass.className})` : ''} (${dayLabel(nextClass.timestamp)}).`
                  }
                </p>
              </motion.div>
              {groups.map(group => (
                <div key={group.label}>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 mt-3 px-1">{group.label}</p>
                  <div className="space-y-2">
                    {group.items.map(cls => {
                      const delay = 0.1 + reminderIdx++ * 0.07;
                      return (
                      <motion.button
                        key={cls.id}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay, duration: 0.25 }}
                        onClick={() => { setSelectedDate(new Date(cls.timestamp)); setScreen('calendar'); }}
                        className="w-full bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3 active:scale-95 transition-transform"
                      >
                        <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: classColor(cls.className || cls.title) }} />
                        <div className="flex-1 min-w-0 text-left">
                          <h3 className="font-bold text-gray-900 text-sm truncate">{cls.title}</h3>
                          {cls.className && <p className="text-gray-400 text-xs mt-0.5 truncate">{cls.className}</p>}
                        </div>
                        <span className="text-xs font-medium text-gray-400 shrink-0 bg-gray-50 rounded-lg px-2 py-1">{cls.date}</span>
                      </motion.button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </motion.div>
  );
};

const renderBoldText = (text?: string) => {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
};

const AdvancedSettings = ({
  mode, tone, setTone, complexity, setComplexity,
  duration, setDuration, lessonTime, setLessonTime,
  questionCount, setQuestionCount, slideCount, setSlideCount,
  focus, setFocus, groundingContent, setGroundingContent,
  turn, setTurn, questionType, setQuestionType,
  examValue, setExamValue, examDuration, setExamDuration,
}: {
  mode: PlannerMode,
  tone: string, setTone: (v: any) => void,
  complexity: string, setComplexity: (v: any) => void,
  duration: number, setDuration: (v: number) => void,
  lessonTime: number, setLessonTime: (v: number) => void,
  questionCount: number, setQuestionCount: (v: number) => void,
  slideCount: number, setSlideCount: (v: number) => void,
  focus: string, setFocus: (v: any) => void,
  groundingContent: string, setGroundingContent: (v: string) => void,
  turn: string, setTurn: (v: any) => void,
  questionType: string, setQuestionType: (v: any) => void,
  examValue: number, setExamValue: (v: number) => void,
  examDuration: number, setExamDuration: (v: number) => void,
}) => (
  <div className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Linguagem do texto</label>
        <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
          <option value="didactic">Didática</option>
          <option value="formal">Formal</option>
          <option value="technical">Técnica</option>
          <option value="concise">Direta e curta</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Nível da turma</label>
        <select value={complexity} onChange={(e) => setComplexity(e.target.value)} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
          <option value="basic">Iniciante</option>
          <option value="intermediate">Intermediário</option>
          <option value="advanced">Avançado</option>
        </select>
      </div>
      {mode === 'plan' && (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Qtd. de Aulas</label>
            <select value={duration} onChange={(e) => setDuration(parseInt(e.target.value))} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
              <option value={0}>Sugerir automaticamente</option>
              {[1,2,3,4,5,6,8,10].map(n => <option key={n} value={n}>{n} {n === 1 ? 'aula' : 'aulas'}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Duração de cada aula</label>
            <select value={lessonTime} onChange={(e) => setLessonTime(parseInt(e.target.value))} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
              <option value={30}>30 min</option>
              <option value={40}>40 min</option>
              <option value={45}>45 min</option>
              <option value={50}>50 min</option>
              <option value={60}>1 hora</option>
              <option value={90}>1h30</option>
              <option value={120}>2 horas</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Turno</label>
            <select value={turn} onChange={(e) => setTurn(e.target.value as any)} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
              <option value="matutino">Matutino</option>
              <option value="vespertino">Vespertino</option>
              <option value="noturno">Noturno</option>
            </select>
          </div>
        </>
      )}
      {mode === 'activities' && (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade de questões</label>
            <input
              type="number"
              min="1"
              max="30"
              value={Number.isFinite(questionCount) ? questionCount : ''}
              onChange={(e) => setQuestionCount(parseInt(e.target.value))}
              onBlur={() => setQuestionCount(Number.isFinite(questionCount) ? Math.min(30, Math.max(1, questionCount)) : 10)}
              className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de questão</label>
            <select value={questionType} onChange={(e) => setQuestionType(e.target.value as any)} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
              <option value="mista">Mista (variada)</option>
              <option value="multipla_escolha">Só múltipla escolha</option>
              <option value="dissertativa">Só dissertativa</option>
            </select>
          </div>
        </>
      )}
      {mode === 'exam' && (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Valor total da prova</label>
            <select value={examValue} onChange={(e) => setExamValue(parseInt(e.target.value))} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
              {[5,10,20,50,100].map(v => <option key={v} value={v}>{v} pontos</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tempo da prova</label>
            <select value={examDuration} onChange={(e) => setExamDuration(parseInt(e.target.value))} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>1 hora</option>
              <option value={90}>1h30</option>
              <option value={120}>2 horas</option>
              <option value={180}>3 horas</option>
            </select>
          </div>
        </>
      )}
      {mode === 'slides' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade de slides</label>
          <input type="number" min="3" max="50" value={slideCount} onChange={(e) => setSlideCount(parseInt(e.target.value))} className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-sm" />
        </div>
      )}
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">Abordagem do conteúdo</label>
      <select value={focus} onChange={(e) => setFocus(e.target.value)} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
        <option value="balanced">Equilibrada (teoria + prática)</option>
        <option value="practical">Foco em exemplos práticos</option>
        <option value="theoretical">Foco em teoria e conceitos</option>
      </select>
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">Material de apoio <span className="font-normal text-gray-400">(opcional)</span></label>
      <textarea
        value={groundingContent}
        onChange={(e) => setGroundingContent(e.target.value)}
        placeholder="Cole aqui um texto, apostila ou resumo que a IA deve usar como base..."
        className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-sm h-20 resize-none"
      />
    </div>
  </div>
);

const GenerateModal = ({
  show, onClose, onGenerate, mode,
  tone, setTone, complexity, setComplexity,
  duration, setDuration, lessonTime, setLessonTime,
  questionCount, setQuestionCount, slideCount, setSlideCount,
  focus, setFocus, groundingContent, setGroundingContent,
  turn, setTurn, questionType, setQuestionType,
  examValue, setExamValue, examDuration, setExamDuration,
}: {
  show: boolean, onClose: () => void, onGenerate: () => void,
  mode: PlannerMode,
  tone: string, setTone: (v: any) => void,
  complexity: string, setComplexity: (v: any) => void,
  duration: number, setDuration: (v: number) => void,
  lessonTime: number, setLessonTime: (v: number) => void,
  questionCount: number, setQuestionCount: (v: number) => void,
  slideCount: number, setSlideCount: (v: number) => void,
  focus: string, setFocus: (v: any) => void,
  groundingContent: string, setGroundingContent: (v: string) => void,
  turn: string, setTurn: (v: any) => void,
  questionType: string, setQuestionType: (v: any) => void,
  examValue: number, setExamValue: (v: number) => void,
  examDuration: number, setExamDuration: (v: number) => void,
}) => {
  const label = mode === 'plan' ? 'Plano de Aula' : mode === 'activities' ? 'Atividades' : mode === 'exam' ? 'Prova' : 'Slides';
  if (!show) return null;
  return createPortal(
    <div className="fixed inset-0 z-[9999] modal-fade-in">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl flex flex-col max-h-[90vh] modal-slide-up">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-bold text-gray-900">Personalizar {label}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4">
          <AdvancedSettings
            mode={mode} tone={tone} setTone={setTone}
            complexity={complexity} setComplexity={setComplexity}
            duration={duration} setDuration={setDuration}
            lessonTime={lessonTime} setLessonTime={setLessonTime}
            questionCount={questionCount} setQuestionCount={setQuestionCount}
            slideCount={slideCount} setSlideCount={setSlideCount}
            focus={focus} setFocus={setFocus}
            groundingContent={groundingContent} setGroundingContent={setGroundingContent}
            turn={turn} setTurn={setTurn}
            questionType={questionType} setQuestionType={setQuestionType}
            examValue={examValue} setExamValue={setExamValue}
            examDuration={examDuration} setExamDuration={setExamDuration}
          />
        </div>
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 space-y-2">
          <button
            onClick={onGenerate}
            className="w-full bg-indigo-600 text-white rounded-2xl py-4 text-base font-bold flex items-center justify-center gap-2"
          >
            <Sparkles size={18} /> Gerar {label}
          </button>
          <button
            onClick={onGenerate}
            className="w-full text-gray-400 text-sm py-2 font-medium"
          >
            Gerar assim mesmo
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const SLIDE_W = 960;
const SLIDE_H = 540;

// Rich-text syntax:
//   **bold**       → negrito
//   ==text==       → marca-texto (acento)
//   [[keyword]]    → palavra-chave colorida (primária)
//   {IconName}     → ícone Lucide inline (preview) / bullet colorido (PPTX)
//   ## Subtitle    → subtítulo dentro do corpo (linha maior)

// Removes ALL inline markup from a string so it renders cleanly in plain-text
// fields (card/topic/column titles, stat labels) that don't support rich runs.
// Without this, tokens like {Sun} or **bold** leak into the slide as literal text.
const stripInlineMarkup = (s: string): string =>
  (s || '')
    .replace(/\{[A-Za-z0-9]+\}/g, '')              // {IconName} tokens
    .replace(/\(([A-Z][a-zA-Z0-9]+)\)/g, '')       // (PascalCase) icon names
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')           // ***bold italic***
    .replace(/\*\*(.+?)\*\*/g, '$1')               // **bold**
    .replace(/==(.+?)==/g, '$1')                   // ==highlight==
    .replace(/\[\[(.+?)\]\]/g, '$1')               // [[keyword]]
    .replace(/`+/g, '')                            // backticks
    .replace(/^\s*#+\s*/, '')                       // leading # headers
    .replace(/\*+/g, '')                           // stray asterisks
    .replace(/\s{2,}/g, ' ')                        // collapse double spaces
    .trim();

const parseRichHtml = (text: string, primaryColor: string, accentColor: string): string => {
  if (!text) return '';
  const ac = accentColor || '#6366F1';
  const pc = primaryColor || '#4F46E5';
  return text
    // Strip (PascalCase) icon-name placeholders the AI sometimes inserts
    .replace(/\(([A-Z][a-zA-Z0-9]+)\)\s*/g, '')
    // Headers (#, ##, ###) → bold sub-heading
    .replace(/^\s*#{1,6}\s+(.+)$/gm, `<div style="font-size:17px;font-weight:800;color:${pc};margin:10px 0 4px;letter-spacing:-0.3px">$1</div>`)
    // Bullet lines (-, •, or single * + space) → bullet glyph
    .replace(/^\s*(?:[-•]|\*(?!\*))\s+(.+)$/gm, `<div style="padding-left:4px"><span style="color:${ac};font-weight:800">•</span>&nbsp;$1</div>`)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/==(.+?)==/g, `<mark style="background:${ac}44;color:inherit;padding:1px 5px;border-radius:4px;font-weight:600">$1</mark>`)
    .replace(/\[\[(.+?)\]\]/g, `<span style="color:${pc};font-weight:800">$1</span>`)
    .replace(/\{([A-Za-z0-9]+)\}/g, `<span data-icon="$1" style="color:${pc};font-size:0.85em;vertical-align:middle;margin-right:2px">◆</span>`)
    // Remove any leftover stray markers
    .replace(/\*+/g, '')
    .replace(/`+/g, '')
    .replace(/\n/g, '<br/>');
};

// Extended parseMarkdown for pptxgenjs text runs.
//
// Fixes vs old version:
// 1. Strip (IconName) patterns — AI sometimes emits "(CheckCircle) Title"
//    instead of the correct {CheckCircle} inline-icon syntax.
// 2. Line breaks: breakLine:true is applied to the LAST run of each line
//    (never an empty text run — pptxgenjs emits an invalid <a:t></a:t> for
//    text:'' which corrupts the whole .pptx in PowerPoint).
// 3. ==highlight== now uses accent colour (not the `highlight: boolean`
//    pptxgenjs option, which would apply a yellow mark-up regardless of
//    the hex string we were passing).
// 4. Guard ** matches so a lone `*` or empty `****` is treated as plain text.
const parseRichMarkdown = (text: any, baseOpts: any, primaryColor?: string, accentColor?: string): any[] => {
  if (!text) return [];
  const raw = typeof text === 'string' ? text : JSON.stringify(text);
  const pc = (primaryColor || '#4F46E5').replace('#', '');
  const ac = (accentColor || '#6366F1').replace('#', '');
  const baseSize = typeof baseOpts.fontSize === 'number' ? baseOpts.fontSize : 13;

  // Strip (PascalCaseWord) icon-name placeholders the AI sometimes inserts
  const str = raw.replace(/\(([A-Z][a-zA-Z0-9]+)\)\s*/g, '');

  // Remove any stray markdown markers left in a plain-text fragment (malformed
  // bold like "** texto", leftover backticks, lone asterisks/hashes).
  // NOTE: do NOT call .trim() here — the surrounding whitespace between tokens
  // (e.g. the space in "text **bold** more") must be preserved so that pptxgenjs
  // renders "text bold more" (with spaces) instead of "textboldmore".
  const stripStray = (s: string): string =>
    s.replace(/\*+/g, '').replace(/`+/g, '').replace(/^#+\s*/, '');

  // Inline patterns — triple/double asterisk, highlight, primary, icon token
  const INLINE = /(\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|==[^=\n]+==|\[\[[^\]\n]+\]\]|\{[A-Za-z0-9]+\})/g;

  const processLine = (line: string): any[] => {
    const parts = line.split(INLINE);
    const runs: any[] = [];
    parts.forEach(part => {
      if (!part) return;
      if (/^\*\*\*[^*\n]+\*\*\*$/.test(part)) {
        const inner = part.slice(3, -3).trim();
        if (inner) runs.push({ text: inner, options: { ...baseOpts, bold: true, italic: true } });
      } else if (/^\*\*[^*\n]+\*\*$/.test(part)) {
        const inner = part.slice(2, -2).trim();
        if (inner) runs.push({ text: inner, options: { ...baseOpts, bold: true } });
      } else if (/^==[^=\n]+==$/.test(part)) {
        const inner = part.slice(2, -2).trim();
        if (inner) runs.push({ text: inner, options: { ...baseOpts, bold: true, color: ac } });
      } else if (/^\[\[[^\]\n]+\]\]$/.test(part)) {
        const inner = part.slice(2, -2).trim();
        if (inner) runs.push({ text: inner, options: { ...baseOpts, bold: true, color: pc } });
      } else if (/^\{[A-Za-z0-9]+\}$/.test(part)) {
        runs.push({ text: '◆ ', options: { ...baseOpts, bold: true, color: ac } });
      } else {
        const clean = stripStray(part);
        // Keep space-only strings (word separators between markup tokens);
        // skip truly empty strings produced by stripping stray markers.
        if (clean) runs.push({ text: clean, options: { ...baseOpts } });
      }
    });
    return runs;
  };

  const lines = str.split('\n');
  const allRuns: any[] = [];
  lines.forEach((line, idx) => {
    const isLast = idx === lines.length - 1;

    // Markdown header (#, ##, ###) → bold sub-heading in primary colour
    const headerMatch = line.match(/^\s*#{1,6}\s+(.*)$/);
    // Bullet line (-, •, or single * + space) → real bullet glyph
    const bulletMatch = line.match(/^\s*(?:[-•]|\*(?!\*))\s+(.*)$/);

    let lineRuns: any[];
    if (headerMatch) {
      const inner = processLine(headerMatch[1]);
      lineRuns = inner.map(r => ({ ...r, options: { ...r.options, bold: true, color: pc, fontSize: baseSize + 1, paraSpaceBefore: 6 } }));
    } else if (bulletMatch) {
      lineRuns = processLine(bulletMatch[1]);
      if (lineRuns.length) lineRuns.unshift({ text: '•  ', options: { ...baseOpts, bold: true, color: ac } });
    } else {
      lineRuns = processLine(line);
    }

    if (lineRuns.length === 0) {
      // Blank line — a single space keeps the break valid (never text:'')
      allRuns.push({ text: ' ', options: { ...baseOpts, breakLine: !isLast } });
      return;
    }
    if (!isLast) {
      const last = lineRuns[lineRuns.length - 1];
      lineRuns[lineRuns.length - 1] = { ...last, options: { ...last.options, breakLine: true } };
    }
    lineRuns.forEach(r => allRuns.push(r));
  });
  return allRuns.length ? allRuns : [{ text: stripStray(str) || ' ', options: { ...baseOpts } }];
};

// Renders rich text inside SlideCanvas (editable toggle)
const RichBody = ({ value, onChange, style, rows = 6, primaryColor, accentColor }: {
  value: string; onChange: (v: string) => void;
  style?: React.CSSProperties; rows?: number;
  primaryColor: string; accentColor: string;
}) => {
  const [editing, setEditing] = useState(false);
  if (editing) return (
    <textarea
      autoFocus
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      rows={rows}
      style={{ width: '100%', resize: 'none', outline: 'none', border: `2px solid ${primaryColor}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', background: '#fff', ...style }}
    />
  );
  return (
    <div
      onClick={() => setEditing(true)}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(parseRichHtml(value, primaryColor, accentColor) || '<span style="color:#aaa;font-style:italic">Clique para editar...</span>') }}
      style={{ cursor: 'text', fontSize: 14, lineHeight: 1.65, color: '#374151', width: '100%', minHeight: 60, ...style }}
    />
  );
};

// Renders an icon inline inside SlideCanvas body (replaces ◆ placeholder)
const RichBodyWithIcons = ({ value, onChange, style, primaryColor, accentColor }: {
  value: string; onChange: (v: string) => void;
  style?: React.CSSProperties; primaryColor: string; accentColor: string;
}) => {
  const [editing, setEditing] = useState(false);
  if (editing) return (
    <textarea autoFocus value={value} onChange={e => onChange(e.target.value)} onBlur={() => setEditing(false)}
      rows={7} style={{ width: '100%', resize: 'none', outline: 'none', border: `2px solid ${primaryColor}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, lineHeight: 1.65, fontFamily: 'inherit', background: '#fff', ...style }} />
  );
  // Split by icon tokens and render mixed content
  const parts = value.split(/(\{[A-Za-z0-9]+\})/g);
  return (
    <div onClick={() => setEditing(true)} style={{ cursor: 'text', fontSize: 14, lineHeight: 1.7, color: '#374151', width: '100%', ...style }}>
      {parts.map((p, i) => {
        const iconMatch = p.match(/^\{([A-Za-z0-9]+)\}$/);
        if (iconMatch) return <DynamicIcon key={i} name={iconMatch[1]} size={15} color={primaryColor} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />;
        return <span key={i} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(parseRichHtml(p, primaryColor, accentColor)) }} />;
      })}
    </div>
  );
};

const SlideCanvas = ({ slide, theme, onUpdate, schoolName, teacherName }: {
  slide: any; theme: any;
  onUpdate: (d: any) => void;
  schoolName?: string; teacherName?: string;
}) => {
  const isRef = slide.layoutID === 'LAYOUT_REFERENCES';
  const isCover = slide.layoutID === 'LAYOUT_COVER';
  const bg = (isRef || isCover) ? theme.primaryColor : theme.backgroundColor;
  const imgSrc = slide.data.imageUrl || getImageUrl(slide.data.imagePrompt, 1200, 800);

  const FONT_T = '"Segoe UI", system-ui, sans-serif';
  const FONT_B = '"Segoe UI", system-ui, sans-serif';
  const FONT_Q = 'Georgia, serif';
  const INK = '#334155';
  const INK_SOFT = '#64748B';
  const PAD = 52; // margem esquerda consistente (~0.55in)
  const cardShadow = '0 6px 20px rgba(100,116,139,0.18)';

  const titleStyle = { color: isCover || isRef ? '#ffffff' : theme.primaryColor, fontFamily: FONT_T, fontWeight: 800 };

  // Cabeçalho editável: eyebrow (kicker) + título + traço de acento (abaixo do título).
  // Title uses INK (dark slate) on light-bg slides for reliable readability regardless of chosen primary colour.
  const EditableHeader = ({ darkBg = false }: { darkBg?: boolean }) => (
    <div style={{ marginBottom: 14 }}>
      <input value={slide.data.kicker || ''} onChange={e => onUpdate({ kicker: e.target.value })} placeholder="RÓTULO"
        style={{ fontSize: 12, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color: theme.accentColor, background: 'transparent', border: 'none', outline: 'none', width: '100%', display: 'block', marginBottom: 6, fontFamily: FONT_B }} />
      <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
        style={{ ...titleStyle, color: darkBg ? '#fff' : INK, fontSize: 30, lineHeight: 1.18, background: 'transparent', border: 'none', width: '100%', outline: 'none', display: 'block' }} />
      <div style={{ width: 54, height: 4, backgroundColor: theme.accentColor, borderRadius: 2, marginTop: 10 }} />
    </div>
  );

  if (isCover) return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, position: 'relative', display: 'flex', overflow: 'hidden' }}>
      {/* Accent stripe */}
      <div style={{ position: 'absolute', left: 462, top: 0, width: 6, height: SLIDE_H, backgroundColor: theme.accentColor, zIndex: 2 }} />
      {/* Decorative circles */}
      <div style={{ position: 'absolute', left: -30, bottom: -30, width: 160, height: 160, borderRadius: '50%', backgroundColor: theme.accentColor, opacity: 0.25 }} />
      <div style={{ position: 'absolute', left: 320, top: -40, width: 110, height: 110, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.12)' }} />
      {/* Left panel */}
      <div style={{ width: 460, height: SLIDE_H, padding: '44px 48px 38px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', zIndex: 1 }}>
        <div>
          <input value={slide.data.kicker || ''} onChange={e => onUpdate({ kicker: e.target.value })} placeholder="APRESENTAÇÃO"
            style={{ fontSize: 12, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)', background: 'transparent', border: 'none', outline: 'none', width: '100%', display: 'block', marginBottom: 14, fontFamily: FONT_B }} />
          <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
            style={{ ...titleStyle, fontSize: 46, lineHeight: 1.12, background: 'transparent', border: 'none', width: '100%', outline: 'none', color: '#fff', marginBottom: 18, display: 'block' }} />
          <div style={{ width: 54, height: 4, backgroundColor: theme.accentColor, borderRadius: 2, marginBottom: 16 }} />
          <input value={slide.data.subtitle || ''} onChange={e => onUpdate({ subtitle: e.target.value })} placeholder="Subtítulo"
            style={{ fontSize: 16, color: 'rgba(255,255,255,0.88)', background: 'transparent', border: 'none', width: '100%', outline: 'none', fontWeight: 500, display: 'block', fontFamily: FONT_B }} />
        </div>
        <div style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600, fontSize: 13, fontFamily: FONT_B }}>
          {teacherName ? `Prof. ${teacherName}` : ''}{teacherName && schoolName ? '  ·  ' : ''}{schoolName || ''}
        </div>
      </div>
      {/* Right panel image — full bleed, no padding/border */}
      <div style={{ flex: 1, height: SLIDE_H, overflow: 'hidden' }}>
        <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
      </div>
    </div>
  );

  if (slide.layoutID === 'LAYOUT_CONTENT_LEFT' || slide.layoutID === 'LAYOUT_CONTENT_RIGHT') {
    const isLeft = slide.layoutID === 'LAYOUT_CONTENT_LEFT';
    const textPanel = (
      <div style={{ flex: 1, padding: `40px ${PAD}px 40px`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
        <EditableHeader />
        <RichBodyWithIcons value={slide.data.text || ''} onChange={v => onUpdate({ text: v })}
          primaryColor={theme.primaryColor} accentColor={theme.accentColor} style={{ flex: 1 }} />
      </div>
    );
    const imgPanel = (
      <div style={{ width: 384, height: SLIDE_H, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
        {/* brand tint for unity */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: theme.primaryColor, opacity: 0.22 }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, [isLeft ? 'left' : 'right']: 0, width: 6, backgroundColor: theme.accentColor }} />
      </div>
    );
    return (
      <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: isLeft ? 'row' : 'row-reverse', overflow: 'hidden' }}>
        {textPanel}{imgPanel}
      </div>
    );
  }

  if (slide.layoutID === 'LAYOUT_CONTENT_TOP') return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: `34px ${PAD}px 12px`, flexShrink: 0 }}>
        <EditableHeader />
        <RichBodyWithIcons value={slide.data.text || ''} onChange={v => onUpdate({ text: v })}
          primaryColor={theme.primaryColor} accentColor={theme.accentColor} style={{ minHeight: 60 }} />
      </div>
      <div style={{ flex: 1, margin: `4px ${PAD}px 30px`, borderRadius: 14, overflow: 'hidden', boxShadow: cardShadow }}>
        <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
      </div>
    </div>
  );

  if (slide.layoutID === 'LAYOUT_TOPICS') return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', padding: `34px ${PAD}px 32px`, overflow: 'hidden' }}>
      <EditableHeader />
      <div style={{ display: 'flex', gap: 22, flex: 1, marginTop: 6 }}>
        {slide.data.topics?.slice(0, 3).map((t: any, i: number) => (
          <div key={i} style={{ flex: 1, background: '#fff', borderRadius: 16, padding: '24px 16px 18px', border: '1px solid #eef2f7', boxShadow: cardShadow, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', backgroundColor: theme.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, flexShrink: 0 }}>
              <DynamicIcon name={t.icon || 'Sparkles'} size={26} color="white" />
            </div>
            <input value={t.title || ''} onChange={e => onUpdate({ topics: slide.data.topics.map((t2: any, j: number) => j === i ? { ...t2, title: e.target.value } : t2) })} placeholder="Tópico"
              style={{ fontSize: 15, fontWeight: 800, color: theme.primaryColor, background: 'transparent', border: 'none', width: '100%', outline: 'none', textAlign: 'center', marginBottom: 8, fontFamily: FONT_T }} />
            <RichBody value={t.content || ''} onChange={v => onUpdate({ topics: slide.data.topics.map((t2: any, j: number) => j === i ? { ...t2, content: v } : t2) })}
              primaryColor={theme.primaryColor} accentColor={theme.accentColor} rows={4}
              style={{ fontSize: 12.5, color: INK_SOFT, lineHeight: 1.55, flex: 1, textAlign: 'center', minHeight: 40 }} />
          </div>
        ))}
      </div>
    </div>
  );

  if (isRef) return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', padding: `48px ${PAD}px`, overflow: 'hidden', position: 'relative' }}>
      <div style={{ width: 8, height: SLIDE_H, backgroundColor: theme.accentColor, position: 'absolute', left: 0, top: 0 }} />
      <div style={{ position: 'absolute', right: -60, bottom: -60, width: 300, height: 300, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <div style={{ position: 'absolute', right: 40, top: -50, width: 130, height: 130, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.05)' }} />
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 8, fontFamily: FONT_B }}>Referências</div>
      <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Para saber mais"
        style={{ fontSize: 34, fontWeight: 800, color: '#fff', background: 'transparent', border: 'none', width: '100%', outline: 'none', display: 'block', fontFamily: FONT_T }} />
      <div style={{ width: 54, height: 4, backgroundColor: theme.accentColor, borderRadius: 2, margin: '12px 0 22px' }} />
      <textarea value={slide.data.references?.join('\n') || ''} onChange={e => onUpdate({ references: e.target.value.split('\n') })} placeholder="Uma referência por linha"
        style={{ fontSize: 15, color: 'rgba(255,255,255,0.9)', lineHeight: 1.8, background: 'transparent', border: 'none', width: '100%', flex: 1, outline: 'none', resize: 'none', fontFamily: FONT_B }} />
    </div>
  );

  if (slide.layoutID === 'LAYOUT_QUOTE') return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 100px', position: 'relative', overflow: 'hidden' }}>
      {/* Giant decorative quote marks */}
      <div style={{ position: 'absolute', top: 10, left: 40, fontSize: 220, lineHeight: 1, color: theme.primaryColor, opacity: 0.1, fontFamily: FONT_Q, fontWeight: 900, userSelect: 'none' }}>"</div>
      <div style={{ position: 'absolute', bottom: -40, right: 40, fontSize: 220, lineHeight: 1, color: theme.primaryColor, opacity: 0.1, fontFamily: FONT_Q, fontWeight: 900, userSelect: 'none', transform: 'rotate(180deg)' }}>"</div>
      {slide.data.title !== undefined && (
        <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="RÓTULO"
          style={{ fontSize: 12, color: theme.accentColor, textAlign: 'center', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 3, background: 'transparent', border: 'none', outline: 'none', width: '60%', marginBottom: 18, fontFamily: FONT_B }} />
      )}
      <div style={{ width: 56, height: 4, backgroundColor: theme.accentColor, borderRadius: 3, marginBottom: 26 }} />
      <textarea value={slide.data.quote || ''} onChange={e => onUpdate({ quote: e.target.value })} placeholder="Citação impactante..."
        style={{ fontSize: 28, fontStyle: 'italic', color: theme.primaryColor, textAlign: 'center', lineHeight: 1.5, background: 'transparent', border: 'none', outline: 'none', width: '100%', resize: 'none', fontFamily: FONT_Q, fontWeight: 600, marginBottom: 22, overflow: 'hidden' }}
        rows={4} />
      <div style={{ width: 56, height: 2, backgroundColor: theme.accentColor, borderRadius: 3, marginBottom: 16 }} />
      <input value={slide.data.author || ''} onChange={e => onUpdate({ author: e.target.value })} placeholder="— Autor"
        style={{ fontSize: 16, color: INK_SOFT, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none', fontWeight: 700, letterSpacing: 1, fontFamily: FONT_B }} />
    </div>
  );

  if (slide.layoutID === 'LAYOUT_TWO_COLUMNS') return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: `32px ${PAD}px 14px`, flexShrink: 0 }}>
        <EditableHeader />
      </div>
      <div style={{ display: 'flex', flex: 1, gap: 20, padding: `0 ${PAD}px 30px` }}>
        {[{ key: 'column1', num: '1', c: theme.primaryColor }, { key: 'column2', num: '2', c: theme.accentColor }].map(col => {
          // Extract first line as column title (mirrors PPTX export logic)
          const rawVal = (slide.data[col.key] || '') as string;
          const firstBreak = rawVal.search(/\n/);
          const colTitle = stripInlineMarkup(firstBreak > 0 ? rawVal.slice(0, firstBreak) : rawVal);
          const colBody = firstBreak > 0 ? rawVal.slice(firstBreak + 1).trim() : '';
          return (
            <div key={col.key} style={{ flex: 1, background: '#fff', borderRadius: 16, border: '1px solid #eef2f7', boxShadow: cardShadow, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Accent top stripe */}
              <div style={{ height: 5, backgroundColor: col.c, flexShrink: 0 }} />
              <div style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Column title */}
                {colTitle && (
                  <div style={{ fontSize: 15, fontWeight: 800, color: col.c, fontFamily: FONT_T, marginBottom: 10, lineHeight: 1.3 }}>{colTitle}</div>
                )}
                {/* Column body */}
                <RichBodyWithIcons
                  value={colBody || rawVal}
                  onChange={v => onUpdate({ [col.key]: colTitle ? `${colTitle}\n${v}` : v })}
                  primaryColor={theme.primaryColor} accentColor={theme.accentColor}
                  style={{ flex: 1, fontSize: 13 }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (slide.layoutID === 'LAYOUT_FULL_IMAGE') {
    const imgSrcFull = slide.data.imageUrl || getImageUrl(slide.data.imagePrompt, 1200, 800);
    return (
      <div style={{ width: SLIDE_W, height: SLIDE_H, position: 'relative', overflow: 'hidden', backgroundColor: '#111' }}>
        <img src={imgSrcFull} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
        {/* Dark gradient overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.1) 100%)' }} />
        {/* Accent left bar */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 7, height: '100%', backgroundColor: theme.accentColor }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: `0 ${PAD}px 44px` }}>
          <input value={slide.data.kicker || ''} onChange={e => onUpdate({ kicker: e.target.value })} placeholder="RÓTULO"
            style={{ fontSize: 12, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color: '#fff', background: 'transparent', border: 'none', outline: 'none', width: '100%', display: 'block', marginBottom: 10, textShadow: '0 1px 6px rgba(0,0,0,0.6)', fontFamily: FONT_B }} />
          <div style={{ width: 48, height: 4, backgroundColor: theme.accentColor, borderRadius: 2, marginBottom: 14 }} />
          <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
            style={{ fontSize: 44, fontWeight: 900, color: '#ffffff', background: 'transparent', border: 'none', outline: 'none', width: '100%', display: 'block', lineHeight: 1.15, marginBottom: 12, textShadow: '0 2px 12px rgba(0,0,0,0.5)', fontFamily: FONT_T }} />
          <input value={slide.data.subtitle || ''} onChange={e => onUpdate({ subtitle: e.target.value })} placeholder="Subtítulo"
            style={{ fontSize: 17, color: 'rgba(255,255,255,0.88)', background: 'transparent', border: 'none', outline: 'none', fontWeight: 500, letterSpacing: 0.5, fontFamily: FONT_B, textShadow: '0 1px 6px rgba(0,0,0,0.5)' }} />
        </div>
      </div>
    );
  }

  if (slide.layoutID === 'LAYOUT_STATS') return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: `32px ${PAD}px 14px`, flexShrink: 0 }}>
        <EditableHeader />
      </div>
      <div style={{ display: 'flex', gap: 22, flex: 1, padding: `0 ${PAD}px 32px`, alignItems: 'stretch' }}>
        {(slide.data.stats || [{ value: '', label: '' }, { value: '', label: '' }, { value: '', label: '' }]).slice(0, 4).map((s: any, i: number) => {
          const isDark = i % 2 === 0;
          const pctMatch = String(s.value || '').match(/(\d{1,3})\s*%/);
          const pct = pctMatch ? Math.max(0, Math.min(100, parseInt(pctMatch[1], 10))) : null;
          return (
            <div key={i} style={{ flex: 1, background: isDark ? theme.primaryColor : '#fff', borderRadius: 16, padding: '22px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', border: isDark ? 'none' : '1px solid #eef2f7', boxShadow: cardShadow }}>
              <div style={{ width: 50, height: 50, borderRadius: '50%', backgroundColor: isDark ? theme.accentColor : theme.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, flexShrink: 0 }}>
                <DynamicIcon name={s.icon || 'BarChart2'} size={24} color="#fff" />
              </div>
              <input value={s.value || ''} onChange={e => onUpdate({ stats: (slide.data.stats || []).map((s2: any, j: number) => j === i ? { ...s2, value: e.target.value } : s2) })} placeholder="00"
                style={{ fontSize: 36, fontWeight: 900, color: isDark ? '#fff' : theme.primaryColor, background: 'transparent', border: 'none', outline: 'none', textAlign: 'center', width: '100%', lineHeight: 1.05, fontFamily: FONT_T }} />
              {pct !== null && (
                <div style={{ width: '78%', height: 7, borderRadius: 4, marginTop: 10, backgroundColor: isDark ? 'rgba(255,255,255,0.25)' : '#e2e8f0', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, backgroundColor: theme.accentColor }} />
                </div>
              )}
              <input value={s.label || ''} onChange={e => onUpdate({ stats: (slide.data.stats || []).map((s2: any, j: number) => j === i ? { ...s2, label: e.target.value } : s2) })} placeholder="Rótulo"
                style={{ fontSize: 12.5, color: isDark ? 'rgba(255,255,255,0.85)' : INK_SOFT, background: 'transparent', border: 'none', outline: 'none', textAlign: 'center', width: '100%', marginTop: 10, fontWeight: 600, fontFamily: FONT_B }} />
            </div>
          );
        })}
      </div>
    </div>
  );

  if (slide.layoutID === 'LAYOUT_TIMELINE') {
    const events = slide.data.events || [];
    return (
      <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: `32px ${PAD}px 8px`, flexShrink: 0 }}>
          <EditableHeader />
        </div>
        {/* Timeline line */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: `0 ${PAD}px 32px` }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 0 }}>
            {/* Horizontal line */}
            <div style={{ position: 'absolute', top: 20, left: 20, right: 20, height: 3, backgroundColor: `${theme.accentColor}55`, zIndex: 0 }} />
            {events.slice(0, 5).map((ev: any, i: number) => {
              const cols = Math.min(events.length, 5);
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>
                  {/* Dot */}
                  <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: i % 2 === 0 ? theme.primaryColor : theme.accentColor, border: `4px solid ${bg}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', marginBottom: 14 }}>
                    <span style={{ fontSize: 12, color: '#fff', fontWeight: 800, fontFamily: FONT_T }}>{i + 1}</span>
                  </div>
                  <div style={{ textAlign: 'center', padding: '0 6px', width: `${100 / cols}%` }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: theme.primaryColor, marginBottom: 4, fontFamily: FONT_T }}>{ev.year || '____'}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 4, lineHeight: 1.3, fontFamily: FONT_T }}>{ev.title || 'Evento'}</div>
                    <div style={{ fontSize: 11, color: INK_SOFT, lineHeight: 1.4, fontFamily: FONT_B }}>{ev.description || ''}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

const SlidePreviewList = ({
  presentationData, setPresentationData, profile,
  isExporting, regenLoading, setRegenLoading, setError,
  exportPPTX,
  schedules, classes, setClasses, topic, selectedClassId
}: {
  presentationData: PresentationData;
  setPresentationData: (d: PresentationData | null) => void;
  profile: UserProfile;
  isExporting: boolean;
  regenLoading: boolean;
  setRegenLoading: (v: boolean) => void;
  setError: (e: string) => void;
  exportPPTX: () => void;
  schedules: ClassSchedule[];
  classes: ClassItem[];
  setClasses: (c: ClassItem[]) => void;
  topic: string;
  selectedClassId: string;
}) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [regenState, setRegenState] = useState<{ idx: number; prompt: string } | null>(null);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / SLIDE_W);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const updateSlide = (idx: number, newData: any) => {
    setPresentationData({
      ...presentationData,
      slides: presentationData.slides.map((s, i) => i === idx ? { ...s, data: { ...s.data, ...newData } } : s)
    });
  };

  const handleRegenerateSlide = async (idx: number, newPrompt: string) => {
    if (!newPrompt) return;
    setRegenLoading(true);
    try {
      const targetSlide = presentationData.slides[idx];
      const prompt = `Regenere o slide ${idx + 1} da apresentação sobre "${presentationData.presentationTitle}".
Layout atual: ${targetSlide.layoutID}. Nova instrução: ${newPrompt}.
Mantenha o estilo: ${JSON.stringify(presentationData.theme)}.
SAÍDA: JSON estrito apenas com os dados: { "title": "...", "text": "...", "illustrationQuery": "..." }`;
      const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt });
      const newData = JSON.parse(response.text || '{}');
      const newImgUrl = newData.illustrationQuery ? await fetchPixabayImage(newData.illustrationQuery, 1200, 800) : targetSlide.data.imageUrl;
      updateSlide(idx, { title: newData.title || targetSlide.data.title, text: newData.text || targetSlide.data.text, imagePrompt: newData.illustrationQuery || targetSlide.data.imagePrompt, imageUrl: newImgUrl });
    } catch (err) {
      setError('Erro ao regenerar slide. Tente novamente.');
      setTimeout(() => setError(''), 5000);
    } finally {
      setRegenLoading(false);
    }
  };

  return (
    <div className="mb-8 border-t border-gray-100 pt-6">
      <h3 className="text-lg font-bold text-gray-900 mb-4">{presentationData.presentationTitle}</h3>
      {/* Measure the available width via this invisible full-width div */}
      <div ref={outerRef} className="w-full" style={{ height: 0 }} />
      <div className="flex flex-col gap-6 pb-4">
        {presentationData.slides.map((slide, idx) => (
          <div key={idx} className="group relative">
            {/* Outer: sets the displayed size using aspect-ratio + scale */}
            <div
              className="w-full rounded-2xl shadow-lg overflow-hidden border border-gray-200"
              style={{ height: Math.round(SLIDE_H * scale) }}
            >
              <div style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <SlideCanvas
                  slide={slide}
                  theme={presentationData.theme}
                  onUpdate={(d) => updateSlide(idx, d)}
                  schoolName={profile.schoolName}
                  teacherName={profile.name}
                />
              </div>
            </div>
            {/* Controls overlay (above the scaled content) */}
            <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 backdrop-blur p-2 rounded-xl shadow-lg flex gap-2 items-center">
              <span className="text-[10px] font-bold text-gray-400 px-1">{idx + 1}</span>
              {regenState?.idx === idx ? (
                <>
                  <input autoFocus placeholder="Nova instrução..." value={regenState.prompt}
                    onChange={e => setRegenState({ idx, prompt: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') { handleRegenerateSlide(idx, regenState.prompt); setRegenState(null); } if (e.key === 'Escape') setRegenState(null); }}
                    className="text-xs w-40 p-1.5 border rounded-lg focus:outline-none" />
                  <button onClick={() => { handleRegenerateSlide(idx, regenState.prompt); setRegenState(null); }} disabled={regenLoading}
                    className="text-xs bg-emerald-600 text-white px-2 py-1.5 rounded-lg font-bold disabled:opacity-60 flex items-center gap-1">
                    {regenLoading ? <Loader2 size={11} className="animate-spin" /> : null}OK
                  </button>
                  <button onClick={() => setRegenState(null)} className="text-xs bg-gray-200 text-gray-700 px-2 py-1.5 rounded-lg font-bold">✕</button>
                </>
              ) : (
                <button onClick={() => setRegenState({ idx, prompt: '' })} className="text-xs bg-emerald-600 text-white px-2 py-1.5 rounded-lg font-bold">Regerar</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <button onClick={exportPPTX} disabled={isExporting}
          className="w-full bg-indigo-600 text-white rounded-2xl py-4 text-sm font-bold flex items-center justify-center gap-2 shadow-md disabled:opacity-50 transition-opacity">
          {isExporting ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
          {isExporting ? 'Gerando...' : 'Baixar PPTX'}
        </button>
      </div>
    </div>
  );
};

// ─── Professional document HTML builder ──────────────────────────────────────
const buildDocx = async (
  rawMd: string,
  docType: 'plan' | 'exam' | 'activities',
  opts: { school?: string; teacher?: string; subject?: string; topic?: string; className?: string; duration?: number; lessonTime?: number; turn?: string; examValue?: number; examDuration?: number }
): Promise<Blob> => {
  const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ShadingType, PageOrientation, Footer } = await import('docx');
  const SEP = '\n---GABARITO---\n';
  const sepIdx = rawMd.indexOf(SEP);
  const mainMd = sepIdx >= 0 ? rawMd.slice(0, sepIdx) : rawMd;
  const gabMd  = sepIdx >= 0 ? rawMd.slice(sepIdx + SEP.length) : '';

  // Cor única da marca (indigo) para todos os tipos de documento
  const ac = '4338CA';
  const dk = '312E81';

  const parseInline = (text: string) => {
    const runs: InstanceType<typeof TextRun>[] = [];
    const rx = /(\*\*[^*]+?\*\*|\*[^*]+?\*)/g;
    let last = 0; let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), size: 22 }));
      const t = m[0];
      if (t.startsWith('**')) runs.push(new TextRun({ text: t.slice(2, -2), bold: true, size: 22 }));
      else runs.push(new TextRun({ text: t.slice(1, -1), italics: true, size: 22 }));
      last = m.index + t.length;
    }
    if (last < text.length) runs.push(new TextRun({ text: text.slice(last), size: 22 }));
    return runs.length ? runs : [new TextRun({ text: '', size: 22 })];
  };

  const hr = () => new Paragraph({
    children: [new TextRun('')],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } },
    spacing: { before: 40, after: 40 },
  });

  const infoLine = (text: string) => new Paragraph({
    children: [new TextRun({ text, size: 20, color: '333333' })],
    spacing: { before: 30, after: 30 },
  });

  const mdParas = (md: string) =>
    md.split('\n').map(line => {
      if (!line.trim()) return new Paragraph({ children: [new TextRun('')], spacing: { after: 60 } });
      if (line.startsWith('### '))
        return new Paragraph({ children: [new TextRun({ text: line.slice(4), bold: true, color: dk, size: 22 })], spacing: { before: 120, after: 60 } });
      if (line.startsWith('## '))
        return new Paragraph({ children: [new TextRun({ text: line.slice(3), bold: true, color: dk, size: 22 })], spacing: { before: 160, after: 80 } });
      if (line.startsWith('- ') || line.startsWith('* '))
        return new Paragraph({ children: [new TextRun({ text: '• ', size: 22 }), ...parseInline(line.slice(2))], indent: { left: 360 }, spacing: { after: 40 } });
      if (/^\d+\. /.test(line)) {
        const num = line.match(/^(\d+)\./)?.[1] || '1';
        return new Paragraph({ children: [new TextRun({ text: `${num}. `, size: 22 }), ...parseInline(line.replace(/^\d+\. /, ''))], indent: { left: 360 }, spacing: { after: 40 } });
      }
      return new Paragraph({ children: parseInline(line), spacing: { after: 60 } });
    });

  const docChildren: InstanceType<typeof Paragraph>[] = [];

  if (docType === 'plan') {
    const secs: Record<string, string> = {};
    mainMd.split(/\n(?=## )/).forEach(part => {
      const m = part.match(/^## (.+?)\n([\s\S]*)/);
      if (m) secs[m[1].trim().toUpperCase()] = m[2].trim();
    });
    const get = (...keys: string[]): string => {
      for (const k of keys) {
        const u = k.toUpperCase();
        const found = Object.keys(secs).find(s => s === u || s.replace(/[^A-Z]/g, '').includes(u.replace(/[^A-Z]/g, '')) || u.replace(/[^A-Z]/g, '').includes(s.replace(/[^A-Z]/g, '')));
        if (found && secs[found]) return secs[found];
      }
      return '';
    };

    const turnoStr = opts.turn ? opts.turn.charAt(0).toUpperCase() + opts.turn.slice(1) : '____________';

    // Header info block
    docChildren.push(infoLine(`ESCOLA: ${opts.school || '____________'}`));
    docChildren.push(infoLine(`ÁREA DE CONHECIMENTO: ${get('ÁREA DE CONHECIMENTO', 'AREA DE CONHECIMENTO')}`));
    docChildren.push(infoLine(`EIXO/UNIDADE TEMÁTICA: ${get('EIXO/UNIDADE TEMÁTICA', 'EIXO', 'UNIDADE TEMÁTICA')}   |   ANO/SÉRIE: ${opts.className || '____________'}   |   TURNO: ${turnoStr}`));
    docChildren.push(infoLine(`COMPONENTE CURRICULAR: ${opts.subject || '____________'}`));
    docChildren.push(infoLine(`QUANTIDADE DE AULAS: ${opts.duration ?? '___'}   |   DURAÇÃO: ${opts.lessonTime ? opts.lessonTime + ' min por aula' : '____________'}`));
    docChildren.push(infoLine(`PROFESSOR(A): ${opts.teacher || '____________'}`));
    docChildren.push(hr());

    // Title
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: 'PLANO DE AULA', bold: true, size: 28, color: dk })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 160 },
    }));

    // Content sections
    const secDefs = [
      { label: 'CONTEÚDO', keys: ['CONTEÚDO', 'CONTEUDO'] },
      { label: 'OBJETIVOS', keys: ['OBJETIVOS'] },
      { label: 'PERGUNTAS MOBILIZADORAS DE APRENDIZAGEM', keys: ['PERGUNTAS MOBILIZADORAS DE APRENDIZAGEM', 'PERGUNTAS MOBILIZADORAS', 'PERGUNTAS'] },
      { label: 'METODOLOGIA', keys: ['METODOLOGIA'] },
      { label: 'HABILIDADE (BNCC)', keys: ['HABILIDADE (BNCC)', 'HABILIDADE BNCC', 'HABILIDADES BNCC', 'HABILIDADE'] },
      { label: 'RECURSOS DIDÁTICOS', keys: ['RECURSOS DIDÁTICOS', 'RECURSOS DIDATICOS', 'RECURSOS'] },
      { label: 'AVALIAÇÃO', keys: ['AVALIAÇÃO', 'AVALIACAO'] },
      { label: 'REFERÊNCIAS', keys: ['REFERÊNCIAS', 'REFERENCIAS'] },
    ];

    const sectionBox = {
      top: { style: BorderStyle.SINGLE, size: 4, color: ac },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: ac },
      left: { style: BorderStyle.SINGLE, size: 4, color: ac },
      right: { style: BorderStyle.SINGLE, size: 4, color: ac },
    };
    for (const { label, keys } of secDefs) {
      const content = get(...keys);
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: label, bold: true, size: 22, color: dk })],
        border: sectionBox,
        spacing: { before: 140, after: 60 },
        indent: { left: 80, right: 80 },
      }));
      docChildren.push(...mdParas(content));
      docChildren.push(hr());
    }

  } else {
    const isExam = docType === 'exam';
    const typeLabel = isExam ? 'AVALIAÇÃO' : 'ATIVIDADE';

    // Header info
    docChildren.push(infoLine(`ESCOLA: ${opts.school || '____________'}   |   PROFESSOR(A): ${opts.teacher || '____________'}   |   DISCIPLINA: ${opts.subject || '____________'}`));
    docChildren.push(infoLine(`TURMA: ${opts.className || '____________'}   |   DATA: ___/___/______   |   ${isExam ? 'NOTA: _______' : 'ENTREGA: ____________'}`));
    if (isExam && (opts.examValue || opts.examDuration)) {
      const durStr = opts.examDuration
        ? (opts.examDuration < 60 ? `${opts.examDuration} min` : `${Math.floor(opts.examDuration / 60)}h${opts.examDuration % 60 ? `${opts.examDuration % 60}min` : ''}`)
        : '____________';
      docChildren.push(infoLine(`VALOR: ${opts.examValue ?? '____'} pontos   |   DURAÇÃO: ${durStr}`));
    }
    docChildren.push(hr());

    // Student name underline
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: 'NOME DO(A) ALUNO(A): ', bold: true, size: 22 })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '555555' } },
      spacing: { before: 80, after: 200 },
    }));

    // Centered document title
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: `${typeLabel}: ${opts.topic || ''}`, bold: true, size: 28, color: ac })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 200 },
    }));

    const skipLine = (line: string) =>
      /^# /.test(line) ||
      /^\*\*(Escola|Professor|Turma|Nome do|Disciplina):/i.test(line.trim()) ||
      /^---$/.test(line.trim());

    for (const line of mainMd.split('\n')) {
      if (skipLine(line)) continue;

      if (!line.trim()) {
        docChildren.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 40 } }));
        continue;
      }

      if (line.startsWith('## ')) {
        docChildren.push(new Paragraph({
          children: [new TextRun({ text: line.slice(3), bold: true, color: dk, size: 24 })],
          border: {
            top: { style: BorderStyle.SINGLE, size: 4, color: ac },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: ac },
            left: { style: BorderStyle.SINGLE, size: 4, color: ac },
            right: { style: BorderStyle.SINGLE, size: 4, color: ac },
          },
          spacing: { before: 200, after: 100 },
          indent: { left: 80, right: 80 },
        }));
        continue;
      }

      if (/^_{10,}$/.test(line.trim())) {
        docChildren.push(new Paragraph({
          children: [new TextRun('')],
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' } },
          spacing: { before: 40, after: 180 },
        }));
        continue;
      }

      if (/^\( \) [A-D]\)/.test(line.trim())) {
        docChildren.push(new Paragraph({
          children: [new TextRun({ text: '○  ', size: 22 }), ...parseInline(line.replace(/^\( \)/, '').trim())],
          indent: { left: 480 },
          spacing: { after: 40 },
        }));
        continue;
      }

      if (/^\*[^*].*[^*]\*$/.test(line.trim())) {
        docChildren.push(new Paragraph({
          children: [new TextRun({ text: line.trim().slice(1, -1), italics: true, size: 22 })],
          alignment: AlignmentType.RIGHT,
          spacing: { before: 80, after: 80 },
        }));
        continue;
      }

      docChildren.push(new Paragraph({
        children: parseInline(line),
        spacing: { after: 60 },
      }));
    }

    if (gabMd) {
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: 'GABARITO', bold: true, size: 28, color: 'FFFFFF' })],
        shading: { fill: dk, type: ShadingType.CLEAR, color: 'auto' },
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 160 },
        pageBreakBefore: true,
      }));
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: `${typeLabel}: ${opts.topic || ''}`, bold: true, size: 24, color: ac })],
        spacing: { after: 160 },
      }));
      for (const line of gabMd.replace(/^## Gabarito[^\n]*\n?/, '').split('\n')) {
        if (!line.trim()) {
          docChildren.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 40 } }));
          continue;
        }
        docChildren.push(new Paragraph({ children: parseInline(line), spacing: { after: 80 } }));
      }
    }
  }

  const brandFooter = new Footer({
    children: [new Paragraph({
      children: [new TextRun({ text: 'Prof. Corujão', size: 16, color: 'BBBBBB', italics: true })],
      alignment: AlignmentType.RIGHT,
    })],
  });

  const wordDoc = new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }, margin: { top: 1134, bottom: 1417, left: 1417, right: 1417 } } },
      footers: { default: brandFooter },
      children: docChildren,
    }],
  });
  return Packer.toBlob(wordDoc);
};

const stripSlideMarkup = (s: any): string =>
  typeof s === 'string' ? s.replace(/\[\[|\]\]/g, '') : (s ?? '');

const clampHex = (c: any, fallback: string): string => {
  if (typeof c === 'string' && /^#?[0-9a-fA-F]{6}$/.test(c.trim())) return `#${c.trim().replace('#', '')}`;
  return fallback;
};

const hexToHsl = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0; const li = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = li > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue /= 6;
  }
  return [hue * 360, sat * 100, li * 100];
};

const hslToHex = (h: number, s: number, l: number): string => {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
};

// Force a clean monochromatic palette from a single hue, so the deck never
// mixes clashing colors (blue+yellow etc). Accent and background share the
// primary's hue, differing only in lightness/saturation.
const makeMonochromePalette = (rawPrimary: any) => {
  const primary = clampHex(rawPrimary, '#4338CA');
  const [h, s] = hexToHsl(primary);
  const sat = Math.min(Math.max(s, 45), 85);
  return {
    primaryColor: hslToHex(h, sat, 38),
    accentColor: hslToHex(h, Math.min(sat + 8, 92), 56),
    backgroundColor: hslToHex(h, Math.min(sat, 26), 97),
  };
};

const sanitizeSlideData = (parsed: any): any => {
  if (!parsed?.slides) return parsed;
  const mono = makeMonochromePalette(parsed?.theme?.primaryColor);
  return {
    ...parsed,
    theme: { ...(parsed.theme || {}), ...mono },
    slides: parsed.slides.map((slide: any) => {
      const d = slide.data || {};
      return {
        ...slide,
        data: {
          ...d,
          title: stripSlideMarkup(d.title),
          kicker: stripSlideMarkup(d.kicker),
          subtitle: stripSlideMarkup(d.subtitle),
          author: stripSlideMarkup(d.author),
          quote: stripSlideMarkup(d.quote),
          // text / column1 / column2 intentionally kept — parsed by parseRichHtml
          topics: Array.isArray(d.topics)
            ? d.topics.map((t: any) => ({ ...t, title: stripSlideMarkup(t.title), content: stripSlideMarkup(t.content) }))
            : d.topics,
          events: Array.isArray(d.events)
            ? d.events.map((e: any) => ({ ...e, year: stripSlideMarkup(e.year), title: stripSlideMarkup(e.title), description: stripSlideMarkup(e.description) }))
            : d.events,
          stats: Array.isArray(d.stats)
            ? d.stats.map((s: any) => ({ ...s, value: stripSlideMarkup(s.value), label: stripSlideMarkup(s.label) }))
            : d.stats,
          references: Array.isArray(d.references) ? d.references.map(stripSlideMarkup) : d.references,
        },
      };
    }),
  };
};

// Generic blob download — appends a temporary <a> to document.body so the
// browser treats it as a real anchor click (avoids the "ghost click" problem
// where some browsers silently block programmatic downloads after the first).
const downloadBlob = async (blob: Blob, filename: string): Promise<void> => {
  // Em PWA no celular (standalone) o download de blob via <a download> é
  // frequentemente bloqueado em silêncio. Tentamos primeiro o menu nativo de
  // compartilhar/salvar (Arquivos, Drive, etc.), que funciona no mobile.
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    const nav = navigator as any;
    if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: filename });
      return;
    }
  } catch (e: any) {
    // Usuário cancelou o menu de compartilhamento → não cai no fallback
    if (e?.name === 'AbortError') return;
    // Qualquer outro erro → tenta o download clássico abaixo
  }
  // Fallback (desktop e navegadores sem Web Share de arquivos)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';
  document.body.appendChild(a);
  a.click();
  // Revoke after a generous delay to guarantee the download has started
  setTimeout(() => {
    try { document.body.removeChild(a); } catch { /* already removed */ }
    URL.revokeObjectURL(url);
  }, 30_000);
};

const buildDocHtml = (
  rawMd: string,
  docType: 'plan' | 'exam' | 'activities',
  opts: { school?: string; teacher?: string; subject?: string; topic?: string; className?: string; duration?: number; lessonTime?: number; turn?: string; examValue?: number; examDuration?: number }
): string => {
  const SEP = '\n---GABARITO---\n';
  const sepIdx = rawMd.indexOf(SEP);
  const mainMd  = sepIdx >= 0 ? rawMd.slice(0, sepIdx)      : rawMd;
  const gabMd   = sepIdx >= 0 ? rawMd.slice(sepIdx + SEP.length) : '';

  const mdToHtml = (md: string) => md
    .replace(/^---+$/gim, '<hr class="divider">')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/^(\( \) [A-D]\) .+)$/gim, '<div class="mc-opt">$1</div>')
    .replace(/^(_{10,})$/gim, '<div class="ans-line"></div>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  const labels = { plan: 'PLANO DE AULA', exam: 'AVALIAÇÃO', activities: 'ATIVIDADES' };
  const accent = { plan: '#059669', exam: '#dc2626', activities: '#2563eb' };
  const dark   = { plan: '#064e3b', exam: '#7f1d1d', activities: '#1e3a8a' };
  const ac = accent[docType];
  const dk = dark[docType];

  const gabHtml = gabMd ? `
    <div class="gab-page">
      <div class="gab-hdr">
        <div class="gab-badge">GABARITO</div>
        <div>
          <div class="gab-title">${opts.topic || 'Material Didático'}</div>
          <div class="gab-meta">${opts.teacher ? `Prof. ${opts.teacher}` : ''}${opts.subject ? ` · ${opts.subject}` : ''}${opts.school ? ` · ${opts.school}` : ''}</div>
        </div>
      </div>
      <div class="gab-body"><p>${mdToHtml(gabMd.replace(/^## Gabarito[^\n]*\n?/, ''))}</p></div>
    </div>` : '';

  // ── Plan: parse ## sections and render as PDF table layout ──────────────
  let planBody = '';
  if (docType === 'plan') {
    const sections: Record<string, string> = {};
    mainMd.split(/\n(?=## )/).forEach(part => {
      const m = part.match(/^## (.+?)\n([\s\S]*)/);
      if (m) sections[m[1].trim().toUpperCase()] = m[2].trim();
    });
    const get = (...keys: string[]) => {
      for (const key of keys) {
        const upper = key.toUpperCase();
        const found = Object.keys(sections).find(k => k === upper || k.replace(/[^A-Z]/g, '').includes(upper.replace(/[^A-Z]/g, '')) || upper.replace(/[^A-Z]/g, '').includes(k.replace(/[^A-Z]/g, '')));
        if (found && sections[found]) return mdToHtml(sections[found]);
      }
      return '&nbsp;';
    };

    planBody = `
  <table class="info-tbl">
    <tr><td class="info-cell" colspan="5"><strong>ÁREA DE CONHECIMENTO:</strong> ${get('ÁREA DE CONHECIMENTO', 'AREA DE CONHECIMENTO')}</td></tr>
    <tr>
      <td class="info-cell" colspan="2"><strong>EIXO/UNIDADE TEMÁTICA:</strong> ${get('EIXO/UNIDADE TEMÁTICA', 'EIXO', 'UNIDADE TEMÁTICA')}</td>
      <td class="info-cell"><strong>ANO/SÉRIE:</strong> ${opts.className || '___________'}</td>
      <td class="info-cell"><strong>TURMA:</strong> ___________</td>
      <td class="info-cell"><strong>TURNO:</strong> ${opts.turn ? opts.turn.charAt(0).toUpperCase() + opts.turn.slice(1) : '___________'}</td>
    </tr>
    <tr><td class="info-cell" colspan="5"><strong>COMPONENTE CURRICULAR:</strong> ${opts.subject || '___________'}</td></tr>
    <tr>
      <td class="info-cell" colspan="2"><strong>QUANTIDADE DE AULAS:</strong> ${opts.duration ?? '___'}</td>
      <td class="info-cell" colspan="3"><strong>DURAÇÃO:</strong> ${opts.lessonTime ? opts.lessonTime + ' min' : '___________'}</td>
    </tr>
    <tr><td class="info-cell" colspan="5"><strong>PROFESSOR(A):</strong> ${opts.teacher || '___________'}</td></tr>
  </table>

  <p class="plan-title">PLANO DE AULA</p>

  <table class="plan-tbl">
    <tr><td class="sec-hdr">CONTEÚDO:</td></tr>
    <tr><td class="sec-body">${get('CONTEÚDO', 'CONTEUDO')}</td></tr>
    <tr><td class="sec-hdr">OBJETIVOS:</td></tr>
    <tr><td class="sec-body">${get('OBJETIVOS')}</td></tr>
    <tr><td class="sec-hdr">PERGUNTAS MOBILIZADORAS DE APRENDIZAGEM:</td></tr>
    <tr><td class="sec-body">${get('PERGUNTAS MOBILIZADORAS DE APRENDIZAGEM', 'PERGUNTAS MOBILIZADORAS', 'PERGUNTAS')}</td></tr>
    <tr><td class="sec-hdr">METODOLOGIA:</td></tr>
    <tr><td class="sec-body">${get('METODOLOGIA')}</td></tr>
    <tr><td class="sec-hdr">Habilidade (BNCC):</td></tr>
    <tr><td class="sec-body">${get('HABILIDADE (BNCC)', 'HABILIDADE BNCC', 'HABILIDADES BNCC', 'HABILIDADE')}</td></tr>
    <tr><td class="sec-hdr">RECURSOS DIDÁTICOS:</td></tr>
    <tr><td class="sec-body">${get('RECURSOS DIDÁTICOS', 'RECURSOS DIDATICOS', 'RECURSOS')}</td></tr>
    <tr><td class="sec-hdr">AVALIAÇÃO:</td></tr>
    <tr><td class="sec-body">${get('AVALIAÇÃO', 'AVALIACAO')}</td></tr>
    <tr><td class="sec-hdr">REFERÊNCIAS:</td></tr>
    <tr><td class="sec-body">${get('REFERÊNCIAS', 'REFERENCIAS')}</td></tr>
  </table>`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<title>${labels[docType]} — ${opts.topic || ''}</title>
<style>
  @page { size: A4; margin: 1.8cm 2.2cm 2.2cm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.7; color: #111; background: #fff; }
  /* ── App header ── */
  .doc-hdr { display:flex; align-items:center; gap:14px; border-bottom:4px solid ${ac}; padding-bottom:10px; margin-bottom:18px; }
  .logo-box { width:54px; height:54px; border:2px solid #c7d2fe; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#818cf8; font-size:8pt; text-align:center; line-height:1.2; flex-shrink:0; }
  .sch-block { flex:1; }
  .sch-name { font-size:13pt; font-weight:700; color:#111; }
  .sch-sub { font-size:9pt; color:#6b7280; margin-top:2px; }
  .doc-badge { background:${ac}; color:#fff; font-size:9pt; font-weight:700; padding:5px 16px; border-radius:20px; white-space:nowrap; letter-spacing:0.5px; }
  /* ── Typography (exam/activities) ── */
  h1 { font-size:15pt; font-weight:700; color:#111; margin:0 0 14px; text-align:center; }
  h2 { font-size:10.5pt; font-weight:700; color:${ac}; border:1.5px solid ${ac}; padding:5px 12px; border-radius:4px; margin:22px 0 10px; }
  h3 { font-size:11pt; font-weight:700; color:${dk}; margin:14px 0 6px; padding-left:10px; border-left:4px solid ${ac}; }
  p { margin:6px 0; }
  strong { font-weight:700; }
  em { font-style:italic; }
  blockquote { border-left:4px solid ${ac}; padding:6px 14px; color:#4b5563; font-style:italic; background:#f9fafb; border-radius:0 6px 6px 0; margin:10px 0; }
  ul, ol { padding-left:22px; margin:6px 0; }
  li { margin-bottom:4px; }
  /* ── Exam / Activity ── */
  .mc-opt { padding:3px 0 3px 18px; font-size:11pt; }
  .ans-line { border-bottom:1.5px solid #9ca3af; height:26px; margin:5px 0; }
  .divider { border:none; border-top:1.5px solid #e5e7eb; margin:18px 0; }
  /* ── Gabarito page ── */
  .gab-page { page-break-before:always; padding-top:4px; }
  .gab-hdr { background:${dk}; color:#fff; padding:18px 22px; border-radius:10px; margin-bottom:24px; display:flex; align-items:center; gap:18px; }
  .gab-badge { background:#f59e0b; color:#1a1a1a; font-size:10pt; font-weight:800; padding:6px 18px; border-radius:20px; letter-spacing:1px; flex-shrink:0; }
  .gab-title { font-size:14pt; font-weight:700; margin-bottom:3px; }
  .gab-meta { font-size:9pt; color:#a5b4fc; }
  .gab-body { font-size:11pt; line-height:1.9; }
  .gab-body strong { color:${ac}; }
  .gab-body h2 { color:${dk}; border:1.5px solid ${dk}; padding:5px 12px; border-radius:4px; margin:16px 0 8px; font-size:10.5pt; }
  /* ── Plan table layout ── */
  .info-tbl { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:10.5pt; }
  .info-cell { border:1px solid #555; padding:5px 10px; vertical-align:middle; }
  .plan-title { text-align:center; font-weight:700; font-size:12pt; margin:8px 0 10px; text-decoration:underline; }
  .plan-tbl { width:100%; border-collapse:collapse; font-size:10.5pt; }
  .sec-hdr { border:1px solid #555; padding:5px 10px; font-weight:700; background:#f0f0f0; }
  .sec-body { border:1px solid #555; padding:8px 10px 28px; vertical-align:top; }
  .sec-body p, .sec-body br { display:inline; }
  @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
</style>
</head>
<body>
  <div class="doc-hdr">
    <div class="logo-box">Logo<br/>Escola</div>
    <div class="sch-block">
      <div class="sch-name">${opts.school || 'Nome da Escola'}</div>
      <div class="sch-sub">${opts.teacher ? `Prof. ${opts.teacher}` : ''}${opts.subject ? ` · ${opts.subject}` : ''}</div>
    </div>
    <div class="doc-badge">${labels[docType]}</div>
  </div>
  ${docType === 'plan' ? planBody : `<p>${mdToHtml(mainMd)}</p>`}
  ${gabHtml}
</body>
</html>`;
};
// ─────────────────────────────────────────────────────────────────────────────

const PlannerScreen = ({
  schedules,
  setSchedules,
  addClassItems,
  classes,
  setClasses,
  mode,
  profile,
  estudioContext,
  savedResources,
  setSavedResources,
  notifications,
  setNotifications,
  setScreen,
  addTask,
  updateTask,
  activeTasks,
  plannerTopic: topic,
  setPlannerTopic: setTopic,
  plannerSelectedClassId: selectedClassId,
  setPlannerSelectedClassId: setSelectedClassId,
  plannerPlan: plan,
  setPlannerPlan: setPlan,
  plannerPresentationData: presentationData,
  setPlannerPresentationData: setPresentationData,
  plannerActivity: activity,
  setPlannerActivity: setActivity,
  plannerExam: exam,
  setPlannerExam: setExam,
  generatePlan,
  generateResource,
  plannerDuration: duration,
  setPlannerDuration: setDuration,
  plannerLessonTime: lessonTime,
  setPlannerLessonTime: setLessonTime,
  plannerTone: tone,
  setPlannerTone: setTone,
  plannerComplexity: complexity,
  setPlannerComplexity: setComplexity,
  plannerFocus: focus,
  setPlannerFocus: setFocus,
  plannerGroundingContent: groundingContent,
  setPlannerGroundingContent: setGroundingContent,
  plannerQuestionCount: questionCount,
  setPlannerQuestionCount: setQuestionCount,
  plannerSlideCount: slideCount,
  setPlannerSlideCount: setSlideCount,
  plannerTurn: turn,
  setPlannerTurn: setTurn,
  plannerQuestionType: questionType,
  setPlannerQuestionType: setQuestionType,
  plannerExamValue: examValue,
  setPlannerExamValue: setExamValue,
  plannerExamDuration: examDuration,
  setPlannerExamDuration: setExamDuration,
  getSuggestion,
  getScheduleBuffer,
  setPlannerMode,
  generationsUsed,
  isLimitReached,
  freeGenerationLimit,
}: {
  schedules: ClassSchedule[], 
  setSchedules: (s: ClassSchedule[]) => void,
  addClassItems: (items: ClassItem[]) => void,
  classes: ClassItem[],
  setClasses: (c: ClassItem[]) => void,
  mode: PlannerMode,
  profile: UserProfile,
  estudioContext: string,
  savedResources: SavedResource[],
  setSavedResources: (r: SavedResource[]) => void,
  notifications?: any[],
  setNotifications?: (n: any[]) => void,
  setScreen: (s: Screen) => void,
  addTask: (task: Omit<BackgroundTask, 'id' | 'status' | 'startTime'>) => string,
  updateTask: (id: string, updates: Partial<BackgroundTask>) => void,
  activeTasks: Record<string, BackgroundTask>,
  plannerTopic: string,
  setPlannerTopic: (t: string | ((prev: string) => string)) => void,
  plannerSelectedClassId: string,
  setPlannerSelectedClassId: (id: string) => void,
  plannerPlan: string,
  setPlannerPlan: (p: string | ((prev: string) => string)) => void,
  plannerPresentationData: PresentationData | null,
  setPlannerPresentationData: (d: PresentationData | null) => void,
  plannerActivity: string,
  setPlannerActivity: (a: string | ((prev: string) => string)) => void,
  plannerExam: string,
  setPlannerExam: (e: string | ((prev: string) => string)) => void,
  generatePlan: (topic?: string, classId?: string) => Promise<void>,
  generateResource: (type: 'activities' | 'slides' | 'exam', topic?: string, classId?: string) => Promise<void>,
  plannerDuration: number,
  setPlannerDuration: (n: number) => void,
  plannerLessonTime: number,
  setPlannerLessonTime: (n: number) => void,
  plannerTone: 'formal' | 'didactic' | 'technical' | 'concise',
  setPlannerTone: (t: 'formal' | 'didactic' | 'technical' | 'concise') => void,
  plannerComplexity: 'basic' | 'intermediate' | 'advanced',
  setPlannerComplexity: (c: 'basic' | 'intermediate' | 'advanced') => void,
  plannerFocus: 'practical' | 'theoretical' | 'balanced',
  setPlannerFocus: (f: 'practical' | 'theoretical' | 'balanced') => void,
  plannerGroundingContent: string,
  setPlannerGroundingContent: (s: string) => void,
  plannerQuestionCount: number,
  setPlannerQuestionCount: (n: number) => void,
  plannerSlideCount: number,
  setPlannerSlideCount: (n: number) => void,
  plannerTurn: 'matutino' | 'vespertino' | 'noturno',
  setPlannerTurn: (t: 'matutino' | 'vespertino' | 'noturno') => void,
  plannerQuestionType: 'mista' | 'multipla_escolha' | 'dissertativa',
  setPlannerQuestionType: (t: 'mista' | 'multipla_escolha' | 'dissertativa') => void,
  plannerExamValue: number,
  setPlannerExamValue: (n: number) => void,
  plannerExamDuration: number,
  setPlannerExamDuration: (n: number) => void,
  getSuggestion: (topic?: string, classId?: string) => Promise<void>,
  getScheduleBuffer: (topic: string, duration: number, startDateStr: string, avoidCollisions: boolean, selectedClass: ClassSchedule, existingClasses: ClassItem[]) => ClassItem[],
  setPlannerMode: (m: PlannerMode) => void,
  generationsUsed: number,
  isLimitReached: boolean,
  freeGenerationLimit: number,
}) => {
  const currentResult = mode === 'plan' ? plan : 
                        mode === 'slides' ? presentationData :
                        mode === 'activities' ? activity :
                        mode === 'exam' ? exam : null;

  const [step, setStep] = useState<'input' | 'suggestion' | 'plan' | 'resources'>(
    currentResult ? 'plan' : 'input'
  );

  // Sync step if data comes in from background
  useEffect(() => {
    if (currentResult) {
      setStep('plan');
    } else {
      setStep('input');
    }
  }, [currentResult]);

  // States removed as they are now props
  
  const loading = Object.values(activeTasks).some(t =>
    t.status === 'processing' && t.type === mode
  );

  const recentTaskError = Object.values(activeTasks)
    .filter(t => t.status === 'error' && t.type === mode)
    .sort((a, b) => b.startTime - a.startTime)[0]?.error;

  const cancelCurrentGeneration = () => {
    Object.values(activeTasks).forEach(t => {
      if (t.status === 'processing' && t.type === mode) {
        updateTask(t.id, { status: 'error', error: 'Geração cancelada pelo usuário.' });
      }
    });
  };

  const [error, setError] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);

  // Gabarito no preview: oculto por padrão em provas, visível nos demais modos
  const [showGabarito, setShowGabarito] = useState(mode !== 'exam');
  useEffect(() => { setShowGabarito(mode !== 'exam'); }, [mode]);

  const resultText = typeof currentResult === 'string' ? currentResult : '';
  // Separador cru ---GABARITO--- vira um heading legível no preview
  // (consome o heading "## Gabarito…" logo em seguida, se houver, para não duplicar)
  const displayResult = resultText.replace(/^[ \t]*---GABARITO---[ \t]*$(?:\n+^#{1,3} .*gabarito.*$)?/gim, '## 🔑 Gabarito do Professor');
  const gabHeadingMatch = displayResult.match(/^#{1,3} .*gabarito.*$/im);
  const hasGabarito = (gabHeadingMatch?.index ?? -1) > 0;
  const visibleResult = hasGabarito && !showGabarito ? displayResult.slice(0, gabHeadingMatch!.index as number) : displayResult;

  const [showSchedulePrompt, setShowSchedulePrompt] = useState(false);
  const [regenState, setRegenState] = useState<{ idx: number; prompt: string } | null>(null);
  const [scheduleStartDate, setScheduleStartDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [scheduleAvoidCollisions, setScheduleAvoidCollisions] = useState(true);
  const [generatedClassesBuffer, setGeneratedClassesBuffer] = useState<ClassItem[]>([]);
  
  const [isAddingClass, setIsAddingClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [showGenModal, setShowGenModal] = useState(false);
  const profileName = profile.name;
  const profileSchoolName = profile.schoolName;
  const selectedClass = schedules.find(s => s.id === selectedClassId);

  const loadingMessage = useFunnyLoadingMessage(loading, 'planner');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Arquivo pesado demais! O limite é 10 MB.');
      e.target.value = '';
      return;
    }

    // If it's a text file, read it directly
    if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.csv')) {
      const text = await file.text();
      setTopic(prev => prev + (prev ? '\n\n' : '') + text);
    } else {
      // Otherwise, use Gemini to extract text
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const base64 = (event.target?.result as string).split(',')[1];
          const response = await generateContentWithRetry({
            model: AI_MODEL,
            contents: [
              { role: 'user', parts: [
                { inlineData: { data: base64, mimeType: file.type } },
                { text: "Extraia todo o texto útil e informações deste arquivo. Formate de forma clara em Markdown." }
              ]}
            ]
          });
          const text = response.text;
          setTopic(prev => prev + (prev ? '\n\n' : '') + text);
        } catch (error) {
          console.error("Error extracting text from file:", error);
          toast.error(formatApiError(error, "Não consegui ler esse arquivo. Tente outro formato."));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const addNewClass = () => {
    if (!newClassName.trim()) return;
    const newClass: ClassSchedule = {
      id: Math.random().toString(36).slice(2, 11),
      name: newClassName,
      days: [1, 2, 3, 4, 5], // Default to weekdays
      time: '08:00'
    };
    setSchedules([...schedules, newClass]);
    setSelectedClassId(newClass.id);
    setNewClassName('');
    setIsAddingClass(false);
  };

  const deleteClass = (id: string) => {
    setSchedules(schedules.filter(s => s.id !== id));
    if (selectedClassId === id) setSelectedClassId('');
  };

  const handleMainAction = () => {
    if (mode === 'plan') {
      if (duration === 0) {
        getSuggestion();
      } else {
        generatePlan();
      }
    } else {
      generateDirectResource(mode);
    }
  };

  const parseMarkdown = (text: any, baseOpts: any) =>
    parseRichMarkdown(text, baseOpts, presentationData?.theme?.primaryColor ?? '#6366f1', presentationData?.theme?.accentColor ?? '#f59e0b');

  const generateDirectResource = async (targetMode: 'activities' | 'slides' | 'exam') => {
    generateResource(targetMode);
  };

  const [isExporting, setIsExporting] = useState(false);
  const [preparingDoc, setPreparingDoc] = useState<'main' | number | null>(null);

  // Reset preparingDoc when mode or content changes
  useEffect(() => { setPreparingDoc(null); }, [mode]);
  useEffect(() => { setPreparingDoc(null); }, [currentResult]);

  const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string>(resolve => {
        const reader = new FileReader();
        // Keep the full data URL so the real MIME type (png/jpeg/webp) is preserved.
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  // Works around a pptxgenjs 4.0.1 bug where [Content_Types].xml declares an
  // Override for slideMaster1..N (one per slide) while only slideMaster1.xml is
  // actually written. The dangling parts make PowerPoint reject the file. We
  // re-open the package, drop Override entries pointing at missing slideMaster
  // parts, and repackage. Returns the original buffer untouched on any failure.
  const repairPptxContentTypes = async (buffer: ArrayBuffer): Promise<ArrayBuffer> => {
    try {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(buffer);
      const ctFile = zip.file('[Content_Types].xml');
      if (!ctFile) return buffer;
      const xml = await ctFile.async('string');
      const existingMasters = new Set(
        Object.keys(zip.files)
          .map(p => p.match(/^ppt\/slideMasters\/(slideMaster\d+\.xml)$/)?.[1])
          .filter((v): v is string => !!v)
      );
      const fixed = xml.replace(
        /<Override PartName="\/ppt\/slideMasters\/(slideMaster\d+\.xml)"[^>]*\/>/g,
        (full, name: string) => (existingMasters.has(name) ? full : '')
      );
      if (fixed === xml) return buffer;
      zip.file('[Content_Types].xml', fixed);
      return await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    } catch (err) {
      console.error('repairPptxContentTypes failed, using original buffer', err);
      return buffer;
    }
  };

  const exportPPTX = async () => {
    if (!presentationData || isExporting) return;
    setIsExporting(true);
    try {
      const { default: pptxgen } = await import('pptxgenjs');
      const pres = new pptxgen();
      pres.layout = 'LAYOUT_16x9';
      const theme = presentationData.theme;
      const pc = theme.primaryColor.replace('#', '');
      const ac = theme.accentColor.replace('#', '');
      const bg = theme.backgroundColor.replace('#', '');
      const schoolLabel = selectedClass?.school || profileSchoolName || '';
      const teacherLabel = profileName || '';
      const totalSlides = presentationData.slides.length;

      // Typography — Segoe UI is clean, modern and ships with Office on every
      // Windows machine, so it renders reliably (unlike web-only fonts).
      const FONT_T = 'Segoe UI';        // títulos
      const FONT_B = 'Segoe UI';        // corpo
      const FONT_Q = 'Georgia';         // citações (serifa de contraste)
      const LEFT = 0.55;                // margem esquerda consistente
      const INK = '334155';             // corpo de texto (slate-700, mais suave que preto)
      const INK_SOFT = '64748B';        // texto secundário

      // Rasteriza um ícone Lucide para PNG (branco) para uso nos cards.
      const iconCache = new Map<string, string>();
      const svgStringToPng = (svg: string, px: number): Promise<string> => new Promise(resolve => {
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = px; canvas.height = px;
          const ctx = canvas.getContext('2d');
          if (!ctx) { URL.revokeObjectURL(url); resolve(''); return; }
          ctx.drawImage(img, 0, 0, px, px);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
        img.src = url;
      });
      const renderIconPng = async (name: string, colorHex: string, px = 128): Promise<string> => {
        const key = `${name}|${colorHex}`;
        if (iconCache.has(key)) return iconCache.get(key)!;
        try {
          const { renderToStaticMarkup } = await import('react-dom/server');
          let svg = renderToStaticMarkup(React.createElement(DynamicIcon, { name, color: colorHex, size: px, strokeWidth: 2 } as any) as any);
          if (!svg.includes('xmlns')) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
          const png = await svgStringToPng(svg, px);
          iconCache.set(key, png);
          return png;
        } catch { return ''; }
      };

      const addFooter = (slide: any, slideNum: number, darkBg = false) => {
        const fg = darkBg ? 'FFFFFF' : 'C4C9D4';
        // Número do slide — canto inferior esquerdo, muito discreto
        slide.addText(`${slideNum} / ${totalSlides}`, { x: 0.15, y: 5.22, w: 0.8, h: 0.22, fontSize: 7, color: fg, align: 'left' as const, transparency: 35 });
        // Marca d'água "Prof. Corujão" — canto inferior direito, discreta
        slide.addText('Prof. Corujão', { x: 7.25, y: 5.22, w: 2.6, h: 0.22, fontSize: 7, color: darkBg ? 'FFFFFF' : 'B0B7C3', transparency: darkBg ? 35 : 45, italic: true, align: 'right' as const, fontFace: FONT_B });
      };

      // Pre-fetch all images as base64 to avoid CORS failures when pptxgenjs
      // requests Pixabay URLs directly from the user's browser.
      const imageCache = new Map<string, string>();
      await Promise.all(
        presentationData.slides
          .map(s => s.data.imageUrl)
          .filter(Boolean)
          .filter((url, i, a) => a.indexOf(url) === i)
          .map(async url => {
            const b64 = await fetchImageAsBase64(url);
            if (b64) imageCache.set(url, b64);
          })
      );
      const addSlideImage = (slide: any, url: string, opts: any) => {
        const dataUrl = imageCache.get(url);
        // Se a imagem não pôde ser baixada em base64 (CORS/hotlink), NÃO usamos
        // `path: url` como fallback: o pptxgen tentaria buscar a URL ao gerar o
        // arquivo e uma única falha derruba o PPTX inteiro. Melhor um slide sem a
        // imagem do que um download que falha.
        if (!dataUrl) return;
        slide.addImage({ data: dataUrl, ...opts });
      };

      // Pre-render every icon used in topics/stats to white PNGs (sit on colored circles).
      const iconNames = new Set<string>();
      presentationData.slides.forEach(s => {
        if (Array.isArray((s.data as any).topics)) (s.data as any).topics.forEach((t: any) => t?.icon && iconNames.add(t.icon));
        if (Array.isArray((s.data as any).stats)) (s.data as any).stats.forEach((t: any) => t?.icon && iconNames.add(t.icon));
      });
      await Promise.all(Array.from(iconNames).map(n => renderIconPng(n, '#FFFFFF', 128)));
      const iconPng = (name?: string) => (name ? iconCache.get(`${name}|#FFFFFF`) || '' : '');

      // Cabeçalho consistente: eyebrow (rótulo) + título + traço de acento.
      // Title uses INK (dark slate) for light-bg slides — readable regardless of user's chosen primary colour.
      // region {x,w} confines the header to a column so it never overlaps a side image.
      // Títulos: os marcadores ==destaque==/[[termo]]/**bold** vazavam LITERAIS
      // nos títulos (só o corpo passava pelo parser rico). Agora viram runs:
      // ==x== ganha a cor de acento, [[x]] a cor primária; {Icon}/(Icon) somem.
      const stripIconTokens = (t: string) => (t || '').replace(/\{[A-Za-z0-9]+\}\s*/g, '').replace(/\(([A-Z][a-zA-Z0-9]+)\)\s*/g, '');
      const cleanTitleText = (t: string) => stripIconTokens(t).replace(/\*+/g, '').replace(/==/g, '').replace(/\[\[|\]\]/g, '').trim();
      const titleRuns = (t: string, baseColor: string): any[] => {
        const parts = stripIconTokens(t).split(/(\*\*[^*\n]+\*\*|==[^=\n]+==|\[\[[^\]\n]+\]\])/g);
        const runs: any[] = [];
        parts.forEach(pt => {
          if (!pt) return;
          if (/^\*\*[^*\n]+\*\*$/.test(pt)) runs.push({ text: pt.slice(2, -2), options: { color: baseColor } });
          else if (/^==[^=\n]+==$/.test(pt)) runs.push({ text: pt.slice(2, -2), options: { color: ac } });
          else if (/^\[\[[^\]\n]+\]\]$/.test(pt)) runs.push({ text: pt.slice(2, -2), options: { color: pc } });
          else { const c = pt.replace(/\*+/g, '').replace(/==+/g, ''); if (c) runs.push({ text: c, options: { color: baseColor } }); }
        });
        return runs.length ? runs : [{ text: cleanTitleText(t), options: { color: baseColor } }];
      };

      const addHeader = (slide: any, kicker: string | undefined, title: string, darkBg = false, region?: { x: number; w: number }) => {
        const hx = region?.x ?? LEFT;
        const hw = region?.w ?? (9.0 - LEFT);
        const hasKick = !!(kicker && kicker.trim());
        if (hasKick) {
          slide.addText((kicker as string).toUpperCase(), { x: hx, y: 0.42, w: hw, h: 0.28, fontSize: 11, color: ac, bold: true, charSpacing: 3, fontFace: FONT_B });
        }
        const titleY = hasKick ? 0.74 : 0.5;
        // Use high-contrast INK for light-background slides; white for dark-background slides
        const titleColor = darkBg ? 'FFFFFF' : INK;
        slide.addText(titleRuns(title || '', titleColor), { x: hx, y: titleY, w: hw, h: 0.85, fontSize: 30, color: titleColor, bold: true, fontFace: FONT_T, valign: 'top', fit: 'shrink' as const });
        // Bar BELOW the title box (box ends at titleY+0.85; bar at +0.90 = 0.05" gap).
        // Previously at +0.78 (inside the box) which caused the bar to cross the 2nd line.
        slide.addShape(pres.ShapeType.rect, { x: hx, y: titleY + 0.90, w: 0.9, h: 0.055, fill: { color: ac } });
        return titleY + 1.04; // y onde o conteúdo pode começar
      };
      const imgShadow = { type: 'outer' as const, blur: 10, offset: 3, angle: 90, color: '94A3B8', opacity: 0.45 };

      for (let si = 0; si < presentationData.slides.length; si++) {
        const slideData = presentationData.slides[si];
        const slide = pres.addSlide();
        const bodyOpts = { fontFace: FONT_B, color: INK, fontSize: 13 };
        const shrink = { fit: 'shrink' as const };
        const kicker = (slideData.data as any).kicker as string | undefined;

        if (slideData.layoutID === 'LAYOUT_COVER') {
          slide.background = { color: pc };
          // Right panel light bg — full height matches LAYOUT_16x9 (5.63")
          slide.addShape(pres.ShapeType.rect, { x: 5.4, y: 0, w: 4.6, h: 5.63, fill: { color: bg } });
          // Accent stripe
          slide.addShape(pres.ShapeType.rect, { x: 5.4, y: 0, w: 0.12, h: 5.63, fill: { color: ac } });
          // Decorative circles
          slide.addShape(pres.ShapeType.ellipse, { x: -0.4, y: 3.8, w: 1.8, h: 1.8, fill: { color: ac, transparency: 60 } });
          slide.addShape(pres.ShapeType.ellipse, { x: 3.5, y: -0.4, w: 1.2, h: 1.2, fill: { color: 'FFFFFF', transparency: 80 } });

          // Eyebrow / kicker — positioned high to match the in-app preview layout
          slide.addText((kicker || 'Apresentação').toUpperCase(), { x: 0.55, y: 0.50, w: 4.6, h: 0.28, fontSize: 11, fontFace: FONT_B, color: 'FFFFFF', bold: true, charSpacing: 3, transparency: 25 });
          // Title: single box at fontSize 36, valign:top, fit:shrink.
          // coverBarY is estimated from char count so the bar never overlaps the title text.
          // At 36pt in 4.7" width, roughly 18 chars fit per line; each line ≈ 0.62" tall.
          const rawCoverTitle = cleanTitleText(slideData.data.title || '');
          const ctEstLines = Math.max(1, Math.min(Math.ceil(rawCoverTitle.length / 18), 4));
          const ctLineH = 0.62; // 36pt × 1.2 line-spacing / 72pt-per-inch ≈ 0.60"
          const ctTitleBoxH = ctEstLines * ctLineH + 0.06; // small buffer so shrink stays slight
          const coverBarY = parseFloat((0.86 + ctTitleBoxH + 0.08).toFixed(2)); // 0.08" gap after box
          slide.addText(rawCoverTitle, { x: 0.5, y: 0.86, w: 4.7, h: ctTitleBoxH, fontSize: 36, fontFace: FONT_T, color: 'FFFFFF', bold: true, align: 'left', valign: 'top', charSpacing: -0.5, ...shrink });
          slide.addShape(pres.ShapeType.rect, { x: 0.55, y: coverBarY, w: 1.2, h: 0.06, fill: { color: ac } });
          slide.addText(cleanTitleText(slideData.data.subtitle || ''), { x: 0.55, y: coverBarY + 0.16, w: 4.6, h: 0.55, fontSize: 14, fontFace: FONT_B, color: 'E2E8F0', align: 'left', ...shrink });
          slide.addText(`${teacherLabel ? `Prof. ${teacherLabel}` : ''}${schoolLabel ? `  ·  ${schoolLabel}` : ''}`.trim(), { x: 0.55, y: 5.05, w: 4.6, h: 0.35, fontSize: 9, fontFace: FONT_B, color: 'A5B4FC', align: 'left' });

          if (slideData.data.imageUrl) {
            // Full-bleed: image fills the entire right panel (after the accent stripe at x=5.52)
            addSlideImage(slide, slideData.data.imageUrl, { x: 5.52, y: 0, w: 4.48, h: 5.63, sizing: { type: 'cover', w: 4.48, h: 5.63 }, rounding: false });
          }

        } else if (slideData.layoutID === 'LAYOUT_CONTENT_LEFT' || slideData.layoutID === 'LAYOUT_CONTENT_RIGHT') {
          slide.background = { color: bg };
          const isLeft = slideData.layoutID === 'LAYOUT_CONTENT_LEFT';
          const imgX = isLeft ? 6.0 : 0.0;
          const contentX = isLeft ? LEFT : 4.35;
          const contentW = 4.85;

          // Full-height image panel with brand tint for unity
          if (slideData.data.imageUrl) {
            addSlideImage(slide, slideData.data.imageUrl, { x: imgX, y: 0, w: 4.0, h: 5.63, sizing: { type: 'cover', w: 4.0, h: 5.63 } });
            slide.addShape(pres.ShapeType.rect, { x: imgX, y: 0, w: 4.0, h: 5.63, fill: { color: pc, transparency: 78 } });
            slide.addShape(pres.ShapeType.rect, { x: isLeft ? imgX : imgX + 3.94, y: 0, w: 0.06, h: 5.63, fill: { color: ac } });
          }

          const contentStartY = addHeader(slide, kicker, slideData.data.title || '', false, { x: contentX, w: contentW });
          const parsedText = parseMarkdown(slideData.data.text || '', { ...bodyOpts, fontSize: 13 });
          slide.addText(parsedText, { x: contentX, y: contentStartY + 0.05, w: contentW, h: 5.05 - contentStartY, valign: 'top', align: 'left', lineSpacing: 24, ...shrink });
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_CONTENT_TOP') {
          slide.background = { color: bg };
          // Compact header starting higher so the image panel is larger (matches preview proportions)
          const ctHasKick = !!(kicker && kicker.trim());
          const ctKickerY = 0.34;
          const ctTitleY = ctHasKick ? ctKickerY + 0.28 : ctKickerY;
          if (ctHasKick) slide.addText(kicker!.toUpperCase(), { x: LEFT, y: ctKickerY, w: 9.0 - LEFT, h: 0.26, fontSize: 11, color: ac, bold: true, charSpacing: 3, fontFace: FONT_B });
          slide.addText(titleRuns(slideData.data.title || '', INK), { x: LEFT, y: ctTitleY, w: 9.0 - LEFT, h: 0.62, fontSize: 30, color: INK, bold: true, fontFace: FONT_T, valign: 'top', ...shrink });
          // Bar BELOW the 0.62" title box (box ends at ctTitleY+0.62; bar at +0.66 = 0.04" gap).
          slide.addShape(pres.ShapeType.rect, { x: LEFT, y: ctTitleY + 0.66, w: 0.9, h: 0.055, fill: { color: ac } });
          const ctBodyY = ctTitleY + 0.80;
          // Sem imagem embutível, o texto ocupa a área toda (antes sobravam ~2.9" vazias)
          const ctHasImg = !!(slideData.data.imageUrl && imageCache.get(slideData.data.imageUrl));
          const parsedText = parseMarkdown(slideData.data.text || '', { ...bodyOpts, fontSize: ctHasImg ? 13 : 15 });
          slide.addText(parsedText, { x: LEFT, y: ctBodyY, w: 9.0 - LEFT, h: ctHasImg ? 1.05 : 5.05 - ctBodyY, valign: 'top', align: 'left', lineSpacing: ctHasImg ? 22 : 26, ...shrink });
          const ctImgY = ctBodyY + 1.15;
          if (ctHasImg) {
            const ctImgH = 5.22 - ctImgY;
            addSlideImage(slide, slideData.data.imageUrl, { x: LEFT, y: ctImgY, w: 9.0 - LEFT, h: ctImgH, sizing: { type: 'cover', w: 9.0 - LEFT, h: ctImgH }, shadow: imgShadow });
          }
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_TOPICS') {
          slide.background = { color: bg };
          const startY = addHeader(slide, kicker, slideData.data.title || '', false);

          if (slideData.data.topics) {
            const items = slideData.data.topics.slice(0, 3);
            const cols = Math.max(items.length, 1);
            const gap = 0.3;
            const totalW = 9.0 - LEFT - 0.15;
            const colW = (totalW - gap * (cols - 1)) / cols;
            const cardY = Math.max(startY + 0.05, 1.55);
            const cardH = 5.22 - cardY;
            items.forEach((topic: any, i: number) => {
              const xPos = LEFT + i * (colW + gap);
              // Card with soft shadow, no harsh border
              slide.addShape(pres.ShapeType.roundRect, { x: xPos, y: cardY, w: colW, h: cardH, fill: { color: 'FFFFFF' }, line: { color: 'EEF2F7', width: 1 }, rectRadius: 0.1, shadow: { type: 'outer', blur: 9, offset: 3, angle: 90, color: 'CBD5E1', opacity: 0.4 } });
              // Icon disc
              const discD = 0.92;
              const discX = xPos + colW / 2 - discD / 2;
              const discY = cardY + 0.32;
              slide.addShape(pres.ShapeType.ellipse, { x: discX, y: discY, w: discD, h: discD, fill: { color: pc } });
              const png = iconPng(topic.icon);
              if (png) slide.addImage({ data: png, x: discX + 0.23, y: discY + 0.23, w: discD - 0.46, h: discD - 0.46 });
              else slide.addText(`${i + 1}`, { x: discX, y: discY, w: discD, h: discD, fontSize: 24, color: 'FFFFFF', align: 'center', valign: 'middle', bold: true, fontFace: FONT_T });
              const txtY = discY + discD + 0.22;
              slide.addText(stripInlineMarkup(topic.title || ''), { x: xPos + 0.15, y: txtY, w: colW - 0.3, h: 0.5, fontSize: 14, bold: true, align: 'center', color: pc, fontFace: FONT_T, valign: 'top', ...shrink });
              slide.addText(stripInlineMarkup(topic.content || ''), { x: xPos + 0.2, y: txtY + 0.5, w: colW - 0.4, h: cardY + cardH - (txtY + 0.5) - 0.2, fontSize: 11, align: 'center', color: INK_SOFT, fontFace: FONT_B, valign: 'top', lineSpacing: 16, ...shrink });
            });
          }
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_REFERENCES') {
          slide.background = { color: pc };
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 10, h: 5.63, fill: { color: pc } });
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.4, h: 5.63, fill: { color: ac } });
          // Decorative elements
          slide.addShape(pres.ShapeType.ellipse, { x: 7.5, y: 3.5, w: 3.5, h: 3.5, fill: { color: 'FFFFFF', transparency: 92 } });
          slide.addShape(pres.ShapeType.ellipse, { x: 8.5, y: -0.5, w: 2, h: 2, fill: { color: ac, transparency: 70 } });

          slide.addText('REFERÊNCIAS', { x: 0.7, y: 0.55, w: 8, h: 0.3, fontSize: 11, color: 'FFFFFF', bold: true, charSpacing: 3, fontFace: FONT_B, transparency: 30 });
          slide.addText(slideData.data.title || 'Para saber mais', { x: 0.7, y: 0.85, w: 8, h: 0.8, fontSize: 32, color: 'FFFFFF', bold: true, fontFace: FONT_T, ...shrink });
          slide.addShape(pres.ShapeType.rect, { x: 0.7, y: 1.72, w: 2.4, h: 0.06, fill: { color: ac } });
          if (slideData.data.references) {
            const refs = slideData.data.references.map((r: string) => (r || '').trim()).filter(Boolean);
            if (refs.length) {
              const refText = refs.map((r: string) => ({ text: r, options: { bullet: { characterCode: '2022', indent: 18 }, breakLine: true, color: 'E2E8F0', fontSize: 13, fontFace: FONT_B, paraSpaceBefore: 8 } }));
              slide.addText(refText, { x: 0.75, y: 2.0, w: 8.3, h: 3.0, valign: 'top', ...shrink });
            }
          }
          addFooter(slide, si + 1, true);

        } else if (slideData.layoutID === 'LAYOUT_QUOTE') {
          slide.background = { color: bg };
          // Giant decorative quote marks
          slide.addText('“', { x: 0.2, y: -0.3, w: 2.5, h: 2, fontSize: 180, color: pc, transparency: 90, fontFace: FONT_Q, bold: true });
          slide.addText('”', { x: 7.5, y: 3.0, w: 2.5, h: 2, fontSize: 180, color: pc, transparency: 90, fontFace: FONT_Q, bold: true });
          // Topic label
          if (slideData.data.title) {
            slide.addText(slideData.data.title.toUpperCase(), { x: 1, y: 0.62, w: 8, h: 0.32, fontSize: 11, color: ac, bold: true, align: 'center', charSpacing: 3, fontFace: FONT_B });
          }
          slide.addShape(pres.ShapeType.rect, { x: 4.5, y: 1.02, w: 1.0, h: 0.06, fill: { color: ac } });
          // Quote
          slide.addText(slideData.data.quote || '', { x: 1, y: 1.25, w: 8, h: 2.55, fontSize: 27, fontFace: FONT_Q, color: pc, bold: false, italic: true, align: 'center', valign: 'middle', lineSpacing: 38, ...shrink });
          slide.addShape(pres.ShapeType.rect, { x: 4.5, y: 3.95, w: 1.0, h: 0.05, fill: { color: ac } });
          // Author
          slide.addText(`— ${slideData.data.author || ''}`, { x: 1, y: 4.15, w: 8, h: 0.4, fontSize: 14, color: INK_SOFT, align: 'center', bold: true, charSpacing: 1, fontFace: FONT_B });
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_TWO_COLUMNS') {
          slide.background = { color: bg };
          const startY = addHeader(slide, kicker, slideData.data.title || '', false);
          const colY = Math.max(startY + 0.05, 1.5);
          const colH = 5.22 - colY;
          const cardW = 4.32;
          // Two soft cards side by side
          [[LEFT, slideData.data.column1, '1'], [LEFT + cardW + 0.26, slideData.data.column2, '2']].forEach(([cx, content, num]: any, idx) => {
            const colColor = idx === 0 ? pc : ac;
            slide.addShape(pres.ShapeType.roundRect, { x: cx, y: colY, w: cardW, h: colH, fill: { color: 'FFFFFF' }, line: { color: 'EEF2F7', width: 1 }, rectRadius: 0.08, shadow: { type: 'outer', blur: 8, offset: 2, angle: 90, color: 'CBD5E1', opacity: 0.35 } });

            // Accent top stripe per column
            slide.addShape(pres.ShapeType.roundRect, { x: cx, y: colY, w: cardW, h: 0.12, fill: { color: colColor }, rectRadius: 0.08 });

            // Extract first non-empty line as column title (AI often puts a header there)
            const rawContent = (typeof content === 'string' ? content : '').trim();
            const firstBreak = rawContent.search(/\n/);
            const colTitle = stripInlineMarkup(firstBreak > 0 ? rawContent.slice(0, firstBreak) : rawContent);
            const colBody = firstBreak > 0 ? rawContent.slice(firstBreak + 1).trim() : '';

            // Column title
            slide.addText(colTitle, { x: cx + 0.22, y: colY + 0.24, w: cardW - 0.44, h: 0.52, fontSize: 14, bold: true, color: colColor, fontFace: FONT_T, valign: 'middle', align: 'left', ...shrink });

            // Column body
            const parsed = parseMarkdown(colBody || rawContent, { ...bodyOpts, fontSize: 12 });
            slide.addText(parsed, { x: cx + 0.22, y: colY + 0.85, w: cardW - 0.44, h: colH - 1.05, valign: 'top', align: 'left', lineSpacing: 20, ...shrink });
          });
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_FULL_IMAGE') {
          // Sem imagem embutível, o slide não fica preto vazio: usa a cor primária
          // com círculos decorativos suaves (visual intencional, não "quebrado").
          const fiHasImg = !!(slideData.data.imageUrl && imageCache.get(slideData.data.imageUrl));
          if (fiHasImg) {
            slide.background = { color: '111111' };
            addSlideImage(slide, slideData.data.imageUrl, { x: 0, y: 0, w: 10, h: 5.63, sizing: { type: 'cover', w: 10, h: 5.63 } });
            // Dark gradient overlay via semi-transparent rect
            slide.addShape(pres.ShapeType.rect, { x: 0, y: 2.2, w: 10, h: 3.43, fill: { color: '000000', transparency: 25 } });
            slide.addShape(pres.ShapeType.rect, { x: 0, y: 3.5, w: 10, h: 2.13, fill: { color: '000000', transparency: 10 } });
          } else {
            slide.background = { color: pc };
            slide.addShape(pres.ShapeType.ellipse, { x: 6.8, y: -1.4, w: 4.6, h: 4.6, fill: { color: 'FFFFFF', transparency: 88 } });
            slide.addShape(pres.ShapeType.ellipse, { x: -1.6, y: 3.4, w: 4.0, h: 4.0, fill: { color: 'FFFFFF', transparency: 92 } });
          }
          // Left accent bar
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 5.63, fill: { color: ac } });
          // Eyebrow above title
          if (kicker) slide.addText(kicker.toUpperCase(), { x: 0.55, y: 2.95, w: 9, h: 0.3, fontSize: 11, color: 'FFFFFF', bold: true, charSpacing: 3, fontFace: FONT_B, shadow: { type: 'outer', blur: 4, offset: 1, angle: 45, color: '000000' } });
          // Accent line above title
          slide.addShape(pres.ShapeType.rect, { x: 0.55, y: kicker ? 3.32 : 3.2, w: 1.0, h: 0.07, fill: { color: ac } });
          // Title
          slide.addText(titleRuns(slideData.data.title || '', 'FFFFFF'), { x: 0.5, y: kicker ? 3.45 : 3.35, w: 9, h: 1.2, fontSize: 40, color: 'FFFFFF', bold: true, fontFace: FONT_T, valign: 'middle', shadow: { type: 'outer', blur: 8, offset: 2, angle: 45, color: '000000' }, ...shrink });
          // Subtitle
          if (slideData.data.subtitle) {
            slide.addText(slideData.data.subtitle, { x: 0.55, y: 4.75, w: 9, h: 0.4, fontSize: 15, color: 'E2E8F0', fontFace: FONT_B, shadow: { type: 'outer', blur: 4, offset: 1, angle: 45, color: '000000' }, ...shrink });
          }
          addFooter(slide, si + 1, true);

        } else if (slideData.layoutID === 'LAYOUT_STATS') {
          slide.background = { color: bg };
          const startY = addHeader(slide, kicker, slideData.data.title || '', false);

          const stats = (slideData.data.stats || []).slice(0, 4);
          const gap = 0.3;
          const totalW = 9.0 - LEFT - 0.15;
          const cardW = stats.length > 0 ? (totalW - gap * (stats.length - 1)) / stats.length : 2.2;
          const cardY = Math.max(startY + 0.1, 1.6);
          const cardH = 5.22 - cardY;
          stats.forEach((s: any, i: number) => {
            const xPos = LEFT + i * (cardW + gap);
            const isDark = i % 2 === 0;
            const cardBg = isDark ? pc : 'FFFFFF';
            slide.addShape(pres.ShapeType.roundRect, { x: xPos, y: cardY, w: cardW, h: cardH, fill: { color: cardBg }, line: { color: isDark ? pc : 'EEF2F7', width: 1 }, rectRadius: 0.1, shadow: { type: 'outer', blur: 9, offset: 3, angle: 90, color: 'CBD5E1', opacity: isDark ? 0.5 : 0.4 } });
            // Icon disc
            const discD = 0.78, discX = xPos + cardW / 2 - discD / 2, discY = cardY + 0.3;
            slide.addShape(pres.ShapeType.ellipse, { x: discX, y: discY, w: discD, h: discD, fill: { color: isDark ? ac : pc } });
            const png = iconPng(s.icon);
            if (png) slide.addImage({ data: png, x: discX + 0.2, y: discY + 0.2, w: discD - 0.4, h: discD - 0.4 });
            // Value
            const valY = discY + discD + 0.18;
            slide.addText(s.value || '—', { x: xPos + 0.1, y: valY, w: cardW - 0.2, h: 0.85, fontSize: 34, bold: true, align: 'center', color: isDark ? 'FFFFFF' : pc, fontFace: FONT_T, ...shrink });
            // Mini progress bar when the value is a percentage
            const pctMatch = String(s.value || '').match(/(\d{1,3})\s*%/);
            let labelY = valY + 0.95;
            if (pctMatch) {
              const pct = Math.max(0, Math.min(100, parseInt(pctMatch[1], 10)));
              const barW = cardW - 0.8, barX = xPos + 0.4, barY = valY + 0.92;
              slide.addShape(pres.ShapeType.roundRect, { x: barX, y: barY, w: barW, h: 0.12, fill: { color: isDark ? 'FFFFFF' : 'E2E8F0', transparency: isDark ? 70 : 0 }, rectRadius: 0.06 });
              if (pct > 0) slide.addShape(pres.ShapeType.roundRect, { x: barX, y: barY, w: Math.max(barW * pct / 100, 0.12), h: 0.12, fill: { color: ac }, rectRadius: 0.06 });
              labelY = barY + 0.32;
            }
            // Label
            slide.addText(s.label || '', { x: xPos + 0.15, y: labelY, w: cardW - 0.3, h: cardY + cardH - labelY - 0.15, fontSize: 11, align: 'center', color: isDark ? 'E2E8F0' : INK_SOFT, valign: 'top', fontFace: FONT_B, lineSpacing: 15, ...shrink });
          });
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_TIMELINE') {
          slide.background = { color: bg };
          const tlStartY = addHeader(slide, kicker, slideData.data.title || '', false);

          const events = (slideData.data.events || []).slice(0, 5);
          if (events.length > 0) {
            const cols = events.length;
            const colW = (9.0 - LEFT) / cols;
            // O ano fica 1.0" acima da linha — ancorar no fim do cabeçalho evita colisão com o título
            const lineY = Math.max(2.55, tlStartY + 1.0);
            // Horizontal timeline line
            slide.addShape(pres.ShapeType.rect, { x: LEFT + colW * 0.5, y: lineY, w: colW * (cols - 1), h: 0.05, fill: { color: ac, transparency: 30 } });
            events.forEach((ev: any, i: number) => {
              const cx = LEFT + colW * i + colW * 0.5 - 0.25;
              const isDot = i % 2 === 0;
              // Dot
              slide.addShape(pres.ShapeType.ellipse, { x: cx, y: lineY - 0.22, w: 0.5, h: 0.5, fill: { color: isDot ? pc : ac }, line: { color: bg, width: 3 } });
              slide.addText(`${i + 1}`, { x: cx, y: lineY - 0.22, w: 0.5, h: 0.5, fontSize: 12, color: 'FFFFFF', align: 'center', valign: 'middle', bold: true, fontFace: FONT_T });
              // Year
              slide.addText(ev.year || '', { x: cx - 0.3, y: lineY - 1.0, w: 1.1, h: 0.4, fontSize: 13, bold: true, align: 'center', color: pc, fontFace: FONT_T });
              // Event title
              slide.addText(ev.title || '', { x: cx - 0.55, y: lineY + 0.45, w: 1.6, h: 0.6, fontSize: 11, bold: true, align: 'center', color: INK, fontFace: FONT_T, valign: 'top', ...shrink });
              // Description
              slide.addText(ev.description || '', { x: cx - 0.6, y: lineY + 1.05, w: 1.7, h: 1.6, fontSize: 10, align: 'center', color: INK_SOFT, valign: 'top', lineSpacing: 14, fontFace: FONT_B, ...shrink });
            });
          }
          addFooter(slide, si + 1);
        }
      }
      // Use write() + our own downloadBlob instead of writeFile() so we control
      // the anchor element lifecycle — pres.writeFile() uses an internal "ghost"
      // click that some browsers silently block on the second call within the
      // same page session.
      //
      // pres.write({ outputType: 'blob' }) sometimes returns a Blob typed as
      // 'application/zip' (PPTX is a ZIP archive internally), which causes some
      // browsers (especially on Android) to append ".zip" to the filename even
      // when the <a download> attribute specifies ".pptx".
      // Re-wrapping with the correct OOXML MIME type prevents that.
      const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      const rawBlob = await pres.write({ outputType: 'arraybuffer' }) as ArrayBuffer;

      // pptxgenjs 4.0.1 has a bug in [Content_Types].xml generation: it writes one
      // <Override .../slideMaster{N}.xml> per slide (slideMaster1..N) even though
      // only slideMaster1.xml actually exists. PowerPoint then refuses to open the
      // file ("needs repair"). Strip the Override entries for any slideMaster part
      // that isn't present in the package, leaving the package spec-valid.
      const repaired = await repairPptxContentTypes(rawBlob);
      const blob = new Blob([repaired], { type: PPTX_MIME });
      const safeName = presentationData.presentationTitle.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_') || 'Apresentacao';
      await downloadBlob(blob, `Aula_${safeName}.pptx`);
    } catch (e) {
      console.error(e);
      toast.error('A apresentação não saiu dessa vez. Confere a conexão e tenta de novo.');
    } finally {
      setIsExporting(false);
    }
  };

  const generateAndSetBuffer = (startDateStr: string, avoidCollisions: boolean, selectedClass: ClassSchedule) => {
    const newItems = getScheduleBuffer(topic, duration, startDateStr, avoidCollisions, selectedClass, classes);
    setGeneratedClassesBuffer(newItems);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40 flex flex-col">
      <Header 
        setScreen={setScreen}
        title={mode === 'plan' ? 'Planejador' : mode === 'activities' ? 'Gerador de Atividades' : mode === 'exam' ? 'Gerador de Provas' : 'Gerador de Slides'}
        subtitle="Fluxo Automatizado" 
        profile={profile}
      />
      
      <div className="bg-white rounded-[1.5rem] p-6 shadow-sm border border-gray-50 mb-6 shrink-0">
        {step === 'input' && (
          <>
            <PillTabs
              layoutKey="planner"
              stretch
              className="mb-6"
              tabs={[
                { id: 'plan', label: 'Plano', icon: BookOpen },
                { id: 'activities', label: 'Atividades', icon: FileText },
                { id: 'slides', label: 'Slides', icon: Presentation },
                { id: 'exam', label: 'Prova', icon: FileQuestion },
              ]}
              active={mode}
              onChange={id => setPlannerMode(id as PlannerMode)}
            />
            <label className="block text-base font-bold text-gray-700 mb-2">Conteúdo ou Arquivo</label>
            <textarea 
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Digite o conteúdo ou cole o texto aqui..." 
              className="w-full bg-[#F8F9FE] border-none rounded-2xl py-4 px-4 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500/20 mb-4 h-32 resize-none"
            />
            <div className="flex items-center justify-center w-full mb-6">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-100 border-dashed rounded-2xl cursor-pointer bg-[#F8F9FE] hover:bg-gray-50 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Plus className="w-8 h-8 mb-2 text-gray-400" />
                  <p className="text-sm text-gray-500">Carregar PDF e jpg</p>
                </div>
                <input type="file" accept=".pdf,image/*" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
            <label className="block text-base font-bold text-gray-700 mb-2">Para qual turma?</label>
            <div className="flex gap-2 mb-6">
              <select 
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className={`flex-1 rounded-2xl py-4 px-4 text-base focus:outline-none transition-all ${
                  selectedClassId 
                    ? 'bg-indigo-600 text-white font-bold' 
                    : 'bg-[#F8F9FE] text-gray-700 focus:ring-2 focus:ring-indigo-500/20'
                }`}
              >
                <option value="">Selecione uma turma</option>
                {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button 
                onClick={() => setIsAddingClass(true)}
                className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0"
              >
                <Plus size={24} />
              </button>
            </div>

            <AnimatePresence>
              {isAddingClass && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6 overflow-hidden"
                >
                  <div className="bg-indigo-50 p-4 rounded-2xl flex gap-2">
                    <input 
                      type="text"
                      value={newClassName}
                      onChange={(e) => setNewClassName(e.target.value)}
                      placeholder="Nome da nova turma..."
                      className="flex-1 bg-white border-none rounded-xl px-4 py-2 text-sm focus:outline-none"
                    />
                    <button 
                      onClick={addNewClass}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold"
                    >
                      Criar
                    </button>
                    <button 
                      onClick={() => setIsAddingClass(false)}
                      className="text-gray-400 px-2"
                    >
                      X
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {!profile?.isPro && profile?.role !== 'admin' && (
              <div className="flex items-center justify-between mb-1 px-1">
                <span className="text-xs text-gray-400">Gerações usadas</span>
                <span className={`text-xs font-bold ${isLimitReached ? 'text-red-500' : generationsUsed >= freeGenerationLimit - 2 ? 'text-amber-500' : 'text-gray-500'}`}>
                  {generationsUsed}/{freeGenerationLimit}
                </span>
              </div>
            )}
            {isLimitReached ? (
              <div className="w-full bg-indigo-50 border border-indigo-200 rounded-2xl py-4 px-4 text-center flex flex-col gap-3">
                <div>
                  <p className="text-indigo-700 font-bold text-sm mb-0.5">Limite do plano gratuito atingido</p>
                  <p className="text-indigo-400 text-xs">Ative o Pro para gerações ilimitadas de planos, slides, atividades e provas.</p>
                </div>
                <a
                  href="https://wa.me/5598981796309?text=Olá! Quero ativar o plano Pro do Prof. Corujão."
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-green-500 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                >
                  <MessageCircle size={16} /> Ativar Pro via WhatsApp
                </a>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (mode === 'plan' && duration === 0) {
                    getSuggestion();
                  } else {
                    setShowGenModal(true);
                  }
                }}
                disabled={loading || !topic || !selectedClassId}
                className={`w-full text-white rounded-2xl py-4 text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-all active:scale-[0.98] ${loading ? 'bg-indigo-500 animate-pulse' : 'bg-indigo-600'}`}
              >
                {loading ? <Loader2 className="animate-spin" /> : <Sparkles size={20} />}
                {loading ? loadingMessage : (mode === 'plan' ? (duration === 0 ? 'Analisar Conteúdo' : 'Gerar Plano') : mode === 'activities' ? 'Gerar Atividades' : mode === 'exam' ? 'Gerar Prova' : 'Gerar Slides')}
              </button>
            )}
            <GenerateModal
              show={showGenModal}
              onClose={() => setShowGenModal(false)}
              onGenerate={() => { setShowGenModal(false); handleMainAction(); }}
              mode={mode}
              tone={tone} setTone={setTone}
              complexity={complexity} setComplexity={setComplexity}
              duration={duration} setDuration={setDuration}
              lessonTime={lessonTime} setLessonTime={setLessonTime}
              questionCount={questionCount} setQuestionCount={setQuestionCount}
              slideCount={slideCount} setSlideCount={setSlideCount}
              focus={focus} setFocus={setFocus}
              groundingContent={groundingContent} setGroundingContent={setGroundingContent}
              turn={turn} setTurn={setTurn}
              questionType={questionType} setQuestionType={setQuestionType}
              examValue={examValue} setExamValue={setExamValue}
              examDuration={examDuration} setExamDuration={setExamDuration}
            />
            {loading && (
              <button
                onClick={cancelCurrentGeneration}
                className="w-full mt-2 text-gray-500 hover:text-red-600 text-sm font-bold py-2 transition-colors"
              >
                Cancelar
              </button>
            )}
            {(error || recentTaskError) && (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-red-500 text-sm text-center font-medium">{error || recentTaskError}</p>
                {recentTaskError && (
                  <button
                    onClick={() => { setError(''); handleMainAction(); }}
                    disabled={loading}
                    className="w-full border border-indigo-400 text-indigo-600 rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <RefreshCw size={15} /> Tentar novamente
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {step === 'suggestion' && (
          <div className="text-center">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Sugestão de Cronograma</h3>
            <p className="text-gray-500 mb-6">Este conteúdo pode ser concluído em:</p>
            <div className="flex items-center justify-center gap-4 mb-8">
              <button onClick={() => setDuration(Math.max(1, duration - 1))} className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-xl font-bold">-</button>
              <span className="text-4xl font-bold text-indigo-600">{duration}</span>
              <button onClick={() => setDuration(duration + 1)} className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-xl font-bold">+</button>
            </div>
            <p className="text-sm text-gray-400 mb-8">Aulas de {lessonTime} minutos</p>
            <button 
              onClick={() => generatePlan()}
              disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-2xl py-4 text-lg font-bold flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" /> : 'Confirmar e Gerar Plano'}
            </button>
            {error && <p className="text-red-500 text-sm mt-3 text-center font-medium">{error}</p>}
          </div>
        )}

        {step === 'plan' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {mode === 'plan' ? 'Plano Gerado' : mode === 'activities' ? 'Atividades Geradas' : mode === 'exam' ? 'Prova Gerada' : 'Slides Gerados'}
              </h3>
              <button onClick={() => setStep('input')} className="text-indigo-600 text-sm font-bold">Novo</button>
            </div>
            {mode === 'plan' && (
              <div className="flex flex-col gap-2 mb-6">
                <div className="flex gap-2">
                  <button
                    onClick={() => { generateResource('activities'); setPlannerMode('activities'); }}
                    className="flex-1 bg-indigo-50 text-indigo-600 rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <FileText size={16} /> Atividades
                  </button>
                  <button
                    onClick={() => { generateResource('slides'); setPlannerMode('slides'); }}
                    className="flex-1 bg-indigo-50 text-indigo-600 rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <Presentation size={16} /> Slides
                  </button>
                </div>
                <button
                  onClick={() => {
                    const selectedClass = schedules.find(s => s.id === selectedClassId);
                    if (selectedClass) generateAndSetBuffer(scheduleStartDate, scheduleAvoidCollisions, selectedClass);
                    setShowSchedulePrompt(true);
                  }}
                  disabled={!selectedClassId}
                  className="w-full bg-emerald-50 text-emerald-700 rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 border border-emerald-100 disabled:opacity-40"
                >
                  <CalendarIcon size={16} /> Agendar no Cronograma
                </button>
              </div>
            )}
            
            {(currentResult && mode === 'slides' && presentationData) && (
              <SlidePreviewList
                presentationData={presentationData}
                setPresentationData={setPresentationData}
                profile={profile}
                isExporting={isExporting}
                regenLoading={regenLoading}
                setRegenLoading={setRegenLoading}
                setError={setError}
                exportPPTX={exportPPTX}
                schedules={schedules}
                classes={classes}
                setClasses={setClasses}
                topic={topic}
                selectedClassId={selectedClassId}
              />
            )}
            
            {(currentResult && mode !== 'slides') && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className="flex flex-col gap-2 mb-4"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 uppercase tracking-wide">
                    {mode === 'exam' ? 'Prova' : mode === 'activities' ? 'Atividades' : 'Plano de Aula'}
                  </span>
                  {selectedClass?.name && <span className="text-[11px] font-medium text-gray-500">Turma: {selectedClass.name}</span>}
                  {(selectedClass?.subject || profile.subject) && <span className="text-[11px] font-medium text-gray-500">{selectedClass?.subject || profile.subject}</span>}
                  <span className="text-[11px] text-gray-400">{new Date().toLocaleDateString('pt-BR')}</span>
                </div>
                {hasGabarito && (
                  <button
                    onClick={() => setShowGabarito(!showGabarito)}
                    className="self-start flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full active:scale-95 transition-transform"
                  >
                    {showGabarito ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showGabarito ? 'Ocultar gabarito' : 'Mostrar gabarito'}
                  </button>
                )}
                <div className="max-h-[60vh] overflow-y-auto no-scrollbar border border-gray-100 rounded-2xl p-4 bg-gray-50">
                  <div className="markdown-body text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{visibleResult}</ReactMarkdown>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                      onClick={async () => {
                        if (preparingDoc !== null) return;
                        setPreparingDoc('main');
                        try {
                          const docType = mode === 'exam' ? 'exam' : mode === 'activities' ? 'activities' : 'plan';
                          const blob = await buildDocx(currentResult as string, docType, {
                            school: selectedClass?.school || profileSchoolName || '',
                            teacher: profileName || '',
                            subject: selectedClass?.subject || profile.subject || '',
                            topic,
                            className: selectedClass?.name || '',
                            duration,
                            lessonTime,
                            turn,
                            examValue,
                            examDuration,
                          });
                          const label = docType === 'plan' ? 'plano' : docType === 'exam' ? 'avaliacao' : 'atividades';
                          const filename = `${label}-${(topic || 'material').replace(/\s+/g, '-')}.docx`;
                          await downloadBlob(blob, filename);
                        } catch (e) {
                          console.error('Erro ao exportar Word:', e);
                          toast.error('O documento Word fugiu! Tenta gerar de novo.');
                        } finally {
                          setPreparingDoc(null);
                        }
                      }}
                      disabled={preparingDoc !== null}
                      className="flex-1 bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {preparingDoc === 'main' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Exportar Word
                    </button>
                  <button
                    onClick={() => {
                      const docType = mode === 'exam' ? 'exam' : mode === 'activities' ? 'activities' : 'plan';
                      printPlannerContent(
                        topic || 'Material',
                        currentResult as string,
                        docType,
                        profileName,
                        selectedClass?.school || profileSchoolName
                      );
                    }}
                    className="px-4 bg-gray-100 text-gray-700 rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
                    title="Imprimir / PDF"
                  >
                    <FileText size={16} /> PDF
                  </button>
                </div>
              </motion.div>
            )}

          </div>
        )}
      </div>

      {showSchedulePrompt && (
        <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-gray-900/40 backdrop-blur-sm p-4 h-[100dvh]">
          <motion.div 
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-white rounded-[2rem] p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-center mb-4">
              <div className="w-12 h-1 bg-gray-200 rounded-full"></div>
            </div>
            
            <div className="mb-4 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 mb-3">
                <CalendarIcon size={24} />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Agendar as Aulas?</h2>
              <p className="text-sm text-gray-500">
                Gostaria de distribuir os tópicos gerados no cronograma da turma <span className="font-bold">{schedules.find(s => s.id === selectedClassId)?.name || ''}</span>?
              </p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-100">
              <label className="block text-sm font-semibold text-gray-700 mb-2">A partir de qual data?</label>
              <input 
                type="date"
                value={scheduleStartDate}
                onChange={(e) => {
                  setScheduleStartDate(e.target.value);
                  const selectedClass = schedules.find(s => s.id === selectedClassId);
                  if (selectedClass) {
                    generateAndSetBuffer(e.target.value, scheduleAvoidCollisions, selectedClass);
                  }
                }}
                className="w-full bg-white border border-gray-300 rounded-xl p-3 text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium mb-4"
              />

              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={scheduleAvoidCollisions}
                    onChange={(e) => {
                      setScheduleAvoidCollisions(e.target.checked);
                      const selectedClass = schedules.find(s => s.id === selectedClassId);
                      if (selectedClass) {
                        generateAndSetBuffer(scheduleStartDate, e.target.checked, selectedClass);
                      }
                    }}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-gray-300 rounded peer-checked:bg-indigo-600 peer-checked:border-indigo-600 transition-colors flex items-center justify-center">
                    <CheckCircle2 size={14} className="text-white opacity-0 peer-checked:opacity-100" />
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-800">Tentar evitar colisões</span>
                  <span className="text-xs text-gray-500">Pular dias que já possuem aula marcada</span>
                </div>
              </label>
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-900 mb-3 px-1">Pré-visualização:</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-2 no-scrollbar">
                {generatedClassesBuffer.length === 0 && (
                  <p className="text-sm text-gray-500 italic text-center py-4">Nenhuma data disponível encontrada.</p>
                )}
                {generatedClassesBuffer.map((item, index) => (
                  <div key={item.id} className="flex items-center justify-between bg-white border border-gray-100 p-3 rounded-xl shadow-sm">
                    <span className="text-sm font-medium text-gray-800 line-clamp-1 flex-1 pr-2">{item.title}</span>
                    <span className="text-xs bg-indigo-50 text-indigo-700 font-bold px-2 py-1 rounded-lg shrink-0 border border-indigo-100">{item.date}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button 
                onClick={() => {
                  addClassItems(generatedClassesBuffer);
                  setShowSchedulePrompt(false);
                  setGeneratedClassesBuffer([]);
                  if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('Cronograma Atualizado!', { icon: '/favicon.ico' });
                  }
                }}
                disabled={generatedClassesBuffer.length === 0}
                className="w-full bg-indigo-600 text-white rounded-xl py-4 text-sm font-bold flex items-center justify-center gap-2 disabled:bg-indigo-300 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCircle2 size={18} /> Sim, confirmar e agendar
              </button>
              <button 
                onClick={() => {
                  setShowSchedulePrompt(false);
                  setGeneratedClassesBuffer([]);
                }}
                className="w-full bg-gray-50 text-gray-600 rounded-xl py-3 text-sm font-bold border border-gray-100 hover:bg-gray-100 transition-colors"
              >
                Não, apenas salvar o plano
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};

const ChatScreen = ({
  profile,
  setProfile,
  estudioContext,
  messages,
  setMessages,
  classes,
  schedules,
  savedResources,
  addClassItems,
  customEvents,
  setCustomEvents,
  setScreen,
  notifications,
  setNotifications,
  generatePlan,
  generateResource,
  plannerTopic,
  setPlannerTopic,
  plannerSelectedClassId,
  setPlannerSelectedClassId,
  setPlannerMode,
  getScheduleBuffer
}: { 
  profile: UserProfile, 
  setProfile: (p: UserProfile) => void,
  estudioContext: string, 
  messages: {id: string, role: 'user' | 'model', text: string, date: number, attachment?: { mimeType: string, url: string, data: string, name: string }}[], 
  setMessages: (m: {id: string, role: 'user' | 'model', text: string, date: number, attachment?: { mimeType: string, url: string, data: string, name: string }}[]) => void,
  classes: ClassItem[],
  schedules: ClassSchedule[],
  savedResources: SavedResource[],
  addClassItems: (items: ClassItem[]) => void,
  customEvents: {id: string, title: string, date: string, type: 'prep' | 'admin' | 'holiday' | 'commemorative', status?: 'pending' | 'done'}[],
  setCustomEvents: (c: {id: string, title: string, date: string, type: 'prep' | 'admin' | 'holiday' | 'commemorative', status?: 'pending' | 'done'}[]) => void,
  setScreen: (s: Screen) => void,
  notifications?: any[],
  setNotifications?: (n: any[]) => void,
  generatePlan: (topic?: string, classId?: string) => Promise<void>,
  generateResource: (type: 'activities' | 'slides' | 'exam', topic?: string, classId?: string) => Promise<void>,
  plannerTopic: string,
  setPlannerTopic: (t: string) => void,
  plannerSelectedClassId: string,
  setPlannerSelectedClassId: (id: string) => void,
  setPlannerMode: (m: PlannerMode) => void,
  getScheduleBuffer: (topic: string, duration: number, startDateStr: string, avoidCollisions: boolean, selectedClass: ClassSchedule, existingClasses: ClassItem[]) => ClassItem[]
}) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ file: File, url: string, base64: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const chatMenuRef = useRef<HTMLDivElement>(null);
  const chatLoadingMsg = useFunnyLoadingMessage(loading, 'chat');

  useEffect(() => {
    if (!showChatMenu) return;
    const handler = (e: MouseEvent) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(e.target as Node)) {
        setShowChatMenu(false);
        setConfirmClear(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showChatMenu]);
  const [visibleCount, setVisibleCount] = useState(20);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const startLongPress = (text: string) => {
    longPressTimer.current = setTimeout(() => {
      const plain = text.replace(/[*_~`#>\-]/g, '').trim();
      navigator.clipboard.writeText(plain).then(() => toast.success('Copiado!')).catch(() => toast.error('Não foi possível copiar.'));
    }, 600);
  };
  const cancelLongPress = () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); };

  const SUGGESTIONS = ['Como montar uma aula?', 'Me dê ideias para atividades', 'Minha turma está agitada, o que fazer?', 'Como adaptar para aluno com TDAH?', 'Escreva um bilhete para os pais', 'Avaliações criativas'];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages]);

  const sortedMessages = [...messages].sort((a, b) => (a.date || 0) - (b.date || 0));
  const filteredMessages = sortedMessages.filter(m => m.text.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError(null);
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setFileError('Ops! Este arquivo é muito grande. Por favor, envie arquivos de até 5MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        setSelectedFile({ file, url: result, base64 });
      };
      reader.readAsDataURL(file);
    }
  };

  const sendMessage = async (messageText?: string) => {
    const textToSend = messageText || input;
    if (!textToSend.trim() && !selectedFile) return;
    
    const currentFile = selectedFile;
    setSelectedFile(null);

    const newMessages = [...messages, { 
      role: 'user' as const, 
      text: textToSend, 
      id: Math.random().toString(36).slice(2, 11),
      date: Date.now(),
      attachment: currentFile ? {
        mimeType: currentFile.file.type,
        url: currentFile.url,
        data: currentFile.base64,
        name: currentFile.file.name
      } : undefined
    }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    const sortedHistory = [...newMessages].sort((a, b) => (a.date || 0) - (b.date || 0));
    
    try {
      const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      const now = Date.now();

      const upcomingClasses = [...classes]
        .filter(c => c.timestamp >= now)
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, 10)
        .map(c => `- ${c.title} (${c.className}) em ${c.date}`)
        .join('\n') || 'Nenhuma aula agendada';

      const upcomingEvents = customEvents
        .slice(0, 3)
        .map(e => `- ${e.title} em ${e.date} [${e.type}]`)
        .join('\n') || 'Nenhum evento';

      const acervoSummary = savedResources
        .slice(-5)
        .map(r => `- ${r.title} (${r.type})`)
        .join('\n') || 'Histórico vazio';

      const turmas = schedules.map(s => s.name).join(', ') || 'Nenhuma turma cadastrada';

      const basePrompt = `Você é o "Prof. Corujão", assistente pedagógico pessoal e parceiro de sala de aula do professor.
      Você atua como um CONTROLE REMOTO total do aplicativo (navegar entre telas, criar materiais, agendar aulas, atualizar perfil) E como um coordenador pedagógico experiente, sempre disponível para apoiar o dia a dia da docência.

      Hoje é: ${today}.

      Contexto Atual:
      - Professor: ${profile.name}
      - Escola: ${profile.schoolName || 'Não informada'}
      - Turmas cadastradas: ${turmas}
      - Próximas aulas (máx. 10):
      ${upcomingClasses}
      - Próximos eventos:
      ${upcomingEvents}
      - Últimos materiais gerados:
      ${acervoSummary}
      - Conteúdo do Estúdio: ${estudioContext ? `${estudioContext.substring(0, 300)}...` : 'Vazio'}

      Suas Capacidades no App (USE AS FUNÇÕES SEMPRE QUE POSSÍVEL):
      1. NAVEGAÇÃO: Mudar para as telas 'home', 'planner', 'chat', 'calendar', 'profile', 'estudio', 'biblioteca'.
      2. MATERIAL DIDÁTICO: Gerar Planos de Aula, Slides, Atividades ou Provas. Os materiais ficam disponíveis no histórico ao concluir.
      3. AGENDAMENTO: Marcar uma aula individual (schedule_class) ou uma série de aulas (schedule_lesson_series).
      4. PERFIL: Atualizar nome, disciplina ou escola.

      Sua Expertise Pedagógica (responda diretamente no chat, sem funções):
      - GESTÃO DE SALA: estratégias práticas para indisciplina, turmas agitadas, conflitos entre alunos, engajamento.
      - INCLUSÃO: adaptações para alunos com TDAH, TEA, dislexia e outras necessidades; sugestões alinhadas ao PEI.
      - DIDÁTICA: metodologias ativas, avaliação formativa, recuperação de aprendizagem, dúvidas sobre BNCC.
      - COMUNICAÇÃO: redigir bilhetes e comunicados para famílias, devolutivas de avaliação, relatórios de aluno.
      - CONTEÚDO: explicar qualquer conteúdo escolar, sugerir analogias e exemplos para usar em aula.
      Ao dar conselhos pedagógicos, seja concreto e acionável: passos numerados, frases prontas para usar, exemplos reais. Considere o nível de ensino das turmas do professor.

      Regras de Comportamento:
      1. Seja proativo, conciso e profissional.
      2. NUNCA use emojis.
      3. Se o usuário pedir algo genérico como "Gere um material sobre X", pergunte se ele quer Slides, Plano, Atividades ou Prova, ou sugira um deles.
      4. Quando usar uma função de geração, informe que o material ficará disponível no histórico ao concluir.
      5. Se o professor disser apenas "Oi", faça um resumo do dia baseado nas aulas e sugira algo.
      6. Se o professor desabafar sobre dificuldades em sala, acolha brevemente e ofereça 2-3 estratégias práticas imediatas.

      Histórico:
      ${sortedHistory.slice(-20).map(m => `[${new Date(m.date).toLocaleTimeString()}] ${m.role === 'user' ? 'Professor' : 'Assistente'}: ${m.text}`).join('\n')}

      Responda à última solicitação:`;

      const parts: any[] = [{ text: basePrompt }];
      if (currentFile) {
        parts.push({
          inlineData: {
            mimeType: currentFile.file.type,
            data: currentFile.base64
          }
        });
      }

      const response = await generateContentWithRetry({
        model: AI_MODEL,
        contents: { parts },
        config: {
          tools: [{
            functionDeclarations: [
              {
                name: 'schedule_class',
                description: 'Agendar uma aula específica no calendário.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    date: { type: Type.STRING, description: 'Ex: 15 Abr' },
                    className: { type: Type.STRING }
                  },
                  required: ['title', 'date', 'className']
                }
              },
              {
                name: 'change_screen',
                description: 'Navegar para uma tela diferente no aplicativo.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    screen: {
                      type: Type.STRING,
                      enum: ['home', 'planner', 'chat', 'calendar', 'profile', 'estudio', 'biblioteca', 'gamificacao', 'ferramentas', 'acervo'],
                      description: 'Nome da tela de destino. gamificacao = Turma Gamificada (pontos, equipes, sorteador, timer); ferramentas = Kit do Professor (pareceres, rubricas, adaptações de inclusão, diário de classe); acervo = Histórico de materiais gerados'
                    }
                  },
                  required: ['screen']
                }
              },
              {
                name: 'generate_slides',
                description: 'Gerar uma apresentação de slides completa sobre um tópico.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING },
                    className: { type: Type.STRING, description: 'Nome da turma (opcional, busca nos horários se não enviado)' }
                  },
                  required: ['topic']
                }
              },
              {
                name: 'generate_lesson_plan',
                description: 'Gerar um plano de aula detalhado.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING },
                    className: { type: Type.STRING }
                  },
                  required: ['topic']
                }
              },
              {
                name: 'generate_activities',
                description: 'Gerar uma lista de exercícios/atividades.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING },
                    className: { type: Type.STRING }
                  },
                  required: ['topic']
                }
              },
              {
                name: 'generate_exam',
                description: 'Gerar uma prova/avaliação com questões de múltipla escolha e dissertativas.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING },
                    className: { type: Type.STRING }
                  },
                  required: ['topic']
                }
              },
              {
                name: 'schedule_lesson_series',
                description: 'Agendar uma série de aulas sobre um tópico em lote, distribuídas nos dias de aula da turma.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING },
                    className: { type: Type.STRING },
                    num_classes: { type: Type.NUMBER, description: 'Quantidade de aulas a agendar' },
                    start_date: { type: Type.STRING, description: 'Data de início no formato YYYY-MM-DD' }
                  },
                  required: ['topic', 'className', 'num_classes']
                }
              },
              {
                name: 'update_profile',
                description: 'Atualizar informações do perfil do professor.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    subject: { type: Type.STRING },
                    schoolName: { type: Type.STRING }
                  }
                }
              }
            ]
          }]
        }
      });
      
      if (response.functionCalls && response.functionCalls.length > 0) {
        let responseText = "";
        for (const call of response.functionCalls) {
          const args = call.args as any;
          
          if (call.name === 'schedule_class') {
            addClassItems([{
              id: Math.random().toString(36).slice(2, 11),
              title: args.title,
              date: args.date,
              status: 'pending',
              className: args.className,
              timestamp: Date.now()
            }]);
            responseText += `Aula "${args.title}" agendada para ${args.date}. `;
          } else if (call.name === 'change_screen') {
            setScreen(args.screen as Screen);
            responseText += `Navegando para ${args.screen}. `;
          } else if (call.name === 'generate_slides') {
            const targetClass = schedules.find(s => s.name.toLowerCase().includes((args.className || '').toLowerCase()));
            setPlannerTopic(args.topic);
            if (targetClass) setPlannerSelectedClassId(targetClass.id);
            setPlannerMode('slides');
            generateResource('slides', args.topic, targetClass?.id);
            responseText += `Criando slides sobre "${args.topic}". O material ficará disponível no histórico ao concluir.`;
          } else if (call.name === 'generate_lesson_plan') {
            const targetClass = schedules.find(s => s.name.toLowerCase().includes((args.className || '').toLowerCase()));
            setPlannerTopic(args.topic);
            if (targetClass) setPlannerSelectedClassId(targetClass.id);
            setPlannerMode('plan');
            generatePlan(args.topic, targetClass?.id);
            responseText += `Criando plano de aula sobre "${args.topic}". O material ficará disponível no histórico ao concluir.`;
          } else if (call.name === 'generate_activities') {
            const targetClass = schedules.find(s => s.name.toLowerCase().includes((args.className || '').toLowerCase()));
            setPlannerTopic(args.topic);
            if (targetClass) setPlannerSelectedClassId(targetClass.id);
            setPlannerMode('activities');
            generateResource('activities', args.topic, targetClass?.id);
            responseText += `Gerando atividades sobre "${args.topic}". O material ficará disponível no histórico ao concluir.`;
          } else if (call.name === 'generate_exam') {
            const targetClass = schedules.find(s => s.name.toLowerCase().includes((args.className || '').toLowerCase()));
            setPlannerTopic(args.topic);
            if (targetClass) setPlannerSelectedClassId(targetClass.id);
            setPlannerMode('exam');
            generateResource('exam', args.topic, targetClass?.id);
            responseText += `Gerando prova sobre "${args.topic}". O material ficará disponível no histórico ao concluir.`;
          } else if (call.name === 'schedule_lesson_series') {
            const targetClass = schedules.find(s => s.name.toLowerCase().includes((args.className || '').toLowerCase()));
            if (targetClass) {
              const startDate = args.start_date || new Date().toISOString().split('T')[0];
              const buffer = getScheduleBuffer(args.topic, args.num_classes || 4, startDate, true, targetClass, classes);
              if (buffer.length > 0) {
                addClassItems(buffer);
                responseText += `${buffer.length} aulas sobre "${args.topic}" agendadas para ${targetClass.name}. `;
              } else {
                responseText += `Nenhum horário disponível encontrado para "${targetClass.name}" a partir de ${startDate}. `;
              }
            } else {
              responseText += `Turma "${args.className}" não encontrada. Verifique o nome da turma no perfil. `;
            }
          } else if (call.name === 'update_profile') {
            setProfile({ ...profile, ...args });
            responseText += `Perfil atualizado com sucesso. `;
          }
        }
        setMessages([...newMessages, { id: Math.random().toString(36).slice(2, 11), role: 'model', text: responseText || "Tudo certo! Realizei as ações solicitadas.", date: Date.now() }]);
      } else {
        setMessages([...newMessages, { id: Math.random().toString(36).slice(2, 11), role: 'model', text: response.text || "Em que posso ajudar?", date: Date.now() }]);
      }
    } catch (error) {
      console.error(error);
      setMessages([...newMessages, { id: Math.random().toString(36).slice(2, 11), role: 'model', text: '❌ ' + formatApiError(error, 'Tive um branco aqui, professor. Envia de novo que eu respondo.'), date: Date.now() }]);
    }
    setLoading(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-28 h-full flex flex-col">
      <Header
        setScreen={setScreen}
        title="Prof. Corujão"
        subtitle="Assistente"
        profile={profile}
        notifications={notifications}
        setNotifications={setNotifications}
        bannerImage={null}
        rightAction={
          <div ref={chatMenuRef} className="relative">
            <button
              onClick={() => { setShowChatMenu(v => !v); setConfirmClear(false); }}
              className="w-10 h-10 flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-100"
            >
              <Settings size={20} className="text-gray-600" />
            </button>
            <AnimatePresence>
              {showChatMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-12 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 min-w-[190px] z-50"
                >
                  {!confirmClear ? (
                    <button
                      onClick={() => setConfirmClear(true)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-50 text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                      <span className="text-sm font-medium">Apagar histórico</span>
                    </button>
                  ) : (
                    <div className="px-3 py-2">
                      <p className="text-xs text-gray-500 mb-3 leading-snug">Tem certeza? Isso apaga toda a conversa.</p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmClear(false)} className="flex-1 text-xs py-2 rounded-xl bg-gray-100 text-gray-600 font-semibold">Não</button>
                        <button
                          onClick={() => { setMessages([]); setShowChatMenu(false); setConfirmClear(false); toast.success('Histórico apagado.'); }}
                          className="flex-1 text-xs py-2 rounded-xl bg-red-500 text-white font-semibold"
                        >Apagar</button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        }
      />
      
      <div className="mb-2">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder="Pesquisar nas notas..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-gray-50 rounded-[1.5rem] py-3 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar mb-4 space-y-4">
        {/* Quick suggestions when conversation is empty */}
        {messages.length <= 1 && !searchQuery && (
          <div className="flex flex-wrap gap-2 pt-2 pb-1">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                className="bg-white border border-indigo-100 text-indigo-600 text-xs font-medium px-3 py-2 rounded-2xl shadow-sm active:scale-95 transition-transform"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Ver mais — pagina o histórico */}
        {filteredMessages.length > visibleCount && (
          <button
            onClick={() => setVisibleCount(v => v + 20)}
            className="w-full text-xs text-indigo-500 font-semibold py-2 bg-indigo-50 rounded-2xl"
          >
            Ver mais ({filteredMessages.length - visibleCount} anteriores)
          </button>
        )}

        {filteredMessages.length === 0 && searchQuery && (
          <div className="text-center py-8 text-gray-400 text-sm">Nenhuma nota encontrada.</div>
        )}

        <AnimatePresence initial={false}>
          {filteredMessages.slice(-visibleCount).map((msg) => {
            const isError = msg.text.startsWith('❌');
            const cleanText = isError ? msg.text.replace(/^❌\s*/, '') : msg.text;
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 14, x: msg.role === 'user' ? 20 : -20 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} items-end gap-2`}
              >
                {msg.role !== 'user' && (
                  <img src="https://i.ibb.co/JwXsb4D4/20260521-154229-0000.png" alt="" className="w-11 h-11 object-contain shrink-0 mb-4" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
                )}
                <div
                  onTouchStart={() => startLongPress(cleanText)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                  className={`max-w-[85%] p-4 rounded-2xl select-none ${
                    isError
                      ? 'bg-red-50 text-red-700 rounded-bl-none border border-red-100'
                      : msg.role === 'user'
                      ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-br-none shadow-md shadow-indigo-600/20'
                      : 'bg-white text-gray-800 rounded-bl-none shadow-sm border border-gray-50'
                  }`}
                >
                  {msg.attachment && (
                    <div className="mb-2">
                      {msg.attachment.mimeType.startsWith('image/') && msg.attachment.url ? (
                        <img src={msg.attachment.url} alt="Anexo" className="max-w-full rounded-xl border border-black/10" />
                      ) : (
                        <div className="flex items-center gap-2 bg-black/10 p-3 rounded-xl">
                          {msg.attachment.mimeType.startsWith('image/') ? <ImageIcon size={20} /> : <FileText size={20} />}
                          <span className="text-sm font-medium truncate max-w-[150px]">{msg.attachment.name || 'Arquivo anexado'}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="text-base leading-relaxed">
                    {renderChatText(cleanText, msg.role === 'user' && !isError)}
                  </div>
                  <div className={`text-[10px] mt-2 text-right ${msg.role === 'user' && !isError ? 'text-indigo-200' : isError ? 'text-red-300' : 'text-gray-400'}`}>
                    {new Date(msg.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={chatEndRef} />
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0, y: 10, x: -20 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="flex justify-start items-end gap-2"
            >
              <img src="https://i.ibb.co/JwXsb4D4/20260521-154229-0000.png" alt="" className="w-11 h-11 object-contain shrink-0 mb-1" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
              <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-none shadow-sm border border-gray-50 flex flex-col gap-1.5 max-w-[240px]">
                <div className="flex gap-2 items-center">
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.18s' }} />
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.36s' }} />
                </div>
                {chatLoadingMsg && (
                  <p className="text-xs text-indigo-400 leading-tight">{chatLoadingMsg}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.div
        animate={{ boxShadow: input.length > 0 ? '0 0 0 2px #6366f1' : '0 1px 3px 0 rgb(0 0 0 / 0.05)' }}
        transition={{ duration: 0.2 }}
        className="bg-white p-2 rounded-3xl border border-gray-50 flex flex-col gap-2 shrink-0"
      >
        {fileError && (
          <div className="px-4 py-2 bg-red-50 text-red-600 text-xs rounded-xl mx-2 mt-2 border border-red-100 flex justify-between items-center">
            <span>{fileError}</span>
            <button onClick={() => setFileError(null)}><Plus size={14} className="rotate-45" /></button>
          </div>
        )}
        {selectedFile && (
          <div className="relative self-start ml-2 mt-2">
            {selectedFile.file.type.startsWith('image/') ? (
              <img src={selectedFile.url} alt="Preview" className="h-16 rounded-xl object-cover border border-gray-200" />
            ) : (
              <div className="h-16 px-4 bg-gray-50 rounded-xl border border-gray-200 flex items-center gap-2">
                <FileText size={20} className="text-indigo-500" />
                <span className="text-xs font-medium text-gray-700 truncate max-w-[120px]">{selectedFile.file.name}</span>
              </div>
            )}
            <button
              onClick={() => setSelectedFile(null)}
              className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md"
            >
              <Plus size={12} className="rotate-45" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            accept="image/*,.pdf,.doc,.docx,.txt"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-400 hover:text-indigo-600 transition-colors ml-1"
          >
            <Paperclip size={20} />
          </button>
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Digite uma ideia, lembrete ou tarefa..." 
            className="flex-1 bg-transparent border-none px-2 py-2 text-base focus:outline-none"
          />
          <motion.button
            onClick={() => sendMessage()}
            disabled={loading || (!input.trim() && !selectedFile)}
            whileTap={{ scale: 0.82 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center disabled:opacity-50 shrink-0"
          >
            <Send size={18} />
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const ProfileScreen = ({
  user,
  schedules,
  setSchedules,
  profile,
  setProfile,
  savedResources,
  setScreen,
  onAddClass,
  customEvents,
  setCustomEvents,
  notifications,
  setNotifications,
  onResetAccount,
  onDeleteAccount,
  onImportSyllabus
}: {
  user: any,
  schedules: ClassSchedule[],
  setSchedules: (s: ClassSchedule[]) => void,
  profile: UserProfile,
  setProfile: (p: UserProfile) => void,
  savedResources: SavedResource[],
  setScreen: (s: Screen) => void,
  onAddClass: (c: ClassSchedule) => void,
  customEvents: {id: string, title: string, date: string, type: 'prep' | 'admin' | 'holiday' | 'commemorative', status?: 'pending' | 'done'}[],
  setCustomEvents: (c: {id: string, title: string, date: string, type: 'prep' | 'admin' | 'holiday' | 'commemorative', status?: 'pending' | 'done'}[]) => void,
  notifications?: any[],
  setNotifications?: (n: any[]) => void,
  onResetAccount?: () => void,
  onDeleteAccount?: () => Promise<void>,
  onImportSyllabus?: (cls: ClassSchedule) => void
}) => {
  type ClassFormData = { name: string; subject: string; level: string; shift: string; school: string; profile: string; color: string; days: number[]; dayTimes: Record<number, string> };
  const emptyClassForm: ClassFormData = { name: '', subject: '', level: 'Ensino Fundamental II', shift: 'Manhã', school: '', profile: '', color: '#4F46E5', days: [], dayTimes: {} };
  const [editingClass, setEditingClass] = useState<null | 'new' | ClassSchedule>(null);
  const [classForm, setClassForm] = useState<ClassFormData>(emptyClassForm);
  const [classFormError, setClassFormError] = useState<string | null>(null);
  const [showAdvancedClass, setShowAdvancedClass] = useState(false);
  const [deleteConfirmClassId, setDeleteConfirmClassId] = useState<string | null>(null);
  const classColors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState(profile.name);
  const [profileSubject, setProfileSubject] = useState(profile.subject);
  const [profileSchoolName, setProfileSchoolName] = useState(profile.schoolName || '');
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const daysOfWeek = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const openAddClass = () => {
    setClassForm(emptyClassForm);
    setClassFormError(null);
    setShowAdvancedClass(false);
    setEditingClass('new');
  };

  const openEditClass = (s: ClassSchedule) => {
    // Para turmas legadas sem dayTimes, popula com o campo time para todos os dias
    const legacyDayTimes = s.time ? Object.fromEntries((s.days || []).map(d => [d, s.time])) : {};
    setClassForm({
      name: s.name,
      subject: s.subject || '',
      level: s.level || 'Ensino Fundamental II',
      shift: s.shift || 'Manhã',
      school: s.school || '',
      profile: s.classProfile || '',
      color: s.color || '#4F46E5',
      days: s.days || [],
      dayTimes: s.dayTimes || legacyDayTimes,
    });
    setClassFormError(null);
    setShowAdvancedClass(false);
    setEditingClass(s);
  };

  const handleSaveClass = () => {
    setClassFormError(null);
    if (!classForm.name.trim()) { setClassFormError('Informe o nome da turma.'); return; }
    const firstTime = classForm.dayTimes[classForm.days[0]] || '08:00';
    const classData = {
      name: classForm.name.trim(),
      days: classForm.days,
      time: firstTime,
      dayTimes: classForm.dayTimes,
      color: classForm.color,
      level: classForm.level,
      subject: classForm.subject || undefined,
      school: classForm.school || undefined,
      shift: classForm.shift || undefined,
      classProfile: classForm.profile || undefined,
    };
    if (editingClass === 'new') {
      onAddClass({ id: Math.random().toString(36).slice(2, 11), ...classData });
    } else if (editingClass && typeof editingClass !== 'string') {
      setSchedules(schedules.map(s => s.id === (editingClass as ClassSchedule).id ? { ...s, ...classData } : s));
    }
    setEditingClass(null);
  };

  const toggleFormDay = (dayIndex: number) => {
    setClassForm(f => {
      const newDays = f.days.includes(dayIndex)
        ? f.days.filter(d => d !== dayIndex)
        : [...f.days, dayIndex].sort((a, b) => a - b);
      return { ...f, days: newDays };
    });
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 400;
        let { width, height } = img;
        if (width > height) { if (width > MAX) { height = Math.round(height * MAX / width); width = MAX; } }
        else { if (height > MAX) { width = Math.round(width * MAX / height); height = MAX; } }
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          setIsUploadingPhoto(true);
          try {
            const ref = storageRef(storage, `users/${user.uid}/photo.jpg`);
            await uploadBytesResumable(ref, blob).then(snap => snap);
            const url = await getDownloadURL(ref);
            setProfile({ ...profile, photo: url });
          } catch {
            toast.error('Sua foto nao subiu dessa vez. Tente de novo!');
          } finally {
            setIsUploadingPhoto(false);
          }
        }, 'image/jpeg', 0.7);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = () => {
    setProfile({ ...profile, name: profileName, subject: profileSubject || undefined, schoolName: profileSchoolName || undefined });
    setIsEditingProfile(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title="Meu Perfil" subtitle="Configurações" profile={profile} notifications={notifications} setNotifications={setNotifications} bannerImage="https://i.ibb.co/XZmvBD0Q/7-20260419-213906-0002.png" />
      
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 rounded-[2rem] p-6 shadow-lg mb-8 flex flex-col items-center text-center">
        <div className="absolute -top-14 -right-14 w-44 h-44 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-12 w-40 h-40 bg-violet-400/20 rounded-full blur-2xl pointer-events-none" />
        <div className="relative inline-block mb-4">
          <div className={`w-24 h-24 rounded-full overflow-hidden shadow-xl border-[3px] border-white/80 relative group cursor-pointer flex items-center justify-center ${profile.photo ? 'bg-gray-200' : 'bg-white/15'}`} onClick={() => !isUploadingPhoto && fileInputRef.current?.click()}>
            {profile.photo ? (
              <img src={profile.photo} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { setProfile({ ...profile, photo: '' }); }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-white/10 text-white">
                <User size={48} />
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {isUploadingPhoto ? <Loader2 size={24} className="text-white animate-spin" /> : <Camera size={24} className="text-white" />}
            </div>
            {isUploadingPhoto && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 size={24} className="text-white animate-spin" /></div>}
          </div>
          {profile.photo && !isUploadingPhoto && (
            <button
              onClick={() => setProfile({ ...profile, photo: '' })}
              className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md border-2 border-white"
            >
              <X size={12} />
            </button>
          )}
          <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handlePhotoUpload} disabled={isUploadingPhoto} />
        </div>
        {isEditingProfile ? (
          <div className="relative w-full space-y-3 mt-4 bg-white rounded-2xl p-4 text-left">
            <div className="text-left">
              <label className="text-xs font-bold text-gray-400 uppercase ml-1">Seu Nome</label>
              <input
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                className="w-full text-base font-bold text-gray-900 border-b-2 border-indigo-500 focus:outline-none pb-1 mt-1"
                autoFocus
              />
            </div>
            <p className="text-xs text-gray-400 text-left px-1 pt-1">
              Disciplina e escola são configurados em cada turma. Os campos abaixo são usados como padrão quando você gerar material sem turma selecionada.
            </p>
            <div className="text-left">
              <label className="text-xs font-bold text-gray-400 uppercase ml-1">Disciplina padrão</label>
              <select
                value={profileSubject}
                onChange={e => setProfileSubject(e.target.value)}
                className="w-full text-sm text-gray-700 border-b-2 border-indigo-500 focus:outline-none pb-1 mt-1 bg-transparent"
              >
                <option value="">Nenhuma</option>
                {SUBJECT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="text-left">
              <label className="text-xs font-bold text-gray-400 uppercase ml-1">Escola padrão</label>
              <input
                value={profileSchoolName}
                onChange={e => setProfileSchoolName(e.target.value)}
                placeholder="Ex: Escola Estadual Padrão"
                className="w-full text-sm text-gray-600 border-b-2 border-indigo-500 focus:outline-none pb-1 mt-1"
              />
            </div>
          </div>
        ) : (
          <>
            <h2 className="relative text-xl font-black text-white mt-2">{profile.name || 'Professor'}</h2>
            {profile.subject && <p className="relative text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200 mt-1">{profile.subject}</p>}
            {profile.schoolName && (
              <p className="relative text-sm text-white font-medium mt-2 bg-white/15 border border-white/20 backdrop-blur px-3 py-1 rounded-full">
                {profile.schoolName}
              </p>
            )}
            {user?.email && <p className="relative text-xs text-indigo-200/80 mt-2">{user.email}</p>}
          </>
        )}

        <button
          onClick={() => isEditingProfile ? saveProfile() : setIsEditingProfile(true)}
          className={`relative mt-6 px-6 py-2.5 rounded-full text-base font-bold w-full active:scale-[0.98] transition-all ${isEditingProfile ? 'bg-white text-indigo-700 shadow-lg' : 'bg-white/15 border border-white/25 text-white backdrop-blur'}`}
        >
          {isEditingProfile ? 'Salvar' : 'Editar Perfil'}
        </button>
      </div>

      {/* Pro Status Card */}
      {profile.isPro || profile.role === 'admin' ? (
        <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-[2rem] p-5 shadow-lg mb-4 flex items-center gap-4">
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center shrink-0"><Crown size={28} className="text-white" /></div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="bg-white text-orange-600 text-xs font-black px-2 py-0.5 rounded-full tracking-wider uppercase">PRO</span>
              {profile.role === 'admin' && <span className="bg-white/30 text-white text-xs font-black px-2 py-0.5 rounded-full">ADMIN</span>}
            </div>
            <p className="text-white font-bold text-sm">Acesso ilimitado ativo</p>
            <p className="text-orange-100 text-xs mt-0.5">Gerações ilimitadas, todos os recursos desbloqueados.</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-[2rem] p-5 shadow-sm border-2 border-gray-100 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center"><Lock size={18} className="text-indigo-600" /></div>
            <div>
              <p className="font-bold text-gray-900 text-sm">Modo Gratuito</p>
              <p className="text-xs text-gray-400">{profile.generationsUsed ?? 0} de 10 gerações usadas</p>
            </div>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 mb-4">
            <div
              className="bg-gradient-to-r from-indigo-500 to-violet-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(100, ((profile.generationsUsed ?? 0) / 10) * 100)}%` }}
            />
          </div>
          <a
            href="https://wa.me/5598981796309?text=Olá! Quero ativar o plano Pro do Prof. Corujão."
            target="_blank"
            rel="noopener noreferrer"
            className="w-full bg-green-500 text-white font-bold py-3 rounded-2xl flex items-center justify-center gap-2 text-sm shadow-lg shadow-green-500/25 active:scale-[0.98] transition-transform"
          >
            <MessageCircle size={18} /> Ativar Pro via WhatsApp
          </a>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Turmas', value: schedules.length, icon: Users, chip: 'bg-indigo-50 text-indigo-600', action: undefined as (() => void) | undefined },
          { label: 'Materiais', value: savedResources.length, icon: FolderOpen, chip: 'bg-amber-50 text-amber-600', action: () => setScreen('acervo') },
          { label: 'Gerações', value: profile.generationsUsed ?? 0, icon: Sparkles, chip: 'bg-violet-50 text-violet-600', action: undefined },
        ].map(stat => (
          <button
            key={stat.label}
            onClick={stat.action}
            disabled={!stat.action}
            className={`bg-white rounded-2xl p-4 shadow-sm border border-gray-50 text-center ${stat.action ? 'active:scale-95 transition-transform' : 'cursor-default'}`}
          >
            <div className={`w-9 h-9 mx-auto rounded-xl flex items-center justify-center mb-1.5 ${stat.chip}`}><stat.icon size={17} /></div>
            <div className="text-xl font-black text-gray-900">{stat.value}</div>
            <div className="text-xs text-gray-400 font-medium">{stat.label}{stat.action ? ' →' : ''}</div>
          </button>
        ))}
      </div>

      {/* ── Gestão de Turmas ─────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1 mb-1">
          <h3 className="text-lg font-bold text-gray-900">Gestão de Turmas</h3>
          <button
            onClick={openAddClass}
            className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-full text-sm font-bold shadow-sm active:scale-95 transition-transform"
          >
            <Plus size={15} /> Nova Turma
          </button>
        </div>

        {schedules.length === 0 ? (
          <button
            onClick={openAddClass}
            className="w-full bg-indigo-50 border-2 border-dashed border-indigo-200 rounded-2xl p-6 flex flex-col items-center gap-2 text-indigo-400 active:scale-[0.98] transition-transform"
          >
            <Plus size={28} strokeWidth={1.5} />
            <span className="font-bold text-sm">Adicionar primeira turma</span>
            <span className="text-xs opacity-70">Nome, disciplina, dias e horários</span>
          </button>
        ) : (
          <div className="space-y-2">
            {schedules.map(s => {
              const schedSummary = [...s.days].sort((a, b) => a - b).map(d => {
                const t = s.dayTimes?.[d] || s.time;
                return t ? `${daysOfWeek[d]} ${t}` : daysOfWeek[d];
              }).join(' · ');
              return (
                <div key={s.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="h-1.5 w-full" style={{ backgroundColor: s.color || '#4F46E5' }} />
                  <div className="p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-gray-900 text-sm">{s.name}</h4>
                      {s.subject && <p className="text-xs font-semibold mt-0.5" style={{ color: s.color || '#4F46E5' }}>{s.subject}</p>}
                      {schedSummary ? (
                        <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                          <Clock size={10} strokeWidth={2.5} />{schedSummary}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-300 mt-0.5 italic">Sem horário definido</p>
                      )}
                      {(s.level || s.shift) && (
                        <p className="text-xs text-gray-300 mt-0.5">{[s.level, s.shift].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {onImportSyllabus && (
                        <button
                          onClick={() => onImportSyllabus(s)}
                          className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-indigo-400 active:scale-90 transition-transform"
                          title="Importar ementa (PDF)"
                        >
                          <FileUp size={15} />
                        </button>
                      )}
                      <button
                        onClick={() => openEditClass(s)}
                        className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 active:scale-90 transition-transform"
                      >
                        <Pencil size={15} />
                      </button>
                      {deleteConfirmClassId === s.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { setSchedules(schedules.filter(x => x.id !== s.id)); setDeleteConfirmClassId(null); }}
                            className="px-2.5 py-1.5 bg-red-500 text-white text-xs font-bold rounded-xl"
                          >Excluir</button>
                          <button
                            onClick={() => setDeleteConfirmClassId(null)}
                            className="px-2.5 py-1.5 bg-gray-100 text-gray-600 text-xs font-bold rounded-xl"
                          >Não</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmClassId(s.id)}
                          className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-red-300 active:scale-90 transition-transform"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Modal Adicionar / Editar Turma ── */}
        {editingClass !== null && (
          <div className="fixed inset-0 bg-black/60 z-[70] flex items-end justify-center" onClick={e => { if (e.target === e.currentTarget) setEditingClass(null); }}>
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="bg-white rounded-t-3xl w-full max-w-lg shadow-2xl flex flex-col"
              style={{ maxHeight: '92dvh' }}
            >
              {/* Alça + Header */}
              <div className="flex flex-col items-center pt-3 pb-2 border-b border-gray-100 px-5">
                <div className="w-10 h-1 bg-gray-200 rounded-full mb-3" />
                <div className="flex items-center justify-between w-full">
                  <h2 className="text-lg font-black text-gray-900">
                    {editingClass === 'new' ? '+ Nova Turma' : 'Editar Turma'}
                  </h2>
                  <button onClick={() => setEditingClass(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500">
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Corpo do formulário */}
              <div className="overflow-y-auto flex-1 p-5 space-y-5">
                {classFormError && (
                  <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100 font-medium">{classFormError}</div>
                )}

                {/* Nome */}
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase mb-1.5 block">Nome da Turma *</label>
                  <input
                    type="text"
                    placeholder="Ex: 8º Ano A, Turma 3C, Noturno..."
                    value={classForm.name}
                    onChange={e => setClassForm(f => ({ ...f, name: e.target.value }))}
                    autoFocus
                    className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 font-bold text-gray-900 text-base"
                  />
                </div>

                {/* Disciplina */}
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase mb-1.5 block">Disciplina</label>
                  <select
                    value={classForm.subject}
                    onChange={e => setClassForm(f => ({ ...f, subject: e.target.value }))}
                    className={`w-full p-3 rounded-xl focus:outline-none transition-all ${classForm.subject ? 'bg-indigo-600 text-white font-bold border-none shadow-sm' : 'border border-gray-200 text-gray-500'}`}
                  >
                    <option value="">Selecione a disciplina</option>
                    {SUBJECT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Dias + Horários */}
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase mb-2 block">Dias e Horários de Aula</label>
                  {/* Botões de dias */}
                  <div className="flex gap-1 mb-3">
                    {daysOfWeek.map((day, i) => (
                      <button
                        key={day}
                        onClick={() => toggleFormDay(i)}
                        className={`flex-1 h-9 rounded-xl text-xs font-bold transition-all ${classForm.days.includes(i) ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-400'}`}
                        style={classForm.days.includes(i) ? { backgroundColor: classForm.color } : {}}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  {/* Horário por dia */}
                  {classForm.days.length > 0 ? (
                    <div className="space-y-2">
                      {[...classForm.days].sort((a, b) => a - b).map(dayIdx => (
                        <div key={dayIdx} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-[10px] font-black text-white shrink-0"
                            style={{ backgroundColor: classForm.color }}
                          >
                            {daysOfWeek[dayIdx]}
                          </div>
                          <span className="text-sm text-gray-500 flex-1">Início</span>
                          <input
                            type="time"
                            value={classForm.dayTimes[dayIdx] || ''}
                            onChange={e => setClassForm(f => ({ ...f, dayTimes: { ...f.dayTimes, [dayIdx]: e.target.value } }))}
                            className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-indigo-700 focus:outline-none focus:border-indigo-500 bg-white"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-300 text-center py-3 italic">Toque nos dias acima para selecionar</p>
                  )}
                </div>

                {/* Seção avançada (colapsável) */}
                <div>
                  <button
                    onClick={() => setShowAdvancedClass(!showAdvancedClass)}
                    className="flex items-center gap-1.5 text-xs font-bold text-gray-400 uppercase"
                  >
                    <ChevronRight size={13} className={`transition-transform ${showAdvancedClass ? 'rotate-90' : ''}`} />
                    Informações Adicionais
                  </button>

                  {showAdvancedClass && (
                    <div className="space-y-4 mt-4">
                      {/* Nível */}
                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase mb-1.5 block">Nível de Ensino</label>
                        <select
                          value={classForm.level}
                          onChange={e => setClassForm(f => ({ ...f, level: e.target.value }))}
                          className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-gray-700"
                        >
                          <option value="Educação Infantil">Educação Infantil</option>
                          <option value="Ensino Fundamental I">Ensino Fundamental I</option>
                          <option value="Ensino Fundamental II">Ensino Fundamental II</option>
                          <option value="Ensino Médio">Ensino Médio</option>
                          <option value="EJA">EJA</option>
                        </select>
                      </div>
                      {/* Turno */}
                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase mb-1.5 block">Turno</label>
                        <div className="flex gap-2">
                          {['Manhã', 'Tarde', 'Noite'].map(shift => (
                            <button
                              key={shift}
                              onClick={() => setClassForm(f => ({ ...f, shift }))}
                              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${classForm.shift === shift ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                            >{shift}</button>
                          ))}
                        </div>
                      </div>
                      {/* Escola */}
                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase mb-1.5 block">Nome da Escola</label>
                        <input
                          type="text"
                          placeholder="Ex: EE João Silva"
                          value={classForm.school}
                          onChange={e => setClassForm(f => ({ ...f, school: e.target.value }))}
                          className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm"
                        />
                      </div>
                      {/* Perfil */}
                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase mb-1.5 block">Perfil da Turma</label>
                        <textarea
                          placeholder="Ex: Turma participativa, 2 alunos com TDAH, prefere aulas práticas."
                          value={classForm.profile}
                          onChange={e => setClassForm(f => ({ ...f, profile: e.target.value }))}
                          className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 resize-none h-16 text-sm"
                        />
                      </div>
                      {/* Cor */}
                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase mb-2 block">Cor de Identificação</label>
                        <div className="flex gap-2.5">
                          {classColors.map(color => (
                            <button
                              key={color}
                              onClick={() => setClassForm(f => ({ ...f, color }))}
                              className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform ${classForm.color === color ? 'scale-110 ring-2 ring-offset-2 ring-gray-400' : ''}`}
                              style={{ backgroundColor: color }}
                            >
                              {classForm.color === color && <CheckCircle2 size={16} className="text-white" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Rodapé */}
              <div className="p-5 pt-3 border-t border-gray-100 flex gap-3">
                <button onClick={() => setEditingClass(null)} className="flex-1 p-3.5 rounded-2xl bg-gray-100 font-bold text-gray-600">
                  Cancelar
                </button>
                <button onClick={handleSaveClass} className="flex-[2] p-3.5 rounded-2xl bg-indigo-600 text-white font-black text-base shadow-sm active:scale-[0.98] transition-transform">
                  {editingClass === 'new' ? 'Criar Turma' : 'Salvar Alterações'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>


      <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-50 mb-8 mt-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-900">Configurações</h2>
        </div>
        
        <div className="space-y-4">
          <button 
            onClick={() => setShowFeedbackModal(true)}
            className="w-full flex items-center justify-between p-4 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-green-600 shadow-sm">
                <MessageSquare size={20} />
              </div>
              <div className="text-left">
                <h3 className="font-bold text-gray-900">Enviar Feedback</h3>
                <p className="text-xs text-gray-500">Sugestões ou problemas</p>
              </div>
            </div>
            <ChevronRight size={20} className="text-gray-400" />
          </button>

          <button 
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full flex items-center justify-between p-4 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-amber-600 shadow-sm">
                <LogOut size={20} />
              </div>
              <div className="text-left">
                <h3 className="font-bold text-gray-900">Sair da conta</h3>
                <p className="text-xs text-gray-500">Desconectar do dispositivo</p>
              </div>
            </div>
            <ChevronRight size={20} className="text-gray-400" />
          </button>

        </div>
      </div>

      {/* Zona de Perigo — colapsável */}
      <div className="mb-8 mt-4">
        <button
          onClick={() => setShowDangerZone(!showDangerZone)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-red-50 border border-red-100 active:scale-[0.98] transition-transform"
        >
          <span className="text-xs font-black text-red-400 uppercase tracking-widest flex items-center gap-1.5"><AlertCircle size={13} /> Zona de Perigo</span>
          <ChevronRight size={16} className={`text-red-300 transition-transform ${showDangerZone ? 'rotate-90' : ''}`} />
        </button>

        <AnimatePresence>
          {showDangerZone && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-red-50 border border-red-100 rounded-b-2xl px-4 pb-4 pt-2 space-y-3 border-t-0">
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-white border border-red-100 shadow-sm hover:bg-red-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center text-red-600">
                      <Trash2 size={20} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-bold text-red-700">Resetar Conta</h3>
                      <p className="text-xs text-red-400">Apaga todos os seus dados permanentemente</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-red-300" />
                </button>
                <button
                  onClick={() => { setDeleteConfirmText(''); setShowDeleteConfirm(true); }}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-red-600 border border-red-700 shadow-sm active:scale-[0.98] transition-transform"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-500 rounded-xl flex items-center justify-center text-white">
                      <X size={20} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-bold text-white">Excluir minha conta</h3>
                      <p className="text-xs text-red-200">Remove sua conta e todos os dados do app</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-red-300" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showFeedbackModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-6"
            onClick={() => setShowFeedbackModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-[2rem] p-6 w-full max-w-md shadow-2xl"
            >
              <h2 className="text-xl font-bold text-gray-900 mb-2">Enviar Feedback</h2>
              <p className="text-sm text-gray-500 mb-6">Sua opinião é muito importante para melhorarmos o app.</p>
              
              {feedbackSent ? (
                <div className="bg-green-50 text-green-700 p-4 rounded-xl flex items-center justify-center gap-2 font-medium mb-6">
                  <CheckCircle2 size={20} />
                  Feedback enviado com sucesso!
                </div>
              ) : (
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="Descreva sua sugestão, problema ou ideia..."
                  className="w-full bg-gray-50 rounded-xl p-4 min-h-[120px] mb-6 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
                />
              )}
              
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowFeedbackModal(false)}
                  className="flex-1 py-3 text-sm font-bold text-gray-500 hover:text-gray-700"
                >
                  {feedbackSent ? "Fechar" : "Cancelar"}
                </button>
                {!feedbackSent && (
                  <button 
                    onClick={async () => {
                      if (!feedbackText.trim()) return;
                      try {
                        const feedbackRef = doc(collection(db, 'feedback'));
                        await setDoc(feedbackRef, {
                          uid: auth.currentUser?.uid || '',
                          name: profile.name || '',
                          email: auth.currentUser?.email || '',
                          text: feedbackText,
                          date: Date.now()
                        });
                        setFeedbackSent(true);
                        setTimeout(() => {
                          setShowFeedbackModal(false);
                          setFeedbackSent(false);
                          setFeedbackText('');
                        }, 3000);
                      } catch (e) {
                        console.error('Error sending feedback:', e);
                        toast.error('Seu feedback ficou preso no caminho. Tente enviar de novo.');
                      }
                    }}
                    disabled={!feedbackText.trim()}
                    className="flex-1 bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700"
                  >
                    Enviar
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
        
        {showLogoutConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-6"
            onClick={() => setShowLogoutConfirm(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-[2rem] p-6 w-full max-w-md shadow-2xl"
            >
              <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center mb-4">
                <LogOut size={24} />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Sair da conta?</h2>
              <p className="text-sm text-gray-500 mb-6">Você precisará fazer login novamente para voltar a acessar suas turmas e materiais.</p>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 py-3 bg-gray-50 text-gray-600 rounded-xl text-sm font-bold border border-gray-200"
                >
                  Cancelar
                </button>
                <button 
                  onClick={async () => {
                    await logOut();
                    setShowLogoutConfirm(false);
                  }}
                  className="flex-1 bg-amber-500 text-white rounded-xl py-3 text-sm font-bold hover:bg-amber-600 transition-colors"
                >
                  Confirmar e Sair
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showResetConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-[70] flex items-center justify-center p-6"
            onClick={() => setShowResetConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-[2rem] p-6 w-full max-w-md shadow-2xl"
            >
              <div className="text-center mb-4">
                <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Trash2 size={32} className="text-red-500" />
                </div>
                <h2 className="text-xl font-black text-gray-900 mb-1">Eita... tá certo disso?</h2>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Isso vai apagar <span className="font-bold text-gray-700">tudo</span>: turmas, materiais, notas...
                  até aquela atividade incrível que você fez às 23h.
                </p>
                <p className="text-xs text-red-400 font-bold mt-3 bg-red-50 rounded-xl py-2 px-3">
                  Sem volta, viu? Sem recuperar depois!
                </p>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold shadow-sm"
                >
                  Não, me arrependi!
                </button>
                <button
                  onClick={() => {
                    if (onResetAccount) onResetAccount();
                    setShowResetConfirm(false);
                    setScreen('home');
                  }}
                  className="flex-1 bg-gray-100 text-red-500 rounded-2xl py-3 text-sm font-bold"
                >
                  Sim, pode apagar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-[70] flex items-center justify-center p-6"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-[2rem] p-6 w-full max-w-md shadow-2xl"
            >
              <div className="text-center mb-5">
                <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <X size={32} className="text-red-500" />
                </div>
                <h2 className="text-xl font-black text-gray-900 mb-1">Excluir conta?</h2>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Sua conta, dados e materiais serão <span className="font-bold text-gray-700">apagados permanentemente</span>. Essa ação não pode ser desfeita.
                </p>
              </div>
              <p className="text-xs font-bold text-gray-500 mb-2 text-center">Digite <span className="text-red-500">EXCLUIR</span> para confirmar</p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="EXCLUIR"
                className="w-full border-2 border-red-200 rounded-2xl px-4 py-3 text-center font-bold text-red-600 focus:outline-none focus:border-red-500 mb-4"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold shadow-sm"
                >
                  Cancelar
                </button>
                <button
                  disabled={deleteConfirmText !== 'EXCLUIR'}
                  onClick={async () => {
                    setShowDeleteConfirm(false);
                    if (onDeleteAccount) await onDeleteAccount();
                  }}
                  className="flex-1 bg-red-600 text-white rounded-2xl py-3 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Excluir conta
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
};

const formatEventDate = (dateStr: string) => {
  if (dateStr.includes('-')) {
    const [year, month, day] = dateStr.split(' ')[0].split('-');
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${parseInt(day)} ${monthNames[parseInt(month)-1]}`;
  }
  return dateStr;
};

const getEventsForDay = (allEvents: any[], year: number, month: number, day: number) => {
  return allEvents.filter(e => {
    if (e.date.includes('-')) {
      const [yearStr, monthStr, dayStr] = e.date.split(' ')[0].split('-');
      return parseInt(yearStr) === year && parseInt(monthStr) === month + 1 && parseInt(dayStr) === day;
    }
    return parseInt(e.date.split(' ')[0]) === day;
  });
};

const getEasterDate = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
};

const addDays = (date: Date, days: number): Date => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const getNthWeekday = (year: number, month: number, weekday: number, nth: number): Date => {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (nth - 1) * 7);
};

const fmt = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 00:00`;

const getDefaultHolidays = (year: number) => {
  const easter = getEasterDate(year);
  const carnival = addDays(easter, -47);
  const goodFriday = addDays(easter, -2);
  const corpusChristi = addDays(easter, 60);
  const motherDay = getNthWeekday(year, 4, 0, 2); // 2nd Sunday of May
  const fatherDay = getNthWeekday(year, 7, 0, 2); // 2nd Sunday of August

  const national = [
    { id: `h1-${year}`,  title: 'Confraternização Universal',   date: `${year}-01-01 00:00` },
    { id: `h2-${year}`,  title: 'Carnaval',                     date: fmt(carnival) },
    { id: `h3-${year}`,  title: 'Sexta-feira Santa',            date: fmt(goodFriday) },
    { id: `h4-${year}`,  title: 'Páscoa',                       date: fmt(easter) },
    { id: `h5-${year}`,  title: 'Tiradentes',                   date: `${year}-04-21 00:00` },
    { id: `h6-${year}`,  title: 'Dia do Trabalhador',           date: `${year}-05-01 00:00` },
    { id: `h7-${year}`,  title: 'Corpus Christi',               date: fmt(corpusChristi) },
    { id: `h8-${year}`,  title: 'Independência do Brasil',      date: `${year}-09-07 00:00` },
    { id: `h9-${year}`,  title: 'Nossa Sra. Aparecida',         date: `${year}-10-12 00:00` },
    { id: `h10-${year}`, title: 'Dia dos Professores',          date: `${year}-10-15 00:00` },
    { id: `h11-${year}`, title: 'Finados',                      date: `${year}-11-02 00:00` },
    { id: `h12-${year}`, title: 'Proclamação da República',     date: `${year}-11-15 00:00` },
    { id: `h13-${year}`, title: 'Natal',                        date: `${year}-12-25 00:00` },
  ].map(h => ({ ...h, type: 'holiday' as const }));

  const commemorative = [
    { id: `c1-${year}`,  title: 'Dia Internacional da Mulher',      date: `${year}-03-08 00:00` },
    { id: `c2-${year}`,  title: 'Dia Mundial da Água',               date: `${year}-03-22 00:00` },
    { id: `c3-${year}`,  title: 'Dia do Índio / Povos Indígenas',    date: `${year}-04-19 00:00` },
    { id: `c4-${year}`,  title: 'Dia das Mães',                      date: fmt(motherDay) },
    { id: `c5-${year}`,  title: 'Dia Mundial do Meio Ambiente',      date: `${year}-06-05 00:00` },
    { id: `c6-${year}`,  title: 'Festa Junina / São João',           date: `${year}-06-24 00:00` },
    { id: `c7-${year}`,  title: 'Dia dos Pais',                      date: fmt(fatherDay) },
    { id: `c8-${year}`,  title: 'Dia do Folclore',                   date: `${year}-08-22 00:00` },
    { id: `c9-${year}`,  title: 'Dia do Estudante',                  date: `${year}-08-11 00:00` },
    { id: `c10-${year}`, title: 'Semana da Pátria',                  date: `${year}-09-01 00:00` },
    { id: `c11-${year}`, title: 'Dia Mundial da Educação',           date: `${year}-10-05 00:00` },
    { id: `c12-${year}`, title: 'Dia das Crianças',                  date: `${year}-10-12 00:00` },
    { id: `c13-${year}`, title: 'Dia da Consciência Negra',          date: `${year}-11-20 00:00` },
  ].map(h => ({ ...h, type: 'commemorative' as const }));

  return [...national, ...commemorative];
};

const HolidaySuggestion = ({ holidayName }: { holidayName: string }) => {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSuggestion = async () => {
      try {
        const prompt = `Dê uma dica CURTA e PRÁTICA (máximo 2 frases) para um professor aproveitar o feriado "${holidayName}" no seu planejamento pedagógico ou para atividades de descanso com alunos. Foque na objetividade.`;
        const response = await generateContentWithRetry({
          model: AI_MODEL,
          contents: prompt,
        });
        
        if (response.text) {
          setSuggestion(response.text);
        } else {
          setError('Não foi possível gerar uma dica agora.');
        }
      } catch (err) {
        console.error(err);
        setError('Erro ao carregar dica.');
      } finally {
        setLoading(false);
      }
    };
    fetchSuggestion();
  }, [holidayName]);

  if (loading) return <div className="p-4 bg-indigo-50 rounded-2xl text-indigo-600 text-sm">Pensando em uma dica pedagógica...</div>;
  if (error) return <div className="p-4 bg-red-50 rounded-2xl text-red-600 text-sm">{error}</div>;
  return <div className="p-4 bg-indigo-50 rounded-2xl text-indigo-900 border border-indigo-100 text-sm"><strong>💡 Dica do Gemini:</strong> {suggestion}</div>;
};

const DayDetailScreen = ({
  schedules,
  selectedDate,
  currentMonth,
  currentYear,
  allEvents,
  setScreen,
  notifications,
  setNotifications,
  setCustomEvents,
  setClasses,
  onPrepareLesson,
  onRescheduleLesson,
}: {
  schedules: ClassSchedule[],
  selectedDate: number,
  currentMonth: number,
  currentYear: number,
  allEvents: any[],
  setScreen: (s: Screen) => void,
  notifications?: any[],
  setNotifications?: (n: any[]) => void,
  setCustomEvents: (c: any[]) => void,
  setClasses: (c: ClassItem[]) => void,
  onPrepareLesson?: (topic: string, classId: string) => void,
  onRescheduleLesson?: (classItemId: string) => void,
}) => {
  const monthName = new Date(currentYear, currentMonth).toLocaleString('pt-BR', { month: 'long' });
  const selectedDayEvents = getEventsForDay(allEvents, currentYear, currentMonth, selectedDate);
  const holiday = selectedDayEvents.find(e => e.type === 'holiday' || e.type === 'commemorative' || e.type === 'admin');
  const customEvents = allEvents.filter(e => e.type === 'prep' || e.type === 'admin' || e.type === 'holiday' || e.type === 'commemorative');
  const classes = allEvents.filter(e => e.type === 'class');

  const getEventColor = (e: any) => {
    if (e.type === 'class') {
      const schedule = schedules.find(s => s.name === e.className);
      return schedule?.color || '#4F46E5'; // Default indigo
    }
    if (e.type === 'holiday') return '#EAB308'; // yellow-500
    if (e.type === 'commemorative') return '#A855F7'; // purple-500
    if (e.type === 'prep') return '#10B981'; // emerald-500
    return '#F59E0B'; // amber-500
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="pb-40">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => setScreen('calendar')} className="p-2 bg-white rounded-full border border-gray-100 shadow-sm">
          <ChevronRight className="rotate-180" size={20} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Detalhes do Dia</h1>
      </div>

      <div className="bg-white rounded-[1.5rem] p-6 shadow-sm border border-gray-50 mb-8">
        <h2 className="text-xl font-bold text-gray-900">{selectedDate} de {monthName} de {currentYear}</h2>
      </div>

      <div className="space-y-4">
        {holiday && <HolidaySuggestion holidayName={holiday.title} />}
        {selectedDayEvents.length > 0 ? (
          <Reorder.Group axis="y" values={selectedDayEvents} onReorder={(newEvents) => {
            const reorderedCustom = newEvents.filter(e => e.type === 'prep' || e.type === 'admin' || e.type === 'holiday' || e.type === 'commemorative') as any[];
            const reorderedClasses = newEvents.filter(e => e.type === 'class') as any[];

            setCustomEvents(reorderedCustom);
            setClasses(reorderedClasses);
          }} className="space-y-4">
            {selectedDayEvents.map((e) => (
              <Reorder.Item key={e.id} value={e} className="w-full" dragListener={true}>
                <EventItem
                  e={e}
                  color={getEventColor(e)}
                  onComplete={() => {
                    if (e.type === 'class') {
                      setClasses(classes.map(c => c.id === e.id ? { ...c, status: 'done' } : c));
                    } else {
                      setCustomEvents(customEvents.map(ce => ce.id === e.id ? { ...ce, status: 'done' } : ce));
                    }
                  }}
                  onPrepare={e.type === 'class' && onPrepareLesson ? () => {
                    const sched = schedules.find(s => s.name === e.className);
                    onPrepareLesson(e.topic || e.title, sched?.id || '');
                  } : undefined}
                  onReschedule={e.type === 'class' && onRescheduleLesson ? () => onRescheduleLesson(e.id) : undefined}
                />
              </Reorder.Item>
            ))}
          </Reorder.Group>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <img src="https://i.ibb.co/FbhRcLsz/Sem-nome-1300-x-1300-px-20260616-150714-0000.png" alt="Calendário Vazio" className="w-48 h-auto object-contain mb-6 rounded-3xl opacity-80" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
            <h3 className="text-lg font-bold text-gray-900 mb-2">Dia Livre</h3>
            <p className="text-gray-500 text-sm max-w-[200px]">Nenhum evento programado para este dia.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// IMPORTAÇÃO POR PDF — Calendário Letivo & Ementa
// ═══════════════════════════════════════════════════════════════════

const MONTH_ABBR_IMPORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const IMPORT_EVENT_TYPES = [
  { key: 'holiday' as const,       label: 'Feriado/Recesso', color: '#EAB308' },
  { key: 'admin' as const,         label: 'Administrativo',  color: '#F59E0B' },
  { key: 'commemorative' as const, label: 'Comemorativa',    color: '#A855F7' },
  { key: 'prep' as const,          label: 'Pedagógico',      color: '#10B981' },
];

type ImportEventType = 'holiday' | 'admin' | 'prep' | 'commemorative';
interface ImportedEvent { title: string; date: string; type: ImportEventType }
interface ImportedLesson { title: string; content?: string }
interface ImportedModule { title: string; topics: string[]; estimatedClasses: number; lessons?: ImportedLesson[] }
interface SyllabusRow extends ImportedModule { startDate: string }


const MONTH_NAME_TO_NUM: Record<string, number> = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, março: 3, mar: 3, abril: 4, abr: 4,
  maio: 5, mai: 5, junho: 6, jun: 6, julho: 7, jul: 7, agosto: 8, ago: 8,
  setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
};

// Normaliza datas em vários formatos para YYYY-MM-DD; null se irrecuperável
const normalizeImportDate = (raw: any, year: number): string | null => {
  if (!raw) return null;
  let s = String(raw).trim();
  // Já em ISO (com ou sem hora)
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const mo = Number(iso[2]), da = Number(iso[3]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${iso[1]}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    return null;
  }
  // DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const da = Number(m[1]), mo = Number(m[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${m[3]}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    return null;
  }
  // DD/MM ou DD-MM (sem ano)
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) {
    const da = Number(m[1]), mo = Number(m[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${year}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    return null;
  }
  // "12 de maio", "12 de maio de 2026", "12 maio"
  m = s.toLowerCase().match(/^(\d{1,2})\s*(?:de\s+)?([a-zç]+)(?:\s*(?:de\s+)?(\d{4}))?$/);
  if (m) {
    const da = Number(m[1]);
    const mo = MONTH_NAME_TO_NUM[m[2]];
    const yr = m[3] ? Number(m[3]) : year;
    if (mo && da >= 1 && da <= 31) return `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  }
  return null;
};

const CALENDAR_EXTRACT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    events: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          date: { type: Type.STRING, description: 'YYYY-MM-DD' },
          type: { type: Type.STRING, enum: ['holiday', 'admin', 'prep', 'commemorative'] },
        },
        required: ['title', 'date', 'type'],
      },
    },
  },
  required: ['events'],
};

const parseCalendarEvents = (text: string, year: number): ImportedEvent[] => {
  let raw = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: any;
  try { parsed = JSON.parse(raw || '{}'); } catch { return []; }
  const list = Array.isArray(parsed) ? parsed : (parsed.events || []);
  return list
    .map((e: any) => {
      if (!e || !e.title) return null;
      const date = normalizeImportDate(e.date, year);
      if (!date) return null;
      return {
        title: String(e.title).slice(0, 80),
        date,
        type: (['holiday', 'admin', 'prep', 'commemorative'].includes(e.type) ? e.type : 'admin') as ImportEventType,
      };
    })
    .filter(Boolean) as ImportedEvent[];
};

const extractAcademicCalendar = async (source: File | string, year: number): Promise<ImportedEvent[]> => {
  // Aceita arquivo (PDF/imagem) ou texto colado pelo usuário
  const docPart = typeof source === 'string'
    ? { text: `TEXTO DO DOCUMENTO:\n\n${source}` }
    : { inlineData: { data: await fileToBase64(source), mimeType: guessMimeType(source) } };
  const basePrompt = `Este documento é um calendário escolar/letivo brasileiro referente ao ano ${year}. Ele pode estar em vários formatos: texto corrido, tabela, grade mensal (calendário visual onde os dias são numerados em quadrados e os eventos são marcados por cores, círculos ou legendas), documento escaneado ou foto. Leia com atenção, incluindo legendas de cores e rodapés.

Extraia TODOS os eventos com data: feriados, recessos, férias, início e fim de bimestres/trimestres/semestres, reuniões pedagógicas, conselhos de classe, entrega de notas, formação de professores (HTPC), sábados letivos, datas comemorativas e eventos escolares.

Para cada evento retorne: um título curto e claro, a data no formato YYYY-MM-DD (se o ano não aparecer no documento, use ${year}), e o tipo. Regras do tipo: "holiday" para feriados, recessos e férias; "admin" para reuniões, conselhos, entrega de notas e formação; "prep" para eventos pedagógicos e planejamento; "commemorative" para datas comemorativas.

Se um evento durar vários dias (ex: "12 a 16/05"), registre apenas o dia de início. Se a grade mensal usar cores ou símbolos com legenda, use a legenda para identificar o que cada dia marcado significa. Ignore texto que não seja um evento com data.`;

  const response = await generateContentWithRetry({
    model: AI_MODEL,
    contents: [{ role: 'user', parts: [
      docPart,
      { text: basePrompt }
    ]}],
    config: { responseMimeType: 'application/json', responseSchema: CALENDAR_EXTRACT_SCHEMA },
  });
  let events = parseCalendarEvents(response.text || '', year);
  if (events.length) return events;

  // 2ª tentativa: transcrição primeiro, sem schema rígido. Ajuda em documentos
  // escaneados, fotos e grades visuais em que a 1ª passada não achou nada.
  const retryResponse = await generateContentWithRetry({
    model: AI_MODEL,
    contents: [{ role: 'user', parts: [
      docPart,
      { text: `Primeiro, transcreva mentalmente TODO o conteúdo legível deste documento (é um calendário escolar brasileiro de ${year}), incluindo tabelas, grades mensais, legendas de cores e anotações. Depois, liste cada evento datado que encontrar.

Responda APENAS com JSON válido no formato:
{"events":[{"title":"...","date":"YYYY-MM-DD","type":"holiday|admin|prep|commemorative"}]}

Datas sem ano: use ${year}. Períodos (ex: 12 a 16/05): use o dia de início. Se um dia está apenas marcado com cor/símbolo, use a legenda para nomear o evento. Extraia o máximo possível, mesmo eventos pequenos.` }
    ]}],
  });
  events = parseCalendarEvents(retryResponse.text || '', year);
  return events;
};

const SYLLABUS_EXTRACT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    modules: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          lessons: {
            type: Type.ARRAY,
            description: 'Uma entrada por aula, na ordem do documento',
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Título ou conteúdo da aula' },
                content: { type: Type.STRING, description: 'Detalhes, atividades ou objetivo da aula (se houver)' },
              },
              required: ['title'],
            },
          },
        },
        required: ['title', 'lessons'],
      },
    },
  },
  required: ['modules'],
};

const SYLLABUS_PROMPT = `Este documento é uma ementa / plano de curso / plano de ensino brasileiro. Pode estar em texto corrido, tabela, documento escaneado ou foto.

REGRA MAIS IMPORTANTE: cada linha de conteúdo da tabela (ou cada item numerado) normalmente corresponde a UMA aula. Por exemplo, se um módulo tem 7 linhas de conteúdo com carga horária "2 H/A" cada, ele tem 7 aulas. Se o documento numera as aulas (Aula 1, Aula 2...), cada número é uma aula. Linhas como "Atividade", "Revisão", "Prova", "Exercícios" TAMBÉM são aulas e devem ser incluídas.

Extraia TODOS os módulos (ou meses/unidades) na ordem do documento, e dentro de cada módulo TODAS as aulas, da primeira à última, sem pular nenhuma. Para cada aula retorne:
- title: o conteúdo ou título da aula (resuma em até 90 caracteres se for longo)
- content: detalhes, atividades práticas ou objetivo da aula, se o documento tiver (senão omita)

NÃO resuma nem agrupe aulas. Se o documento tem 49 linhas de conteúdo, retorne 49 aulas no total. Use a carga horária total como verificação: se o curso tem 98 horas e cada aula tem 2 horas, devem existir ~49 aulas.`;

const parseSyllabusModules = (text: string): ImportedModule[] => {
  let raw = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: any;
  try { parsed = JSON.parse(raw || '{}'); } catch { return []; }
  const list = Array.isArray(parsed) ? parsed : (parsed.modules || []);
  return list
    .filter((m: any) => m && m.title)
    .map((m: any) => {
      const lessons: ImportedLesson[] = Array.isArray(m.lessons)
        ? m.lessons
            .filter((l: any) => l && (l.title || typeof l === 'string'))
            .map((l: any) => typeof l === 'string'
              ? { title: l.slice(0, 120) }
              : { title: String(l.title).slice(0, 120), ...(l.content ? { content: String(l.content).slice(0, 300) } : {}) })
        : [];
      // Compat: resposta antiga com topics/estimatedClasses (2ª tentativa pode devolver esse formato)
      const topics: string[] = lessons.length
        ? lessons.map(l => l.title)
        : (Array.isArray(m.topics) ? m.topics.map((t: any) => String(t)) : []);
      // Limite de 200 = ano letivo brasileiro completo (200 dias letivos)
      const estimatedClasses = lessons.length
        ? Math.min(200, lessons.length)
        : Math.max(1, Math.min(200, Math.round(Number(m.estimatedClasses) || 4)));
      return { title: String(m.title).slice(0, 80), topics, estimatedClasses, ...(lessons.length ? { lessons } : {}) };
    })
    .filter((m: ImportedModule) => m.estimatedClasses > 0);
};

const extractSyllabus = async (source: File | string): Promise<ImportedModule[]> => {
  // Aceita arquivo (PDF/imagem) ou texto colado pelo usuário
  const docPart = typeof source === 'string'
    ? { text: `TEXTO DO DOCUMENTO:\n\n${source}` }
    : { inlineData: { data: await fileToBase64(source), mimeType: guessMimeType(source) } };
  const response = await generateContentWithRetry({
    model: AI_MODEL,
    contents: [{ role: 'user', parts: [
      docPart,
      { text: SYLLABUS_PROMPT }
    ]}],
    config: { responseMimeType: 'application/json', responseSchema: SYLLABUS_EXTRACT_SCHEMA },
  });
  let modules = parseSyllabusModules(response.text || '');
  if (modules.length) return modules;

  // 2ª tentativa: transcrição primeiro, sem schema rígido (documentos escaneados/fotos)
  const retryResponse = await generateContentWithRetry({
    model: AI_MODEL,
    contents: [{ role: 'user', parts: [
      docPart,
      { text: `Primeiro, transcreva mentalmente TODO o conteúdo legível deste documento (é uma ementa ou plano de curso escolar brasileiro), incluindo todas as linhas de todas as tabelas. Depois, identifique os módulos e TODAS as aulas de cada módulo. Cada linha de conteúdo com carga horária é uma aula; linhas de Atividade, Revisão e Prova também são aulas.

Responda APENAS com JSON válido no formato:
{"modules":[{"title":"...","lessons":[{"title":"...","content":"..."}]}]}

NÃO resuma nem agrupe: extraia cada aula como um item separado, da primeira à última.` }
    ]}],
  });
  modules = parseSyllabusModules(retryResponse.text || '');
  return modules;
};

// Calcula datas de início sequenciais (cada módulo começa após o anterior terminar)
const computeSequentialStarts = (mods: ImportedModule[], startISO: string, selectedClass?: ClassSchedule, holidayISOs?: Set<string>): SyllabusRow[] => {
  const days = selectedClass?.days?.length ? selectedClass.days : [1, 2, 3, 4, 5];
  const [y, m, d] = startISO.split('-').map(Number);
  let cur = new Date(y, m - 1, d, 12, 0, 0, 0);
  const result: SyllabusRow[] = [];
  for (const mod of mods) {
    let guard = 1100;
    while ((!days.includes(cur.getDay()) || holidayISOs?.has(toISODate(cur))) && guard > 0) { cur.setDate(cur.getDate() + 1); guard--; }
    result.push({ ...mod, startDate: toISODate(cur) });
    let scheduled = 0; guard = 1100;
    while (scheduled < mod.estimatedClasses && guard > 0) {
      if (days.includes(cur.getDay()) && !holidayISOs?.has(toISODate(cur))) scheduled++;
      cur.setDate(cur.getDate() + 1);
      guard--;
    }
  }
  return result;
};

// Distribui os módulos em ClassItems no calendário, respeitando os dias da turma
// Reparte os tópicos do módulo entre as aulas, em ordem (ex: 6 tópicos em 3
// aulas viram 2 tópicos por aula; sobras vão para as primeiras aulas)
const splitTopicsAcrossLessons = (topics: string[], lessons: number): string[][] => {
  const out: string[][] = Array.from({ length: lessons }, () => []);
  if (!topics.length || lessons < 1) return out;
  topics.forEach((t, i) => {
    const bucket = Math.min(lessons - 1, Math.floor((i * lessons) / topics.length));
    out[bucket].push(t);
  });
  return out;
};

const distributeSyllabus = (rows: SyllabusRow[], selectedClass: ClassSchedule, holidayISOs?: Set<string>): ClassItem[] => {
  const items: ClassItem[] = [];
  const usedDays = new Set<string>();
  const days = selectedClass.days?.length ? selectedClass.days : [1, 2, 3, 4, 5];
  for (const mod of rows) {
    if (!mod.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(mod.startDate)) continue;
    const [y, m, d] = mod.startDate.split('-').map(Number);
    let cur = new Date(y, m - 1, d, 12, 0, 0, 0);
    // Com lessons extraídas do documento: cada aula tem título e conteúdo próprios.
    // Sem lessons (formato antigo): reparte os tópicos entre as aulas estimadas.
    const hasLessons = !!mod.lessons?.length;
    const lessonTopics = hasLessons ? [] : splitTopicsAcrossLessons(mod.topics || [], mod.estimatedClasses);
    let done = 0; let guard = 1100;
    while (done < mod.estimatedClasses && guard > 0) {
      const key = toISODate(cur);
      if (days.includes(cur.getDay()) && !usedDays.has(key) && !holidayISOs?.has(key)) {
        usedDays.add(key);
        const lesson = hasLessons ? mod.lessons![done] : undefined;
        const title = lesson
          ? lesson.title
          : (mod.estimatedClasses > 1 ? `${mod.title}: Aula ${done + 1}` : mod.title);
        const topicStr = lesson
          ? (lesson.content || mod.title)
          : (lessonTopics[done]?.join(' · ') || '');
        items.push({
          id: Math.random().toString(36).slice(2, 11),
          title,
          date: `${cur.getDate()} ${MONTH_ABBR_IMPORT[cur.getMonth()]}`,
          status: 'pending',
          className: selectedClass.name,
          timestamp: cur.getTime(),
          ...(topicStr ? { topic: topicStr } : {}),
        });
        done++;
      }
      cur.setDate(cur.getDate() + 1);
      guard--;
    }
  }
  return items.sort((a, b) => a.timestamp - b.timestamp);
};

const buildHolidayISOs = (customEvents: { type: string, date: string }[]): Set<string> => {
  const isos = new Set<string>();
  customEvents.filter(e => e.type === 'holiday').forEach(e => isos.add(e.date.split(' ')[0]));
  const curYear = new Date().getFullYear();
  [curYear, curYear + 1, curYear + 2].forEach(y =>
    getDefaultHolidays(y).filter(h => h.type === 'holiday').forEach(h => isos.add(h.date.split(' ')[0]))
  );
  return isos;
};

const ImportModal = ({ mode, targetClass, year, onClose, customEvents, setCustomEvents, onAddClassItems }: {
  mode: 'calendar' | 'syllabus';
  targetClass?: ClassSchedule;
  year: number;
  onClose: () => void;
  customEvents: { id: string, title: string, date: string, type: ImportEventType, status?: 'pending' | 'done' }[];
  setCustomEvents: (c: any[]) => void;
  onAddClassItems: (items: ClassItem[]) => void;
}) => {
  const [phase, setPhase] = useState<'upload' | 'paste' | 'loading' | 'review' | 'error'>('upload');
  const [errorMsg, setErrorMsg] = useState('');
  const [events, setEvents] = useState<ImportedEvent[]>([]);
  const [rows, setRows] = useState<SyllabusRow[]>([]);
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const todayISO = toISODate(new Date());

  const runExtraction = async (source: File | string) => {
    setErrorMsg(''); setPhase('loading');
    try {
      if (mode === 'calendar') {
        const ev = await extractAcademicCalendar(source, year);
        if (!ev.length) { setErrorMsg('Não encontrei eventos com data, mesmo tentando duas vezes. Você pode colar o texto do documento ou criar os eventos manualmente.'); setPhase('error'); return; }
        setEvents(ev.sort((a, b) => a.date.localeCompare(b.date)));
        setPhase('review');
      } else {
        const mods = await extractSyllabus(source);
        if (!mods.length) { setErrorMsg('Não encontrei módulos nesta ementa, mesmo tentando duas vezes. Você pode colar o texto do documento ou criar as aulas manualmente.'); setPhase('error'); return; }
        setRows(computeSequentialStarts(mods, todayISO, targetClass, buildHolidayISOs(customEvents)));
        setPhase('review');
      }
    } catch (err) {
      setErrorMsg(formatApiError(err, 'Não consegui processar. Tente novamente.'));
      setPhase('error');
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setErrorMsg('Arquivo muito grande. O limite é 10 MB.'); setPhase('error'); return; }
    runExtraction(file);
  };

  // Fallback sem IA: cria uma linha inicial e vai direto para a revisão editável
  const startManual = () => {
    if (mode === 'calendar') {
      setEvents([{ title: 'Novo evento', date: todayISO, type: 'admin' }]);
    } else {
      setRows([{ title: 'Módulo 1', topics: [], estimatedClasses: 4, startDate: todayISO }]);
    }
    setPhase('review');
  };

  const confirmCalendar = () => {
    const additions = events
      .filter(e => !customEvents.some(ce => ce.title === e.title && ce.date.split(' ')[0] === e.date))
      .map(e => ({
        id: Date.now().toString(36) + Math.random().toString(36).substring(2),
        title: e.title,
        date: `${e.date} 00:00`,
        type: e.type,
      }));
    if (additions.length === 0) { toast.info('Esses eventos já estão no calendário.'); onClose(); return; }
    setCustomEvents([...customEvents, ...additions]);
    toast.success(`${additions.length} evento${additions.length !== 1 ? 's' : ''} adicionado${additions.length !== 1 ? 's' : ''} ao calendário!`);
    onClose();
  };

  const confirmSyllabus = () => {
    if (!targetClass) return;
    const items = distributeSyllabus(rows, targetClass, buildHolidayISOs(customEvents));
    if (!items.length) { toast.error('Nenhuma aula foi gerada. Verifique as datas e os dias da turma.'); return; }
    onAddClassItems(items);
    toast.success(`${items.length} aulas distribuídas no calendário de ${targetClass.name}!`);
    onClose();
  };

  const totalLessons = rows.reduce((sum, r) => sum + (r.estimatedClasses || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/60 z-[110] flex items-end justify-center" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="bg-white rounded-t-3xl w-full max-w-lg shadow-2xl flex flex-col"
        style={{ maxHeight: '92dvh' }}
      >
        <div className="flex flex-col items-center pt-3 pb-2 border-b border-gray-100 px-5">
          <div className="w-10 h-1 bg-gray-200 rounded-full mb-3" />
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              {mode === 'calendar' ? <CalendarIcon size={18} className="text-indigo-600" /> : <BookOpen size={18} className="text-indigo-600" />}
              <h2 className="text-lg font-black text-gray-900">
                {mode === 'calendar' ? 'Importar Calendário Letivo' : `Importar Ementa${targetClass ? ` · ${targetClass.name}` : ''}`}
              </h2>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"><X size={18} /></button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          {/* UPLOAD */}
          {phase === 'upload' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                <FileUp size={30} className="text-indigo-500" />
              </div>
              <p className="text-sm text-gray-600 font-medium mb-1">
                {mode === 'calendar'
                  ? 'Envie o PDF do calendário letivo da sua escola.'
                  : 'Envie o PDF da ementa / plano de curso da disciplina.'}
              </p>
              <p className="text-xs text-gray-400 mb-5">
                {mode === 'calendar'
                  ? 'A IA vai extrair feriados, recessos, reuniões e datas importantes.'
                  : 'A IA vai extrair os módulos e você define quando cada um começa.'}
              </p>
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full bg-indigo-600 text-white rounded-2xl py-3.5 font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Upload size={18} /> Escolher arquivo (PDF, imagem)
              </button>
              <p className="text-[11px] text-gray-300 mt-3">Máximo 10 MB · PDF, JPG ou PNG</p>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setPhase('paste')}
                  className="flex-1 bg-gray-100 text-gray-700 rounded-2xl py-3 font-bold text-sm active:scale-[0.98] transition-transform"
                >
                  Colar texto
                </button>
                <button
                  onClick={startManual}
                  className="flex-1 bg-gray-100 text-gray-700 rounded-2xl py-3 font-bold text-sm active:scale-[0.98] transition-transform"
                >
                  Criar manualmente
                </button>
              </div>
              <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleFile} />
            </div>
          )}

          {/* PASTE — texto colado pelo usuário */}
          {phase === 'paste' && (
            <div className="py-2">
              <p className="text-sm text-gray-600 font-medium mb-1">
                {mode === 'calendar' ? 'Cole o texto do calendário letivo' : 'Cole o texto da ementa'}
              </p>
              <p className="text-xs text-gray-400 mb-3">Copie de um documento, site, e-mail ou mensagem e cole aqui. A IA organiza tudo para você revisar.</p>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={10}
                placeholder={mode === 'calendar'
                  ? 'Ex:\n21/04 - Tiradentes (feriado)\n01/05 - Dia do Trabalhador\n12 a 16/05 - Semana de provas...'
                  : 'Ex:\nMódulo 1: Introdução\n- O que é informática (2h)\n- Hardware e software (2h)\nMódulo 2: Word\n- Interface e menus (2h)...'}
                className="w-full border border-gray-200 rounded-2xl p-3 text-sm resize-none focus:outline-none focus:border-indigo-400 bg-gray-50"
              />
              <div className="flex gap-2 mt-3">
                <button onClick={() => setPhase('upload')} className="flex-1 bg-gray-100 text-gray-600 rounded-2xl py-3 font-bold text-sm">Voltar</button>
                <button
                  onClick={() => runExtraction(pasteText.trim())}
                  disabled={pasteText.trim().length < 20}
                  className="flex-[2] bg-indigo-600 text-white rounded-2xl py-3 font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                >
                  <Sparkles size={15} /> Extrair com IA
                </button>
              </div>
            </div>
          )}

          {/* LOADING */}
          {phase === 'loading' && (
            <div className="text-center py-12">
              <Loader2 size={36} className="mx-auto mb-4 animate-spin text-indigo-500" />
              <p className="text-sm font-bold text-gray-700">Lendo o documento...</p>
              <p className="text-xs text-gray-400 mt-1">A IA está extraindo as informações. Pode levar alguns segundos.</p>
            </div>
          )}

          {/* ERROR */}
          {phase === 'error' && (
            <div className="text-center py-10">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-red-50 flex items-center justify-center mb-4">
                <AlertCircle size={28} className="text-red-400" />
              </div>
              <p className="text-sm font-bold text-gray-700 mb-1">Não deu certo</p>
              <p className="text-xs text-gray-400 mb-5 px-4">{errorMsg}</p>
              <div className="flex flex-col gap-2 items-stretch px-4">
                <button onClick={() => setPhase('upload')} className="bg-gray-100 text-gray-700 rounded-2xl py-3 px-6 font-bold text-sm">Tentar outro arquivo</button>
                <button onClick={() => setPhase('paste')} className="bg-indigo-50 text-indigo-600 rounded-2xl py-3 px-6 font-bold text-sm">Colar texto do documento</button>
                <button onClick={startManual} className="bg-indigo-50 text-indigo-600 rounded-2xl py-3 px-6 font-bold text-sm">Criar manualmente</button>
              </div>
            </div>
          )}

          {/* REVIEW — CALENDAR */}
          {phase === 'review' && mode === 'calendar' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 bg-indigo-50 rounded-xl p-3 mb-1">
                <Sparkles size={15} className="text-indigo-500 shrink-0" />
                <p className="text-xs text-indigo-700 font-medium">Revise os {events.length} eventos extraídos. Ajuste o tipo, a data ou remova o que não quiser antes de confirmar.</p>
              </div>
              {events.map((ev, i) => {
                const meta = IMPORT_EVENT_TYPES.find(t => t.key === ev.type) || IMPORT_EVENT_TYPES[1];
                return (
                  <div key={i} className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <div className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: meta.color }} />
                      <input
                        value={ev.title}
                        onChange={e => setEvents(prev => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                        className="flex-1 bg-transparent text-sm font-bold text-gray-800 focus:outline-none border-b border-transparent focus:border-gray-300 min-w-0"
                      />
                      <button onClick={() => setEvents(prev => prev.filter((_, j) => j !== i))} className="text-red-300 shrink-0"><Trash2 size={15} /></button>
                    </div>
                    <div className="flex items-center gap-2 pl-5">
                      <input
                        type="date"
                        value={ev.date}
                        onChange={e => setEvents(prev => prev.map((x, j) => j === i ? { ...x, date: e.target.value } : x))}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-xs font-semibold text-gray-600 bg-white focus:outline-none"
                      />
                      <select
                        value={ev.type}
                        onChange={e => setEvents(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value as ImportEventType } : x))}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-xs font-semibold bg-white focus:outline-none"
                        style={{ color: meta.color }}
                      >
                        {IMPORT_EVENT_TYPES.map(t => <option key={t.key} value={t.key} style={{ color: '#374151' }}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
              <button
                onClick={() => setEvents(prev => [...prev, { title: 'Novo evento', date: todayISO, type: 'admin' }])}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 rounded-xl py-2.5"
              >
                <Plus size={14} /> Adicionar evento
              </button>
            </div>
          )}

          {/* REVIEW — SYLLABUS */}
          {phase === 'review' && mode === 'syllabus' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 bg-indigo-50 rounded-xl p-3">
                <Sparkles size={15} className="text-indigo-500 shrink-0" />
                <p className="text-xs text-indigo-700 font-medium">Encontrei {rows.length} módulos com {rows.reduce((s, r) => s + r.estimatedClasses, 0)} aulas no total. Defina <b>quando cada módulo começa nesta turma</b>. As aulas serão distribuídas nos dias da turma ({(targetClass?.days?.length ? targetClass!.days : [1,2,3,4,5]).map(d => ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d]).join(', ')}), cada uma com seu conteúdo.</p>
              </div>
              <button
                onClick={() => setRows(prev => computeSequentialStarts(prev, prev[0]?.startDate || todayISO, targetClass, buildHolidayISOs(customEvents)))}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 rounded-xl py-2"
              >
                <RefreshCw size={13} /> Distribuir em sequência a partir do 1º módulo
              </button>
              {rows.map((mod, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    <input
                      value={mod.title}
                      onChange={e => setRows(prev => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                      className="flex-1 bg-transparent text-sm font-bold text-gray-800 focus:outline-none border-b border-transparent focus:border-gray-300 min-w-0"
                    />
                    <button onClick={() => setRows(prev => prev.filter((_, j) => j !== i))} className="text-red-300 shrink-0"><Trash2 size={15} /></button>
                  </div>
                  {mod.topics.length > 0 && (
                    <p className="text-[11px] text-gray-400 pl-8 line-clamp-2">{mod.topics.join(' · ')}</p>
                  )}
                  <div className="flex items-center gap-2 pl-8">
                    <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-1">
                      <button onClick={() => setRows(prev => prev.map((x, j) => j === i ? { ...x, estimatedClasses: Math.max(1, x.estimatedClasses - 1) } : x))} className="w-6 h-6 text-gray-400 font-bold">−</button>
                      <span className="text-xs font-bold text-gray-700 w-12 text-center">{mod.estimatedClasses} aula{mod.estimatedClasses !== 1 ? 's' : ''}</span>
                      <button onClick={() => setRows(prev => prev.map((x, j) => j === i ? { ...x, estimatedClasses: Math.min(200, x.estimatedClasses + 1) } : x))} className="w-6 h-6 text-gray-400 font-bold">+</button>
                    </div>
                    <input
                      type="date"
                      value={mod.startDate}
                      onChange={e => setRows(prev => prev.map((x, j) => j === i ? { ...x, startDate: e.target.value } : x))}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-indigo-700 bg-white focus:outline-none flex-1"
                    />
                  </div>
                </div>
              ))}
              <button
                onClick={() => setRows(prev => [...prev, { title: `Módulo ${prev.length + 1}`, topics: [], estimatedClasses: 4, startDate: prev[prev.length - 1]?.startDate || todayISO }])}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 rounded-xl py-2.5"
              >
                <Plus size={14} /> Adicionar módulo
              </button>
            </div>
          )}
        </div>

        {phase === 'review' && (
          <div className="p-5 pt-3 border-t border-gray-100 flex gap-3 items-center">
            {mode === 'syllabus' && <span className="text-xs text-gray-400 font-medium shrink-0">{totalLessons} aulas</span>}
            <button onClick={onClose} className="flex-1 p-3.5 rounded-2xl bg-gray-100 font-bold text-gray-600">Cancelar</button>
            <button
              onClick={mode === 'calendar' ? confirmCalendar : confirmSyllabus}
              disabled={mode === 'calendar' ? events.length === 0 : rows.length === 0}
              className="flex-[2] p-3.5 rounded-2xl bg-indigo-600 text-white font-black text-base shadow-sm active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <CheckCircle2 size={18} />
              {mode === 'calendar' ? 'Adicionar ao calendário' : 'Distribuir no calendário'}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};

const CalendarScreen = ({
  classes,
  setClasses,
  schedules,
  profile,
  inboxMessages,
  customEvents,
  setCustomEvents,
  selectedDate,
  setSelectedDate,
  currentMonth,
  setCurrentMonth,
  currentYear,
  setCurrentYear,
  setScreen,
  notifications,
  setNotifications,
  onImport
}: {
  classes: ClassItem[],
  setClasses: (c: ClassItem[]) => void,
  schedules: ClassSchedule[],
  profile: UserProfile,
  inboxMessages: {id: string, role: 'user' | 'model', text: string, date: number, attachment?: { mimeType: string, url: string, data: string, name: string }}[],
  customEvents: {id: string, title: string, date: string, type: 'prep' | 'admin' | 'holiday' | 'commemorative', status?: 'pending' | 'done'}[],
  setCustomEvents: (c: {id: string, title: string, date: string, type: 'prep' | 'admin' | 'holiday' | 'commemorative', status?: 'pending' | 'done'}[]) => void,
  selectedDate: number,
  setSelectedDate: (d: number) => void,
  currentMonth: number,
  setCurrentMonth: (m: number) => void,
  currentYear: number,
  setCurrentYear: (y: number) => void,
  setScreen: (s: Screen) => void,
  notifications?: any[],
  setNotifications?: (n: any[]) => void,
  onImport?: () => void
}) => {
  const [filter, setFilter] = useState('Todas');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventType, setNewEventType] = useState<'prep' | 'admin'>('prep');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const monthAbbrNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const [globalHolidays, setGlobalHolidays] = useState<{id:string,name:string,date:string}[]>([]);
  useEffect(() => {
    getDoc(doc(db, 'config', 'feriados')).then(snap => {
      if (snap.exists()) setGlobalHolidays(snap.data().list || []);
    }).catch(() => {});
  }, []);

  const EVENT_PRESETS = [
    { label: 'Prova',             icon: FileQuestion,  type: 'admin' as const, color: '#EF4444' },
    { label: 'Reunião',           icon: Users,         type: 'admin' as const, color: '#3B82F6' },
    { label: 'Conselho de Classe',icon: MessageSquare, type: 'admin' as const, color: '#8B5CF6' },
    { label: 'Recesso',           icon: Coffee,        type: 'prep'  as const, color: '#F59E0B' },
    { label: 'Saída Pedagógica',  icon: MapPin,        type: 'prep'  as const, color: '#10B981' },
    { label: 'Reposição de Aula', icon: RefreshCw,     type: 'prep'  as const, color: '#6366F1' },
    { label: 'Entrega de Notas',  icon: ClipboardList, type: 'admin' as const, color: '#F97316' },
    { label: 'Outro',             icon: Plus,          type: 'prep'  as const, color: '#6B7280' },
  ];
  
  const days = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const dates = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  const startingEmptyCells = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const monthName = new Date(currentYear, currentMonth).toLocaleString('pt-BR', { month: 'long' });

  const filteredClasses = filter === 'Todas' 
    ? classes 
    : classes.filter(c => c.className === filter);

  const defaultHolidays = getDefaultHolidays(currentYear).filter(h => !customEvents.some(ce => ce.title === h.title && ce.date.startsWith(h.date.split(' ')[0])));

  const globalHolidayEvents = globalHolidays.map(h => ({ id: h.id, title: h.name, date: h.date, type: 'holiday' as const }));

  const allEvents = [...filteredClasses.map(c => ({...c, type: 'class' as const})), ...customEvents, ...defaultHolidays, ...globalHolidayEvents];
  
  const getEventColorInternal = (e: any) => {
    if (e.type === 'class') {
      const schedule = schedules.find(s => s.name === e.className);
      return schedule?.color || '#4F46E5';
    }
    if (e.type === 'holiday') return '#EAB308';      // yellow — feriado nacional
    if (e.type === 'commemorative') return '#A855F7'; // purple — data comemorativa
    if (e.type === 'prep') return '#10B981';
    return '#F59E0B';
  };

  const getDayEvents = (day: number) => {
    return allEvents.filter(e => {
      if (e.date.includes('-')) {
        const [yearStr, monthStr, dayStr] = e.date.split(' ')[0].split('-');
        return parseInt(yearStr) === currentYear && parseInt(monthStr) === currentMonth + 1 && parseInt(dayStr) === day;
      }
      const parts = e.date.split(' ');
      const eDay = parseInt(parts[0]);
      if (parts.length > 1) {
        return eDay === day && parts[1] === monthAbbrNames[currentMonth];
      }
      return eDay === day;
    });
  };

  const eventsThisMonth = allEvents.filter(e => {
    if (e.date.includes('-')) {
      const [yearStr, monthStr] = e.date.split(' ')[0].split('-');
      return parseInt(yearStr) === currentYear && parseInt(monthStr) === currentMonth + 1;
    }
    const parts = e.date.split(' ');
    if (parts.length > 1) {
      return parts[1] === monthAbbrNames[currentMonth];
    }
    return true;
  }).sort((a, b) => {
    const dayA = a.date.includes('-') ? parseInt(a.date.split(' ')[0].split('-')[2]) : parseInt(a.date.split(' ')[0]);
    const dayB = b.date.includes('-') ? parseInt(b.date.split(' ')[0].split('-')[2]) : parseInt(b.date.split(' ')[0]);
    return (isNaN(dayA) ? 0 : dayA) - (isNaN(dayB) ? 0 : dayB);
  });

  const selectedDayEvents = getDayEvents(selectedDate);

  const [monthDir, setMonthDir] = useState(0);
  const changeMonth = (delta: number) => {
    setMonthDir(delta);
    let newMonth = currentMonth + delta;
    let newYear = currentYear;
    if (newMonth < 0) { newMonth = 11; newYear -= 1; }
    else if (newMonth > 11) { newMonth = 0; newYear += 1; }
    setCurrentMonth(newMonth);
    setCurrentYear(newYear);
  };

  const handleAddEvent = () => {
    if (!newEventTitle) return;
    const newEvent = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2),
      title: newEventTitle,
      date: `${selectedDate} ${monthAbbrNames[currentMonth]}`,
      type: newEventType,
      status: 'pending' as const
    };
    setCustomEvents([...customEvents, newEvent]);
    setIsModalOpen(false);
    setNewEventTitle('');
    setSelectedPreset(null);
  };

  const todayReal = new Date();
  const weekStart = new Date(todayReal);
  weekStart.setHours(0, 0, 0, 0);
  const dow = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - (dow === 0 ? 6 : dow - 1));

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const allEventsForWeek = [
    ...filteredClasses.map(c => ({ ...c, type: 'class' as const })),
    ...customEvents,
    ...getDefaultHolidays(todayReal.getFullYear()).filter(
      h => !customEvents.some(ce => ce.title === h.title && ce.date.startsWith(h.date.split(' ')[0]))
    ),
    ...getDefaultHolidays(todayReal.getFullYear() + 1).filter(
      h => !customEvents.some(ce => ce.title === h.title && ce.date.startsWith(h.date.split(' ')[0]))
    ),
  ];

  const getWeekDayEvents = (date: Date) => {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return allEventsForWeek.filter(e => {
      if (e.date.includes('-')) {
        const [ys, ms, ds] = e.date.split(' ')[0].split('-');
        return parseInt(ys) === y && parseInt(ms) === m && parseInt(ds) === d;
      }
      const parts = e.date.split(' ');
      const eDay = parseInt(parts[0]);
      const eMon = parts[1];
      const abbrs = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return eDay === d && eMon === abbrs[date.getMonth()];
    });
  };

  const ptDayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  const getEventColor = (e: any) => {
    if (e.type === 'class') {
      const schedule = schedules.find(s => s.name === e.className);
      return schedule?.color || '#4F46E5';
    }
    if (e.type === 'holiday') return '#EAB308';
    if (e.type === 'commemorative') return '#A855F7';
    if (e.type === 'prep') return '#10B981';
    return '#F59E0B';
  };

  const formatEventDate = (dateStr: string) => {
    if (dateStr.includes('-')) {
      const [year, month, day] = dateStr.split(' ')[0].split('-');
      const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      return `${parseInt(day)} ${monthNames[parseInt(month)-1]}`;
    }
    return dateStr;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header 
        setScreen={setScreen}
        title="Cronograma" 
        subtitle="Visão Semestral" 
        profile={profile} 
        notifications={notifications}
        setNotifications={setNotifications}
        bannerImage="https://i.ibb.co/x8t6Wmp7/20260419-204249-0002.png"
      >
        <div className="flex items-center gap-2 shrink-0">
          {onImport && (
            <button
              onClick={onImport}
              className="w-10 h-10 bg-white border border-indigo-100 text-indigo-600 rounded-xl shadow-sm flex items-center justify-center"
              title="Importar calendário letivo (PDF)"
            >
              <FileUp size={20} />
            </button>
          )}
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-10 h-10 bg-indigo-600 text-white rounded-xl shadow-sm flex items-center justify-center"
          >
            <Plus size={24} />
          </button>
        </div>
      </Header>
      
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-6" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-1">Novo Evento</h2>
            <p className="text-sm text-gray-400 mb-4">{selectedDate} de {monthAbbrNames[currentMonth]}</p>

            <div className="grid grid-cols-4 gap-2 mb-5">
              {EVENT_PRESETS.map(preset => {
                const Icon = preset.icon;
                const isActive = selectedPreset === preset.label;
                return (
                  <button
                    key={preset.label}
                    onClick={() => {
                      setSelectedPreset(preset.label);
                      setNewEventTitle(preset.label);
                      setNewEventType(preset.type);
                    }}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-2xl border-2 transition-all ${isActive ? 'border-current scale-105 shadow-sm' : 'border-gray-100 hover:border-gray-200'}`}
                    style={isActive ? { borderColor: preset.color, backgroundColor: preset.color + '15' } : {}}
                  >
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: preset.color + '22' }}>
                      <Icon size={16} style={{ color: preset.color }} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-600 text-center leading-tight">{preset.label}</span>
                  </button>
                );
              })}
            </div>

            <input
              type="text"
              placeholder="Personalizar título..."
              value={newEventTitle}
              onChange={(e) => setNewEventTitle(e.target.value)}
              className="w-full p-3 mb-4 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />

            <div className="flex gap-3">
              <button onClick={() => { setIsModalOpen(false); setSelectedPreset(null); setNewEventTitle(''); }} className="flex-1 p-3 rounded-xl bg-gray-100 font-bold text-sm">Cancelar</button>
              <button
                onClick={handleAddEvent}
                disabled={!newEventTitle.trim()}
                className="flex-1 p-3 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-40"
              >Adicionar</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Calendar Grid */}
      <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-50 mb-8">
        <div className="flex justify-between items-center mb-6">
          <button onClick={() => changeMonth(-1)} className="p-1 text-gray-400"><ChevronRight className="rotate-180" size={20} /></button>
          <h2 className="font-bold text-gray-900 capitalize">{monthName} {currentYear}</h2>
          <button onClick={() => changeMonth(1)} className="p-1 text-gray-400"><ChevronRight size={20} /></button>
        </div>
        
        <div className="grid grid-cols-7 gap-y-1 text-center">
          {days.map(d => <span key={d} className="text-xs font-bold text-gray-400 uppercase tracking-wider">{d}</span>)}
        </div>
        <div className="overflow-hidden">
        <AnimatePresence mode="wait" custom={monthDir}>
        <motion.div
          key={`${currentYear}-${currentMonth}`}
          custom={monthDir}
          variants={{
            enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
            center: { x: 0, opacity: 1 },
            exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.22, ease: 'easeInOut' }}
          className="grid grid-cols-7 gap-y-4 text-center mt-4"
        >
          {Array(startingEmptyCells).fill(0).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {dates.map((d, di) => {
            const today = new Date();
            const isToday = d === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
            const isSelected = d === selectedDate;
            const dayEvents = getDayEvents(d);
            const mainEvent = dayEvents.find(e => e.type === 'holiday') || dayEvents.find(e => e.type === 'commemorative') || dayEvents.find(e => e.type === 'class') || dayEvents[0];
            const dayColor = mainEvent ? getEventColorInternal(mainEvent) : null;
            // allDone only considers tasks (classes/prep/admin), never holidays
            const taskEvents = dayEvents.filter(e => e.type !== 'holiday' && e.type !== 'commemorative');
            const allDone = taskEvents.length > 0 && taskEvents.every(e => (e as any).status === 'done');

            let cellStyle: React.CSSProperties = {};
            let cellClass = 'text-sm font-medium w-9 h-9 flex flex-col items-center justify-center rounded-xl transition-all relative';

            if (isSelected) {
              cellClass += ' bg-indigo-600 text-white shadow-md font-bold';
            } else if (isToday) {
              cellClass += ' ring-2 ring-indigo-500 font-black bg-indigo-600 text-white';
            } else if (dayColor && !allDone) {
              cellStyle = { backgroundColor: dayColor, color: '#fff' };
              cellClass += ' font-bold shadow-sm';
            } else {
              cellClass += ' text-gray-600 hover:bg-gray-100';
            }

            return (
              <motion.div
                key={d}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: di * 0.012, duration: 0.2 }}
                className="relative flex justify-center py-0.5"
              >
                <button
                  onClick={() => { setSelectedDate(d); setScreen('dayDetail'); }}
                  style={cellStyle}
                  className={cellClass}
                >
                  <span>{d}</span>
                  {isToday && !isSelected && (
                    <span className="text-[7px] font-black leading-none -mt-0.5 uppercase tracking-wide opacity-80">hoje</span>
                  )}
                </button>
              </motion.div>
            );
          })}
        </motion.div>
        </AnimatePresence>
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900">Esta Semana</h2>
        </div>
        <div className="space-y-2">
          {weekDays.map((date, idx) => {
            const isToday = date.toDateString() === todayReal.toDateString();
            const dayEvts = getWeekDayEvents(date);
            if (!isToday && dayEvts.length === 0) return null;
            return (
              <div
                key={idx}
                className={`rounded-2xl border shadow-sm overflow-hidden ${isToday ? 'border-indigo-200 bg-indigo-50' : 'border-gray-100 bg-white'}`}
              >
                <div className={`flex items-center gap-2 px-4 py-2 ${isToday ? 'bg-indigo-100' : 'bg-gray-50'}`}>
                  <span className={`text-xs font-bold uppercase tracking-wide ${isToday ? 'text-indigo-700' : 'text-gray-400'}`}>
                    {ptDayNames[date.getDay()]}
                  </span>
                  <span className={`text-sm font-black ${isToday ? 'text-indigo-800' : 'text-gray-700'}`}>
                    {date.getDate()}
                  </span>
                  <span className={`text-xs ${isToday ? 'text-indigo-500' : 'text-gray-400'}`}>
                    {date.toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}
                  </span>
                  {isToday && (
                    <span className="ml-auto text-[10px] font-black text-indigo-600 bg-indigo-200 rounded-full px-2 py-0.5 uppercase tracking-wide">hoje</span>
                  )}
                </div>
                {dayEvts.length === 0 ? (
                  <div className="px-4 py-3">
                    <p className="text-xs text-gray-400 italic">Nenhum evento</p>
                  </div>
                ) : (
                  <div className="px-4 py-2 space-y-1.5">
                    {dayEvts.map((e: any) => (
                      <div key={e.id} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getEventColorInternal(e) }} />
                        <span className={`text-sm ${e.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                          {e.type === 'class' ? `${e.className}${e.topic ? `: ${e.topic}` : ''}` : e.title}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {weekDays.every(date => !( date.toDateString() === todayReal.toDateString() || getWeekDayEvents(date).length > 0)) && (
            <div className="text-center py-6 bg-white rounded-2xl border border-gray-50 shadow-sm">
              <CalendarIcon size={24} className="mx-auto text-gray-300 mb-2" />
              <p className="text-gray-400 text-sm font-medium">Nenhum evento esta semana</p>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 mb-6">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#EAB308]" /><span className="text-xs text-gray-500">Feriado nacional</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#A855F7]" /><span className="text-xs text-gray-500">Data comemorativa</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#10B981]" /><span className="text-xs text-gray-500">Preparação</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" /><span className="text-xs text-gray-500">Administrativo</span></div>
      </div>
    </motion.div>
  );
};

type GameMode = 'story' | 'quiz' | 'wordsearch' | 'crossword' | 'bingo' | 'escape' | 'memory' | 'sequencia' | 'flashcard';
type EscapeTheme = 'medieval' | 'lab' | 'detective' | 'space';

const buildWordSearchGrid = (rawWords: string[], size = 15): { grid: string[][], placements: {word: string, row: number, col: number, dir: string}[] } => {
  const words = rawWords.map(w => w.toUpperCase().replace(/[^A-ZÁÉÍÓÚÂÊÔÃÕÇÜ]/gi, '')).filter(w => w.length >= 3 && w.length <= size);
  const grid: string[][] = Array.from({ length: size }, () => Array(size).fill(''));
  const dirs = [ [0,1,'→'], [1,0,'↓'], [1,1,'↘'], [-1,1,'↗'] ] as const;
  const placements: {word: string, row: number, col: number, dir: string}[] = [];
  for (const word of words) {
    let placed = false;
    for (let attempt = 0; attempt < 80 && !placed; attempt++) {
      const [dr, dc, dirLabel] = dirs[Math.floor(Math.random() * dirs.length)];
      const r0 = Math.floor(Math.random() * size);
      const c0 = Math.floor(Math.random() * size);
      const rEnd = r0 + dr * (word.length - 1);
      const cEnd = c0 + dc * (word.length - 1);
      if (rEnd < 0 || rEnd >= size || cEnd < 0 || cEnd >= size) continue;
      let ok = true;
      for (let i = 0; i < word.length; i++) {
        const cell = grid[r0 + dr * i][c0 + dc * i];
        if (cell && cell !== word[i]) { ok = false; break; }
      }
      if (!ok) continue;
      for (let i = 0; i < word.length; i++) grid[r0 + dr * i][c0 + dc * i] = word[i];
      placements.push({ word, row: r0, col: c0, dir: dirLabel });
      placed = true;
    }
  }
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!grid[r][c]) grid[r][c] = letters[Math.floor(Math.random() * 26)];
  return { grid, placements };
};

const buildBingoCards = (items: string[], count: number, dim: 3 | 5 = 5, freeText = 'LIVRE'): string[][][] => {
  const hasFree = dim === 5;
  const needed = dim * dim - (hasFree ? 1 : 0);
  const freeR = Math.floor(dim / 2), freeC = Math.floor(dim / 2);
  const cards: string[][][] = [];
  for (let n = 0; n < count; n++) {
    const shuffled = shuffleArray(items).slice(0, needed);
    const card: string[][] = [];
    let idx = 0;
    for (let r = 0; r < dim; r++) {
      const row: string[] = [];
      for (let c = 0; c < dim; c++) {
        if (hasFree && r === freeR && c === freeC) row.push(`★ ${freeText}`);
        else row.push(shuffled[idx++] || '');
      }
      card.push(row);
    }
    cards.push(card);
  }
  return cards;
};

const buildCrosswordGrid = (rawWords: {word: string, clue: string}[]) => {
  const SIZE = 21;
  const CENTER = Math.floor(SIZE / 2);
  type Cell = string | null;
  const grid: Cell[][] = Array.from({length: SIZE}, () => Array(SIZE).fill(null));
  type Placement = {word: string, clue: string, row: number, col: number, dir: 'H' | 'V'};
  const placements: Placement[] = [];
  // Normaliza acentos (Á→A, É→E, Ç→C, …) ANTES de filtrar para não mutilar palavras acentuadas
  const words = rawWords.slice(0, 15).map(w => ({...w, word: w.word.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z]/g, '')})).filter(w => w.word.length >= 3);
  if (words.length === 0) return null;

  const canPlace = (word: string, row: number, col: number, dir: 'H' | 'V'): boolean => {
    const len = word.length;
    if (dir === 'H') {
      if (col < 0 || col + len > SIZE || row < 0 || row >= SIZE) return false;
      if (col > 0 && grid[row][col - 1] !== null) return false;
      if (col + len < SIZE && grid[row][col + len] !== null) return false;
      for (let i = 0; i < len; i++) {
        const cell = grid[row][col + i];
        if (cell !== null && cell !== word[i]) return false;
        if (cell === null) {
          if (row > 0 && grid[row - 1][col + i] !== null) return false;
          if (row < SIZE - 1 && grid[row + 1][col + i] !== null) return false;
        }
      }
    } else {
      if (row < 0 || row + len > SIZE || col < 0 || col >= SIZE) return false;
      if (row > 0 && grid[row - 1][col] !== null) return false;
      if (row + len < SIZE && grid[row + len][col] !== null) return false;
      for (let i = 0; i < len; i++) {
        const cell = grid[row + i][col];
        if (cell !== null && cell !== word[i]) return false;
        if (cell === null) {
          if (col > 0 && grid[row + i][col - 1] !== null) return false;
          if (col < SIZE - 1 && grid[row + i][col + 1] !== null) return false;
        }
      }
    }
    return true;
  };

  const doPlace = (word: string, row: number, col: number, dir: 'H' | 'V') => {
    for (let i = 0; i < word.length; i++) {
      if (dir === 'H') grid[row][col + i] = word[i];
      else grid[row + i][col] = word[i];
    }
  };

  const first = words[0];
  doPlace(first.word, CENTER, CENTER - Math.floor(first.word.length / 2), 'H');
  placements.push({word: first.word, clue: first.clue, row: CENTER, col: CENTER - Math.floor(first.word.length / 2), dir: 'H'});

  for (let wi = 1; wi < words.length; wi++) {
    const {word, clue} = words[wi];
    let placed = false;
    for (const pw of [...placements].reverse()) {
      if (placed) break;
      const nd: 'H' | 'V' = pw.dir === 'H' ? 'V' : 'H';
      for (let ni = 0; ni < word.length && !placed; ni++) {
        for (let pi = 0; pi < pw.word.length && !placed; pi++) {
          if (word[ni] !== pw.word[pi]) continue;
          const row = nd === 'V' ? pw.row - ni : pw.row + pi;
          const col = nd === 'V' ? pw.col + pi : pw.col - ni;
          if (canPlace(word, row, col, nd)) {
            doPlace(word, row, col, nd);
            placements.push({word, clue, row, col, dir: nd});
            placed = true;
          }
        }
      }
    }
  }

  let minR = SIZE, maxR = 0, minC = SIZE, maxC = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (grid[r][c] !== null) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  }
  if (minR > maxR) return null;
  const pad = 1;
  const r0 = Math.max(0, minR - pad), r1 = Math.min(SIZE - 1, maxR + pad);
  const c0 = Math.max(0, minC - pad), c1 = Math.min(SIZE - 1, maxC + pad);
  const trimmed: Cell[][] = [];
  for (let r = r0; r <= r1; r++) trimmed.push(grid[r].slice(c0, c1 + 1));
  const adjP = placements.map(p => ({...p, row: p.row - r0, col: p.col - c0}));
  const cellNum = new Map<string, number>();
  let counter = 1;
  const sorted = [...adjP].sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);
  const across: {num: number, word: string, clue: string}[] = [];
  const down: {num: number, word: string, clue: string}[] = [];
  for (const p of sorted) {
    const key = `${p.row},${p.col}`;
    if (!cellNum.has(key)) cellNum.set(key, counter++);
    const num = cellNum.get(key)!;
    if (p.dir === 'H') across.push({num, word: p.word, clue: p.clue});
    else down.push({num, word: p.word, clue: p.clue});
  }
  across.sort((a, b) => a.num - b.num);
  down.sort((a, b) => a.num - b.num);
  return {grid: trimmed, cellNumbers: Object.fromEntries(cellNum), across, down};
};

const STORY_SECTIONS = ['🗺️ Quem é Quem', '📖 A História', '🎬 Atividade'];

const generateStoryImages = async (topic: string, popTheme: string): Promise<Record<string, string>> => {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) return {};
  try {
    const keywordPrompt = `For an educational narrative-metaphor story that teaches "${topic}" set in the pop-culture universe of "${popTheme}", generate one short English search keyword (2-4 words) per section to find an illustration on Pixabay.
Return ONLY valid JSON with these exact keys:
{"🗺️ Quem é Quem":"...","📖 A História":"...","🎬 Atividade":"..."}`;
    const response = await generateContentWithRetry({ model: AI_MODEL, contents: keywordPrompt });
    const raw = response.text || '';
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const keywords: Record<string, string> = JSON.parse(cleaned);

    const entries = await Promise.all(
      STORY_SECTIONS.map(async section => {
        const q = keywords[section];
        if (!q) return [section, ''] as [string, string];
        const cacheKey = `illus|${q.trim().toLowerCase()}`;
        if (pixabayCache.has(cacheKey)) return [section, pixabayCache.get(cacheKey)!] as [string, string];
        try {
          const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(q.trim())}&image_type=illustration&safesearch=true&orientation=horizontal&per_page=20&order=popular`;
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) return [section, ''] as [string, string];
          const data = await res.json();
          if (!data.hits?.length) return [section, ''] as [string, string];
          const hit = data.hits[Math.floor(Math.random() * Math.min(5, data.hits.length))];
          const imgUrl: string = hit.webformatURL || hit.largeImageURL || '';
          if (imgUrl) pixabayCache.set(cacheKey, imgUrl);
          return [section, imgUrl] as [string, string];
        } catch { return [section, ''] as [string, string]; }
      })
    );
    return Object.fromEntries(entries.filter(([, v]) => v));
  } catch (err) {
    console.warn('[StoryImages] failed:', err);
    return {};
  }
};

const printGameResult = (opts: { title: string, subject?: string, level?: string, className?: string, teacherName?: string, schoolName?: string, activityLabel: string, bingoDim?: number }) => {
  const node = document.getElementById('game-print-area');
  if (!node) return;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast.error('O navegador bloqueou a janela de impressão. Permita pop-ups e tente de novo.'); return; }
  // Sequência Didática é documento do PROFESSOR: sem campos de aluno, sem placar, sem "boa sorte"
  const isTeacherDoc = opts.activityLabel === 'Sequência Didática';
  const fieldsHtml = isTeacherDoc
    ? `
        <div class="fields-grid">
          <div class="field" style="grid-column:1/3"><span class="field-label">PROFESSOR(A)</span><div class="field-line">${escapeHtml(opts.teacherName || '')}</div></div>
          <div class="field" style="grid-column:3/-1"><span class="field-label">TURMA</span><div class="field-line">${escapeHtml(opts.className || '')}</div></div>
        </div>`
    : `
        <div class="fields-grid">
          <div class="field"><span class="field-label">NOME</span><div class="field-line"></div></div>
          <div class="field"><span class="field-label">DATA</span><div class="field-line short"></div></div>
          <div class="field"><span class="field-label">TURMA</span><div class="field-line short">${escapeHtml(opts.className || '')}</div></div>
          <div class="field"><span class="field-label">N&ordm;</span><div class="field-line tiny"></div></div>
          <div class="field full"><span class="field-label">PROFESSOR(A)</span><div class="field-line">${escapeHtml(opts.teacherName || '')}</div></div>
        </div>`;
  const headerHtml = `
    <div class="page-header">
      <div class="header-inner">
        <div class="header-top-row">
          <div class="header-text">
            <div class="school-row">
              <div class="school-name">${escapeHtml(opts.schoolName || 'ESCOLA')}</div>
              <div class="school-meta">${escapeHtml(opts.subject || '')}${opts.level ? ' • ' + escapeHtml(opts.level) : ''}</div>
            </div>
            <div class="activity-tag">${escapeHtml(opts.activityLabel)}</div>
            <h1 class="doc-title">${escapeHtml(opts.title)}</h1>
          </div>
        </div>
        ${fieldsHtml}
      </div>
    </div>
  `;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title><style>
    @page { size: A4; margin: 1.4cm 1.4cm 2cm; }
    * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1f2937; line-height: 1.5; margin: 0; font-size: 12px; background: white; }

    /* ── HEADER ───────────────────────────────────────────── */
    .page-header { background: white; border: 1.5px solid #e5e7eb; border-top: 6px solid var(--ac,#4338ca); border-radius: 12px; padding: 16px 18px 14px; color: #111827; margin-bottom: 18px; }
    .header-inner { position:relative; }
    .header-top-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    .header-text { flex:1; min-width:0; }
    .school-row { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #f3f4f6; font-size:8.5px; letter-spacing:1.5px; color:#9ca3af; text-transform:uppercase; font-weight:700; }
    .school-name { font-weight:900; color:#111827; font-size:10px; }
    .activity-tag { display:inline-flex; align-items:center; gap:5px; background:var(--ac,#4338ca); color:white; padding:3.5px 12px; border-radius:20px; font-size:9px; font-weight:900; letter-spacing:1.2px; text-transform:uppercase; margin-bottom:7px; }
    .doc-title { font-size:23px; font-weight:900; color:#111827; margin:0 0 14px; line-height:1.2; letter-spacing:-0.3px; }
    .fields-grid { display:grid; grid-template-columns:2fr 1fr 1fr 0.5fr; gap:7px 12px; margin-top:4px; }
    .field { display:flex; flex-direction:column; gap:2px; }
    .field.full { grid-column:1/-1; }
    .field-label { font-size:7px; font-weight:900; color:#9ca3af; letter-spacing:1.5px; text-transform:uppercase; }
    .field-line { border-bottom:1.5px solid #d1d5db; min-height:17px; padding:2px 4px; font-size:10.5px; color:#111827; font-weight:700; }

    /* ── HOW TO PLAY card ─────────────────────────────────── */
    .instructions { display:flex; gap:12px; align-items:center; background:white; border:2.5px dashed var(--ac,#4338ca); padding:10px 14px; margin:10px 0 18px; border-radius:10px; font-size:11px; color:#1f2937; }
    .instructions-icon { width:52px; height:52px; flex-shrink:0; image-rendering:pixelated; image-rendering:crisp-edges; }
    .instructions-icon svg { width:100%; height:100%; display:block; }
    .instructions-body { flex:1; }
    .instructions-title { font-size:8.5px; font-weight:900; color:var(--ac,#4338ca); letter-spacing:1.5px; text-transform:uppercase; margin-bottom:4px; }

    /* pixel decorations */
    .px-deco { position:absolute; image-rendering:pixelated; image-rendering:crisp-edges; opacity:0.85; z-index:0; }
    .px-deco svg { width:100%; height:100%; display:block; }

    /* ── GENERAL CONTENT ──────────────────────────────────── */
    h2 { font-size:13px; margin:18px 0 8px; color:var(--ac,#4338ca); font-weight:900; padding:5px 12px; border:1.5px solid var(--ac,#4338ca); border-radius:6px; display:inline-block; }
    h3 { font-size:12px; margin:10px 0 4px; color:#1f2937; font-weight:700; }
    p { margin:6px 0; }

    /* ── WORD SEARCH ──────────────────────────────────────── */
    .ws-wrapper { display:flex; justify-content:center; margin:14px 0 10px; page-break-inside:avoid; break-inside:avoid; }
    .ws-grid { display:grid; gap:0; border:3px solid var(--ac,#4338ca); background:var(--ac,#4338ca); page-break-inside:avoid; break-inside:avoid; padding:2px; border-radius:8px; box-shadow:0 3px 12px rgba(0,0,0,0.15); }
    .ws-cell { background:white; width:24px; height:24px; text-align:center; line-height:24px; font-weight:800; font-size:12px; font-family:'Courier New',monospace; color:#111; }
    /* word chips (injected by JS) */
    .word-chips { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0 18px; }
    .word-chip { display:inline-flex; align-items:center; gap:6px; border:2px solid var(--ac,#4338ca); border-radius:20px; padding:4px 10px 4px 6px; font-size:10px; font-weight:700; color:var(--ac,#4338ca); background:var(--ac-light,#eef2ff); page-break-inside:avoid; }
    .word-chip-box { width:14px; height:14px; border:1.5px solid var(--ac,#4338ca); border-radius:3px; flex-shrink:0; background:white; }

    /* ── BINGO ────────────────────────────────────────────── */
    .bingo-card { border:3px solid var(--ac,#4338ca); margin:8px 8px 26px; page-break-inside:avoid; break-inside:avoid; border-radius:14px; overflow:hidden; box-shadow:0 4px 14px rgba(0,0,0,0.12); outline:1.5px dashed #9ca3af; outline-offset:6px; }
    .bingo-draw-section { page-break-before:always; break-before:page; }
    .bingo-card-title { display:flex; justify-content:center; gap:0; background:#1e293b; padding:8px 10px; }
    .bingo-letter { display:inline-flex; align-items:center; justify-content:center; width:46px; height:46px; font-size:28px; font-weight:900; color:white; border-radius:8px; margin:0 2px; }
    .bingo-sub { text-align:center; font-size:9px; color:#6b7280; padding:4px 0; background:#f8f7ff; border-bottom:1px solid #ddd6fe; letter-spacing:1px; font-weight:700; }
    .bingo-grid { display:grid; grid-template-columns:repeat(var(--bingo-dim,5),1fr); gap:0; }
    .bingo-cell { border-right:1px solid #e0d9ff; border-bottom:1px solid #e0d9ff; padding:10px 4px; min-height:54px; text-align:center; font-size:9.5px; font-weight:700; display:flex; align-items:center; justify-content:center; background:white; }
    .bingo-cell:nth-child(odd) { background:#faf8ff; }
    .bingo-cell:nth-child(5n) { border-right:none; }
    .bingo-cell.free { background:#fbbf24; font-weight:900; color:#78350f; font-size:14px; border-color:#f59e0b; }
    /* calling circles (injected) */
    .bingo-calling { padding:10px 12px; background:#f8f7ff; border-top:2px dashed var(--ac,#4338ca); }
    .bingo-calling-label { font-size:8px; font-weight:900; color:var(--ac,#4338ca); letter-spacing:1.5px; text-transform:uppercase; margin-bottom:6px; }
    .bingo-calling-circles { display:flex; flex-wrap:wrap; gap:5px; }
    .bingo-circle { display:inline-block; width:22px; height:22px; border-radius:50%; border:1.5px solid var(--ac,#4338ca); background:white; }

    /* ── QUIZ ─────────────────────────────────────────────── */
    .quiz-progress { display:flex; gap:4px; margin-bottom:14px; flex-wrap:wrap; }
    .quiz-dot { width:18px; height:8px; border-radius:4px; background:#e5e7eb; }
    .quiz-q { border:2px solid #e5e7eb; border-radius:12px; padding:12px 14px 12px 54px; margin-bottom:14px; page-break-inside:avoid; break-inside:avoid; background:white; box-shadow:0 2px 8px rgba(0,0,0,0.07); position:relative; }
    .quiz-num { position:absolute; left:12px; top:12px; width:30px; height:30px; background:var(--ac,#4338ca); color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; }
    .quiz-q p, .quiz-q b { color:#1f2937; font-weight:700; margin:0 0 8px; }
    .quiz-opts { display:flex; flex-direction:column; gap:5px; margin-top:8px; }
    .quiz-opt { display:flex; align-items:center; gap:8px; padding:5px 10px; border-radius:8px; background:#f9fafb; border:1.5px solid #e5e7eb; font-size:11px; }
    .quiz-opt-letter { width:22px; height:22px; border-radius:50%; background:var(--ac-light,#eef2ff); color:var(--ac,#4338ca); font-weight:900; font-size:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0; border:1.5px solid var(--ac,#4338ca); }
    .quiz-answer { display:none; }

    /* ── MEMORY ───────────────────────────────────────────── */
    .cut-hint { font-size:10px; color:#6b7280; font-style:italic; margin:0 0 10px; display:flex; align-items:center; gap:5px; padding:6px 10px; background:#fef3c7; border-radius:6px; border:1.5px dashed #f59e0b; }
    /* quebra de página por CARTA (não pela grade inteira): 20 pares fluem por várias páginas */
    .memory-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:5px; padding:6px; background:#f9fafb; border-radius:12px; border:2px dashed #d1d5db; }
    .memory-pair { border:1.5px dashed #9ca3af; padding:14px 8px; min-height:88px; display:flex; align-items:center; justify-content:center; text-align:center; font-size:10px; page-break-inside:avoid; break-inside:avoid; background:white; border-radius:8px; position:relative; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
    .memory-pair::after { content:'✂'; position:absolute; top:-10px; right:6px; font-size:12px; color:#6b7280; background:#f9fafb; padding:0 3px; border-radius:4px; }
    .memory-pair.concept { background:var(--ac,#4338ca); color:white; font-weight:900; border-color:var(--ac,#4338ca); font-size:11px; border-style:solid; }
    .memory-pair.concept::after { background:var(--ac,#4338ca); color:rgba(255,255,255,0.7); }

    /* ── CROSSWORD ────────────────────────────────────────── */
    /* Cell size is driven by inline style (computed from grid width in React).
       .cw-grid-table centres the grid and provides page-break protection. */
    .cw-grid-table { border-collapse:collapse; margin:14px auto; page-break-inside:avoid; break-inside:avoid; }
    .cw-grid-black { background:transparent; }
    .cw-grid-white { border:2px solid #374151; border-radius:2px; position:relative; vertical-align:top; background:white; }
    .cw-grid-num { position:absolute; top:1px; left:2px; font-size:7px; font-weight:900; color:var(--ac,#4338ca); line-height:1; }
    /* Clue container — 2-column layout that works WITHOUT Tailwind */
    .cw-clues-cols { display:grid; grid-template-columns:1fr 1fr; gap:10px 22px; margin-top:14px; padding:12px 14px; background:var(--ac-light,#eef2ff); border:2px solid var(--ac,#4338ca); border-radius:10px; page-break-inside:avoid; break-inside:avoid; }
    .cw-clue-dir { font-size:8.5px; font-weight:900; color:var(--ac,#4338ca); letter-spacing:1.5px; text-transform:uppercase; margin:0 0 6px; display:block; border-bottom:1.5px solid var(--ac,#4338ca); padding-bottom:4px; }
    .cw-clue-item { font-size:10.5px; margin-bottom:4px; line-height:1.35; color:#1f2937; }
    .cw-item { margin-bottom:16px; page-break-inside:avoid; break-inside:avoid; }
    .cw-clue { font-weight:700; margin-bottom:5px; color:#1f2937; display:flex; align-items:center; gap:7px; }
    .cw-num-badge { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; background:var(--ac,#4338ca); color:white; border-radius:50%; font-size:10px; font-weight:900; flex-shrink:0; }
    .cw-boxes { display:flex; gap:3px; }
    .cw-box { border:2px solid #374151; width:27px; height:27px; border-radius:4px; }
    .cw-answer { display:none; }
    .clue-list { list-style:none; padding-left:0; columns:2; column-gap:20px; counter-reset:list-item; }
    .clue-list li { margin-bottom:5px; break-inside:avoid; page-break-inside:avoid; padding-left:24px; position:relative; counter-increment:list-item; }
    .clue-list li::before { content:counter(list-item)'.'; position:absolute; left:0; font-weight:800; color:var(--ac,#4338ca); }

    /* ── STORY ────────────────────────────────────────────── */
    .markdown-body h2 { color:white; font-size:14px; margin-top:18px; padding:5px 12px; background:var(--ac,#4338ca); border-radius:6px; display:inline-block; }
    .markdown-body h3 { color:#1f2937; font-size:13px; font-weight:800; border-bottom:1.5px solid #e5e7eb; padding-bottom:3px; }
    .markdown-body ul, .markdown-body ol { padding-left:22px; }
    .markdown-body li { margin-bottom:4px; }
    .markdown-body blockquote { border-left:4px solid var(--ac,#4338ca); padding:6px 12px; margin:8px 0; background:var(--ac-light,#eef2ff); color:#1f2937; border-radius:0 8px 8px 0; }
    .markdown-body table { border-collapse:collapse; width:100%; margin:8px 0; }
    .markdown-body th, .markdown-body td { border:1px solid #d1d5db; padding:5px 8px; text-align:left; font-size:11px; }
    .markdown-body th { background:var(--ac,#4338ca); color:white; font-weight:800; }
    /* Images: centred block, never wider than column, never overlapping text */
    .markdown-body img { display:block; max-width:55%; max-height:200px; object-fit:cover; border-radius:10px; margin:10px auto 14px; box-shadow:0 2px 10px rgba(0,0,0,0.12); }

    /* ── SECTION DIVIDER ──────────────────────────────────── */
    .section-divider { display:flex; align-items:center; gap:10px; margin:18px 0 14px; opacity:0.7; }
    .section-divider-line { flex:1; height:2px; background:repeating-linear-gradient(90deg, var(--ac,#4338ca) 0, var(--ac,#4338ca) 3px, transparent 3px, transparent 6px); }
    .section-divider-icon { width:18px; height:18px; flex-shrink:0; image-rendering:pixelated; }
    .section-divider-icon svg { width:100%; height:100%; display:block; }

    /* ── BOA SORTE LINE ───────────────────────────────────── */
    .boa-sorte { display:flex; align-items:center; justify-content:center; gap:8px; margin:20px 0 10px; font-size:11px; font-style:italic; color:var(--ac,#4338ca); font-weight:700; letter-spacing:0.5px; }
    .boa-sorte-px { width:14px; height:14px; image-rendering:pixelated; }
    .boa-sorte-px svg { width:100%; height:100%; display:block; }

    /* ── SCORE TRACKER (injected) ─────────────────────────── */
    .score-tracker { margin:8px 0 12px; padding:16px 18px; border:3px solid var(--ac,#4338ca); border-radius:14px; background:var(--ac-light,#eef2ff); page-break-inside:avoid; break-inside:avoid; position:relative; }
    .score-tracker::before, .score-tracker::after { content:''; position:absolute; width:18px; height:18px; border:2.5px solid var(--ac,#4338ca); background:#fbbf24; }
    .score-tracker::before { top:-10px; left:14px; border-radius:50%; }
    .score-tracker::after { bottom:-10px; right:14px; border-radius:50%; }
    .score-header { display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:10px; }
    .score-px-star { width:26px; height:26px; flex-shrink:0; image-rendering:pixelated; }
    .score-px-star svg { width:100%; height:100%; display:block; }
    .score-title { font-size:12px; font-weight:900; color:var(--ac,#4338ca); letter-spacing:2.5px; text-transform:uppercase; }
    .score-stars { font-size:22px; letter-spacing:4px; text-align:center; margin-bottom:12px; }
    .score-row { display:flex; align-items:center; justify-content:center; gap:24px; flex-wrap:wrap; }
    .score-label { font-size:8.5px; font-weight:900; color:var(--ac,#4338ca); letter-spacing:1.5px; text-transform:uppercase; }
    .score-field { border-bottom:2.5px solid var(--ac,#4338ca); min-width:90px; text-align:center; font-size:14px; font-weight:900; color:#1f2937; padding:2px 8px; }

    /* ── ANSWER KEY ───────────────────────────────────────── */
    .answer-key-page { display:none; page-break-before:always; padding-top:12px; }
    @media print { .answer-key-page { display:block; } .quiz-answer, .cw-answer { display:none !important; } }
    .answer-key-header { display:flex; align-items:center; gap:14px; margin-bottom:16px; padding:14px 16px; background:#fef2f2; border-radius:12px; border:2.5px dashed #dc2626; }
    .answer-key-trophy { width:60px; height:60px; flex-shrink:0; image-rendering:pixelated; }
    .answer-key-trophy svg { width:100%; height:100%; display:block; }
    .answer-key-title { font-size:18px; color:#dc2626; font-weight:900; letter-spacing:3px; text-transform:uppercase; padding:0; background:none; border-radius:0; display:block; margin:0; line-height:1; }
    .answer-key-subtitle { font-size:9px; color:#7f1d1d; font-weight:700; letter-spacing:1.5px; margin-top:4px; }
    .answer-key-item { font-size:11px; margin-bottom:6px; padding:7px 12px; background:white; border-radius:8px; border-left:4px solid #dc2626; box-shadow:0 1px 3px rgba(0,0,0,0.05); }

    /* ── UTIL ─────────────────────────────────────────────── */
    .hide-on-screen { display:block; }
    button { display:none; }
  </style></head><body>
    ${headerHtml}
    ${node.innerHTML}
    <script>
    (function(){
      var label = "${opts.activityLabel}";
      // Cores alinhadas às cores de tela do modeMeta (EstudioScreen)
      var themes = {
        'Metafora Narrativa':    { ac:'#c026d3', light:'#fdf4ff', emoji:'📖' },
        'Quiz Avaliativo':       { ac:'#d97706', light:'#fffbeb', emoji:'⚡' },
        'Caca-Palavras':         { ac:'#059669', light:'#ecfdf5', emoji:'🔍' },
        'Palavras Cruzadas':     { ac:'#2563eb', light:'#eff6ff', emoji:'✏️' },
        'Bingo Educativo':       { ac:'#db2777', light:'#fdf2f8', emoji:'🎱' },
        'Jogo da Memoria':       { ac:'#0d9488', light:'#f0fdfa', emoji:'🃏' },
        'Sequencia Didatica':    { ac:'#7c3aed', light:'#f5f3ff', emoji:'📋' },
        'Flashcards':            { ac:'#ea580c', light:'#fff7ed', emoji:'🗂️' }
      };
      // labels chegam acentuados; keys do objeto são sem acento — normaliza para casar
      var norm = function(s){ return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); };
      var t = themes[norm(label)] || { ac:'#4338ca', light:'#eef2ff', emoji:'🎮' };
      document.documentElement.style.setProperty('--ac', t.ac);
      document.documentElement.style.setProperty('--ac-light', t.light);
      document.documentElement.style.setProperty('--bingo-dim', '${opts.bingoDim || 5}');

      // emoji on activity tag
      var tag = document.querySelector('.activity-tag');
      if (tag) tag.innerHTML = t.emoji + '&nbsp;&nbsp;' + tag.textContent.trim();

      // ── PIXEL ART per activity ───────────────────────────
      var SR = ' shape-rendering="crispEdges"';
      var pixelArts = {
        'Caca-Palavras': '<svg viewBox="0 0 16 16"' + SR + '>'
          + '<rect x="9" y="9" width="2" height="2" fill="#78350f"/><rect x="10" y="10" width="2" height="2" fill="#92400e"/><rect x="11" y="11" width="2" height="2" fill="#92400e"/><rect x="12" y="12" width="2" height="2" fill="#78350f"/>'
          + '<rect x="3" y="1" width="5" height="1" fill="#1e3a8a"/><rect x="2" y="2" width="1" height="1" fill="#1e3a8a"/><rect x="8" y="2" width="1" height="1" fill="#1e3a8a"/><rect x="1" y="3" width="1" height="5" fill="#1e3a8a"/><rect x="9" y="3" width="1" height="5" fill="#1e3a8a"/><rect x="2" y="8" width="1" height="1" fill="#1e3a8a"/><rect x="8" y="8" width="1" height="1" fill="#1e3a8a"/><rect x="3" y="9" width="5" height="1" fill="#1e3a8a"/>'
          + '<rect x="3" y="2" width="5" height="1" fill="#bfdbfe"/><rect x="2" y="3" width="7" height="5" fill="#bfdbfe"/><rect x="3" y="8" width="5" height="1" fill="#bfdbfe"/>'
          + '<rect x="3" y="3" width="2" height="1" fill="#ffffff"/><rect x="3" y="4" width="1" height="1" fill="#ffffff"/>'
          + '</svg>',
        'Quiz Avaliativo': '<svg viewBox="0 0 16 16"' + SR + '>'
          + '<rect x="8" y="1" width="3" height="1" fill="#9a3412"/><rect x="7" y="2" width="1" height="1" fill="#9a3412"/><rect x="11" y="2" width="1" height="1" fill="#9a3412"/>'
          + '<rect x="6" y="3" width="1" height="1" fill="#9a3412"/><rect x="11" y="3" width="1" height="1" fill="#9a3412"/>'
          + '<rect x="5" y="4" width="1" height="1" fill="#9a3412"/><rect x="11" y="4" width="1" height="1" fill="#9a3412"/>'
          + '<rect x="4" y="5" width="1" height="1" fill="#9a3412"/><rect x="11" y="5" width="1" height="1" fill="#9a3412"/>'
          + '<rect x="3" y="6" width="1" height="1" fill="#9a3412"/><rect x="12" y="6" width="1" height="1" fill="#9a3412"/>'
          + '<rect x="3" y="7" width="10" height="1" fill="#9a3412"/>'
          + '<rect x="8" y="8" width="1" height="1" fill="#9a3412"/><rect x="7" y="9" width="1" height="1" fill="#9a3412"/><rect x="6" y="10" width="1" height="1" fill="#9a3412"/><rect x="5" y="11" width="1" height="1" fill="#9a3412"/><rect x="4" y="12" width="1" height="1" fill="#9a3412"/><rect x="3" y="13" width="2" height="1" fill="#9a3412"/><rect x="3" y="14" width="1" height="1" fill="#9a3412"/>'
          + '<rect x="8" y="2" width="3" height="1" fill="#facc15"/><rect x="7" y="3" width="4" height="1" fill="#facc15"/><rect x="6" y="4" width="5" height="1" fill="#facc15"/><rect x="5" y="5" width="6" height="1" fill="#facc15"/><rect x="4" y="6" width="8" height="1" fill="#facc15"/>'
          + '<rect x="4" y="8" width="4" height="1" fill="#facc15"/><rect x="3" y="9" width="4" height="1" fill="#facc15"/><rect x="3" y="10" width="3" height="1" fill="#facc15"/><rect x="3" y="11" width="2" height="1" fill="#facc15"/><rect x="3" y="12" width="1" height="1" fill="#facc15"/>'
          + '</svg>',
        'Bingo Educativo': '<svg viewBox="0 0 16 16"' + SR + '>'
          + '<rect x="4" y="1" width="6" height="1" fill="#581c87"/><rect x="3" y="2" width="1" height="1" fill="#581c87"/><rect x="10" y="2" width="1" height="1" fill="#581c87"/>'
          + '<rect x="2" y="3" width="1" height="1" fill="#581c87"/><rect x="11" y="3" width="1" height="1" fill="#581c87"/>'
          + '<rect x="1" y="4" width="1" height="5" fill="#581c87"/><rect x="12" y="4" width="1" height="5" fill="#581c87"/>'
          + '<rect x="2" y="9" width="1" height="1" fill="#581c87"/><rect x="11" y="9" width="1" height="1" fill="#581c87"/>'
          + '<rect x="3" y="10" width="1" height="1" fill="#581c87"/><rect x="10" y="10" width="1" height="1" fill="#581c87"/>'
          + '<rect x="4" y="11" width="6" height="1" fill="#581c87"/>'
          + '<rect x="4" y="2" width="6" height="1" fill="#c084fc"/><rect x="3" y="3" width="8" height="1" fill="#c084fc"/>'
          + '<rect x="2" y="4" width="10" height="5" fill="#c084fc"/><rect x="3" y="9" width="8" height="1" fill="#c084fc"/><rect x="4" y="10" width="6" height="1" fill="#c084fc"/>'
          + '<rect x="4" y="3" width="2" height="1" fill="#f3e8ff"/><rect x="3" y="4" width="1" height="2" fill="#f3e8ff"/>'
          + '<rect x="5" y="4" width="3" height="1" fill="#ffffff"/><rect x="5" y="5" width="1" height="1" fill="#ffffff"/><rect x="7" y="5" width="1" height="1" fill="#ffffff"/><rect x="5" y="6" width="3" height="1" fill="#ffffff"/><rect x="5" y="7" width="1" height="1" fill="#ffffff"/><rect x="7" y="7" width="1" height="1" fill="#ffffff"/><rect x="5" y="8" width="3" height="1" fill="#ffffff"/>'
          + '</svg>',
        'Jogo da Memoria': '<svg viewBox="0 0 16 16"' + SR + '>'
          + '<rect x="6" y="2" width="7" height="1" fill="#831843"/><rect x="6" y="3" width="1" height="9" fill="#831843"/><rect x="12" y="3" width="1" height="9" fill="#831843"/><rect x="6" y="12" width="7" height="1" fill="#831843"/>'
          + '<rect x="7" y="3" width="5" height="9" fill="#fbcfe8"/>'
          + '<rect x="8" y="4" width="3" height="1" fill="#ec4899"/><rect x="8" y="6" width="3" height="1" fill="#ec4899"/><rect x="8" y="8" width="3" height="1" fill="#ec4899"/><rect x="8" y="10" width="3" height="1" fill="#ec4899"/>'
          + '<rect x="3" y="5" width="7" height="1" fill="#831843"/><rect x="3" y="6" width="1" height="8" fill="#831843"/><rect x="9" y="6" width="1" height="8" fill="#831843"/><rect x="3" y="14" width="7" height="1" fill="#831843"/>'
          + '<rect x="4" y="6" width="5" height="8" fill="#ffffff"/>'
          + '<rect x="5" y="8" width="3" height="1" fill="#ec4899"/><rect x="7" y="9" width="1" height="1" fill="#ec4899"/><rect x="6" y="10" width="1" height="1" fill="#ec4899"/><rect x="6" y="12" width="1" height="1" fill="#ec4899"/>'
          + '</svg>',
        'Palavras Cruzadas': '<svg viewBox="0 0 16 16"' + SR + '>'
          + '<rect x="1" y="1" width="10" height="1" fill="#134e4a"/><rect x="1" y="2" width="1" height="9" fill="#134e4a"/><rect x="10" y="2" width="1" height="9" fill="#134e4a"/><rect x="1" y="10" width="10" height="1" fill="#134e4a"/>'
          + '<rect x="1" y="4" width="10" height="1" fill="#134e4a"/><rect x="1" y="7" width="10" height="1" fill="#134e4a"/>'
          + '<rect x="4" y="1" width="1" height="10" fill="#134e4a"/><rect x="7" y="1" width="1" height="10" fill="#134e4a"/>'
          + '<rect x="2" y="2" width="2" height="2" fill="#ccfbf1"/>'
          + '<rect x="5" y="2" width="2" height="2" fill="#1f2937"/>'
          + '<rect x="8" y="2" width="2" height="2" fill="#ccfbf1"/>'
          + '<rect x="2" y="5" width="2" height="2" fill="#ccfbf1"/>'
          + '<rect x="5" y="5" width="2" height="2" fill="#ccfbf1"/>'
          + '<rect x="8" y="5" width="2" height="2" fill="#1f2937"/>'
          + '<rect x="2" y="8" width="2" height="2" fill="#1f2937"/>'
          + '<rect x="5" y="8" width="2" height="2" fill="#ccfbf1"/>'
          + '<rect x="8" y="8" width="2" height="2" fill="#ccfbf1"/>'
          + '<rect x="11" y="10" width="2" height="1" fill="#f59e0b"/><rect x="12" y="11" width="2" height="1" fill="#f59e0b"/><rect x="13" y="12" width="2" height="1" fill="#f59e0b"/><rect x="14" y="13" width="1" height="2" fill="#451a03"/>'
          + '</svg>',
        'Metafora Narrativa': '<svg viewBox="0 0 16 16"' + SR + '>'
          + '<rect x="2" y="2" width="12" height="1" fill="#86198f"/><rect x="2" y="3" width="1" height="10" fill="#86198f"/><rect x="13" y="3" width="1" height="10" fill="#86198f"/><rect x="2" y="13" width="12" height="1" fill="#86198f"/>'
          + '<rect x="3" y="3" width="10" height="10" fill="#fef3c7"/>'
          + '<rect x="7" y="3" width="2" height="10" fill="#86198f"/>'
          + '<rect x="4" y="5" width="3" height="1" fill="#92400e"/><rect x="4" y="7" width="3" height="1" fill="#92400e"/><rect x="4" y="9" width="3" height="1" fill="#92400e"/><rect x="4" y="11" width="2" height="1" fill="#92400e"/>'
          + '<rect x="9" y="5" width="3" height="1" fill="#92400e"/><rect x="9" y="7" width="3" height="1" fill="#92400e"/><rect x="9" y="9" width="3" height="1" fill="#92400e"/><rect x="9" y="11" width="2" height="1" fill="#92400e"/>'
          + '<rect x="10" y="3" width="1" height="1" fill="#fbbf24"/><rect x="9" y="4" width="3" height="1" fill="#fbbf24"/><rect x="10" y="5" width="1" height="1" fill="#fbbf24"/>'
          + '</svg>'
      };
      var pxArt = pixelArts[norm(label)] || '<div style="font-size:34px;text-align:center;line-height:52px">🎮</div>';

      // ── Instructions box: pixel art + title ─────────────
      var instr = document.querySelector('.instructions');
      if (instr) {
        var body = instr.innerHTML;
        instr.innerHTML = '<div class="instructions-icon">' + pxArt + '</div><div class="instructions-body"><div class="instructions-title">Como Jogar</div>' + body + '</div>';
      }

      // ── WORD SEARCH: word chips ─────────────────────────
      var clueList = document.querySelector('.clue-list');
      if (clueList && document.querySelector('.ws-grid')) {
        var items = Array.from(clueList.querySelectorAll('li'));
        var chips = document.createElement('div');
        chips.className = 'word-chips';
        items.forEach(function(li) {
          var chip = document.createElement('div');
          chip.className = 'word-chip';
          chip.innerHTML = '<span class="word-chip-box"></span><span>' + li.textContent.replace(/^\\d+\\.\\s*/, '').trim() + '</span>';
          chips.appendChild(chip);
        });
        clueList.replaceWith(chips);
      }

      // ── BINGO: colored B-I-N-G-O tiles + calling circles (em TODAS as cartelas) ─
      var bingoCols = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6'];
      document.querySelectorAll('.bingo-card-title').forEach(function(bingoTitle){
        bingoTitle.innerHTML = 'BINGO'.split('').map(function(l,i){
          return '<span class="bingo-letter" style="background:' + bingoCols[i] + '">' + l + '</span>';
        }).join('');
      });
      document.querySelectorAll('.bingo-cell.free').forEach(function(bingoFree){
        var freeText = bingoFree.textContent.replace('★ ', '').trim();
        bingoFree.innerHTML = '&#11088;<br>' + (freeText || 'FREE') + '<br>&#11088;';
      });
      document.querySelectorAll('.bingo-card').forEach(function(card) {
        var cellCount = card.querySelectorAll('.bingo-cell:not(.free)').length;
        var calling = document.createElement('div');
        calling.className = 'bingo-calling';
        calling.innerHTML = '<div class="bingo-calling-label">Termos sorteados. Marque abaixo:</div><div class="bingo-calling-circles">'
          + Array(cellCount).fill('<span class="bingo-circle"></span>').join('') + '</div>';
        card.appendChild(calling);
      });

      // ── QUIZ: progress dots + numbered badges + option pills ─
      var quizQs = document.querySelectorAll('.quiz-q');
      if (quizQs.length) {
        var prog = document.createElement('div');
        prog.className = 'quiz-progress';
        for (var d=0; d<quizQs.length; d++) { var dot=document.createElement('div'); dot.className='quiz-dot'; prog.appendChild(dot); }
        quizQs[0].before(prog);
        quizQs.forEach(function(q, i) {
          var badge = document.createElement('div');
          badge.className = 'quiz-num';
          badge.textContent = i + 1;
          q.insertBefore(badge, q.firstChild);
          // restyle opts
          q.querySelectorAll('.quiz-opt').forEach(function(opt) {
            var b = opt.querySelector('b');
            if (b) {
              var letter = document.createElement('span');
              letter.className = 'quiz-opt-letter';
              letter.textContent = b.textContent.replace(/[^A-D]/g,'');
              b.replaceWith(letter);
            }
          });
        });
      }

      // ── MEMORY / FLASHCARDS: cut hint próprio de cada jogo ─
      var memGrid = document.querySelector('.memory-grid');
      if (memGrid) {
        var hint = document.createElement('p');
        hint.className = 'cut-hint';
        hint.innerHTML = memGrid.classList.contains('flashcard-grid')
          ? '✂&nbsp; Recorte os cartões pelas linhas tracejadas &mdash; <strong>frente</strong> e <strong>verso</strong> são cartas separadas: use a frente para perguntar e o verso para conferir a resposta.'
          : '✂&nbsp; Recorte as fichas e embaralhe &mdash; <strong>conceitos</strong> com fundo colorido, <strong>definições</strong> com fundo branco.';
        memGrid.before(hint);
      }

      // ── CROSSWORD: restyle clue items ────────────────────
      var cwClueCols = document.querySelector('.cw-clues-cols');
      if (!cwClueCols) {
        // Legacy list style: add num badges
        document.querySelectorAll('.cw-clue').forEach(function(cl) {
          var m = cl.textContent.match(/^(\\d+)[\\.\\)]/);
          if (m) {
            var badge = document.createElement('span');
            badge.className = 'cw-num-badge';
            badge.textContent = m[1];
            cl.innerHTML = cl.innerHTML.replace(/^\\d+[\\.\\)]\\s*/, '');
            cl.insertBefore(badge, cl.firstChild);
          }
        });
      }

      // ── PIXEL ART decorations ────────────────────────────
      var pxStar = '<svg viewBox="0 0 16 16"' + SR + '>'
        + '<rect x="7" y="1" width="2" height="2" fill="#fbbf24"/>'
        + '<rect x="6" y="3" width="4" height="1" fill="#fbbf24"/>'
        + '<rect x="1" y="5" width="14" height="2" fill="#fbbf24"/>'
        + '<rect x="2" y="7" width="12" height="2" fill="#fbbf24"/>'
        + '<rect x="3" y="9" width="3" height="2" fill="#fbbf24"/>'
        + '<rect x="10" y="9" width="3" height="2" fill="#fbbf24"/>'
        + '<rect x="2" y="11" width="3" height="2" fill="#fbbf24"/>'
        + '<rect x="11" y="11" width="3" height="2" fill="#fbbf24"/>'
        + '<rect x="1" y="13" width="3" height="2" fill="#fbbf24"/>'
        + '<rect x="12" y="13" width="3" height="2" fill="#fbbf24"/>'
        + '<rect x="6" y="5" width="4" height="1" fill="#fef3c7"/>'
        + '<rect x="7" y="6" width="2" height="1" fill="#fef3c7"/>'
        + '</svg>';

      var pxDiamond = '<svg viewBox="0 0 16 16"' + SR + ' style="color:var(--ac,#4338ca)">'
        + '<rect x="7" y="2" width="2" height="1" fill="currentColor"/>'
        + '<rect x="6" y="3" width="4" height="1" fill="currentColor"/>'
        + '<rect x="5" y="4" width="6" height="1" fill="currentColor"/>'
        + '<rect x="4" y="5" width="8" height="1" fill="currentColor"/>'
        + '<rect x="3" y="6" width="10" height="2" fill="currentColor"/>'
        + '<rect x="4" y="8" width="8" height="1" fill="currentColor"/>'
        + '<rect x="5" y="9" width="6" height="1" fill="currentColor"/>'
        + '<rect x="6" y="10" width="4" height="1" fill="currentColor"/>'
        + '<rect x="7" y="11" width="2" height="2" fill="currentColor"/>'
        + '</svg>';

      var pxSparkle = '<svg viewBox="0 0 16 16"' + SR + ' style="color:var(--ac,#4338ca)">'
        + '<rect x="7" y="0" width="2" height="4" fill="currentColor"/>'
        + '<rect x="6" y="3" width="4" height="2" fill="currentColor"/>'
        + '<rect x="0" y="7" width="4" height="2" fill="currentColor"/>'
        + '<rect x="3" y="6" width="2" height="4" fill="currentColor"/>'
        + '<rect x="11" y="6" width="2" height="4" fill="currentColor"/>'
        + '<rect x="12" y="7" width="4" height="2" fill="currentColor"/>'
        + '<rect x="7" y="11" width="2" height="5" fill="currentColor"/>'
        + '<rect x="6" y="11" width="4" height="2" fill="currentColor"/>'
        + '</svg>';

      var pxTrophy = '<svg viewBox="0 0 16 16"' + SR + '>'
        + '<rect x="0" y="2" width="2" height="1" fill="#92400e"/><rect x="14" y="2" width="2" height="1" fill="#92400e"/>'
        + '<rect x="0" y="3" width="1" height="3" fill="#92400e"/><rect x="15" y="3" width="1" height="3" fill="#92400e"/>'
        + '<rect x="0" y="6" width="2" height="1" fill="#92400e"/><rect x="14" y="6" width="2" height="1" fill="#92400e"/>'
        + '<rect x="3" y="1" width="10" height="1" fill="#78350f"/>'
        + '<rect x="2" y="2" width="1" height="6" fill="#92400e"/><rect x="13" y="2" width="1" height="6" fill="#92400e"/>'
        + '<rect x="3" y="2" width="10" height="6" fill="#fbbf24"/>'
        + '<rect x="3" y="8" width="10" height="1" fill="#78350f"/>'
        + '<rect x="6" y="9" width="4" height="2" fill="#b45309"/>'
        + '<rect x="3" y="11" width="10" height="1" fill="#78350f"/>'
        + '<rect x="2" y="12" width="12" height="2" fill="#fbbf24"/>'
        + '<rect x="2" y="14" width="12" height="1" fill="#78350f"/>'
        + '<rect x="7" y="4" width="2" height="1" fill="#ffffff"/>'
        + '<rect x="6" y="5" width="4" height="1" fill="#ffffff"/>'
        + '<rect x="7" y="6" width="2" height="1" fill="#ffffff"/>'
        + '<rect x="3" y="3" width="1" height="2" fill="#fde68a"/>'
        + '</svg>';

      // ── SECTION DIVIDER between instructions and content ─
      if (instr && instr.nextElementSibling) {
        var divider = document.createElement('div');
        divider.className = 'section-divider';
        divider.innerHTML = '<span class="section-divider-line"></span><span class="section-divider-icon">' + pxDiamond + '</span><span class="section-divider-line"></span>';
        instr.after(divider);
      }

      // ── BOA SORTE line + SCORE TRACKER ───────────────────
      // For Metafora Narrativa the tracker is embedded in the Mapa da Metafora page (see below).
      var akPage = document.querySelector('.answer-key-page');
      var boaSorte = document.createElement('div');
      boaSorte.className = 'boa-sorte';
      boaSorte.innerHTML = '<span class="boa-sorte-px">' + pxSparkle + '</span><span>Boa sorte, jogador(a)!</span><span class="boa-sorte-px">' + pxSparkle + '</span>';

      var tracker = document.createElement('div');
      tracker.className = 'score-tracker';
      tracker.innerHTML = '<div class="score-header"><div class="score-px-star">' + pxStar + '</div><div class="score-title">Minha Pontuação</div><div class="score-px-star">' + pxStar + '</div></div>'
        + '<div class="score-stars">&#11088; &#11088; &#11088; &#11088; &#11088;</div>'
        + '<div class="score-row"><span class="score-label">Acertos</span><div class="score-field">___ / ___</div><span class="score-label">Nota</span><div class="score-field">___________</div></div>';

      // Only inject standalone tracker for non-storytelling activities.
      // For 'Metafora Narrativa' the tracker is bundled with the Mapa da Metafora page.
      // 'Sequencia Didatica' é documento do professor: sem placar nem "boa sorte".
      if (norm(label) !== 'Metafora Narrativa' && norm(label) !== 'Sequencia Didatica') {
        if (akPage) {
          akPage.before(boaSorte);
          akPage.before(tracker);
        } else {
          var footer = document.querySelector('.page-footer');
          document.body.insertBefore(boaSorte, footer);
          document.body.insertBefore(tracker, footer);
        }
      }

      // ── ANSWER KEY header with pixel-art trophy ──────────
      var akTitle = document.querySelector('.answer-key-title');
      if (akTitle) {
        var wrap = document.createElement('div');
        wrap.className = 'answer-key-header';
        wrap.innerHTML = '<div class="answer-key-trophy">' + pxTrophy + '</div>';
        var titleBox = document.createElement('div');
        titleBox.appendChild(akTitle.cloneNode(true));
        var subtitle = document.createElement('div');
        subtitle.className = 'answer-key-subtitle';
        subtitle.textContent = 'Confira suas respostas e some os pontos';
        titleBox.appendChild(subtitle);
        wrap.appendChild(titleBox);
        akTitle.replaceWith(wrap);
      }

      // ── STORY: Gabarito do Professor em página própria ───
      document.querySelectorAll('.markdown-body h2').forEach(function(h){
        if (/gabarito/i.test(h.textContent)) {
          var br = document.createElement('div');
          br.style.pageBreakBefore = 'always';
          br.style.breakBefore = 'page';
          h.parentNode.insertBefore(br, h);
        }
      });

      // ── STORY: last page = score tracker + Mapa da Metafora ─
      // Folha do aluno: decodificar a metáfora durante a leitura
      // (personagem → conceito real → pista da história que entrega a conexão)
      if (norm(label) === 'Metafora Narrativa') {
        var detEmojis = ['🧭','🔮','⭐','🗝️'];
        var detCards = detEmojis.map(function(em, i){
          return '<div style="border:2.5px solid var(--ac,#c026d3);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;">'
            + '<div style="background:var(--ac,#c026d3);padding:9px 14px;display:flex;align-items:center;gap:8px;">'
            + '<span style="font-size:18px;">' + em + '</span>'
            + '<span style="font-weight:900;font-size:12px;color:white;letter-spacing:0.3px;">Descoberta ' + (i + 1) + '</span>'
            + '</div>'
            + '<div style="padding:12px 14px;flex:1;display:flex;flex-direction:column;gap:9px;">'
            // Personagem
            + '<div><div style="font-size:7.5px;color:#6b7280;font-weight:800;letter-spacing:1.2px;margin-bottom:4px;">PERSONAGEM OU ELEMENTO DA HISTÓRIA</div>'
            + '<div style="border-bottom:1.5px solid #d1d5db;min-height:20px;"></div></div>'
            // Conceito real
            + '<div><div style="font-size:7.5px;color:var(--ac,#c026d3);font-weight:800;letter-spacing:1.2px;margin-bottom:4px;">REPRESENTA NA VIDA REAL</div>'
            + '<div style="border-bottom:1.5px solid var(--ac,#c026d3);min-height:20px;"></div></div>'
            // Pista
            + '<div style="flex:1;display:flex;flex-direction:column;">'
            + '<div style="font-size:7.5px;color:#6b7280;font-weight:800;letter-spacing:1.2px;margin-bottom:5px;">A PISTA: QUE MOMENTO DA HISTÓRIA ENTREGOU A CONEXÃO?</div>'
            + '<div style="flex:1;border:1.5px dashed #d1d5db;border-radius:7px;min-height:52px;background:#fafafa;"></div>'
            + '</div>'
            + '</div>'
            + '</div>';
        }).join('');

        var mapPage = document.createElement('div');
        mapPage.style.cssText = 'page-break-before:always;padding:14px;';
        mapPage.innerHTML =
          // ── Compact score tracker at the top ──
          '<div class="score-tracker" style="margin:0 0 16px;">'
          + '<div class="score-header"><div class="score-px-star">' + pxStar + '</div><div class="score-title">Minha Pontuação</div><div class="score-px-star">' + pxStar + '</div></div>'
          + '<div class="score-stars">&#11088; &#11088; &#11088; &#11088; &#11088;</div>'
          + '<div class="score-row"><span class="score-label">Acertos</span><div class="score-field">___ / ___</div><span class="score-label">Nota</span><div class="score-field">___________</div></div>'
          + '</div>'
          // ── Header da folha do aluno ──
          + '<div style="background:var(--ac,#c026d3);color:white;padding:8px 14px;border-radius:8px;font-weight:900;font-size:13px;margin-bottom:6px;letter-spacing:0.3px;">🗺️ Mapa da Metáfora: Missão do Detetive</div>'
          + '<div style="font-size:10px;color:#6b7280;margin-bottom:12px;line-height:1.5;">Durante a história, descubra quem é quem: anote o personagem, o conceito real que ele representa e o momento da história que entregou a conexão. Cada descoberta certa vale ponto!</div>'
          // ── 2×2 grid — cards fill the remaining page space ──
          + '<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px;min-height:420px;">'
          + detCards
          + '</div>';
        document.body.appendChild(mapPage);
      }

      // ── marca d'água: injetada após TODO o conteúdo dinâmico ──
      var _wm = document.createElement('div');
      _wm.textContent = 'Prof. Corujão';
      _wm.style.cssText = 'position:fixed;bottom:3mm;right:4mm;font-size:7px;color:#9ca3af;letter-spacing:0.5px;opacity:0.55;font-style:italic;pointer-events:none;z-index:9999;';
      document.body.appendChild(_wm);

      setTimeout(function(){ window.print(); }, 600);
    })();
    </script>
  </body></html>`);
  w.document.close();
};

type EscapeRoomData = {
  title: string;
  briefing: string;
  timeLimit?: string;
  rules?: string[];
  theme: EscapeTheme;
  enigmas: { narrative: string; challenge: string; answer: string; hint: string; imageUrl?: string }[];
};

const ESCAPE_THEMES: Record<EscapeTheme, {
  name: string;
  cover: string;
  enigmaBg: string;
  cardBg: string;
  primary: string;
  secondary: string;
  accent: string;
  textOnDark: string;
  textOnLight: string;
  border: string;
  font: string;
  ornament: string;
  pageDecor: string;
  badge: string;
}> = {
  medieval: {
    name: 'Pergaminho Medieval',
    cover: `linear-gradient(135deg, #2c1408 0%, #4a2208 50%, #1c0d04 100%)`,
    enigmaBg: `linear-gradient(135deg, #faf3e0 0%, #f5e8c8 100%)`,
    cardBg: '#fffbf0',
    primary: '#3a2510',
    secondary: '#5b3a1a',
    accent: '#c07c1a',
    textOnDark: '#fef3c7',
    textOnLight: '#3a2510',
    border: '#5b3a1a',
    font: `'Cinzel', 'Georgia', serif`,
    ornament: '⚜',
    pageDecor: `repeating-linear-gradient(45deg, transparent, transparent 30px, rgba(91,58,26,0.05) 30px, rgba(91,58,26,0.05) 31px)`,
    badge: '⚔️',
  },
  lab: {
    name: 'Laboratório Científico',
    cover: `linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0c4a6e 100%)`,
    enigmaBg: `#f8fafc`,
    cardBg: '#ffffff',
    primary: '#0c1e3a',
    secondary: '#075985',
    accent: '#047857',
    textOnDark: '#e0f2fe',
    textOnLight: '#0c1e3a',
    border: '#0369a1',
    font: `'JetBrains Mono', 'Courier New', monospace`,
    ornament: '⚛',
    pageDecor: `linear-gradient(0deg, transparent 24px, rgba(3,105,161,0.08) 25px), linear-gradient(90deg, transparent 24px, rgba(3,105,161,0.08) 25px)`,
    badge: '⚗️',
  },
  detective: {
    name: 'Dossiê Confidencial',
    cover: `linear-gradient(135deg, #18181b 0%, #3f3f46 50%, #18181b 100%)`,
    enigmaBg: `#f5f5f4`,
    cardBg: '#fafaf9',
    primary: '#0a0a0a',
    secondary: '#27272a',
    accent: '#b91c1c',
    textOnDark: '#fafafa',
    textOnLight: '#18181b',
    border: '#27272a',
    font: `'Courier Prime', 'Courier New', monospace`,
    ornament: '🔍',
    pageDecor: `repeating-linear-gradient(0deg, transparent, transparent 28px, rgba(0,0,0,0.05) 28px, rgba(0,0,0,0.05) 29px)`,
    badge: '🕵️',
  },
  space: {
    name: 'Missão Galáctica',
    cover: `radial-gradient(ellipse at top, #4c1d95 0%, #1e1b4b 50%, #020617 100%)`,
    enigmaBg: `linear-gradient(160deg, #f5f3ff 0%, #ede9fe 100%)`,
    cardBg: '#ffffff',
    primary: '#1e1b4b',
    secondary: '#7c3aed',
    accent: '#d97706',
    textOnDark: '#fef3c7',
    textOnLight: '#1e1b4b',
    border: '#7c3aed',
    font: `'Orbitron', 'Trebuchet MS', sans-serif`,
    ornament: '★',
    pageDecor: `radial-gradient(circle at 20% 30%, rgba(124,58,237,0.18) 0%, transparent 2px), radial-gradient(circle at 70% 60%, rgba(124,58,237,0.13) 0%, transparent 1.5px), radial-gradient(circle at 40% 80%, rgba(217,119,6,0.15) 0%, transparent 2px), radial-gradient(circle at 85% 15%, rgba(124,58,237,0.1) 0%, transparent 2px)`,
    badge: '🚀',
  },
};

const printEscapeRoom = (data: EscapeRoomData, opts: { className?: string; teacherName?: string; schoolName?: string; subject?: string; level?: string }) => {
  const theme = ESCAPE_THEMES[data.theme];
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast.error('O navegador bloqueou a janela de impressão. Permita pop-ups e tente de novo.'); return; }
  const todayStr = new Date().toLocaleDateString('pt-BR');
  const enigmaPages = data.enigmas.map((en, i) => `
    <section class="page enigma-page">
      <div class="page-decor"></div>
      <header class="enigma-header">
        <span class="enigma-num">ENIGMA ${String(i + 1).padStart(2, '0')}</span>
        <span class="enigma-total">de ${data.enigmas.length}</span>
      </header>
      ${en.imageUrl ? `<div class="enigma-art"><img src="${escapeHtml(en.imageUrl)}" alt="" crossorigin="anonymous" /></div>` : ''}
      <div class="narrative-block">
        <div class="narrative-icon">${theme.ornament}</div>
        <p class="narrative">${escapeHtml(en.narrative)}</p>
      </div>
      <div class="challenge-block">
        <div class="challenge-label">DESAFIO</div>
        <p class="challenge">${escapeHtml(en.challenge)}</p>
      </div>
      <div class="answer-block">
        <div class="answer-label">🔑 SUA RESPOSTA</div>
        <div class="answer-line"></div>
      </div>
      <div class="hint-block">
        <div class="hint-label">💡 DICA: USE APENAS SE PRECISAR</div>
        <p class="hint-text">${escapeHtml(en.hint)}</p>
      </div>
      <footer class="page-footer">
        <span>${escapeHtml(data.title)}</span><span>${i + 1} / ${data.enigmas.length}</span>
      </footer>
    </section>
  `).join('');

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=JetBrains+Mono:wght@400;700&family=Courier+Prime:wght@400;700&family=Orbitron:wght@500;700;900&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; margin: 0; padding: 0; }
    body { font-family: ${theme.font}; color: ${theme.textOnLight}; background: white; }
    .page { width: 210mm; height: 297mm; padding: 22mm 20mm; position: relative; overflow: hidden; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .page-decor { position: absolute; inset: 0; background-image: ${theme.pageDecor}; pointer-events: none; opacity: 0.8; }

    /* ──────── COVER ──────── */
    .cover { background: ${theme.cover}; color: ${theme.textOnDark}; display: flex; flex-direction: column; justify-content: space-between; }
    .cover-top { position: relative; z-index: 1; text-align: center; }
    .cover-badge { font-size: 76px; line-height: 1; margin-bottom: 12mm; filter: drop-shadow(0 4px 18px rgba(0,0,0,0.4)); }
    .cover-subtitle { font-size: 14px; letter-spacing: 8px; opacity: 0.9; margin-bottom: 8mm; text-transform: uppercase; font-weight: 700; }
    .cover-title { font-size: 42px; font-weight: 900; line-height: 1.1; letter-spacing: -1px; text-shadow: 0 4px 16px rgba(0,0,0,0.5); padding: 0 8mm; }
    .cover-ornament { font-size: 32px; margin: 8mm 0; opacity: 0.85; }
    .cover-info { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; max-width: 130mm; margin: 0 auto; }
    .info-box { background: rgba(255,255,255,0.14); border: 1.5px solid rgba(255,255,255,0.3); backdrop-filter: blur(8px); border-radius: 12px; padding: 10px 14px; }
    .info-label { font-size: 9px; letter-spacing: 2.5px; opacity: 0.85; text-transform: uppercase; margin-bottom: 3px; font-weight: 700; }
    .info-value { font-size: 14px; font-weight: 800; }
    .cover-briefing { position: relative; z-index: 1; background: rgba(0,0,0,0.35); border-left: 4px solid ${theme.accent}; padding: 16px 20px; border-radius: 0 14px 14px 0; margin-top: 6mm; }
    .cover-briefing-label { font-size: 10px; letter-spacing: 3px; opacity: 0.95; margin-bottom: 8px; text-transform: uppercase; font-weight: 800; color: ${theme.accent}; }
    .cover-briefing-text { font-size: 14px; line-height: 1.7; font-weight: 500; }
    .cover-rules { position: relative; z-index: 1; margin-top: 4mm; }
    .cover-rules-title { font-size: 11px; letter-spacing: 3px; opacity: 0.95; margin-bottom: 10px; text-transform: uppercase; font-weight: 800; text-align: center; }
    .cover-rules-list { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
    .cover-rules-list li { font-size: 11.5px; padding: 8px 12px 8px 30px; background: rgba(255,255,255,0.12); border-radius: 8px; position: relative; line-height: 1.4; font-weight: 500; }
    .cover-rules-list li::before { content: counter(rule); counter-increment: rule; position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; border-radius: 50%; background: ${theme.accent}; color: white; font-size: 9px; font-weight: 900; display: flex; align-items: center; justify-content: center; }
    .cover-rules-list { counter-reset: rule; }
    .cover-footer { position: relative; z-index: 1; text-align: center; font-size: 10px; opacity: 0.85; letter-spacing: 2px; padding-top: 4mm; border-top: 1px solid rgba(255,255,255,0.3); font-weight: 600; }

    /* ──────── ENIGMA PAGE ──────── */
    .enigma-page { background: ${theme.enigmaBg}; color: ${theme.textOnLight}; display: flex; flex-direction: column; gap: 8mm; }
    .enigma-header { position: relative; z-index: 1; display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 6mm; border-bottom: 3px double ${theme.border}; }
    .enigma-num { font-size: 28px; font-weight: 900; color: ${theme.primary}; letter-spacing: -0.5px; }
    .enigma-total { font-size: 13px; color: ${theme.primary}; letter-spacing: 2px; text-transform: uppercase; font-weight: 800; }
    .enigma-art { position: relative; z-index: 1; border-radius: 14px; overflow: hidden; max-height: 65mm; box-shadow: 0 8px 24px rgba(0,0,0,0.18); border: 3px solid ${theme.border}; }
    .enigma-art img { width: 100%; height: 100%; object-fit: cover; display: block; max-height: 65mm; }
    .narrative-block { position: relative; z-index: 1; display: flex; gap: 12px; align-items: flex-start; background: ${theme.cardBg}; border-left: 5px solid ${theme.accent}; padding: 14px 18px; border-radius: 0 12px 12px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .narrative-icon { font-size: 22px; color: ${theme.accent}; flex-shrink: 0; }
    .narrative { font-size: 13px; line-height: 1.7; color: ${theme.primary}; font-weight: 500; }
    .challenge-block { position: relative; z-index: 1; background: ${theme.cardBg}; border: 2px solid ${theme.border}; border-radius: 14px; padding: 18px 20px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
    .challenge-label { font-size: 10px; letter-spacing: 4px; color: ${theme.accent}; font-weight: 900; margin-bottom: 10px; text-transform: uppercase; }
    .challenge { font-size: 16px; font-weight: 700; line-height: 1.5; color: ${theme.primary}; }
    .answer-block { position: relative; z-index: 1; }
    .answer-label { font-size: 11px; letter-spacing: 3px; color: ${theme.primary}; font-weight: 900; margin-bottom: 8px; text-transform: uppercase; }
    .answer-line { height: 16mm; border: 2.5px dashed ${theme.border}; border-radius: 12px; background: repeating-linear-gradient(180deg, transparent 0, transparent 7mm, rgba(0,0,0,0.05) 7mm, rgba(0,0,0,0.05) 7.5mm); }
    .hint-block { position: relative; z-index: 1; margin-top: auto; background: ${theme.primary}; color: ${theme.textOnDark}; padding: 14px 18px; border-radius: 12px; border: 2px dashed ${theme.accent}; }
    .hint-label { font-size: 9px; letter-spacing: 2px; opacity: 0.85; font-weight: 700; margin-bottom: 6px; text-transform: uppercase; text-align: center; }
    .hint-text { font-size: 12px; line-height: 1.55; text-align: center; font-weight: 500; }
    .page-footer { position: relative; z-index: 1; display: flex; justify-content: space-between; font-size: 9.5px; letter-spacing: 2px; color: ${theme.primary}; padding-top: 6mm; border-top: 1px solid ${theme.border}; text-transform: uppercase; font-weight: 800; }

    /* ──────── ANSWER KEY ──────── */
    .key-page { background: ${theme.cardBg}; color: ${theme.textOnLight}; position: relative; }
    .key-page::before { content: 'GABARITO'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 180px; font-weight: 900; color: ${theme.border}; opacity: 0.06; pointer-events: none; letter-spacing: 12px; }
    .key-header { position: relative; z-index: 1; text-align: center; padding-bottom: 8mm; border-bottom: 3px double ${theme.border}; margin-bottom: 10mm; }
    .key-stamp { display: inline-block; padding: 6px 18px; border: 3px solid ${theme.accent}; color: ${theme.accent}; font-weight: 900; letter-spacing: 4px; font-size: 12px; transform: rotate(-3deg); margin-bottom: 10mm; border-radius: 6px; }
    .key-title { font-size: 36px; font-weight: 900; color: ${theme.primary}; letter-spacing: -1px; }
    .key-subtitle { font-size: 12px; color: ${theme.primary}; margin-top: 5mm; letter-spacing: 3px; text-transform: uppercase; font-weight: 700; }
    .key-list { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 6mm; }
    .key-item { display: flex; gap: 14px; align-items: flex-start; padding: 12px 16px; background: ${theme.enigmaBg}; border-left: 4px solid ${theme.accent}; border-radius: 0 12px 12px 0; }
    .key-num { font-size: 22px; font-weight: 900; color: ${theme.accent}; min-width: 32px; line-height: 1; }
    .key-content { flex: 1; }
    .key-challenge { font-size: 11.5px; color: ${theme.primary}; line-height: 1.5; margin-bottom: 6px; font-weight: 500; }
    .key-answer { font-size: 16px; font-weight: 900; color: ${theme.primary}; letter-spacing: 1px; }

    @media print { body { margin: 0; } .page { margin: 0; box-shadow: none; } }
  </style></head><body>

  <!-- ════════ COVER ════════ -->
  <section class="page cover">
    <div class="page-decor"></div>
    <div class="cover-top">
      <div class="cover-badge">${theme.badge}</div>
      <div class="cover-subtitle">Escape Room Educacional</div>
      <h1 class="cover-title">${escapeHtml(data.title)}</h1>
      <div class="cover-ornament">${theme.ornament}  ${theme.ornament}  ${theme.ornament}</div>
    </div>

    <div class="cover-info">
      <div class="info-box"><div class="info-label">Turma</div><div class="info-value">${escapeHtml(opts.className || '—')}</div></div>
      <div class="info-box"><div class="info-label">Tempo</div><div class="info-value">${escapeHtml(data.timeLimit || '45 min')}</div></div>
      <div class="info-box"><div class="info-label">Professor</div><div class="info-value">${escapeHtml(opts.teacherName || '—')}</div></div>
      <div class="info-box"><div class="info-label">Enigmas</div><div class="info-value">${data.enigmas.length} desafios</div></div>
    </div>

    <div class="cover-briefing">
      <div class="cover-briefing-label">▸ Briefing da Missão</div>
      <p class="cover-briefing-text">${escapeHtml(data.briefing)}</p>
    </div>

    ${data.rules && data.rules.length ? `<div class="cover-rules">
      <div class="cover-rules-title">Regras do Jogo</div>
      <ul class="cover-rules-list">
        ${data.rules.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>` : ''}

    <div class="cover-footer">
      ${escapeHtml(opts.schoolName || '')} ${opts.subject ? '· ' + escapeHtml(opts.subject) : ''} ${opts.level ? '· ' + escapeHtml(opts.level) : ''} · ${todayStr}
    </div>
  </section>

  ${enigmaPages}

  <!-- ════════ ANSWER KEY ════════ -->
  <section class="page key-page">
    <div class="page-decor"></div>
    <header class="key-header">
      <div class="key-stamp">CONFIDENCIAL · PROFESSOR</div>
      <h2 class="key-title">Gabarito</h2>
      <p class="key-subtitle">Respostas dos Enigmas</p>
    </header>
    <div class="key-list">
      ${data.enigmas.map((en, i) => `
        <div class="key-item">
          <div class="key-num">${String(i + 1).padStart(2, '0')}</div>
          <div class="key-content">
            <p class="key-challenge">${escapeHtml(en.challenge)}</p>
            <p class="key-answer">→ ${escapeHtml(en.answer)}</p>
          </div>
        </div>
      `).join('')}
    </div>
  </section>

  <script>
    (function(){
      var _wm = document.createElement('div');
      _wm.textContent = 'Prof. Corujão';
      _wm.style.cssText = 'position:fixed;bottom:3mm;right:4mm;font-size:7px;color:#9ca3af;letter-spacing:0.5px;opacity:0.55;font-style:italic;pointer-events:none;z-index:9999;';
      document.body.appendChild(_wm);
      setTimeout(function(){ window.print(); }, 800);
    })();
  </script>
  </body></html>`);
  w.document.close();
};

const EstudioScreen = ({
  estudioContext,
  setEstudioContext,
  studioMessages,
  setStudioMessages,
  profile,
  setScreen,
  setPlannerMode,
  notifications,
  setNotifications,
  schedules,
  addTask,
  updateTask,
  activeTasks,
  removeTask,
  studioReopenTaskId,
  setStudioReopenTaskId,
}: {
  estudioContext: string,
  setEstudioContext: (c: string | ((prev: string) => string)) => void,
  studioMessages: { id: string; role: 'user' | 'model'; text: string; date: number }[],
  setStudioMessages: (m: { id: string; role: 'user' | 'model'; text: string; date: number }[] | ((prev: { id: string; role: 'user' | 'model'; text: string; date: number }[]) => { id: string; role: 'user' | 'model'; text: string; date: number }[])) => void,
  profile: UserProfile,
  setScreen: (s: Screen) => void,
  setPlannerMode: (m: PlannerMode) => void,
  notifications?: any[],
  setNotifications?: (n: any[]) => void,
  schedules?: ClassSchedule[],
  addTask: (task: Omit<BackgroundTask, 'id' | 'status' | 'startTime'>) => string,
  updateTask: (id: string, updates: Partial<BackgroundTask>) => void,
  activeTasks: Record<string, BackgroundTask>,
  removeTask: (id: string) => void,
  studioReopenTaskId: string | null,
  setStudioReopenTaskId: (id: string | null) => void,
}) => {
  const [activeMode, setActiveMode] = useState<GameMode | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [classId, setClassId] = useState<string>('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<'fácil' | 'média' | 'difícil'>('média');
  const [popTheme, setPopTheme] = useState('');
  const [chapterCount, setChapterCount] = useState<3 | 4 | 5>(4);
  const [storyActivity, setStoryActivity] = useState<'surpresa' | 'reescrever' | 'inverter' | 'ilustrar' | 'debate'>('surpresa');
  const [duration, setDuration] = useState('1 aula');
  const [count, setCount] = useState(10);
  const [quizType, setQuizType] = useState<'multipla' | 'misto'>('multipla');
  const [bingoCardCount, setBingoCardCount] = useState(10);
  const [bingoSize, setBingoSize] = useState<3 | 5>(5);
  const [bingoFreeText, setBingoFreeText] = useState('LIVRE');
  const [wsGridSize, setWsGridSize] = useState<10 | 15 | 20>(15);
  const [escapeTheme, setEscapeTheme] = useState<EscapeTheme>('medieval');
  const [escapeEnigmaCount, setEscapeEnigmaCount] = useState<4 | 5 | 6>(5);

  const studioLoadingMsg = useFunnyLoadingMessage(isGenerating, 'studio');
  const selectedClass = (schedules || []).find(s => s.id === classId);
  const defaultSubject = selectedClass?.subject || profile.subject || '';
  const defaultLevel = selectedClass?.level || 'Ensino Fundamental II';

  const localGenActiveRef = useRef(false);

  const closeModal = () => {
    localGenActiveRef.current = false;
    setActiveMode(null); setResult(null); setTopic(''); setPopTheme(''); setIsGenerating(false);
  };

  useEffect(() => {
    if (!studioReopenTaskId) return;
    const task = activeTasks[studioReopenTaskId];
    if (!task || task.status !== 'completed' || !task.meta) return;
    const meta = task.meta as { mode?: GameMode; topic?: string; classId?: string; escapeTheme?: EscapeTheme; bingoSize?: 3 | 5; popTheme?: string };
    if (meta.mode) setActiveMode(meta.mode);
    if (meta.topic) setTopic(meta.topic);
    if (meta.classId !== undefined) setClassId(meta.classId);
    if (meta.escapeTheme) setEscapeTheme(meta.escapeTheme);
    if (meta.popTheme) setPopTheme(meta.popTheme);
    setResult(task.result);
    removeTask(studioReopenTaskId);
    setStudioReopenTaskId(null);
  }, [studioReopenTaskId, activeTasks, removeTask, setStudioReopenTaskId]);

  const generate = async () => {
    if (!topic.trim()) { toast.error('Qual é o tema? O Corujão precisa saber para criar!'); return; }
    if (!activeMode) return;
    if (activeMode === 'story' && !popTheme.trim()) { toast.error('Escolha o universo pop que vai dar vida à história!'); return; }
    setIsGenerating(true);
    setResult(null);
    localGenActiveRef.current = true;
    const modeLabels: Record<GameMode, string> = { story: 'Storytelling', quiz: 'Quiz', wordsearch: 'Caça-Palavras', crossword: 'Cruzadas', bingo: 'Bingo', escape: 'Escape Room', memory: 'Memória', sequencia: 'Sequência Didática', flashcard: 'Flashcards' };
    const taskId = addTask({
      type: activeMode,
      title: `${modeLabels[activeMode]}: ${topic.trim().slice(0, 40)}`,
      meta: { mode: activeMode, topic, classId, escapeTheme, bingoSize, bingoFreeText, bingoCardCount, wsGridSize, escapeEnigmaCount, difficulty, popTheme, chapterCount, storyActivity, duration, count, quizType },
    });
    try {
      const context = `Disciplina: ${defaultSubject || 'Geral'} | Nível: ${defaultLevel}${selectedClass ? ` | Turma: ${selectedClass.name}` : ''} | Tema: ${topic}`;
      let prompt = '';
      if (activeMode === 'story') {
        const storyActivityBriefs: Record<typeof storyActivity, string> = {
          surpresa: 'Escolha VOCÊ o formato mais potente para este conteúdo (reescrita criativa, cenário invertido, cena para ilustrar ou debate guiado) e nomeie-o na primeira linha em negrito.',
          reescrever: '**Capítulo do Aluno** (reescrita criativa): o aluno escreve o próximo capítulo introduzindo UM conceito novo do conteúdo como um novo personagem. Dê a instrução completa, sugira 2 conceitos candidatos, 3 critérios de avaliação observáveis e 1 frase de exemplo para começar.',
          inverter: '**E se...?** (cenário invertido): descreva em 1 parágrafo o que teria acontecido se a decisão-chave da história fosse a oposta, e proponha 3 perguntas para a turma discutir as consequências REAIS do conceito nessa inversão.',
          ilustrar: '**Cena Ilustrada**: roteiro de 1 cena marcante para o aluno desenhar, listando os elementos obrigatórios da cena, com a regra de ouro: a legenda do desenho deve explicar qual conceito real cada elemento representa.',
          debate: '**Debate Guiado**: 1 questão polêmica nascida da história, 2 posições possíveis com argumento inicial de cada lado, e a fala de fechamento do professor conectando tudo ao conteúdo real.',
        };
        prompt = `Você é um mestre em storytelling pedagógico. Crie uma METÁFORA NARRATIVA: uma história ambientada no universo de "${popTheme.trim()}" em que cada personagem ou elemento representa um conceito real do conteúdo estudado.
${context}

Retorne em Markdown brasileiro com EXATAMENTE estas seções (títulos h2 idênticos aos abaixo):

## 🗺️ Quem é Quem
(Tabela Markdown com colunas: Personagem/Elemento | Conceito real | Por que a metáfora funciona. 4 a 6 linhas. Personagens inspirados no universo de "${popTheme.trim()}". É o guia que o professor segue durante a leitura.)

## 📖 A História
(${chapterCount} capítulos, cada um com "### Capítulo N — Título". 2-3 parágrafos por capítulo, narrativa envolvente em que as AÇÕES dos personagens espelham fielmente como os conceitos reais se comportam — a lógica do conteúdo deve estar correta dentro da metáfora. Encerre CADA capítulo com:
> ⏸️ **Pausa pedagógica:** [pergunta oral curta que faz a turma conectar a cena ao conceito real antes de continuar]
)

## 🎬 Atividade
(${storyActivityBriefs[storyActivity]})

## 🧠 Desafio do Conhecimento
(3 questões de múltipla escolha com 4 alternativas A-D, uma de cada tipo, neste formato:
**1. [Compreensão]** — sobre o que aconteceu na história
**2. [Conexão]** — sobre o que determinado personagem/elemento representa
**3. [Aplicação]** — aplica o conceito real a uma situação nova, fora da história
NÃO inclua o gabarito nesta seção — ele vai na seção final exclusiva do professor.)

## 💡 Síntese da Metáfora
(1 parágrafo que desmonta a metáfora explicitamente: "Na história, X representava Y porque...; na vida real, isso significa que...". É o fechamento que garante que toda a turma captou a simbologia.)

## 🔑 Gabarito do Professor
(Seção final, claramente separada da folha do aluno: para CADA questão do Desafio do Conhecimento, a letra correta e 1 frase de justificativa.)

REGRAS: fidelidade conceitual absoluta — a metáfora NUNCA pode ensinar o conceito errado; linguagem adequada ao nível da turma, envolvente sem infantilizar; NÃO copie diálogos nem trechos de obras — inspire-se no universo e crie cenas originais. Português brasileiro natural.`;
      } else if (activeMode === 'quiz') {
        if (quizType === 'misto') {
          const mc = Math.ceil(count * 0.65), vf = count - Math.ceil(count * 0.65);
          prompt = `Gere um quiz MISTO sobre "${topic}" para ${defaultLevel}, disciplina ${defaultSubject}, dificuldade ${difficulty}.
${mc} questões de múltipla escolha (4 alternativas) e ${vf} questões de Verdadeiro/Falso.
Retorne APENAS JSON válido:
{"title":"...","questions":[{"type":"multipla"|"vf","q":"...","options":[...],"correct":0,"explain":"..."}]}
Para questões "vf": options deve ser ["Verdadeiro","Falso"]. "correct" é 0 (Verdadeiro) ou 1 (Falso).`;
        } else {
          prompt = `Gere um quiz de múltipla escolha sobre "${topic}" para ${defaultLevel}, disciplina ${defaultSubject}, dificuldade ${difficulty}.
Retorne APENAS JSON válido (sem markdown, sem \`\`\`):
{"title":"...","questions":[{"q":"pergunta","options":["a","b","c","d"],"correct":0,"explain":"justificativa breve"}]}
Gere exatamente ${count} perguntas. As 4 opções devem ser plausíveis. "correct" é o índice 0-3.`;
        }
      } else if (activeMode === 'wordsearch') {
        const wsMax = wsGridSize === 10 ? 10 : wsGridSize === 15 ? 15 : 20;
        prompt = `Liste ${Math.min(count, wsMax)} palavras-chave sobre "${topic}" (${defaultSubject}, ${defaultLevel}) para caça-palavras.
Cada palavra: substantivo, SEM espaços, SEM acentos, entre 4 e ${wsGridSize - 2} letras, MAIÚSCULAS.
Retorne APENAS JSON: {"title":"...","words":[{"word":"PALAVRA","hint":"dica curta para o aluno"}]}`;
      } else if (activeMode === 'crossword') {
        prompt = `Crie uma lista de ${Math.min(count, 15)} palavras sobre "${topic}" (${defaultSubject}, ${defaultLevel}) com definições no estilo "palavras cruzadas".
Cada palavra: 4 a 10 letras, SEM espaços, MAIÚSCULAS, sem acentos. Escolha palavras que compartilhem letras para facilitar o cruzamento.
Retorne APENAS JSON: {"title":"...","words":[{"word":"PALAVRA","clue":"definição/pista clara, estilo dicionário"}]}`;
      } else if (activeMode === 'bingo') {
        prompt = `Liste 40 termos/conceitos importantes sobre "${topic}" (${defaultSubject}, ${defaultLevel}) para bingo educativo.
Cada termo: 1 a 3 palavras, claros e didáticos.
Retorne APENAS JSON: {"title":"Bingo de ${topic}","items":["termo1","termo2",...]}`;
      } else if (activeMode === 'escape') {
        const themeLabel = { medieval: 'Medieval / Fantasia', lab: 'Laboratório Científico', detective: 'Detetive / Investigação', space: 'Espacial / Sci-Fi' }[escapeTheme];
        prompt = `Você é um designer de Escape Rooms educacionais. Crie um escape room IMERSIVO sobre "${topic}" (${defaultSubject}, ${defaultLevel}), dificuldade ${difficulty}, ambientação ${themeLabel}.

Estrutura:
- title: nome cinematográfico do escape room (até 8 palavras)
- briefing: narrativa de abertura em 3-4 frases imersivas, na 2ª pessoa ("Você é..."), conectando ao tema "${topic}"
- timeLimit: tempo sugerido (ex: "45 minutos")
- rules: array com 3-4 regras curtas
- enigmas: array com EXATAMENTE ${escapeEnigmaCount} enigmas encadeados sobre "${topic}". Cada enigma DEVE testar conhecimento REAL e específico de "${topic}", não trivial. Tipos variados: pergunta direta, charada, cálculo, anagrama, código, sequência. Cada um com:
  - narrative: 1-2 frases situando o enigma na história
  - challenge: o desafio em si (claro e específico)
  - answer: resposta curta (1-3 palavras), em MAIÚSCULAS
  - hint: dica que ajuda sem entregar a resposta
  - keyword: 2-4 palavras EM INGLÊS para buscar ilustração no Pixabay (relacionada ao enigma específico)

Retorne APENAS JSON válido (sem markdown):
{"title":"...","briefing":"...","timeLimit":"...","rules":["...","..."],"enigmas":[{"narrative":"...","challenge":"...","answer":"...","hint":"...","keyword":"..."}]}`;
      } else if (activeMode === 'memory') {
        prompt = `Gere ${count} pares conceito↔definição sobre "${topic}" (${defaultSubject}, ${defaultLevel}) para jogo da memória.
Cada conceito: 1-3 palavras. Cada definição: 1 frase curta (max 12 palavras). Inclua 1 emoji representando o conceito.
Retorne APENAS JSON: {"title":"...","pairs":[{"concept":"...","definition":"...","emoji":"🎯"}]}`;
      } else if (activeMode === 'sequencia') {
        prompt = `Você é um pedagogo especialista em metodologias ativas. Crie uma SEQUÊNCIA DIDÁTICA completa e profissional sobre "${topic}".
${context}
Duração: ${duration}

Retorne em Markdown brasileiro com EXATAMENTE as seções abaixo (substitua [ ] por conteúdo real, sem introduções nem comentários fora da estrutura):

## 🎯 Objetivos de Aprendizagem
[3-5 objetivos com verbos de ação alinhados à BNCC]

## 📋 Conhecimentos Prévios
[O que os alunos precisam saber antes + 1 estratégia rápida de diagnóstico inicial]

## 🗺️ Etapas da Sequência
[${duration === '1 aula' ? '3' : duration.includes('semana') ? '5' : '8'} etapas numeradas. Para CADA etapa: **Etapa N — Nome** (tempo estimado), objetivo da etapa, descrição detalhada da atividade com metodologia ativa, papel do professor e papel do aluno.]

## 🧩 Diferenciação e Inclusão
[2-3 adaptações concretas para alunos com dificuldades e 1-2 desafios extras para alunos avançados]

## 📊 Avaliação ao Longo da Sequência
[Instrumentos de avaliação formativa por etapa + critérios de êxito observáveis]

## 📦 Materiais Necessários
[Lista de materiais por etapa, priorizando recursos simples e acessíveis]

NÃO use código nem tabelas Markdown. Português brasileiro natural.`;
      } else if (activeMode === 'flashcard') {
        prompt = `Gere ${count} flashcards de estudo sobre "${topic}" (${defaultSubject}, ${defaultLevel}) para revisão de conteúdo.
FRENTE: pergunta curta, termo ou conceito-chave (máx. 12 palavras).
VERSO: resposta/explicação clara e completa em 1-2 frases (máx. 30 palavras).
Varie os tipos: definição, "o que é", causa/efeito, exemplo, comparação.
Retorne APENAS JSON: {"title":"...","cards":[{"front":"...","back":"...","emoji":"💡"}]}`;
      }
      let finalResult: any = null;
      if (activeMode === 'story') {
        const [response, sectionImages] = await Promise.all([
          generateContentWithRetry({ model: AI_MODEL, contents: prompt }),
          generateStoryImages(topic, popTheme)
        ]);
        finalResult = { markdown: response.text || '', sectionImages };
      } else if (activeMode === 'sequencia') {
        const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt });
        finalResult = { markdown: response.text || '', title: `Sequência Didática: ${topic}` };
      } else if (activeMode === 'escape') {
        const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt });
        const raw = response.text || '';
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.enigmas) || parsed.enigmas.length === 0 ||
            parsed.enigmas.some((en: any) => typeof en?.narrative !== 'string' || typeof en?.challenge !== 'string' || typeof en?.answer !== 'string')) {
          throw new Error('[IA_FORMATO] escape room sem title/enigmas válidos');
        }
        parsed.enigmas = parsed.enigmas.map((en: any) => ({ ...en, hint: typeof en.hint === 'string' ? en.hint : '' }));
        const apiKey = process.env.PIXABAY_API_KEY;
        if (apiKey && parsed.enigmas) {
          const withImages = await Promise.all(parsed.enigmas.map(async (en: any) => {
            const q = en.keyword;
            if (!q) return en;
            const cacheKey = `illus|${q.trim().toLowerCase()}`;
            if (pixabayCache.has(cacheKey)) return { ...en, imageUrl: pixabayCache.get(cacheKey) };
            try {
              const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(q.trim())}&image_type=illustration&safesearch=true&orientation=horizontal&per_page=20&order=popular`;
              const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
              if (!res.ok) return en;
              const data = await res.json();
              if (!data.hits?.length) return en;
              const hit = data.hits[Math.floor(Math.random() * Math.min(5, data.hits.length))];
              const imgUrl: string = hit.webformatURL || hit.largeImageURL || '';
              if (imgUrl) pixabayCache.set(cacheKey, imgUrl);
              return { ...en, imageUrl: imgUrl };
            } catch { return en; }
          }));
          parsed.enigmas = withImages;
        }
        finalResult = { ...parsed, theme: escapeTheme };
      } else {
        const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt });
        const raw = response.text || '';
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        if (activeMode === 'wordsearch') {
          if (!Array.isArray(parsed?.words) || parsed.words.some((w: any) => typeof w?.word !== 'string')) {
            throw new Error('[IA_FORMATO] caça-palavras sem lista de words válida');
          }
          const built = buildWordSearchGrid(parsed.words.map((w: any) => w.word), wsGridSize);
          finalResult = { ...parsed, grid: built.grid, placements: built.placements };
        } else if (activeMode === 'bingo') {
          if (!Array.isArray(parsed?.items) || parsed.items.length === 0) {
            throw new Error('[IA_FORMATO] bingo sem lista de items válida');
          }
          const cards = buildBingoCards(parsed.items, bingoCardCount, bingoSize, bingoFreeText);
          finalResult = { ...parsed, cards, bingoSize };
        } else if (activeMode === 'crossword') {
          if (parsed?.words != null && !Array.isArray(parsed.words)) {
            throw new Error('[IA_FORMATO] cruzadinha com words em formato inválido');
          }
          const crossword = buildCrosswordGrid(parsed.words || []);
          finalResult = { ...parsed, crossword };
        } else {
          finalResult = parsed;
        }
      }
      updateTask(taskId, { status: 'completed', result: finalResult });
      if (localGenActiveRef.current) setResult(finalResult);
    } catch (err: any) {
      console.error('[Gamification] error:', err);
      const friendlyMsg = formatApiError(err, 'A IA travou nessa. Aguarde um instante e tente de novo.');
      updateTask(taskId, { status: 'error', error: friendlyMsg });
      if (localGenActiveRef.current) toast.error(friendlyMsg);
    }
    if (localGenActiveRef.current) setIsGenerating(false);
    localGenActiveRef.current = false;
  };

  const modeMeta: Record<GameMode, { title: string, icon: any, color: string, bg: string, desc: string }> = {
    story: { title: 'Storytelling', icon: ScrollText, color: 'text-fuchsia-600', bg: 'bg-fuchsia-50 border-fuchsia-200', desc: 'A matéria vira história: personagens da cultura pop são os conceitos' },
    quiz: { title: 'Quiz', icon: Trophy, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', desc: 'Perguntas de múltipla escolha ou V/F' },
    wordsearch: { title: 'Caça-Palavras', icon: Grid3x3, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', desc: 'Grade com palavras escondidas para achar' },
    crossword: { title: 'Palavras Cruzadas', icon: Puzzle, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', desc: 'Grade cruzada com pistas e definições' },
    bingo: { title: 'Bingo Educativo', icon: Dice5, color: 'text-pink-600', bg: 'bg-pink-50 border-pink-200', desc: 'Cartelas com termos do conteúdo da aula' },
    escape: { title: 'Escape Room', icon: KeyRound, color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200', desc: 'Enigmas encadeados temáticos para imprimir' },
    memory: { title: 'Memória', icon: Layers3, color: 'text-teal-600', bg: 'bg-teal-50 border-teal-200', desc: 'Pares de conceito e definição para combinar' },
    sequencia: { title: 'Sequência Didática', icon: ClipboardList, color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200', desc: 'Passo a passo completo com etapas, inclusão e avaliação' },
    flashcard: { title: 'Flashcards', icon: Layers, color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', desc: 'Cartões de revisão frente e verso para imprimir' },
  };

  const smallActivities: GameMode[] = ['sequencia', 'flashcard', 'story', 'quiz', 'wordsearch', 'crossword', 'bingo', 'memory'];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title="Jogos" subtitle="Gamificação de Aulas" profile={profile} notifications={notifications} setNotifications={setNotifications} bannerImage="https://i.ibb.co/tPMphWm0/Design-sem-nome-20260520-142758-0000.png" />

      <div className="px-1 mb-6">
        <p className="text-sm text-gray-500 leading-relaxed">Transforme qualquer conteúdo em sequências didáticas, flashcards e atividades gamificadas que prendem a atenção da turma.</p>
      </div>

      {/* ESCAPE ROOM — destaque */}
      <button
        onClick={() => setActiveMode('escape')}
        className="w-full relative overflow-hidden rounded-[2rem] p-6 mb-4 shadow-xl text-left bg-gradient-to-br from-rose-600 via-red-600 to-orange-500 active:scale-[0.98] transition-transform"
      >
        <div className="absolute -top-6 -right-6 opacity-20">
          <KeyRound size={130} className="text-white" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-black tracking-widest uppercase text-yellow-300 bg-white/10 px-2 py-0.5 rounded-full backdrop-blur">★ Principal</span>
          </div>
          <h2 className="text-3xl font-black text-white mb-2 leading-tight">Escape Room</h2>
          <p className="text-sm text-rose-100 max-w-[80%] leading-relaxed mb-4">
            Crie enigmas encadeados temáticos para imprimir e jogar em sala. Desafio a resolver em equipe.
          </p>
          <div className="inline-flex items-center gap-2 bg-white text-rose-700 font-bold px-4 py-2 rounded-full text-sm">
            <KeyRound size={16} /> Criar escape room
          </div>
        </div>
      </button>

      {/* Atividades menores */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {smallActivities.map(m => {
          const meta = modeMeta[m];
          const Icon = meta.icon;
          return (
            <button
              key={m}
              onClick={() => setActiveMode(m)}
              className={`relative rounded-3xl p-4 text-left shadow-sm border-2 ${meta.bg} active:scale-[0.97] transition-transform`}
            >
              <Icon size={28} className={`${meta.color} mb-2`} />
              <h3 className={`font-bold text-sm ${meta.color}`}>{meta.title}</h3>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">{meta.desc}</p>
            </button>
          );
        })}
      </div>

      {/* MODAL */}
      <AnimatePresence>
        {activeMode && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={closeModal}
          >
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="bg-white w-full sm:max-w-lg rounded-t-[2rem] sm:rounded-[2rem] max-h-[92vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  {(() => { const Icon = modeMeta[activeMode].icon; return <Icon size={22} className={modeMeta[activeMode].color} />; })()}
                  <h3 className="font-bold text-lg text-gray-900">{modeMeta[activeMode].title}</h3>
                </div>
                <button
                  onClick={closeModal}
                  title={isGenerating ? 'Fechar (a geração continua em segundo plano)' : 'Fechar'}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>
              {isGenerating && (
                <div className="px-5 pt-3 -mb-1 flex items-center gap-2 text-[11px] text-indigo-500 font-semibold">
                  <Loader2 size={12} className="animate-spin" />
                  <span>Pode fechar. A geração continua em segundo plano.</span>
                </div>
              )}

              {!result && (
                <div className="p-5 space-y-4">
                  {(schedules && schedules.length > 0) && (
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Turma (opcional)</label>
                      <select value={classId} onChange={e => setClassId(e.target.value)} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400">
                        <option value="">Sem turma específica</option>
                        {schedules.map(s => <option key={s.id} value={s.id}>{s.name} {s.subject ? `· ${s.subject}` : ''}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tema / Conteúdo</label>
                    <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Ex: Sistema Solar, Revolução Industrial, Frações..." className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400" />
                  </div>

                  {activeMode === 'story' && (
                    <>
                      <div className="bg-fuchsia-50 border border-fuchsia-100 rounded-2xl p-3.5">
                        <p className="text-xs text-fuchsia-800 leading-relaxed"><b>Como funciona:</b> seu conteúdo vira uma história no universo que a turma ama. Cada personagem representa um conceito real. Vem com guia de leitura, pausas para discutir, atividade e desafio final.</p>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Universo pop da história *</label>
                        <input value={popTheme} onChange={e => setPopTheme(e.target.value)} placeholder="Ex: Harry Potter, Minecraft, futebol, Naruto..." className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-fuchsia-400" />
                        <div className="flex gap-1.5 mt-2 overflow-x-auto no-scrollbar pb-1">
                          {['🧙 Harry Potter', '⛏️ Minecraft', '⚽ Futebol', '🦸 Super-heróis', '🍥 Naruto', '🎮 Videogame', '🚀 Star Wars', '🏴‍☠️ Piratas'].map(t => {
                            const value = t.slice(t.indexOf(' ') + 1);
                            return (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setPopTheme(value)}
                                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all active:scale-95 ${popTheme === value ? 'bg-fuchsia-600 text-white border-fuchsia-600' : 'bg-white text-gray-500 border-gray-200'}`}
                              >
                                {t}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Capítulos</label>
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          {([3, 4, 5] as const).map(n => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setChapterCount(n)}
                              className={`py-2.5 rounded-2xl border-2 text-center transition-colors ${chapterCount === n ? 'border-fuchsia-500 bg-fuchsia-50' : 'border-gray-200 bg-white'}`}
                            >
                              <p className={`text-sm font-black ${chapterCount === n ? 'text-fuchsia-700' : 'text-gray-600'}`}>{n}</p>
                              <p className="text-[10px] text-gray-400">{n === 3 ? 'história curta' : n === 4 ? 'equilibrado' : 'saga completa'}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Atividade da história</label>
                        <div className="grid grid-cols-2 gap-2 mt-1">
                          {([
                            { v: 'surpresa', label: '🦉 Corujão decide', sub: 'A IA escolhe a melhor' },
                            { v: 'reescrever', label: '✍️ Capítulo do aluno', sub: 'Turma escreve a sequência' },
                            { v: 'inverter', label: '🔄 E se...?', sub: 'Cenário invertido p/ discutir' },
                            { v: 'ilustrar', label: '🎨 Cena ilustrada', sub: 'Desenho com legenda conceitual' },
                            { v: 'debate', label: '🗣️ Debate guiado', sub: 'Questão polêmica da história' },
                          ] as { v: typeof storyActivity; label: string; sub: string }[]).map(a => (
                            <button
                              key={a.v}
                              type="button"
                              onClick={() => setStoryActivity(a.v)}
                              className={`p-3 rounded-2xl border-2 text-left transition-colors ${storyActivity === a.v ? 'border-fuchsia-500 bg-fuchsia-50' : 'border-gray-200 bg-white'} ${a.v === 'surpresa' ? 'col-span-2' : ''}`}
                            >
                              <p className={`text-sm font-bold ${storyActivity === a.v ? 'text-fuchsia-700' : 'text-gray-700'}`}>{a.label}</p>
                              <p className="text-[10px] text-gray-500 mt-0.5">{a.sub}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {activeMode === 'quiz' && (
                    <>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tipo de questões</label>
                        <div className="flex gap-2 mt-1">
                          {(['multipla', 'misto'] as const).map(t => (
                            <button key={t} onClick={() => setQuizType(t)} className={`flex-1 py-2.5 rounded-2xl text-sm font-bold border-2 transition-colors ${quizType === t ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-200 text-gray-500'}`}>
                              {t === 'multipla' ? '4 alternativas' : 'Misto V/F + MC'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Quantidade de perguntas</label>
                        <input type="number" min={5} max={30} value={count} onChange={e => setCount(parseInt(e.target.value) || 0)} onBlur={() => setCount(c => Math.max(5, Math.min(30, c || 10)))} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Dificuldade</label>
                        <select value={difficulty} onChange={e => setDifficulty(e.target.value as any)} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm">
                          <option value="fácil">Fácil</option>
                          <option value="média">Média</option>
                          <option value="difícil">Difícil</option>
                        </select>
                      </div>
                    </>
                  )}

                  {activeMode === 'wordsearch' && (
                    <>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tamanho da grade</label>
                        <div className="flex gap-2 mt-1">
                          {([10, 15, 20] as const).map(sz => (
                            <button key={sz} onClick={() => setWsGridSize(sz)} className={`flex-1 py-2.5 rounded-2xl text-sm font-bold border-2 transition-colors ${wsGridSize === sz ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-200 text-gray-500'}`}>
                              {sz}×{sz}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Quantidade de palavras</label>
                        <input type="number" min={5} max={wsGridSize === 10 ? 10 : wsGridSize === 15 ? 15 : 20} value={count} onChange={e => setCount(parseInt(e.target.value) || 0)} onBlur={() => setCount(c => Math.max(5, Math.min(wsGridSize === 10 ? 10 : wsGridSize === 15 ? 15 : 20, c || 10)))} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm" />
                      </div>
                    </>
                  )}
                  {(activeMode === 'crossword' || activeMode === 'memory' || activeMode === 'flashcard') && (
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {activeMode === 'memory' ? 'Quantidade de pares' : activeMode === 'flashcard' ? 'Quantidade de cartões' : 'Quantidade de palavras'}
                      </label>
                      <input type="number" min={5} max={20} value={count} onChange={e => setCount(parseInt(e.target.value) || 0)} onBlur={() => setCount(c => Math.max(5, Math.min(20, c || 10)))} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm" />
                    </div>
                  )}

                  {activeMode === 'sequencia' && (
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Duração</label>
                      <select value={duration} onChange={e => setDuration(e.target.value)} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm">
                        <option value="1 aula">1 aula (3 etapas)</option>
                        <option value="1 semana">1 semana (5 etapas)</option>
                        <option value="1 bimestre">1 bimestre (8 etapas)</option>
                      </select>
                    </div>
                  )}

                  {activeMode === 'bingo' && (
                    <>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Formato da cartela</label>
                        <div className="flex gap-2 mt-1">
                          {([5, 3] as const).map(sz => (
                            <button key={sz} onClick={() => setBingoSize(sz)} className={`flex-1 py-2.5 rounded-2xl text-sm font-bold border-2 transition-colors ${bingoSize === sz ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-200 text-gray-500'}`}>
                              {sz}×{sz} {sz === 5 ? 'Clássico' : 'Mini'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Número de cartelas</label>
                        <input type="number" min={1} max={30} value={bingoCardCount} onChange={e => setBingoCardCount(parseInt(e.target.value) || 0)} onBlur={() => setBingoCardCount(c => Math.max(1, Math.min(30, c || 10)))} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm" />
                      </div>
                      {bingoSize === 5 && (
                        <div>
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Texto da casa livre</label>
                          <input value={bingoFreeText} onChange={e => setBingoFreeText(e.target.value || 'LIVRE')} placeholder="LIVRE" className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm" />
                        </div>
                      )}
                    </>
                  )}
                  {activeMode === 'escape' && (
                    <>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Ambientação</label>
                        <div className="grid grid-cols-2 gap-2 mt-1">
                          {([
                            { v: 'medieval', label: '⚔️ Medieval', sub: 'Pergaminhos e castelos' },
                            { v: 'lab', label: '⚗️ Científico', sub: 'Laboratório secreto' },
                            { v: 'detective', label: '🔍 Detetive', sub: 'Dossiê criminal' },
                            { v: 'space', label: '🚀 Espacial', sub: 'Missão galáctica' },
                          ] as { v: EscapeTheme; label: string; sub: string }[]).map(t => (
                            <button
                              key={t.v}
                              type="button"
                              onClick={() => setEscapeTheme(t.v)}
                              className={`p-3 rounded-2xl border-2 text-left transition-colors ${escapeTheme === t.v ? 'border-rose-500 bg-rose-50' : 'border-gray-200 bg-white'}`}
                            >
                              <p className={`text-sm font-bold ${escapeTheme === t.v ? 'text-rose-700' : 'text-gray-700'}`}>{t.label}</p>
                              <p className="text-[10px] text-gray-500 mt-0.5">{t.sub}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Quantidade de enigmas</label>
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          {[4, 5, 6].map(n => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setEscapeEnigmaCount(n as 4 | 5 | 6)}
                              className={`py-2 rounded-2xl border-2 font-bold ${escapeEnigmaCount === n ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-gray-200 bg-white text-gray-600'}`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Dificuldade</label>
                        <select value={difficulty} onChange={e => setDifficulty(e.target.value as any)} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm">
                          <option value="fácil">Fácil</option>
                          <option value="média">Média</option>
                          <option value="difícil">Difícil</option>
                        </select>
                      </div>
                    </>
                  )}

                  <button onClick={generate} disabled={isGenerating || !topic.trim()} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50">
                    {isGenerating ? <><Loader2 size={18} className="animate-spin" /><span className="truncate max-w-[220px]">{studioLoadingMsg || 'Gerando…'}</span></> : <><Wand2 size={18} /> Gerar com IA</>}
                  </button>
                </div>
              )}

              {result && (() => {
                const activityLabels: Record<GameMode, string> = {
                  story: 'Metáfora Narrativa', quiz: 'Quiz Avaliativo', wordsearch: 'Caça-Palavras',
                  crossword: 'Palavras Cruzadas', bingo: 'Bingo Educativo', escape: 'Escape Room', memory: 'Jogo da Memória',
                  sequencia: 'Sequência Didática', flashcard: 'Flashcards'
                };
                const printOpts = {
                  title: result.title || topic,
                  subject: defaultSubject,
                  level: defaultLevel,
                  className: selectedClass?.name,
                  teacherName: profile.name,
                  schoolName: profile.schoolName || selectedClass?.school,
                  activityLabel: activityLabels[activeMode!],
                  bingoDim: result.bingoSize || 5,
                };
                return (
                <div className="p-5">
                  <div className="flex gap-2 mb-4">
                    <button onClick={() => setResult(null)} className="flex-1 bg-gray-100 text-gray-700 font-bold py-2.5 rounded-xl text-sm"><RotateCcw size={14} className="inline -mt-0.5 mr-1" />Refazer</button>
                    <button onClick={() => {
                      if (activeMode === 'escape' && result.enigmas) {
                        printEscapeRoom(result as EscapeRoomData, { className: selectedClass?.name, teacherName: profile.name, schoolName: profile.schoolName || selectedClass?.school, subject: defaultSubject, level: defaultLevel });
                      } else {
                        printGameResult(printOpts);
                      }
                    }} className="flex-1 bg-emerald-600 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"><Download size={16} /> Imprimir / PDF</button>
                  </div>

                  <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-3 mb-3">
                    <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">{printOpts.activityLabel}</p>
                    <h1 className="text-base font-black text-indigo-900">{printOpts.title}</h1>
                    <p className="text-[10px] text-indigo-400 mt-0.5">{printOpts.subject} · {printOpts.level}{printOpts.className ? ` · ${printOpts.className}` : ''}</p>
                  </div>

                  <div id="game-print-area" className="bg-gray-50 rounded-2xl p-4 text-sm">
                    {activeMode === 'story' && result.markdown && (
                      <div className="markdown-body prose prose-sm max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h2: ({ children, ...props }) => {
                              const extractText = (n: any): string => {
                                if (typeof n === 'string') return n;
                                if (typeof n === 'number') return String(n);
                                if (Array.isArray(n)) return n.map(extractText).join('');
                                if (n?.props?.children) return extractText(n.props.children);
                                return '';
                              };
                              const title = extractText(children).trim();
                              const imgUrl = result.sectionImages?.[title];
                              return (
                                <>
                                  {imgUrl && <img src={imgUrl} alt={title} className="w-full rounded-xl mb-3 object-cover" style={{ maxHeight: 180 }} />}
                                  <h2 {...props}>{children}</h2>
                                </>
                              );
                            }
                          }}
                        >{result.markdown}</ReactMarkdown>
                      </div>
                    )}

                    {activeMode === 'quiz' && result.questions && (
                      <>
                        <div className="instructions"><b>Instruções:</b> Leia cada questão com atenção e marque a alternativa correta.</div>
                        <div className="space-y-3">
                          {result.questions.map((q: any, i: number) => (
                            <div key={i} className="quiz-q">
                              <p><b>{i + 1}.</b> {q.q}</p>
                              <div className="mt-2">
                                {q.options.map((opt: string, j: number) => (
                                  <p key={j} className="quiz-opt"><b>{String.fromCharCode(65 + j)})</b> {opt}</p>
                                ))}
                              </div>
                              <p className="quiz-answer text-xs text-emerald-700 mt-2"><b>Resposta:</b> {String.fromCharCode(65 + q.correct)}: {q.explain}</p>
                            </div>
                          ))}
                        </div>
                        <div className="answer-key-page">
                          <h2 className="answer-key-title">Gabarito</h2>
                          {result.questions.map((q: any, i: number) => (
                            <div key={i} className="answer-key-item"><b>{i + 1}.</b> {String.fromCharCode(65 + q.correct)}: {q.explain}</div>
                          ))}
                        </div>
                      </>
                    )}

                    {activeMode === 'wordsearch' && result.grid && (() => {
                      const wsNorm = (s: string) => (s || '').toUpperCase().replace(/[^A-ZÁÉÍÓÚÂÊÔÃÕÇÜ]/gi, '');
                      const placements: { word: string, row: number, col: number, dir: string }[] = result.placements || [];
                      const placedSet = new Set(placements.map(p => p.word));
                      // Só lista pistas de palavras que realmente entraram na grade
                      const placedWords = placements.length ? result.words.filter((w: any) => placedSet.has(wsNorm(w.word))) : result.words;
                      return (
                      <>
                        <div className="instructions"><b>Instruções:</b> Encontre todas as palavras da lista escondidas na grade. Elas podem aparecer na horizontal, vertical ou diagonal.</div>
                        <div className="ws-wrapper">
                          <div className="ws-grid" style={{ gridTemplateColumns: `repeat(${result.grid.length}, 24px)` }}>
                            {result.grid.flatMap((row: string[], r: number) => row.map((cell: string, c: number) => (
                              <div key={`${r}-${c}`} className="ws-cell">{cell}</div>
                            )))}
                          </div>
                        </div>
                        <h2>Palavras para encontrar</h2>
                        <ul className="clue-list">
                          {placedWords.map((w: any, i: number) => <li key={i}><b>{w.word}</b>: {w.hint}</li>)}
                        </ul>
                        {placements.length > 0 && (
                          <div className="answer-key-page">
                            <h2 className="answer-key-title">Gabarito</h2>
                            {placements.map((p, i) => (
                              <div key={i} className="answer-key-item"><b>{p.word}</b> — linha {p.row + 1}, coluna {p.col + 1}, direção {p.dir}</div>
                            ))}
                          </div>
                        )}
                      </>
                      );
                    })()}

                    {activeMode === 'crossword' && result.words && (
                      <>
                        <div className="instructions"><b>Instruções:</b> Leia cada definição e preencha as palavras na grade, uma letra por quadrado.</div>
                        {result.crossword ? (
                          <>
                            <div className="overflow-x-auto">
                              {(() => {
                                const numCols = result.crossword.grid[0]?.length || 10;
                                const cellPx = Math.min(44, Math.max(26, Math.floor(560 / numCols)));
                                return (
                                  <table className="cw-grid-table">
                                    <tbody>
                                      {result.crossword.grid.map((row: (string|null)[], r: number) => (
                                        <tr key={r}>
                                          {row.map((cell: string|null, c: number) => {
                                            if (cell === null) return <td key={c} className="cw-grid-black" style={{ width: cellPx, height: cellPx }} />;
                                            const num = result.crossword.cellNumbers[`${r},${c}`];
                                            return (
                                              <td key={c} className="cw-grid-white" style={{ width: cellPx, height: cellPx, padding: 0 }}>
                                                {num && <span className="cw-grid-num">{num}</span>}
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                );
                              })()}
                            </div>
                            <div className="cw-clues-cols">
                              {result.crossword.across.length > 0 && (
                                <div>
                                  <span className="cw-clue-dir">→ Horizontal</span>
                                  {result.crossword.across.map((c: any) => <p key={c.num} className="cw-clue-item"><b>{c.num}.</b> {c.clue}</p>)}
                                </div>
                              )}
                              {result.crossword.down.length > 0 && (
                                <div>
                                  <span className="cw-clue-dir">↓ Vertical</span>
                                  {result.crossword.down.map((c: any) => <p key={c.num} className="cw-clue-item"><b>{c.num}.</b> {c.clue}</p>)}
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <ol style={{ listStyle: 'decimal', paddingLeft: 20 }}>
                            {result.words.map((w: any, i: number) => (
                              <li key={i} className="cw-item">
                                <p className="cw-clue">{w.clue}</p>
                                <div className="cw-boxes">{w.word.split('').map((_: string, j: number) => <div key={j} className="cw-box" />)}</div>
                              </li>
                            ))}
                          </ol>
                        )}
                        <div className="answer-key-page">
                          <h2 className="answer-key-title">Gabarito</h2>
                          {result.crossword ? (
                            <>
                              {result.crossword.across.length > 0 && <><p style={{fontWeight:900,marginBottom:4}}>→ Horizontal</p>{result.crossword.across.map((c: any) => <div key={c.num} className="answer-key-item"><b>{c.num}.</b> {c.word}</div>)}</>}
                              {result.crossword.down.length > 0 && <><p style={{fontWeight:900,margin:'8px 0 4px'}}>↓ Vertical</p>{result.crossword.down.map((c: any) => <div key={c.num} className="answer-key-item"><b>{c.num}.</b> {c.word}</div>)}</>}
                            </>
                          ) : result.words.map((w: any, i: number) => (
                            <div key={i} className="answer-key-item"><b>{i + 1}.</b> {w.word}</div>
                          ))}
                        </div>
                      </>
                    )}

                    {activeMode === 'bingo' && result.cards && (
                      <>
                        <div className="instructions"><b>Como jogar:</b> Distribua uma cartela para cada aluno. O professor sorteia os termos da lista. Quem marcar uma linha, coluna ou diagonal completa grita BINGO!</div>
                        {result.cards.map((card: string[][], i: number) => (
                          <div key={i} className="bingo-card">
                            <div className="bingo-card-title">BINGO</div>
                            <div className="bingo-sub">Cartela {i + 1}</div>
                            <div className="bingo-grid" style={{ gridTemplateColumns: `repeat(${result.bingoSize || 5}, minmax(0, 1fr))` }}>
                              {card.flatMap((row, r) => row.map((cell, c) => (
                                <div key={`${r}-${c}`} className={`bingo-cell ${cell.startsWith('★') ? 'free' : ''}`}>{cell.replace('★ ', '')}</div>
                              )))}
                            </div>
                          </div>
                        ))}
                        <div className="bingo-draw-section">
                          <h2>Termos para sortear</h2>
                          <ul className="clue-list">
                            {result.items.slice(0, 40).map((it: string, i: number) => <li key={i}>{it}</li>)}
                          </ul>
                        </div>
                      </>
                    )}

                    {activeMode === 'escape' && result.enigmas && (
                      <div className="escape-preview">
                        <div className="bg-gradient-to-br from-rose-600 to-purple-700 text-white rounded-2xl p-4 mb-3">
                          <p className="text-xs font-black tracking-widest uppercase text-white/90">{result.timeLimit || '45 min'} · {result.enigmas.length} enigmas</p>
                          <h2 className="text-lg font-black leading-tight my-1 text-white">{result.title}</h2>
                          <p className="text-sm text-rose-100 leading-relaxed mt-2">{result.briefing}</p>
                        </div>
                        <p className="text-xs font-black text-gray-600 uppercase tracking-widest mb-2">Enigmas</p>
                        <div className="space-y-2">
                          {result.enigmas.map((en: any, i: number) => (
                            <div key={i} className="bg-white border border-gray-200 rounded-2xl p-3 flex gap-3">
                              {en.imageUrl && <img src={en.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" />}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-black text-rose-600 mb-1">ENIGMA {i + 1}</p>
                                <p className="text-sm font-bold text-gray-800 leading-snug">{en.challenge}</p>
                                {en.narrative && <p className="text-xs text-gray-600 mt-1 leading-snug italic line-clamp-2">{en.narrative}</p>}
                                <p className="text-xs font-semibold text-emerald-700 mt-1.5"><KeyRound size={12} className="inline -mt-0.5 mr-1" />{en.answer}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeMode === 'memory' && result.pairs && (
                      <>
                        <div className="instructions"><b>Como jogar:</b> Imprima, recorte pelas linhas tracejadas e embaralhe as cartas. Cada aluno (ou dupla) tenta encontrar os pares conceito-definição virando duas cartas por vez.</div>
                        <div className="memory-grid">
                          {result.pairs.flatMap((p: any, i: number) => [
                            <div key={`c-${i}`} className="memory-pair concept">
                              {p.emoji && <span style={{fontSize:18,display:'block',marginBottom:2}}>{p.emoji}</span>}
                              {p.concept}
                            </div>,
                            <div key={`d-${i}`} className="memory-pair">{p.definition}</div>
                          ])}
                        </div>
                      </>
                    )}

                    {activeMode === 'sequencia' && result.markdown && (
                      <div className="markdown-body prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.markdown}</ReactMarkdown>
                      </div>
                    )}

                    {activeMode === 'flashcard' && result.cards && (
                      <>
                        <div className="instructions"><b>Como usar:</b> Imprima e recorte os cartões pelas linhas tracejadas. Frente e verso são cartas separadas: use a frente para perguntar e o verso para conferir a resposta. Ideal para revisão individual, em duplas ou jogo rápido de perguntas.</div>
                        <div className="memory-grid flashcard-grid">
                          {result.cards.map((c: any, i: number) => (
                            <React.Fragment key={i}>
                              <div className="memory-pair concept">
                                {c.emoji && <span style={{fontSize:18,display:'block',marginBottom:2}}>{c.emoji}</span>}
                                <span style={{fontSize:9,display:'block',opacity:0.6,marginBottom:2,letterSpacing:1}}>FRENTE · {i + 1}</span>
                                {c.front}
                              </div>
                              <div className="memory-pair">
                                <span style={{fontSize:9,display:'block',opacity:0.6,marginBottom:2,letterSpacing:1}}>VERSO · {i + 1}</span>
                                {c.back}
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const printPlannerContent = (title: string, content: string, type: 'plan' | 'activities' | 'exam' | string, teacherName?: string, schoolName?: string, printOpts?: { landscape?: boolean }) => {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast.error('O navegador bloqueou a janela de impressão. Permita pop-ups e tente de novo.'); return; }
  const typeLabel = ({ plan: 'Plano de Aula', activities: 'Atividades', exam: 'Avaliação' } as Record<string, string>)[type] || escapeHtml(type);
  const today = new Date().toLocaleDateString('pt-BR');
  // Escapa o texto ANTES das transformações de markdown: só o HTML gerado aqui
  // dentro (h1/ul/table/…) chega vivo ao document.write.
  const htmlContent = escapeHtml(content)
    // Tabelas markdown (GFM) → <table>
    .replace(/(^\|.+\|[ \t]*\n\|[-:| \t]+\|[ \t]*\n(?:^\|.+\|[ \t]*\n?)*)/gm, (tbl) => {
      const rows = tbl.trim().split('\n').filter(r => r.trim().startsWith('|'));
      if (rows.length < 2) return tbl;
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'));
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      return '<table><thead><tr>' + head.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' +
        body.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>\n';
    })
    // Separador literal ---GABARITO--- → quebra de página + título (consome o heading
    // "## Gabarito…" logo em seguida, se houver, para não duplicar a quebra)
    .replace(/^[ \t]*---GABARITO---[ \t]*$(?:\n+^#{1,3} .*gabarito.*$)?/gim, '<div style="page-break-before: always"></div><h2>GABARITO DO PROFESSOR</h2>')
    // ### antes de ## (senão "### Título" vira "<h2># Título</h2>")
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    // Gabarito começa sempre em página nova (evita resposta na mesma folha do aluno)
    .replace(/^## (.+)$/gm, (_m, t: string) => `${/gabarito/i.test(t) ? '<div style="page-break-before: always"></div>' : ''}<h2>${t}</h2>`)
    .replace(/^# (.+)$/gm, (_m, t: string) => `${/gabarito/i.test(t) ? '<div style="page-break-before: always"></div>' : ''}<h1>${t}</h1>`)
    // Alternativas de múltipla escolha "( ) A) …" → linha de opção estilizada
    .replace(/^\( \) (.+)$\n?/gm, '<div class="opt"><span class="opt-bubble"></span><span>$1</span></div>')
    // Linhas de resposta (10+ underscores) → linha limpa com borda inferior
    .replace(/^_{10,}[ \t]*$\n?/gm, '<div class="answer-line"></div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n/g, '<br>');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4${printOpts?.landscape ? ' landscape' : ''}; margin: ${printOpts?.landscape ? '1.4cm' : '2cm'}; }
    * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2937; line-height: 1.6; margin: 0; font-size: 12px; }
    .header { background: #4338ca; color: white; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header-left h1 { margin: 0 0 4px; font-size: 20px; font-weight: 900; }
    .header-left .tag { background: rgba(255,255,255,0.2); border-radius: 20px; padding: 3px 10px; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; display: inline-block; margin-bottom: 8px; }
    .header-meta { font-size: 9px; color: rgba(255,255,255,0.75); margin-top: 4px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin-top: 8px; }
    .field { border-bottom: 1px solid rgba(255,255,255,0.4); padding-bottom: 2px; }
    .field-label { font-size: 7.5px; font-weight: 700; color: rgba(255,255,255,0.6); letter-spacing: 1px; text-transform: uppercase; }
    .field-val { font-size: 10px; color: white; font-weight: 600; min-height: 14px; }
    h1 { font-size: 16px; font-weight: 900; color: #1e293b; margin: 20px 0 6px; border-left: 4px solid #4338ca; padding-left: 10px; }
    h2 { font-size: 13px; font-weight: 900; color: #4338ca; border: 1.5px solid #4338ca; padding: 4px 12px; border-radius: 6px; display: inline-block; margin: 14px 0 6px; }
    h3 { font-size: 12px; font-weight: 700; color: #334155; margin: 10px 0 4px; }
    p, li { margin: 4px 0; font-size: 11.5px; }
    ul { padding-left: 20px; margin: 4px 0; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 16px 0; }
    strong { font-weight: 800; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: ${printOpts?.landscape ? '11.5px' : '10.5px'}; }
    th { background: #4338ca; color: white; font-weight: 800; padding: ${printOpts?.landscape ? '8px 10px' : '6px 8px'}; text-align: left; border: 1px solid #4338ca; }
    td { padding: ${printOpts?.landscape ? '8px 10px' : '6px 8px'}; border: 1px solid #e2e8f0; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .opt { display: flex; align-items: center; gap: 8px; margin: 3px 0 3px 14px; font-size: 11.5px; }
    .opt-bubble { width: 11px; height: 11px; border: 1.5px solid #64748b; border-radius: 50%; flex-shrink: 0; display: inline-block; }
    .answer-line { border-bottom: 1px solid #94a3b8; height: 22px; width: 100%; max-width: 640px; margin: 0 0 4px; }
    .footer { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 9px; color: #94a3b8; text-align: center; }
  </style></head><body>
  <div class="header">
    <div class="header-left">
      <div class="tag">${typeLabel}</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="header-meta">Gerado pelo Prof. Corujão · ${today}</div>
      <div class="fields">
        <div class="field"><div class="field-label">PROFESSOR(A)</div><div class="field-val">${escapeHtml(teacherName || '')}</div></div>
        <div class="field"><div class="field-label">DATA</div><div class="field-val"></div></div>
        <div class="field"><div class="field-label">ESCOLA</div><div class="field-val">${escapeHtml(schoolName || '')}</div></div>
        <div class="field"><div class="field-label">TURMA</div><div class="field-val"></div></div>
      </div>
    </div>
  </div>
  <div class="content">${htmlContent}</div>
  <div class="footer">Prof. Corujão | Material gerado por IA · Revise antes de usar</div>
  <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`);
  w.document.close();
};

const AcervoScreen = ({ savedResources, setSavedResources, profile, setScreen, notifications, setNotifications }: { savedResources: SavedResource[], setSavedResources: (r: SavedResource[]) => void, profile: UserProfile, setScreen: (s: Screen) => void, notifications?: any[], setNotifications?: (n: any[]) => void }) => {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const typeMeta: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    slides:     { color: 'bg-indigo-500',  label: 'Slides',     icon: <Presentation size={18} /> },
    activities: { color: 'bg-amber-500',   label: 'Atividades', icon: <FileText size={18} /> },
    exam:       { color: 'bg-emerald-500', label: 'Prova',      icon: <FileQuestion size={18} /> },
    plan:       { color: 'bg-cyan-500',    label: 'Plano',      icon: <BookOpen size={18} /> },
  };

  const filtered = savedResources
    .filter(r => typeFilter === 'all' || r.type === typeFilter)
    .filter(r => !search.trim() || r.title.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b.date - a.date);

  const handleDelete = (id: string) => {
    setSavedResources(savedResources.filter(r => r.id !== id));
    setDeleteConfirmId(null);
  };

  const handlePrint = (resource: SavedResource) => {
    const content = typeof resource.content === 'string' ? resource.content : '';
    if (!content) { toast.info('Esse material não tem conteúdo de texto para imprimir.'); return; }
    printPlannerContent(resource.title, content, resource.type as 'plan' | 'activities' | 'exam', profile.name, profile.schoolName);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title="Histórico" subtitle="Materiais gerados recentemente" profile={profile} notifications={notifications} setNotifications={setNotifications} />

      {savedResources.length > 0 && (
        <>
          {/* Search */}
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por título..."
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Type filter */}
          <PillTabs
            layoutKey="acervo"
            className="mb-4"
            tabs={[
              { id: 'all', label: 'Todos', icon: Filter },
              { id: 'slides', label: 'Slides', icon: Presentation },
              { id: 'activities', label: 'Atividades', icon: FileText },
              { id: 'exam', label: 'Provas', icon: FileQuestion },
              { id: 'plan', label: 'Planos', icon: BookOpen },
            ]}
            active={typeFilter}
            onChange={setTypeFilter}
          />

          {/* Count */}
          <p className="text-xs text-gray-400 font-medium mb-3 px-1">
            {filtered.length} {filtered.length === 1 ? 'material' : 'materiais'}{typeFilter !== 'all' || search ? ' encontrados' : ' no total'}
          </p>
        </>
      )}

      {savedResources.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Archive size={44} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">Nenhum material salvo</p>
          <button onClick={() => setScreen('planner')} className="mt-4 bg-indigo-600 text-white px-6 py-2.5 rounded-full text-sm font-bold">Criar Material</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <Search size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">Nenhum material encontrado</p>
          <button onClick={() => { setSearch(''); setTypeFilter('all'); }} className="mt-3 text-indigo-600 text-sm font-bold">Limpar filtros</button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(resource => {
            const meta = typeMeta[resource.type] || typeMeta.plan;
            const hasTextContent = typeof resource.content === 'string' && !!resource.content;
            return (
              <div key={resource.id} className="bg-white rounded-2xl p-4 border border-gray-50 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 ${meta.color}`}>
                    {meta.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-900 text-sm leading-snug truncate">{resource.title}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white ${meta.color}`}>{meta.label}</span>
                      <span className="text-[10px] text-gray-400">{new Date(resource.date).toLocaleDateString('pt-BR')}</span>
                      {!hasTextContent && <span className="text-[10px] text-gray-400 italic">sem prévia — gere de novo em Jogos para editar</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {hasTextContent && (
                      <button
                        onClick={() => handlePrint(resource)}
                        className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-indigo-400 active:scale-90 transition-transform"
                        title="Imprimir / PDF"
                      >
                        <Download size={15} />
                      </button>
                    )}
                    {deleteConfirmId === resource.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleDelete(resource.id)} className="px-2.5 py-1.5 bg-red-500 text-white text-xs font-bold rounded-xl">Excluir</button>
                        <button onClick={() => setDeleteConfirmId(null)} className="px-2.5 py-1.5 bg-gray-100 text-gray-600 text-xs font-bold rounded-xl">Não</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirmId(resource.id)}
                        className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-red-300 active:scale-90 transition-transform"
                        title="Excluir"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};

// ─── Gamificação de Turma ─────────────────────────────────────────────────────
interface GamiBehavior { id: string; label: string; points: number; emoji: string; }
interface GamiReward { id: string; label: string; cost: number; emoji: string; }
interface GamiTeam { id: string; name: string; emoji: string; color: string; }
interface GamiStudent {
  id: string;
  name: string;
  xp: number;          // XP da temporada (zera por bimestre)
  totalXp: number;     // XP acumulado de toda a vida — nunca diminui, define o nível
  weekXp: number;      // XP da semana corrente
  coins: number;       // moedas gastáveis na loja
  teamId?: string;
  badges: string[];
  streak: number;
  lastPointDay?: string;
  participatedDay?: string;
}
interface GamiLogEntry { id: string; studentIds: string[]; label: string; emoji: string; points: number; coins?: number; kind?: 'award' | 'purchase'; date: number; }
interface GamiMission { goal: number; reward: string; progress: number; weekKey: string; }
interface GamiHallEntry { season: number; date: number; top: { name: string; xp: number }[]; }
interface ClassGamification {
  id: string;          // == id da turma (ClassSchedule)
  students: GamiStudent[];
  teams: GamiTeam[];
  behaviors: GamiBehavior[];
  rewards: GamiReward[];
  log: GamiLogEntry[];
  season: number;
  weekKey: string;
  hallOfFame: GamiHallEntry[];
  mission?: GamiMission | null;
  missionDoneWeek?: string;
  skin: 'coruja' | 'emblema';
  soundOn: boolean;
}

const GAMI_LEVELS = [
  { min: 0,   name: 'Aprendiz' },
  { min: 40,  name: 'Explorador' },
  { min: 100, name: 'Estudioso' },
  { min: 200, name: 'Sábio' },
  { min: 320, name: 'Mestre' },
  { min: 480, name: 'Lenda' },
];
const GAMI_SKINS: Record<'coruja' | 'emblema', string[]> = {
  coruja:  ['🥚', '🐣', '🦉', '🌟', '🎓', '👑'],
  emblema: ['🛡️', '🥉', '🥈', '🥇', '💎', '👑'],
};
const gamiLevel = (totalXp: number) => {
  let idx = 0;
  GAMI_LEVELS.forEach((l, i) => { if (totalXp >= l.min) idx = i; });
  return idx;
};
const gamiLevelProgress = (totalXp: number) => {
  const idx = gamiLevel(totalXp);
  if (idx >= GAMI_LEVELS.length - 1) return 1;
  const cur = GAMI_LEVELS[idx].min, next = GAMI_LEVELS[idx + 1].min;
  return Math.min(1, (totalXp - cur) / (next - cur));
};

const GAMI_BADGES: { id: string; name: string; emoji: string; desc: string; check: (s: GamiStudent) => boolean }[] = [
  { id: 'primeiro',  name: 'Primeiro Passo',  emoji: '🌱', desc: 'Ganhou o primeiro ponto',        check: s => s.totalXp >= 1 },
  { id: 'chamas',    name: 'Em Chamas',       emoji: '🔥', desc: '3 dias seguidos ganhando pontos', check: s => (s.streak || 0) >= 3 },
  { id: 'semana',    name: 'Semana Perfeita', emoji: '⚡', desc: '5 dias seguidos ganhando pontos', check: s => (s.streak || 0) >= 5 },
  { id: 'centuriao', name: 'Centurião',       emoji: '💯', desc: 'Alcançou 100 XP',                 check: s => s.totalXp >= 100 },
  { id: 'foguete',   name: 'Foguete',         emoji: '🚀', desc: 'Alcançou 250 XP',                 check: s => s.totalXp >= 250 },
  { id: 'lenda',     name: 'Lenda Viva',      emoji: '👑', desc: 'Alcançou 480 XP',                 check: s => s.totalXp >= 480 },
];

const GAMI_DEFAULT_BEHAVIORS: GamiBehavior[] = [
  { id: 'gb1', label: 'Participou da aula', points: 1,  emoji: '🙋' },
  { id: 'gb2', label: 'Ajudou um colega',   points: 2,  emoji: '🤝' },
  { id: 'gb3', label: 'Tarefa completa',    points: 2,  emoji: '📘' },
  { id: 'gb4', label: 'Esforço extra',      points: 2,  emoji: '💪' },
  { id: 'gb5', label: 'Gentileza',          points: 1,  emoji: '💜' },
  { id: 'gb6', label: 'Atrapalhou a aula',  points: -1, emoji: '🔇' },
  { id: 'gb7', label: 'Sem tarefa',         points: -1, emoji: '📕' },
];
const GAMI_DEFAULT_REWARDS: GamiReward[] = [
  { id: 'gr1', label: 'Ajudante do dia',              cost: 10, emoji: '⭐' },
  { id: 'gr2', label: 'Primeiro da fila',             cost: 10, emoji: '🚶' },
  { id: 'gr3', label: 'Sentar onde quiser (1 dia)',   cost: 15, emoji: '🪑' },
  { id: 'gr4', label: 'Escolher a música/brincadeira', cost: 20, emoji: '🎵' },
  { id: 'gr5', label: 'Mensagem positiva para casa',  cost: 25, emoji: '💌' },
  { id: 'gr6', label: '+1 dia no prazo da tarefa',    cost: 30, emoji: '📅' },
];
const GAMI_TEAM_PRESETS = [
  { name: 'Corujas',  emoji: '🦉', color: '#6366f1' },
  { name: 'Fênix',    emoji: '🔥', color: '#ef4444' },
  { name: 'Dragões',  emoji: '🐉', color: '#10b981' },
  { name: 'Tubarões', emoji: '🦈', color: '#0ea5e9' },
  { name: 'Águias',   emoji: '🦅', color: '#f59e0b' },
  { name: 'Lobos',    emoji: '🐺', color: '#8b5cf6' },
];

const gamiRid = () => Math.random().toString(36).slice(2, 10);
const gamiWeekKey = () => {
  const d = new Date();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
};
const gamiTodayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const gamiYesterdayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// AudioContext único e reutilizado: criar um por toque estoura o limite do
// navegador (~6 no Chrome) em premiações rápidas e silencia o som.
let chimeCtx: AudioContext | null = null;
const playChime = (positive = true) => {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!chimeCtx || chimeCtx.state === 'closed') chimeCtx = new Ctx();
    const ctx = chimeCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(positive ? 880 : 330, ctx.currentTime);
    if (positive) o.frequency.exponentialRampToValueAtTime(1318, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.10, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    setTimeout(() => { try { o.disconnect(); g.disconnect(); } catch {} }, 600);
  } catch { /* sem áudio disponível */ }
};

// Buffer de ruído branco compartilhado (whoosh/impacto) — gerado uma vez e
// reutilizado, mesma lógica de reaproveitamento do chimeCtx acima.
let noiseBuffer: AudioBuffer | null = null;
const getNoiseBuffer = (ctx: AudioContext): AudioBuffer => {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
};
const getChimeCtx = (): AudioContext | null => {
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  if (!chimeCtx || chimeCtx.state === 'closed') chimeCtx = new Ctx();
  if (chimeCtx.state === 'suspended') chimeCtx.resume().catch(() => {});
  return chimeCtx;
};

// Sopro de vento subindo de tom — dispara junto do windup de 'cast'.
const playWhoosh = () => {
  try {
    const ctx = getChimeCtx();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(350, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    src.connect(filter); filter.connect(g); g.connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + 0.5);
    setTimeout(() => { try { src.disconnect(); filter.disconnect(); g.disconnect(); } catch {} }, 700);
  } catch { /* sem áudio disponível */ }
};

// Baque grave (tom caindo + ruído filtrado) — dispara no momento do impacto;
// mais pesado quando o golpe foi crítico.
const playImpactThud = (heavy = false) => {
  try {
    const ctx = getChimeCtx();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(heavy ? 170 : 120, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.18);
    g.gain.setValueAtTime(heavy ? 0.30 : 0.20, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    o.connect(g); g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);

    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(heavy ? 1000 : 650, ctx.currentTime);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(heavy ? 0.24 : 0.14, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    src.connect(filter); filter.connect(ng); ng.connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + 0.15);

    setTimeout(() => { try { o.disconnect(); g.disconnect(); src.disconnect(); filter.disconnect(); ng.disconnect(); } catch {} }, 400);
  } catch { /* sem áudio disponível */ }
};

// Arpejo ascendente e brilhante — dispara na cura por sequência de acertos.
const playHealChime = () => {
  try {
    const ctx = getChimeCtx();
    if (!ctx) return;
    [660, 880, 1320].forEach((freq, i) => {
      const t = ctx!.currentTime + i * 0.09;
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g); g.connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.32);
      setTimeout(() => { try { o.disconnect(); g.disconnect(); } catch {} }, (i * 90) + 500);
    });
  } catch { /* sem áudio disponível */ }
};

const gamiDefaultClass = (classId: string): ClassGamification => ({
  id: classId,
  students: [],
  teams: [],
  behaviors: GAMI_DEFAULT_BEHAVIORS,
  rewards: GAMI_DEFAULT_REWARDS,
  log: [],
  season: 1,
  weekKey: gamiWeekKey(),
  hallOfFame: [],
  mission: null,
  skin: 'coruja',
  soundOn: true,
});

// ─── Ferramentas ao vivo (overlay em tela cheia, ideais para projetar) ────────
const GAMI_STAGE = {
  violet:  { bg: 'from-[#241b4d] via-[#161233] to-[#0c0a1e]', glow: 'bg-violet-500', chip: 'from-violet-500 to-indigo-600',  btn: 'from-violet-500 to-indigo-500 shadow-violet-950/60' },
  night:   { bg: 'from-[#0f2445] via-[#0b1830] to-[#070e1d]', glow: 'bg-sky-500',    chip: 'from-sky-500 to-blue-600',      btn: 'from-sky-500 to-blue-600 shadow-sky-950/60' },
  teal:    { bg: 'from-[#0b3a38] via-[#092528] to-[#05141a]', glow: 'bg-teal-400',   chip: 'from-teal-400 to-cyan-600',     btn: 'from-teal-500 to-cyan-600 shadow-teal-950/60' },
  emerald: { bg: 'from-[#0b3d2a] via-[#08251d] to-[#051510]', glow: 'bg-emerald-400',chip: 'from-emerald-400 to-green-600', btn: 'from-emerald-500 to-green-600 shadow-emerald-950/60' },
  amber:   { bg: 'from-[#4d2c0b] via-[#2e1c0a] to-[#170e05]', glow: 'bg-amber-400',  chip: 'from-amber-400 to-orange-600',  btn: 'from-amber-500 to-orange-600 shadow-amber-950/60' },
  crimson: { bg: 'from-[#4d0f1e] via-[#2d0a14] to-[#16050a]', glow: 'bg-rose-500',   chip: 'from-rose-500 to-red-600',      btn: 'from-rose-500 to-red-600 shadow-rose-950/60' },
  slate:   { bg: 'from-[#243044] via-[#161e2e] to-[#0a0f1a]', glow: 'bg-indigo-400', chip: 'from-slate-500 to-slate-700',   btn: 'from-indigo-500 to-indigo-600 shadow-indigo-950/60' },
  fuchsia: { bg: 'from-[#4a0d33] via-[#2b0820] to-[#150410]', glow: 'bg-fuchsia-500', chip: 'from-fuchsia-500 to-pink-600',   btn: 'from-fuchsia-500 to-pink-600 shadow-fuchsia-950/60' },
} as const;
type GamiStageTheme = keyof typeof GAMI_STAGE;

const CONFETTI_COLORS = ['#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#fb7185'];
const ConfettiBurst = () => (
  <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden">
    {Array.from({ length: 30 }).map((_, i) => {
      const size = 6 + Math.random() * 7;
      return (
        <motion.span
          key={i}
          initial={{ y: '-8vh', x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: '110vh', x: (Math.random() - 0.5) * 140, rotate: 360 + Math.random() * 420, opacity: [1, 1, 0.85] }}
          transition={{ duration: 1.7 + Math.random() * 1.3, delay: Math.random() * 0.3, ease: 'easeIn' }}
          className="absolute rounded-[2px]"
          style={{ left: `${Math.random() * 100}%`, width: size, height: size * 0.45, backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length] }}
        />
      );
    })}
  </div>
);

const GamiToolShell = ({ title, subtitle, icon: Icon, theme = 'violet', onClose, children }: { title: string; subtitle?: string; icon: any; theme?: GamiStageTheme; onClose: () => void; children: React.ReactNode }) => {
  const t = GAMI_STAGE[theme] ?? GAMI_STAGE.violet;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className={`fixed inset-0 z-[130] flex flex-col bg-gradient-to-b ${t.bg}`}
    >
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className={`absolute -top-40 left-1/2 -translate-x-1/2 w-[30rem] h-[30rem] rounded-full blur-[110px] opacity-20 ${t.glow}`} />
      </div>
      <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${t.chip} flex items-center justify-center shadow-lg`}>
            <Icon size={19} className="text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h2 className="text-lg font-black text-white leading-tight">{title}</h2>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">{subtitle ?? 'Kit ao Vivo'}</p>
          </div>
        </div>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 text-white/80 flex items-center justify-center backdrop-blur">
          <X size={18} />
        </button>
      </div>
      <div className="relative flex-1 overflow-y-auto px-5 pb-8 flex flex-col">{children}</div>
    </motion.div>
  );
};

const GamiSorteio = ({ students, onClose, onAwardParticipation }: { students: GamiStudent[]; onClose: () => void; onAwardParticipation: (id: string) => void }) => {
  const [fair, setFair] = useState(true);
  const [drawn, setDrawn] = useState<string[]>([]);
  const [winner, setWinner] = useState<GamiStudent | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState('');
  const [awarded, setAwarded] = useState(false);

  const pool = students.filter(s => !fair || !drawn.includes(s.id));
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const spin = () => {
    if (pool.length === 0 || spinning) return;
    setSpinning(true); setWinner(null); setAwarded(false);
    const total = 20 + Math.floor(Math.random() * 8);
    const tick = (n: number) => {
      if (!alive.current) return;
      setDisplay(pool[Math.floor(Math.random() * pool.length)].name);
      if (n >= total) {
        const w = pool[Math.floor(Math.random() * pool.length)];
        setWinner(w); setDisplay(w.name);
        setDrawn(d => [...d, w.id]);
        setSpinning(false);
        return;
      }
      setTimeout(() => tick(n + 1), 35 + n * 9);
    };
    tick(0);
  };

  return (
    <GamiToolShell title="Sorteador" subtitle="Quem será a estrela?" icon={Ticket} theme="violet" onClose={onClose}>
      {winner && !spinning && <ConfettiBurst />}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <motion.div
          key={display}
          initial={{ scale: 0.96, opacity: 0.7 }} animate={{ scale: 1, opacity: 1 }}
          className={`w-full max-w-md rounded-[2rem] py-14 px-6 text-center border transition-shadow ${winner ? 'bg-gradient-to-br from-violet-500 to-indigo-600 border-violet-300/40 shadow-[0_0_70px_-10px_rgba(139,92,246,0.65)]' : 'bg-white/[0.06] border-white/10 backdrop-blur'}`}
        >
          <p className={`text-3xl sm:text-4xl font-black break-words ${winner ? 'text-white' : spinning ? 'text-white/90' : 'text-white/50'}`}>
            {display || (students.length === 0 ? 'Cadastre os alunos da turma primeiro' : pool.length === 0 ? 'Todos já foram sorteados! 🎉' : 'Toque em Sortear')}
          </p>
          {winner && <p className="text-violet-100 text-xs font-black uppercase tracking-[0.25em] mt-4">✦ Sorteado ✦</p>}
        </motion.div>
        {winner && !awarded && (
          <button
            onClick={() => { onAwardParticipation(winner.id); setAwarded(true); }}
            className="bg-gradient-to-r from-emerald-500 to-green-600 text-white font-bold px-6 py-3 rounded-2xl flex items-center gap-2 active:scale-95 transition-transform shadow-lg shadow-emerald-950/50"
          >
            <Hand size={16} /> +1 Participação para {winner.name.split(' ')[0]}
          </button>
        )}
        {awarded && <p className="text-emerald-400 text-sm font-bold">Ponto registrado! ✓</p>}
      </div>
      <div className="space-y-3">
        <label className="flex items-center justify-between bg-white/[0.06] border border-white/10 backdrop-blur rounded-2xl px-4 py-3">
          <span className="text-sm font-bold text-white/85">Modo justo (não repete sorteados)</span>
          <input type="checkbox" checked={fair} onChange={e => setFair(e.target.checked)} className="w-5 h-5 accent-violet-500" />
        </label>
        {fair && drawn.length > 0 && (
          <div className="flex items-center justify-between text-xs text-white/40 px-1">
            <span>{drawn.length} de {students.length} já sorteados</span>
            <button onClick={() => setDrawn([])} className="text-violet-300 font-bold">Reiniciar rodada</button>
          </div>
        )}
        <button
          onClick={spin}
          disabled={spinning || pool.length === 0}
          className="w-full bg-gradient-to-r from-violet-500 to-indigo-500 text-white font-black py-4 rounded-2xl text-lg disabled:opacity-50 active:scale-[0.98] transition-transform shadow-lg shadow-violet-950/60"
        >
          {spinning ? 'Sorteando…' : 'Sortear'}
        </button>
      </div>
    </GamiToolShell>
  );
};

const GamiTimer = ({ onClose }: { onClose: () => void }) => {
  const [totalSecs, setTotalSecs] = useState(0);
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const [customMin, setCustomMin] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) { if (intervalRef.current) clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => {
      setLeft(l => {
        if (l <= 1) {
          setRunning(false);
          playChime(true); setTimeout(() => playChime(true), 350); setTimeout(() => playChime(true), 700);
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  const start = (mins: number) => {
    const s = Math.max(1, Math.round(mins * 60));
    setTotalSecs(s); setLeft(s); setRunning(true);
  };
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  const pct = totalSecs > 0 ? left / totalSecs : 0;
  const urgent = left > 0 && left <= 10;
  const warn = left > 10 && left <= 60;
  const statusLabel = left === 0 && totalSecs > 0 ? 'Tempo esgotado!' : urgent ? 'Reta final!' : warn ? 'Falta pouco…' : running ? 'Foco total' : totalSecs > 0 ? 'Pausado' : 'Pronto para começar';

  return (
    <GamiToolShell title="Timer" subtitle="Tempo da atividade" icon={TimerIcon} theme="night" onClose={onClose}>
      {urgent && running && (
        <motion.div
          animate={{ opacity: [0.05, 0.45, 0.05] }}
          transition={{ duration: 1, repeat: Infinity }}
          className="fixed inset-0 bg-red-600/30 pointer-events-none"
        />
      )}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-[0.2em] border ${urgent ? 'text-red-300 border-red-400/40 bg-red-500/10' : warn ? 'text-amber-300 border-amber-400/40 bg-amber-500/10' : 'text-sky-300 border-sky-400/30 bg-sky-500/10'}`}>
          {statusLabel}
        </span>
        <p className={`font-black tabular-nums tracking-tight ${urgent ? 'text-red-400' : warn ? 'text-amber-300' : 'text-white'}`} style={{ fontSize: 'min(26vw, 9rem)', lineHeight: 1 }}>
          {mm}:{ss}
        </p>
        {totalSecs > 0 && (
          <div className="w-full max-w-md h-3 bg-white/10 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-1000 ${urgent ? 'bg-red-500' : warn ? 'bg-amber-400' : 'bg-gradient-to-r from-sky-400 to-blue-500'}`} style={{ width: `${pct * 100}%` }} />
          </div>
        )}
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 5, 10].map(m => (
            <button key={m} onClick={() => start(m)} className="bg-white/[0.08] border border-white/10 text-white font-bold py-3 rounded-2xl active:scale-95 transition-transform">{m} min</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number" min={1} max={120} value={customMin} onChange={e => setCustomMin(e.target.value)}
            placeholder="Minutos…" className="flex-1 bg-white/[0.08] border border-white/10 text-white placeholder-white/40 rounded-2xl px-4 py-3 font-bold focus:outline-none focus:border-sky-400/50"
          />
          <button onClick={() => { const m = parseInt(customMin, 10); if (m > 0) start(Math.min(m, 120)); }} disabled={!(parseInt(customMin, 10) > 0)} className="bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold px-5 rounded-2xl shadow-lg shadow-sky-950/60 disabled:opacity-40">Iniciar</button>
        </div>
        {totalSecs > 0 && (
          <div className="flex gap-2">
            <button onClick={() => setRunning(r => !r)} disabled={left === 0} className="flex-1 bg-white/10 text-white font-bold py-3 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-40">
              {running ? <><Pause size={16} /> Pausar</> : <><Play size={16} /> Continuar</>}
            </button>
            <button onClick={() => { setRunning(false); setLeft(totalSecs); }} className="flex-1 bg-white/10 text-white font-bold py-3 rounded-2xl flex items-center justify-center gap-2">
              <RotateCcw size={16} /> Reiniciar
            </button>
          </div>
        )}
      </div>
    </GamiToolShell>
  );
};

const GamiGrupos = ({ students, onClose }: { students: GamiStudent[]; onClose: () => void }) => {
  const [groupSize, setGroupSize] = useState(4);
  const [separations, setSeparations] = useState<[string, string][]>([]);
  const [selA, setSelA] = useState('');
  const [selB, setSelB] = useState('');
  const [groups, setGroups] = useState<GamiStudent[][] | null>(null);

  const countViolations = (gs: GamiStudent[][]) =>
    separations.filter(([a, b]) => gs.some(g => g.some(s => s.id === a) && g.some(s => s.id === b))).length;

  const generate = () => {
    if (students.length === 0) return;
    // Guarda a tentativa com MENOS violações — antes a primeira tentativa ruim
    // ficava travada como resultado mesmo com 249 chances de melhorar.
    let best: GamiStudent[][] | null = null;
    let bestViolations = Infinity;
    for (let attempt = 0; attempt < 250; attempt++) {
      const shuffled = shuffleArray(students);
      const count = Math.max(1, Math.ceil(shuffled.length / groupSize));
      const gs: GamiStudent[][] = Array.from({ length: count }, () => []);
      shuffled.forEach((s, i) => gs[i % count].push(s));
      const v = countViolations(gs);
      if (v === 0) { best = gs; break; }
      if (v < bestViolations) { bestViolations = v; best = gs; }
    }
    setGroups(best);
  };

  return (
    <GamiToolShell title="Gerador de Grupos" subtitle="Equipes na hora" icon={Users} theme="teal" onClose={onClose}>
      {!groups ? (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2 block">Alunos por grupo</label>
            <div className="grid grid-cols-4 gap-2">
              {[2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setGroupSize(n)} className={`py-3 rounded-2xl font-bold border transition-colors ${groupSize === n ? 'bg-gradient-to-br from-teal-400 to-cyan-600 border-teal-300/40 text-white shadow-lg shadow-teal-950/50' : 'border-white/10 text-white/50 bg-white/[0.06]'}`}>{n}</button>
              ))}
            </div>
          </div>
          <div className="bg-white/[0.06] rounded-2xl p-4 border border-white/10 backdrop-blur">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Separar alunos (opcional)</p>
            <div className="flex gap-2 items-center">
              <select value={selA} onChange={e => setSelA(e.target.value)} className="flex-1 border border-white/10 rounded-xl px-2 py-2 text-sm bg-white/10 text-white min-w-0 [&>option]:text-gray-900">
                <option value="">Aluno…</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <X size={14} className="text-white/30 shrink-0" />
              <select value={selB} onChange={e => setSelB(e.target.value)} className="flex-1 border border-white/10 rounded-xl px-2 py-2 text-sm bg-white/10 text-white min-w-0 [&>option]:text-gray-900">
                <option value="">Aluno…</option>
                {students.filter(s => s.id !== selA).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button
                onClick={() => { if (selA && selB) { setSeparations(p => [...p, [selA, selB]]); setSelA(''); setSelB(''); } }}
                disabled={!selA || !selB}
                className="bg-gradient-to-br from-teal-400 to-cyan-600 text-white w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-40 shrink-0"
              ><Plus size={16} /></button>
            </div>
            {separations.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {separations.map(([a, b], i) => (
                  <div key={i} className="flex items-center justify-between bg-red-500/15 border border-red-400/20 rounded-xl px-3 py-1.5 text-xs">
                    <span className="text-red-300 font-medium">{students.find(s => s.id === a)?.name} ✕ {students.find(s => s.id === b)?.name}</span>
                    <button onClick={() => setSeparations(p => p.filter((_, j) => j !== i))} className="text-red-300/70"><X size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={generate} disabled={students.length === 0} className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-black py-4 rounded-2xl text-lg disabled:opacity-50 shadow-lg shadow-teal-950/60">
            <Shuffle size={18} className="inline mr-2 -mt-1" />Sortear grupos
          </button>
          {students.length === 0 && <p className="text-center text-sm text-white/40">Cadastre os alunos da turma primeiro.</p>}
        </div>
      ) : (
        <div className="flex flex-col flex-1">
          <div className="grid grid-cols-2 gap-3 flex-1 content-start">
            {groups.map((g, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="bg-white/[0.07] rounded-2xl p-4 border border-white/10 backdrop-blur">
                <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-600 text-white text-[10px] font-black uppercase tracking-wider mb-2.5">Grupo {i + 1}</span>
                {g.map(s => <p key={s.id} className="text-sm font-bold text-white/90 leading-relaxed">{s.name}</p>)}
              </motion.div>
            ))}
          </div>
          <button onClick={generate} className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-bold py-3.5 rounded-2xl mt-4 flex items-center justify-center gap-2 shadow-lg shadow-teal-950/60">
            <Shuffle size={16} /> Sortear de novo
          </button>
        </div>
      )}
    </GamiToolShell>
  );
};

const GamiBarulho = ({ onClose, onRewardClass }: { onClose: () => void; onRewardClass: (points: number) => void }) => {
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState('');
  const [challenge, setChallenge] = useState<{ left: number; total: number; strikes: number; status: 'on' | 'win' | 'fail' } | null>(null);
  const levelRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const rafRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new Ctx();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const loop = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / data.length);
          const next = Math.min(1, levelRef.current * 0.82 + rms * 3.2 * 0.18);
          levelRef.current = next;
          // Estado a ~12 Hz: setLevel a 60 fps re-renderizava o componente
          // inteiro a cada frame; a lógica do desafio continua lendo levelRef.
          const now = performance.now();
          if (now - lastUiUpdateRef.current > 80) {
            lastUiUpdateRef.current = now;
            setLevel(next);
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        if (!cancelled) setErr('Não consegui acessar o microfone. Verifique a permissão do navegador.');
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      try { ctxRef.current?.close(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (!challenge || challenge.status !== 'on') return;
    const id = setInterval(() => {
      setChallenge(c => {
        if (!c || c.status !== 'on') return c;
        const noisy = levelRef.current > 0.5;
        const strikes = noisy ? c.strikes + 1 : c.strikes;
        if (strikes >= 12) { playChime(false); return { ...c, strikes, status: 'fail' }; }
        if (c.left <= 1) { playChime(true); setTimeout(() => playChime(true), 300); return { ...c, left: 0, status: 'win' }; }
        return { ...c, left: c.left - 1, strikes };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [challenge?.status]);

  const zoneLabel = level < 0.25 ? 'Silêncio perfeito' : level < 0.5 ? 'Murmúrio de trabalho' : level < 0.75 ? 'Está ficando alto…' : 'MUITO BARULHO!';
  const zoneHex = level < 0.5 ? '#34d399' : level < 0.75 ? '#fbbf24' : '#ef4444';

  return (
    <GamiToolShell title="Medidor de Barulho" subtitle="Ouvidos do Corujão" icon={Volume2} theme="emerald" onClose={onClose}>
      {err ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <Volume2 size={40} className="text-white/25" />
          <p className="text-sm text-white/60 max-w-xs">{err}</p>
        </div>
      ) : (
        <>
          <div className="flex-1 flex flex-col items-center justify-center gap-7">
            <div className="relative flex items-center justify-center h-32">
              <motion.div
                animate={{ scale: 1 + level * 0.9, opacity: 0.35 + level * 0.5 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                className="absolute w-32 h-32 rounded-full blur-2xl"
                style={{ backgroundColor: zoneHex }}
              />
              <p className="relative font-black text-2xl sm:text-3xl text-center px-4 transition-colors duration-300" style={{ color: zoneHex }}>{zoneLabel}</p>
            </div>
            <div className="w-full max-w-md">
              <div className="flex gap-1 items-end h-16">
                {Array.from({ length: 24 }).map((_, i) => {
                  const on = level * 24 > i;
                  const c = i < 12 ? '#34d399' : i < 18 ? '#fbbf24' : '#ef4444';
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-full transition-all duration-100"
                      style={{ height: `${28 + (i / 23) * 72}%`, backgroundColor: on ? c : 'rgba(255,255,255,0.08)', boxShadow: on ? `0 0 10px ${c}66` : 'none' }}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between mt-2 px-0.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-300/60">Zona tranquila</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-red-300/60">Limite do desafio ↑</span>
              </div>
            </div>
            {challenge && (
              <div className={`w-full max-w-md rounded-2xl p-4 text-center border backdrop-blur ${challenge.status === 'win' ? 'bg-emerald-500/15 border-emerald-400/40' : challenge.status === 'fail' ? 'bg-red-500/15 border-red-400/30' : 'bg-white/[0.06] border-white/10'}`}>
                {challenge.status === 'on' && (
                  <>
                    <p className="text-4xl font-black text-white tabular-nums">{String(Math.floor(challenge.left / 60)).padStart(2, '0')}:{String(challenge.left % 60).padStart(2, '0')}</p>
                    <p className="text-xs text-white/50 font-bold mt-1">Desafio do Silêncio em andamento · avisos: {challenge.strikes}/12</p>
                  </>
                )}
                {challenge.status === 'win' && (
                  <>
                    <p className="text-lg font-black text-emerald-300">🎉 A turma venceu o desafio!</p>
                    <button
                      onClick={() => { onRewardClass(2); setChallenge(null); }}
                      className="mt-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-bold px-5 py-2.5 rounded-2xl shadow-lg shadow-emerald-950/50"
                    >Dar +2 pontos para todos</button>
                  </>
                )}
                {challenge.status === 'fail' && (
                  <>
                    <p className="text-lg font-black text-red-300">O barulho venceu desta vez… 😅</p>
                    <button onClick={() => setChallenge(null)} className="mt-3 bg-white/10 text-white font-bold px-5 py-2.5 rounded-2xl">Fechar desafio</button>
                  </>
                )}
              </div>
            )}
          </div>
          {!challenge && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider text-center">Desafio do Silêncio: turma fica abaixo do limite e ganha pontos</p>
              <div className="grid grid-cols-3 gap-2">
                {[3, 5, 10].map(m => (
                  <button key={m} onClick={() => setChallenge({ left: m * 60, total: m * 60, strikes: 0, status: 'on' })} className="bg-gradient-to-r from-emerald-500 to-green-600 text-white font-bold py-3 rounded-2xl active:scale-95 transition-transform shadow-lg shadow-emerald-950/50">{m} min</button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </GamiToolShell>
  );
};

const GamiSemaforo = ({ onClose }: { onClose: () => void }) => {
  const [state, setState] = useState<0 | 1 | 2>(0);
  const meta = [
    { hex: '#10b981', label: 'PODE CONVERSAR', sub: 'Trabalho em grupo liberado' },
    { hex: '#f59e0b', label: 'VOZ BAIXA',       sub: 'Só murmúrio de trabalho' },
    { hex: '#ef4444', label: 'SILÊNCIO',        sub: 'Atenção total ao professor' },
  ][state];
  const lamps = [
    { hex: '#ef4444', on: state === 2 },
    { hex: '#f59e0b', on: state === 1 },
    { hex: '#10b981', on: state === 0 },
  ];
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[130] flex flex-col items-center justify-center gap-8 bg-gradient-to-b from-[#151b28] via-[#0d111c] to-[#05070d] cursor-pointer select-none focus:outline-none"
      onClick={() => setState(s => ((s + 1) % 3) as 0 | 1 | 2)}
      role="button"
      tabIndex={0}
      aria-label={`Semáforo da turma: ${meta.label}. Toque ou pressione Enter para mudar.`}
      onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setState(s => ((s + 1) % 3) as 0 | 1 | 2); } }}
    >
      <button onClick={e => { e.stopPropagation(); onClose(); }} className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center"><X size={20} /></button>
      {/* Cabeçalho no padrão do GamiToolShell (a tela toda é clicável, então o shell não envolve) */}
      <div className="absolute top-5 left-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 via-amber-400 to-red-500 flex items-center justify-center shadow-lg">
          <Siren size={19} className="text-white" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-lg font-black text-white leading-tight">Semáforo</h2>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">Kit ao Vivo</p>
        </div>
      </div>
      <div className="bg-[#1c2433] border border-white/10 rounded-[2.5rem] px-6 py-7 shadow-2xl flex flex-col gap-5">
        {lamps.map((l, i) => (
          <div
            key={i}
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full transition-all duration-500"
            style={{
              backgroundColor: l.on ? l.hex : '#0a0e16',
              boxShadow: l.on ? `0 0 70px 14px ${l.hex}77, inset 0 -8px 16px rgba(0,0,0,0.3)` : 'inset 0 6px 14px rgba(0,0,0,0.7)',
              opacity: l.on ? 1 : 0.45,
            }}
          />
        ))}
      </div>
      <div className="text-center px-6">
        <p className="font-black text-4xl sm:text-5xl transition-colors duration-500" style={{ color: meta.hex, textShadow: `0 0 40px ${meta.hex}66` }}>{meta.label}</p>
        <p className="text-white/60 font-bold text-lg mt-2">{meta.sub}</p>
      </div>
      <p className="text-white/30 text-xs font-bold uppercase tracking-[0.25em]">Toque na tela para mudar</p>
    </motion.div>
  );
};

const GamiDado = ({ onClose }: { onClose: () => void }) => {
  const [faces, setFaces] = useState(6);
  const [value, setValue] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const roll = () => {
    if (rolling) return;
    setRolling(true);
    let n = 0;
    const tick = () => {
      if (!alive.current) return;
      setValue(1 + Math.floor(Math.random() * faces));
      n++;
      if (n >= 14) { setRolling(false); return; }
      setTimeout(tick, 40 + n * 14);
    };
    tick();
  };
  const PIPS: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
  };
  const showPips = faces === 6 && value !== null && PIPS[value];
  return (
    <GamiToolShell title="Dado" subtitle="A sorte está lançada" icon={Dices} theme="slate" onClose={onClose}>
      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        <motion.div
          animate={rolling ? { rotate: [0, 360], scale: 0.92 } : { rotate: 0, scale: 1 }}
          transition={rolling ? { duration: 0.55, repeat: Infinity, ease: 'linear' } : { type: 'spring', stiffness: 320, damping: 16 }}
          className="w-52 h-52 bg-gradient-to-br from-white to-gray-200 rounded-[2.5rem] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] flex items-center justify-center"
        >
          {showPips ? (
            <div className="grid grid-cols-3 grid-rows-3 w-32 h-32">
              {Array.from({ length: 9 }).map((_, i) => {
                const r = Math.floor(i / 3), c = i % 3;
                const on = (PIPS[value!] || []).some(([pr, pc]) => pr === r && pc === c);
                return <div key={i} className="flex items-center justify-center">{on && <span className="w-6 h-6 rounded-full bg-gray-900 shadow-inner" />}</div>;
              })}
            </div>
          ) : (
            <span className="text-8xl font-black text-gray-900 tabular-nums">{value ?? '?'}</span>
          )}
        </motion.div>
        <div className="flex gap-2">
          {[6, 10, 20].map(f => (
            <button key={f} onClick={() => { setFaces(f); setValue(null); }} className={`px-5 py-2.5 rounded-2xl font-bold border transition-colors ${faces === f ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 border-indigo-300/40 text-white shadow-lg shadow-indigo-950/50' : 'bg-white/[0.06] border-white/10 text-white/60'}`}>D{f}</button>
          ))}
        </div>
      </div>
      <button onClick={roll} disabled={rolling} className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 text-white font-black py-4 rounded-2xl text-lg disabled:opacity-60 shadow-lg shadow-indigo-950/60">
        {rolling ? 'Rolando…' : 'Rolar dado'}
      </button>
    </GamiToolShell>
  );
};

const GamiPlacar = ({ teams, onClose }: { teams: GamiTeam[]; onClose: () => void }) => {
  const initial = (teams.length >= 2 ? teams.slice(0, 4).map(t => `${t.emoji} ${t.name}`) : ['Time A', 'Time B']);
  const [names, setNames] = useState<string[]>(initial);
  const [scores, setScores] = useState<number[]>(initial.map(() => 0));
  const gradients = ['from-indigo-500 to-indigo-700', 'from-rose-500 to-rose-700', 'from-emerald-500 to-emerald-700', 'from-amber-500 to-orange-600'];
  const maxScore = Math.max(...scores);
  return (
    <GamiToolShell title="Placar Rápido" subtitle="Quem está na frente?" icon={Trophy} theme="amber" onClose={onClose}>
      <div className="flex-1 grid gap-3 content-center grid-cols-2">
        {names.map((n, i) => {
          const leader = maxScore > 0 && scores[i] === maxScore;
          return (
            <div key={i} className={`relative bg-gradient-to-br ${gradients[i % gradients.length]} rounded-[2rem] p-5 flex flex-col items-center justify-center gap-3 shadow-xl transition-all ${leader ? 'ring-2 ring-white/60 scale-[1.02]' : ''}`}>
              {leader && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-amber-400 border-2 border-white/70 flex items-center justify-center shadow-lg">
                  <Crown size={15} className="text-amber-900" />
                </span>
              )}
              <input
                value={n}
                onChange={e => setNames(p => p.map((x, j) => j === i ? e.target.value : x))}
                aria-label={`Nome do time ${i + 1}`}
                className="bg-transparent text-white font-black text-center text-sm w-full focus:outline-none placeholder-white/50"
              />
              <motion.p key={scores[i]} initial={{ scale: 1.3 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }} className="text-white font-black tabular-nums" style={{ fontSize: 'min(16vw, 5.5rem)', lineHeight: 1 }}>{scores[i]}</motion.p>
              <div className="flex gap-2">
                <button onClick={() => setScores(p => p.map((s, j) => j === i ? Math.max(0, s - 1) : s))} className="w-11 h-11 bg-black/25 text-white rounded-full flex items-center justify-center active:scale-90 transition-transform"><Minus size={18} /></button>
                <button onClick={() => setScores(p => p.map((s, j) => j === i ? s + 1 : s))} className="w-11 h-11 bg-white/30 text-white rounded-full flex items-center justify-center active:scale-90 transition-transform"><Plus size={18} /></button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 mt-4">
        {names.length < 4 && (
          <button onClick={() => { setNames(p => [...p, `Time ${String.fromCharCode(65 + p.length)}`]); setScores(p => [...p, 0]); }} className="flex-1 bg-white/[0.08] border border-white/10 text-white font-bold py-3 rounded-2xl">+ Time</button>
        )}
        {names.length > 2 && (
          <button onClick={() => { setNames(p => p.slice(0, -1)); setScores(p => p.slice(0, -1)); }} className="flex-1 bg-white/[0.08] border border-white/10 text-white font-bold py-3 rounded-2xl">− Time</button>
        )}
        <button onClick={() => setScores(p => p.map(() => 0))} className="flex-1 bg-white/[0.08] border border-white/10 text-white font-bold py-3 rounded-2xl">Zerar</button>
      </div>
    </GamiToolShell>
  );
};

type GamiBattleQ = { q: string; options: string[]; correct: number };

const GamiBatalha = ({ teams, students, subject, level, onClose, onAwardTeam, isAdmin }: {
  teams: GamiTeam[];
  students: GamiStudent[];
  subject: string;
  level: string;
  onClose: () => void;
  onAwardTeam: (teamIdx: number, names: string[], points: number) => void;
  isAdmin?: boolean;
}) => {
  const TEAM_MAX = 40, HIT = 10, WRONG_HIT = 9, FURY_BONUS = 2;
  const CRIT_BONUS = 4, CRIT_TIME_MS = 3000, HEAL_AMOUNT = 5, HEAL_STREAK = 3, LOW_HP = 10;
  type Pose = 'idle' | 'attack' | 'hit' | 'faint' | 'cast' | 'crit' | 'thinking' | 'wrong-cast' | 'heal' | 'victory';
  const hasRealTeams = teams.length >= 2;
  const [pick, setPick] = useState<number[]>([0, 1]);
  const fighters = useMemo(() => hasRealTeams
    ? pick.map(i => ({ name: teams[i]?.name ?? '?', emoji: teams[i]?.emoji ?? '⚔️', color: teams[i]?.color ?? '#6366f1' }))
    : [{ name: 'Time Azul', emoji: '🔵', color: '#3b82f6' }, { name: 'Time Vermelho', emoji: '🔴', color: '#ef4444' }],
  [hasRealTeams, pick, teams]);

  const [phase, setPhase] = useState<'setup' | 'loading' | 'intro' | 'question' | 'anim' | 'end'>('setup');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState('média');
  const [error, setError] = useState('');
  const [hp, setHp] = useState<[number, number]>([TEAM_MAX, TEAM_MAX]);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [qNum, setQNum] = useState(0);
  const [current, setCurrent] = useState<GamiBattleQ | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [winner, setWinner] = useState<0 | 1 | null>(null);
  const [poses, setPoses] = useState<Pose[]>(['idle', 'idle']);
  const [smoke, setSmoke] = useState<{ side: 0 | 1; key: number } | null>(null);
  const [proj, setProj] = useState<{ from: 0 | 1; key: number; crit?: boolean; fury?: boolean } | null>(null);
  const [ring, setRing] = useState<{ side: 0 | 1; key: number; color: string; crit?: boolean } | null>(null);
  const [pops, setPops] = useState<{ id: number; side: 0 | 1; val: number; color: string; heal?: boolean }[]>([]);
  const [awarded, setAwarded] = useState(false);

  // Tremor de tela + flash branco no impacto crítico: manipulação direta de
  // classe CSS (via ref) em vez de estado, pra reiniciar a animação mesmo em
  // críticos consecutivos sem esperar um re-render.
  const arenaRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const triggerCritFx = () => {
    const arena = arenaRef.current, flash = flashRef.current;
    if (arena) { arena.classList.remove('gami-crit-shake'); void arena.offsetWidth; arena.classList.add('gami-crit-shake'); }
    if (flash) { flash.classList.remove('gami-crit-flash'); void flash.offsetWidth; flash.classList.add('gami-crit-flash'); }
  };

  // Flash branco no próprio sprite ao tomar dano — mesma técnica (classList
  // via ref, não estado) pra funcionar em impactos seguidos.
  const spriteImgRefs = useRef<[HTMLImageElement | null, HTMLImageElement | null]>([null, null]);
  const triggerHitFlash = (side: 0 | 1) => {
    const el = spriteImgRefs.current[side];
    if (el) { el.classList.remove('gami-hit-flash'); void el.offsetWidth; el.classList.add('gami-hit-flash'); }
  };

  const questionsRef = useRef<GamiBattleQ[]>([]);
  const bagRef = useRef<GamiBattleQ[]>([]);
  const lastQRef = useRef('');
  const fxKey = useRef(0);
  const qShownAt = useRef(0);
  const streak = useRef<[number, number]>([0, 0]);
  const awaiting = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const after = (ms: number, fn: () => void) => { const id = setTimeout(fn, ms); timers.current.push(id); return id; };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // Timer pendente do gatilho de 'thinking' — cancelado sempre que uma nova
  // pergunta começa, pra um turno atrasado não deixar o OUTRO lado (que já
  // não está mais respondendo) marcado como confuso quando o timer antigo
  // finalmente dispara.
  const thinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ANCHORS = [{ x: 24, y: 66 }, { x: 76, y: 30 }];

  // Sprites reais por cor de time (fallback: emoji). Ciclam enquanto o lado
  // estiver 'idle': respiração normal, "cansado" (ofegante) quando o HP está
  // baixo, "confuso" (coçando a cabeça) durante thinking, "derrotado"
  // (caído, olhos em X) durante faint, "magia falhando" (orbe piscando e
  // fumaçando) durante wrong-cast, "curando" (olhos de coração) durante
  // heal, "carregando poder" durante cast, ou o golpe (normal/crítico)
  // durante attack/crit. 'hit' toca os quadros uma vez só (sem loop) e
  // congela no último.
  const TEAM_SPRITES: Record<string, { idle: string[]; tired?: string[]; thinking?: string[]; faint?: string[]; wrongCast?: string[]; heal?: string[]; cast?: string[]; attack?: string[]; crit?: string[]; hit?: string[]; victory?: string[] }> = {
    '#ef4444': {
      idle: [
        '/assets/battle/duck-red/idle-1.png',
        '/assets/battle/duck-red/idle-2.png',
        '/assets/battle/duck-red/idle-3.png',
        '/assets/battle/duck-red/idle-4.png',
        '/assets/battle/duck-red/idle-5.png',
      ],
      tired: [
        '/assets/battle/duck-red/tired-1.png',
        '/assets/battle/duck-red/tired-2.png',
      ],
      thinking: [
        '/assets/battle/duck-red/thinking-1.png',
        '/assets/battle/duck-red/thinking-2.png',
      ],
      faint: [
        '/assets/battle/duck-red/faint-1.png',
        '/assets/battle/duck-red/faint-2.png',
        '/assets/battle/duck-red/faint-3.png',
      ],
      wrongCast: [
        '/assets/battle/duck-red/wrong-cast-1.png',
        '/assets/battle/duck-red/wrong-cast-2.png',
        '/assets/battle/duck-red/wrong-cast-3.png',
      ],
      heal: [
        '/assets/battle/duck-red/heal-1.png',
        '/assets/battle/duck-red/heal-2.png',
        '/assets/battle/duck-red/heal-3.png',
      ],
      cast: [
        '/assets/battle/duck-red/cast-1.png',
        '/assets/battle/duck-red/cast-2.png',
        '/assets/battle/duck-red/cast-3.png',
        '/assets/battle/duck-red/cast-4.png',
        '/assets/battle/duck-red/cast-5.png',
        '/assets/battle/duck-red/cast-6.png',
        '/assets/battle/duck-red/cast-7.png',
        '/assets/battle/duck-red/cast-8.png',
      ],
      attack: [
        '/assets/battle/duck-red/attack-1.png',
        '/assets/battle/duck-red/attack-2.png',
      ],
      crit: [
        '/assets/battle/duck-red/crit-1.png',
        '/assets/battle/duck-red/crit-2.png',
        '/assets/battle/duck-red/crit-3.png',
      ],
      hit: [
        '/assets/battle/duck-red/hit-1.png',
        '/assets/battle/duck-red/hit-2.png',
        '/assets/battle/duck-red/hit-3.png',
      ],
      victory: [
        '/assets/battle/duck-red/victory-1.png',
        '/assets/battle/duck-red/victory-2.png',
      ],
    },
    // Mesma arte do pato vermelho sem o espelhamento (olha pra esquerda,
    // encarando o adversário a partir da ilha de cima) e com a túnica
    // recolorida de vermelho pra azul.
    '#3b82f6': {
      idle: [
        '/assets/battle/duck-blue/idle-1.png',
        '/assets/battle/duck-blue/idle-2.png',
        '/assets/battle/duck-blue/idle-3.png',
        '/assets/battle/duck-blue/idle-4.png',
        '/assets/battle/duck-blue/idle-5.png',
      ],
      tired: [
        '/assets/battle/duck-blue/tired-1.png',
        '/assets/battle/duck-blue/tired-2.png',
      ],
      thinking: [
        '/assets/battle/duck-blue/thinking-1.png',
        '/assets/battle/duck-blue/thinking-2.png',
      ],
      faint: [
        '/assets/battle/duck-blue/faint-1.png',
        '/assets/battle/duck-blue/faint-2.png',
        '/assets/battle/duck-blue/faint-3.png',
      ],
      wrongCast: [
        '/assets/battle/duck-blue/wrong-cast-1.png',
        '/assets/battle/duck-blue/wrong-cast-2.png',
        '/assets/battle/duck-blue/wrong-cast-3.png',
      ],
      heal: [
        '/assets/battle/duck-blue/heal-1.png',
        '/assets/battle/duck-blue/heal-2.png',
        '/assets/battle/duck-blue/heal-3.png',
      ],
      cast: [
        '/assets/battle/duck-blue/cast-1.png',
        '/assets/battle/duck-blue/cast-2.png',
        '/assets/battle/duck-blue/cast-3.png',
        '/assets/battle/duck-blue/cast-4.png',
        '/assets/battle/duck-blue/cast-5.png',
        '/assets/battle/duck-blue/cast-6.png',
        '/assets/battle/duck-blue/cast-7.png',
        '/assets/battle/duck-blue/cast-8.png',
      ],
      attack: [
        '/assets/battle/duck-blue/attack-1.png',
        '/assets/battle/duck-blue/attack-2.png',
      ],
      crit: [
        '/assets/battle/duck-blue/crit-1.png',
        '/assets/battle/duck-blue/crit-2.png',
        '/assets/battle/duck-blue/crit-3.png',
      ],
      hit: [
        '/assets/battle/duck-blue/hit-1.png',
        '/assets/battle/duck-blue/hit-2.png',
        '/assets/battle/duck-blue/hit-3.png',
      ],
      victory: [
        '/assets/battle/duck-blue/victory-1.png',
        '/assets/battle/duck-blue/victory-2.png',
      ],
    },
  };
  const ATTACK_POSES: Pose[] = ['cast', 'attack', 'crit'];
  const [breathFrame, setBreathFrame] = useState<[number, number]>([0, 0]);
  // Poses lidas via ref dentro do intervalo: a cadência de 220ms não
  // reinicia a cada troca de pose, e o intervalo nem existe fora da luta
  // (setup/loading/end não pagam por ele).
  const posesRef = useRef(poses);
  posesRef.current = poses;
  // 'end' incluso: a arena (e o vencedor respirando) continua visível
  // atrás do overlay translúcido de vitória.
  const battleRunning = phase === 'intro' || phase === 'question' || phase === 'anim' || phase === 'end';
  useEffect(() => {
    if (!battleRunning) return;
    const id = setInterval(() => {
      // Módulo alto (múltiplo de 2 e 5) — o índice real por conjunto de
      // quadros é calculado na renderização com `% frames.length`.
      const ps = posesRef.current;
      setBreathFrame(prev => prev.map((f, i) => (ps[i] === 'idle' || ps[i] === 'thinking' || ps[i] === 'faint' || ps[i] === 'wrong-cast' || ps[i] === 'heal' || ps[i] === 'victory' || ATTACK_POSES.includes(ps[i]) ? (f + 1) % 60 : f)) as [number, number]);
    }, 220);
    return () => clearInterval(id);
  }, [battleRunning]);

  // 'hit' não cicla como as outras poses: avança pelos quadros uma única
  // vez (sem voltar ao início) e para no último até a pose mudar.
  const HIT_FRAME_MS = 110; // +10% (respiração/breathFrame acima fica de fora, é o ciclo de respiração)
  const [hitFrame, setHitFrame] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    ([0, 1] as const).forEach(side => {
      if (poses[side] !== 'hit') return;
      setHitFrame(prev => { const next = [...prev] as [number, number]; next[side] = 0; return next; });
      const frameCount = TEAM_SPRITES[(fighters[side].color || '').toLowerCase()]?.hit?.length ?? 1;
      for (let f = 1; f < frameCount; f++) {
        timers.push(setTimeout(() => {
          setHitFrame(prev => { const next = [...prev] as [number, number]; next[side] = f; return next; });
        }, f * HIT_FRAME_MS));
      }
    });
    return () => timers.forEach(clearTimeout);
  }, [poses[0], poses[1]]);

  // 'cast' toca o loop de 8 quadros de carregamento 2 vezes inteiras antes
  // do ataque sair (não o ciclo lento de respiração) — termina no quadro do
  // brilho máximo bem quando o projétil sai.
  const CAST_FRAME_MS = 88; // +10%
  const CAST_LOOPS = 2;
  const [castFrame, setCastFrame] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    ([0, 1] as const).forEach(side => {
      if (poses[side] !== 'cast') return;
      setCastFrame(prev => { const next = [...prev] as [number, number]; next[side] = 0; return next; });
      const frameCount = TEAM_SPRITES[(fighters[side].color || '').toLowerCase()]?.cast?.length ?? 1;
      const totalSteps = frameCount * CAST_LOOPS;
      for (let f = 1; f < totalSteps; f++) {
        timers.push(setTimeout(() => {
          setCastFrame(prev => { const next = [...prev] as [number, number]; next[side] = f % frameCount; return next; });
        }, f * CAST_FRAME_MS));
      }
    });
    return () => timers.forEach(clearTimeout);
  }, [poses[0], poses[1]]);

  const shuffleQ = (raw: GamiBattleQ): GamiBattleQ => {
    const order = shuffleArray(raw.options.map((_, i) => i));
    return { q: raw.q, options: order.map(i => raw.options[i]), correct: order.indexOf(raw.correct) };
  };

  const drawQuestion = () => {
    if (bagRef.current.length === 0) {
      bagRef.current = shuffleArray(questionsRef.current);
      if (bagRef.current.length > 1 && bagRef.current[0].q === lastQRef.current) bagRef.current.push(bagRef.current.shift()!);
    }
    const raw = bagRef.current.shift()!;
    lastQRef.current = raw.q;
    setCurrent(shuffleQ(raw));
    setQNum(n => n + 1);
  };

  const startBattle = () => {
    // Pré-carrega todos os quadros dos dois lutadores — sem isso a primeira
    // exibição de cada pose (crítico, hit...) pode piscar em branco enquanto
    // o PNG baixa, na primeira batalha antes do service worker cachear.
    fighters.forEach(f => {
      const set = TEAM_SPRITES[(f.color || '').toLowerCase()];
      if (set) Object.values(set).forEach(frames => frames.forEach(src => { const img = new Image(); img.src = src; }));
    });
    // Cancela a coreografia pendente da luta anterior (Revanche no meio de uma animação).
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setHp([TEAM_MAX, TEAM_MAX]); setPoses(['idle', 'idle']); setWinner(null); setAwarded(false);
    setSelected(null); setQNum(0); setTurn(0); setProj(null); setRing(null); setPops([]);
    bagRef.current = [];
    streak.current = [0, 0]; awaiting.current = false; setSmoke(null);
    setPhase('intro');
    after(2600, () => { drawQuestion(); setPhase('question'); beginQuestionTimers(0); });
  };

  const generate = async () => {
    if (!topic.trim()) { setError('Informe o tema da batalha.'); return; }
    if (hasRealTeams && pick.length !== 2) { setError('Escolha exatamente 2 equipes para a batalha.'); return; }
    setError(''); setPhase('loading');
    try {
      const prompt = `Gere ${count} perguntas de múltipla escolha sobre "${topic}" (disciplina: ${subject || 'geral'}, nível: ${level}), dificuldade ${difficulty}.
Cada pergunta: enunciado curto (máximo 110 caracteres), 4 alternativas curtas (máximo 38 caracteres cada), apenas UMA correta.
Varie os tipos: definição, complete a frase, verdadeiro ou falso disfarçado, qual é, quem foi.
Retorne APENAS JSON válido: {"questions":[{"q":"pergunta","options":["alt A","alt B","alt C","alt D"],"correct":0}]}
onde "correct" é o índice (0 a 3) da alternativa correta.`;
      const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt });
      const raw = (response.text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(raw);
      const valid = (parsed.questions || []).filter((x: any) => x?.q && Array.isArray(x.options) && x.options.length === 4 && typeof x.correct === 'number' && x.correct >= 0 && x.correct <= 3);
      if (!valid.length) throw new Error('sem perguntas');
      questionsRef.current = valid;
      startBattle();
    } catch {
      setError('Não consegui gerar as perguntas. Tente novamente.');
      setPhase('setup');
    }
  };

  // Atalho só para admin: pula a chamada de IA com perguntas fixas, pra
  // testar a coreografia da luta (poses, dano, fúria...) sem gastar tempo/tokens.
  const DEV_QUESTIONS: GamiBattleQ[] = [
    { q: '[TESTE] Pergunta 1 — escolha a alternativa B', options: ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D'], correct: 1 },
    { q: '[TESTE] Pergunta 2 — escolha a alternativa A', options: ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D'], correct: 0 },
    { q: '[TESTE] Pergunta 3 — escolha a alternativa D', options: ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D'], correct: 3 },
    { q: '[TESTE] Pergunta 4 — escolha a alternativa C', options: ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D'], correct: 2 },
    { q: '[TESTE] Pergunta 5 — escolha a alternativa B', options: ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D'], correct: 1 },
    { q: '[TESTE] Pergunta 6 — escolha a alternativa A', options: ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D'], correct: 0 },
  ];
  const startDevTest = () => {
    if (hasRealTeams && pick.length !== 2) { setError('Escolha exatamente 2 equipes para a batalha.'); return; }
    setError('');
    questionsRef.current = DEV_QUESTIONS;
    startBattle();
  };

  const setPose = (side: 0 | 1, p: Pose) =>
    setPoses(prev => prev.map((v, i) => i === side ? p : v) as Pose[]);

  // Cronômetro da pergunta + pose 'thinking' após 8s sem responder
  const beginQuestionTimers = (t: 0 | 1) => {
    qShownAt.current = performance.now();
    awaiting.current = true;
    if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current);
    thinkTimerRef.current = after(8000, () => { if (awaiting.current) setPose(t, 'thinking'); });
  };

  const impact = (target: 0 | 1, dmg: number, color: string, crit = false) => {
    setProj(null);
    setRing({ side: target, key: ++fxKey.current, color, crit });
    const id = ++fxKey.current;
    setPops(p => [...p, { id, side: target, val: dmg, color }]);
    after(900, () => setPops(p => p.filter(x => x.id !== id)));
    setPose(target, 'hit');
    setHp(h => h.map((v, i) => i === target ? Math.max(0, v - dmg) : v) as [number, number]);
    playImpactThud(crit);
    triggerHitFlash(target);
    if (crit) triggerCritFx();
  };

  const finish = (win: 0 | 1, faint: 0 | 1) => {
    setPose(faint, 'faint');
    setPose(win, 'victory'); // vencedor comemora (acenando, cajado erguido)
    setMsg(`${fighters[faint].name} não aguenta mais!`);
    // Segura ~6s comemorando na arena antes da tela de vitória cobrir tudo.
    // O derrotado fica parado ~3,3s e some (fade da poseAnim 'faint'),
    // enquanto o vencedor segue comemorando o resto do tempo.
    after(6000, () => { setWinner(win); setPhase('end'); playChime(true); });
  };

  const nextTurn = (prev: 0 | 1) => {
    const nt = (1 - prev) as 0 | 1;
    setTurn(nt);
    setSelected(null);
    // Ambos os lados voltam pra idle — sem isso a pose 'heal' (olhos de
    // coração) de quem curou ficava presa durante todo o turno do adversário.
    setPoses(['idle', 'idle']);
    drawQuestion();
    setPhase('question');
    beginQuestionTimers(nt);
  };

  const healPop = (side: 0 | 1) => {
    const id = ++fxKey.current;
    setPops(pp => [...pp, { id, side, val: HEAL_AMOUNT, color: '#22c55e', heal: true }]);
    after(900, () => setPops(pp => pp.filter(x => x.id !== id)));
    setRing({ side, key: ++fxKey.current, color: '#22c55e' });
    setPose(side, 'heal');
    setHp(h => h.map((v, i) => i === side ? Math.min(TEAM_MAX, v + HEAL_AMOUNT) : v) as [number, number]);
    playHealChime();
  };

  const answer = (i: number) => {
    if (phase !== 'question' || !current) return;
    awaiting.current = false;
    const elapsed = performance.now() - qShownAt.current;
    setSelected(i);
    setPhase('anim');
    const other = (1 - turn) as 0 | 1;
    if (i === current.correct) {
      playChime(true);
      const fury = hp[turn] <= TEAM_MAX / 2;
      const crit = elapsed < CRIT_TIME_MS;
      const dmg = HIT + (fury ? FURY_BONUS : 0) + (crit ? CRIT_BONUS : 0);
      const newHp = Math.max(0, hp[other] - dmg);
      // Sequência de acertos → cura ao atingir HEAL_STREAK
      streak.current[turn] += 1;
      const willHeal = streak.current[turn] >= HEAL_STREAK && hp[turn] > 0;
      if (willHeal) streak.current[turn] = 0;
      setMsg(`${crit ? 'CRÍTICO! ' : 'Resposta certa! '}${fighters[turn].name} ${crit ? 'acerta em cheio' : 'lança um ataque' + (fury ? ' furioso' : '')}!`);
      setPose(turn, 'cast'); // carregando mágica: o loop de quadros toca CAST_LOOPS vezes inteiras antes do projétil sair
      // Janela do windup derivada do nº real de quadros do set — se a arte
      // mudar de tamanho, o disparo continua sincronizado com o fim do loop.
      const castLen = TEAM_SPRITES[(fighters[turn].color || '').toLowerCase()]?.cast?.length ?? 8;
      const loopMs = castLen * CAST_FRAME_MS;
      const tAttack = CAST_LOOPS * loopMs + 45;
      playWhoosh();
      for (let l = 1; l < CAST_LOOPS; l++) after(l * loopMs, playWhoosh); // um sopro por volta do loop
      after(tAttack, () => { setPose(turn, crit ? 'crit' : 'attack'); setProj({ from: turn, key: ++fxKey.current, crit, fury }); });
      after(tAttack + 550, () => { setPose(turn, 'idle'); impact(other, dmg, fighters[turn].color, crit); });
      if (willHeal) after(tAttack + 935, () => healPop(turn));
      if (newHp <= 0) {
        after(tAttack + 1430, () => finish(turn, other));
      } else {
        after(tAttack + 1540, () => setPose(other, 'idle'));
        after(tAttack + 1760, () => nextTurn(turn));
      }
    } else {
      playChime(false);
      streak.current[turn] = 0;
      const fury = hp[other] <= TEAM_MAX / 2;
      const dmg = WRONG_HIT + (fury ? FURY_BONUS : 0);
      const newHp = Math.max(0, hp[turn] - dmg);
      setMsg(`Errou! A certa era "${current.options[current.correct]}". ${fighters[other].name} contra-ataca${fury ? ' com fúria' : ''}!`);
      // magia falhando: fumacinha + susto antes do contra-ataque
      setPose(turn, 'wrong-cast');
      setSmoke({ side: turn, key: ++fxKey.current });
      after(1045, () => setSmoke(null)); // +10%
      after(1815, () => { setPose(other, 'attack'); setProj({ from: other, key: ++fxKey.current, fury }); });
      after(2365, () => { setPose(other, 'idle'); impact(turn, dmg, fighters[other].color); });
      if (newHp <= 0) {
        after(3080, () => finish(other, turn));
      } else {
        after(3080, () => setPose(turn, 'idle'));
        after(3300, () => nextTurn(turn));
      }
    }
  };

  // Durações +10% em toda pose de ação (menos a respiração de idle/tired
  // no final da cadeia — essa fica no ritmo original de propósito).
  const poseAnim = (p: string, side: 0 | 1, low = false): any =>
    p === 'attack' ? { x: side === 0 ? 26 : -26, y: side === 0 ? -14 : 14, scale: 1, opacity: 1, rotate: 0, transition: { duration: 0.22 } }
    : p === 'crit' ? { x: side === 0 ? 44 : -44, y: side === 0 ? -24 : 24, scale: 1.12, opacity: 1, rotate: 0, transition: { duration: 0.2 } }
    : p === 'cast' ? { x: 0, y: [0, -4, -2, 0], scale: [1, 1.07, 1.04, 1], opacity: 1, rotate: 0, transition: { duration: 0.55, repeat: Infinity } }
    : p === 'hit' ? { x: [0, -10, 10, -7, 7, 0], y: 0, scale: 1, opacity: 1, rotate: 0, transition: { duration: 0.55 } }
    : p === 'wrong-cast' ? { x: side === 0 ? -14 : 14, y: 6, scale: 0.94, opacity: 1, rotate: 0, transition: { duration: 0.44 } }
    : p === 'heal' ? { x: 0, y: [0, -16, 0], scale: [1, 1.12, 1], opacity: 1, rotate: 0, transition: { duration: 0.66 } }
    : p === 'thinking' ? { x: 0, y: [0, -5, 0], scale: 1, opacity: 1, rotate: [0, -4, 4, 0], transition: { y: { duration: 1.76, repeat: Infinity }, rotate: { duration: 2.2, repeat: Infinity } } }
    // Vencedor: pulinhos alegres de comemoração, em loop.
    : p === 'victory' ? { x: 0, y: [0, -18, 0], scale: [1, 1.05, 1], opacity: 1, rotate: 0, transition: { duration: 0.7, repeat: Infinity, ease: 'easeOut' } }
    // Fica parado no lugar (a arte do sprite já mostra o pato caído) e só
    // desaparece perto do fim da espera de 4s do finish(), pouco antes da
    // tela de vitória cobrir tudo — sem tombar nem escorregar pra fora.
    : p === 'faint' ? { x: 0, y: 0, opacity: 0, scale: 1, rotate: 0, transition: { opacity: { delay: 3.3, duration: 0.5 } } }
    : low ? { x: [0, -2, 2, -1, 0], y: [0, -3, 0], scale: 1, opacity: 1, rotate: 0, transition: { x: { duration: 0.4, repeat: Infinity }, y: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } } }
    : { x: 0, y: [0, -7, 0], scale: 1, opacity: 1, rotate: 0, transition: { y: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }, x: { duration: 0.2 } } };

  const hpColor = (v: number) => v / TEAM_MAX > 0.5 ? '#4ade80' : v / TEAM_MAX > 0.25 ? '#facc15' : '#ef4444';

  // Clareia uma cor hex misturando com branco (amt 0..1). Usado no projétil
  // crítico: em vez de dourado fixo, um tom mais claro da própria cor do
  // time — o golpe do time azul sai azul, o do vermelho sai vermelho, e o
  // crítico ainda se destaca por ser mais brilhante (além do giro/faíscas).
  const lightenHex = (hex: string, amt: number) => {
    const n = parseInt(hex.replace('#', ''), 16);
    if (Number.isNaN(n)) return hex;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const L = (c: number) => Math.round(c + (255 - c) * amt);
    return `#${((L(r) << 16) | (L(g) << 8) | L(b)).toString(16).padStart(6, '0')}`;
  };
  // Cor do projétil/rastro de um lado: cor do time; no crítico, versão
  // clareada da mesma cor (não mais dourado). Fúria mantém a cor base — o
  // tremor já a distingue.
  const projColor = (p: { from: 0 | 1; crit?: boolean }) =>
    p.crit ? lightenHex(fighters[p.from].color, 0.5) : fighters[p.from].color;
  const winnerIds = winner !== null && hasRealTeams
    ? students.filter(s => s.teamId === teams[pick[winner]]?.id).map(s => s.id)
    : [];
  const inBattle = phase === 'intro' || phase === 'question' || phase === 'anim';

  const HpBox = ({ side, corner }: { side: 0 | 1; corner: string }) => (
    <div className={`absolute ${corner} w-[46%] bg-[#f8f0dc] rounded-xl border-2 border-[#5a4a3a] px-2.5 py-1.5 z-10 shadow-[inset_0_-3px_0_rgba(0,0,0,0.12),0_3px_8px_rgba(0,0,0,0.4)]`}>
      <div className="flex items-center justify-between gap-1">
        <p className="font-pixel text-[#3a3020] text-[10px] truncate leading-tight">{fighters[side].emoji} {fighters[side].name}</p>
        {hp[side] <= TEAM_MAX / 2 && hp[side] > 0 && <span className="font-pixel text-[7px] text-red-600 animate-pulse shrink-0">FÚRIA +2</span>}
      </div>
      <div className="flex items-center gap-1 mt-1">
        <span className="font-pixel text-[7px] text-[#c8641e]">HP</span>
        <div className="flex-1 h-2 bg-[#4a3f30] rounded-full overflow-hidden border border-[#5a4a3a]">
          <div className="h-full rounded-full" style={{ width: `${(hp[side] / TEAM_MAX) * 100}%`, backgroundColor: hpColor(hp[side]), transition: 'width 0.45s ease, background-color 0.45s ease' }} />
        </div>
      </div>
      <p className="text-right font-pixel text-[9px] text-[#3a3020] tabular-nums mt-1">{hp[side]}/{TEAM_MAX}</p>
    </div>
  );

  if (phase === 'setup' || phase === 'loading') return (
    <GamiToolShell title="Batalha de Revisão" subtitle="Arena do conhecimento" icon={Swords} theme="crimson" onClose={onClose}>
      {phase === 'setup' && (
        <div className="space-y-4">
          <div className="bg-white/[0.06] border border-white/10 rounded-2xl p-4 backdrop-blur">
            <p className="text-sm text-white/75 leading-relaxed"><b className="text-white">Batalha em turnos:</b> a IA gera perguntas e cada equipe responde na sua vez. <b className="text-emerald-300">Acertou = ataque de {HIT}.</b> <b className="text-red-300">Errou = contra-ataque de {WRONG_HIT}.</b> <b className="text-amber-300">Resposta em até 3s = CRÍTICO (+{CRIT_BONUS})</b>. <b className="text-emerald-300">{HEAL_STREAK} acertos seguidos curam {HEAL_AMOUNT} HP</b>. Abaixo de metade do HP entra em <b className="text-amber-300">Fúria (+{FURY_BONUS})</b>. Vence quem zerar o HP do rival!</p>
          </div>
          {error && <p className="text-sm text-red-300 font-medium bg-red-500/15 border border-red-400/25 rounded-xl p-3">{error}</p>}
          <div>
            <label className="text-xs font-bold text-white/40 uppercase tracking-wider mb-1 block">Tema da revisão</label>
            <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Ex: Frações, Era Vargas, Sistema Solar…" className="w-full border border-white/10 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-rose-400/50 bg-white/[0.08] text-white placeholder-white/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider mb-1 block">Banco de perguntas</label>
              <div className="flex gap-1.5">
                {[6, 10, 14].map(n => (
                  <button key={n} onClick={() => setCount(n)} className={`flex-1 py-2.5 rounded-xl font-bold text-sm border transition-colors ${count === n ? 'bg-gradient-to-br from-rose-500 to-red-600 border-rose-300/40 text-white shadow-lg shadow-rose-950/50' : 'border-white/10 text-white/50 bg-white/[0.06]'}`}>{n}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider mb-1 block">Dificuldade</label>
              <select value={difficulty} onChange={e => setDifficulty(e.target.value)} className="w-full border border-white/10 rounded-xl px-3 py-2.5 text-sm bg-white/[0.08] text-white [&>option]:text-gray-900">
                <option value="fácil">Fácil</option>
                <option value="média">Média</option>
                <option value="difícil">Difícil</option>
              </select>
            </div>
          </div>
          <div className="bg-white/[0.06] rounded-2xl p-4 border border-white/10 backdrop-blur">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{hasRealTeams ? 'Escolha as 2 equipes da batalha' : 'Equipes da batalha'}</p>
            <div className="flex flex-wrap gap-2">
              {hasRealTeams ? teams.slice(0, 8).map((t, i) => {
                const on = pick.includes(i);
                return (
                  <button
                    key={t.id}
                    onClick={() => setPick(p => on ? p.filter(x => x !== i) : [...p, i].slice(-2))}
                    className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-all ${on ? 'text-white border-white/40 shadow-lg scale-105' : 'text-white/50 border-white/10 bg-white/[0.06]'}`}
                    style={on ? { backgroundColor: t.color } : undefined}
                  >{t.emoji} {t.name}</button>
                );
              }) : fighters.map((f, i) => (
                <span key={i} className="text-white text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: f.color }}>{f.emoji} {f.name}</span>
              ))}
            </div>
            {!hasRealTeams && <p className="text-[11px] text-white/35 mt-2">Dica: crie equipes na aba Equipes para usar os nomes reais e dar XP aos vencedores.</p>}
          </div>
          <button onClick={generate} className="w-full bg-gradient-to-r from-rose-500 to-red-600 text-white font-black py-4 rounded-2xl text-lg flex items-center justify-center gap-2 shadow-lg shadow-rose-950/60">
            <Swords size={20} /> Começar batalha
          </button>
          {isAdmin && (
            <button onClick={startDevTest} className="w-full bg-white/[0.08] border border-dashed border-white/25 text-white/70 font-bold py-2.5 rounded-2xl text-xs flex items-center justify-center gap-2">
              🧪 Teste rápido (dev) — pula a IA, perguntas fixas
            </button>
          )}
        </div>
      )}
      {phase === 'loading' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 size={40} className="animate-spin text-rose-400" />
          <p className="text-sm font-bold text-white/60">Preparando as perguntas da batalha…</p>
        </div>
      )}
    </GamiToolShell>
  );

  // Tema retrô (GBA) da batalha: arena verde-campo, painel azul profundo e
  // caixas creme — paleta própria, deliberadamente distinta do modo palco.
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[130] flex flex-col font-vt">
      {/* Deslocamento = tamanho do tile (48px) → loop sem emenda/corte nas listras.
          gami-crit-shake/gami-crit-flash são disparadas via classList (não estado),
          pra reiniciar mesmo em críticos consecutivos sem esperar re-render. */}
      <style>{`
        @keyframes gami-battle-stripes { from { background-position: 0 0; } to { background-position: 48px 48px; } }
        @keyframes gami-crit-shake-kf { 0%, 100% { transform: translate(0, 0); } 15% { transform: translate(-10px, 3px); } 30% { transform: translate(9px, -3px); } 45% { transform: translate(-7px, 2px); } 60% { transform: translate(6px, -2px); } 75% { transform: translate(-3px, 1px); } 90% { transform: translate(2px, 0); } }
        .gami-crit-shake { animation: gami-crit-shake-kf 0.44s ease-out; }
        @keyframes gami-crit-flash-kf { 0% { opacity: 0; } 12% { opacity: 0.7; } 100% { opacity: 0; } }
        .gami-crit-flash { animation: gami-crit-flash-kf 0.39s ease-out; }
        @keyframes gami-proj-tremor-kf { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(1.5px, -1.5px); } 50% { transform: translate(-1.5px, 1.5px); } 75% { transform: translate(1.5px, 1px); } }
        .gami-proj-tremor { animation: gami-proj-tremor-kf 0.1s linear infinite; }
        @keyframes gami-glitch-kf {
          0%, 60%, 90%, 100% { filter: drop-shadow(0 6px 8px rgba(0,0,0,0.4)); transform: translate(0, 0); }
          15%, 75% { filter: drop-shadow(-3px 0 #ef4444cc) drop-shadow(3px 0 #38bdf8cc) drop-shadow(0 6px 8px rgba(0,0,0,0.4)); transform: translate(-1px, 0); }
          30% { filter: drop-shadow(2px 0 #ef4444cc) drop-shadow(-2px 0 #38bdf8cc) drop-shadow(0 6px 8px rgba(0,0,0,0.4)); transform: translate(1px, 0); }
          45% { filter: drop-shadow(-2px 0 #ef4444cc) drop-shadow(2px 0 #38bdf8cc) drop-shadow(0 6px 8px rgba(0,0,0,0.4)); transform: translate(0, -1px); }
        }
        .gami-glitch { animation: gami-glitch-kf 1.21s steps(1) infinite; }
        @keyframes gami-hit-flash-kf { 0%, 100% { filter: brightness(1) drop-shadow(0 6px 8px rgba(0,0,0,0.4)); } 25% { filter: brightness(2.6) saturate(0.25) drop-shadow(0 6px 8px rgba(0,0,0,0.4)); } }
        /* Definida DEPOIS de .gami-glitch de propósito: se as duas classes
           coexistirem por um frame (impacto em quem estava em wrong-cast),
           o flash de dano vence a disputa pela propriedade animation. */
        .gami-hit-flash { animation: gami-hit-flash-kf 0.31s ease-out; }
        @keyframes gami-tilt-kf { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-4deg); } }
        .gami-tilt { animation: gami-tilt-kf 1.21s ease-in-out infinite; transform-origin: 50% 90%; }
      `}</style>
      {/* ── Arena (tela cheia, clara) ── */}
      <div ref={arenaRef} className="relative flex-1 overflow-hidden" style={{ background: 'linear-gradient(180deg, #9fe3da 0%, #86d6be 16%, #7fd39a 30%, #77c96f 44%, #93d268 58%, #aadd6f 72%, #c3e57c 86%, #b0da6a 100%)' }}>
            <div className="absolute inset-0 pointer-events-none opacity-70" style={{ backgroundImage: 'repeating-linear-gradient(180deg, rgba(255,255,255,0.10) 0 26px, rgba(0,0,0,0.04) 26px 52px)' }} />
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.13) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.13) 50%, rgba(255,255,255,0.13) 75%, transparent 75%, transparent 100%)', backgroundSize: '48px 48px', animation: 'gami-battle-stripes 3s linear infinite' }} />
            <div ref={flashRef} className="absolute inset-0 pointer-events-none z-50 bg-white opacity-0" />
            <button onClick={onClose} className="absolute top-4 right-4 z-40 flex items-center gap-1.5 bg-[#1e3a2a]/85 text-emerald-100 border-2 border-emerald-100/30 rounded-lg px-3 py-1.5 text-[11px] font-black tracking-widest active:scale-95 transition-transform">
              <X size={13} /> <span className="font-pixel text-[9px]">SAIR</span>
            </button>
            {HpBox({ side: 1, corner: 'top-4 left-4' })}
            {HpBox({ side: 0, corner: 'bottom-4 right-4' })}
            {/* lutadores em ilhas flutuantes */}
            {([1, 0] as const).map(side => (
              <div key={side} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${ANCHORS[side].x}%`, top: `${ANCHORS[side].y}%` }}>
                <motion.div
                  initial={{ x: side === 0 ? -140 : 140, opacity: 0 }}
                  animate={poseAnim(poses[side], side, hp[side] > 0 && hp[side] <= LOW_HP)}
                  className="relative flex flex-col items-center"
                >
                  {/* aura de carregamento (cast/crit) e halo de cura (heal, em verde) */}
                  {(poses[side] === 'cast' || poses[side] === 'crit' || poses[side] === 'heal') && (
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0.9 }} animate={{ scale: [0.6, 1.35, 0.9], opacity: [0.9, 0.35, 0.8] }} transition={{ duration: 0.55, repeat: Infinity }}
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0 w-24 h-24 sm:w-28 sm:h-28 rounded-full pointer-events-none"
                      style={{ boxShadow: `0 0 26px 10px ${poses[side] === 'heal' ? '#22c55e' : fighters[side].color}`, border: `2px solid ${poses[side] === 'heal' ? '#22c55e' : fighters[side].color}` }}
                    />
                  )}
                  {(() => {
                    const spriteSet = TEAM_SPRITES[(fighters[side].color || '').toLowerCase()];
                    const isLowHp = hp[side] > 0 && hp[side] <= LOW_HP;
                    const isAttacking = ATTACK_POSES.includes(poses[side]);
                    const activeFrames = spriteSet
                      ? (poses[side] === 'hit' && spriteSet.hit ? spriteSet.hit
                        : poses[side] === 'crit' && spriteSet.crit ? spriteSet.crit
                        : poses[side] === 'cast' && spriteSet.cast ? spriteSet.cast
                        : isAttacking && spriteSet.attack ? spriteSet.attack
                        : poses[side] === 'thinking' && spriteSet.thinking ? spriteSet.thinking
                        : poses[side] === 'faint' && spriteSet.faint ? spriteSet.faint
                        : poses[side] === 'wrong-cast' && spriteSet.wrongCast ? spriteSet.wrongCast
                        : poses[side] === 'heal' && spriteSet.heal ? spriteSet.heal
                        : poses[side] === 'victory' && spriteSet.victory ? spriteSet.victory
                        : poses[side] === 'idle' && isLowHp && spriteSet.tired ? spriteSet.tired
                        : spriteSet.idle)
                      : null;
                    const frameIdx = poses[side] === 'hit' && spriteSet?.hit
                      ? Math.min(hitFrame[side], activeFrames!.length - 1)
                      : poses[side] === 'cast' && spriteSet?.cast
                      ? Math.min(castFrame[side], activeFrames!.length - 1)
                      : breathFrame[side] % (activeFrames?.length || 1);
                    const glowSize = poses[side] === 'heal' ? 20 : poses[side] === 'cast' || poses[side] === 'crit' ? 26 : hp[side] <= TEAM_MAX / 2 ? 18 : 9;
                    const glowColor = poses[side] === 'heal' ? '#22c55e' : fighters[side].color;
                    return (
                      <div
                        className="relative z-10 w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center"
                        // Sprite real: sem disco de fundo nem brilho colorido — só a arte do
                        // personagem, sem decoração atrás.
                        style={activeFrames ? undefined : {
                              background: `radial-gradient(circle at 32% 28%, ${fighters[side].color}e8, ${fighters[side].color}55 62%, transparent 78%)`,
                              filter: `drop-shadow(0 0 ${glowSize + (poses[side] === 'heal' ? 6 : 4)}px ${glowColor}99)`,
                            }}
                      >
                        {activeFrames ? (
                          <img
                            ref={el => { spriteImgRefs.current[side] = el; }}
                            src={activeFrames[frameIdx]}
                            alt={fighters[side].name}
                            draggable={false}
                            className={`h-[250px] w-auto max-w-none object-contain select-none drop-shadow-[0_6px_8px_rgba(0,0,0,0.4)]${poses[side] === 'wrong-cast' ? ' gami-glitch' : ''}${poses[side] === 'thinking' ? ' gami-tilt' : ''}`}
                          />
                        ) : (
                          <span className="text-4xl sm:text-5xl drop-shadow-[0_4px_6px_rgba(0,0,0,0.35)]">{fighters[side].emoji}</span>
                        )}
                    {poses[side] === 'thinking' ? (
                      <motion.span
                        initial={{ scale: 0, y: 4 }} animate={{ scale: 1, y: 0 }}
                        className="absolute -top-4 -right-1 w-6 h-6 rounded-full bg-white border-2 border-[#5a4a3a] flex items-center justify-center font-pixel text-[9px] text-[#3a3020] shadow"
                      >?</motion.span>
                    ) : phase !== 'intro' && turn === side && winner === null && poses[side] !== 'faint' && (
                      <span className="absolute -bottom-28 sm:-bottom-24 left-1/2 -translate-x-1/2 font-pixel text-[7px] uppercase text-white bg-[#1e3a2a]/85 border border-white/30 px-2 py-1 rounded-full whitespace-nowrap">Sua vez</span>
                    )}
                      </div>
                    );
                  })()}
                </motion.div>
              </div>
            ))}
            {/* rastro de partículas atrás do projétil */}
            {proj && [3, 2, 1].map(i => (
              <motion.div
                key={`${proj.key}-trail-${i}`}
                initial={{ left: `${ANCHORS[proj.from].x}%`, top: `${ANCHORS[proj.from].y}%`, scale: 0.35, opacity: 0.55 }}
                animate={{ left: `${ANCHORS[1 - proj.from].x}%`, top: `${ANCHORS[1 - proj.from].y}%`, scale: 0.12, opacity: 0 }}
                transition={{ duration: 0.48, ease: 'easeIn', delay: i * 0.05 }}
                className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full pointer-events-none z-10"
                style={{ background: projColor(proj) }}
              />
            ))}
            {/* projétil: gira em voo (mais rápido no crítico) e tremula se for fúria */}
            {proj && (
              <motion.div
                key={proj.key}
                initial={{ left: `${ANCHORS[proj.from].x}%`, top: `${ANCHORS[proj.from].y}%`, scale: 0.4, opacity: 0.9, rotate: 0 }}
                animate={{ left: `${ANCHORS[1 - proj.from].x}%`, top: `${ANCHORS[1 - proj.from].y}%`, scale: 1.05, opacity: 1, rotate: proj.crit ? 720 : 360 }}
                transition={{ duration: 0.48, ease: 'easeIn' }}
                className="absolute w-6 h-6 -ml-3 -mt-3 pointer-events-none z-20"
              >
                <div
                  className={`absolute inset-0 rounded-full${proj.fury ? ' gami-proj-tremor' : ''}`}
                  style={{ background: `radial-gradient(circle, #fff 15%, ${projColor(proj)})`, boxShadow: `0 0 20px 7px ${projColor(proj)}aa` }}
                />
                <span className="absolute w-1.5 h-1.5 -ml-[3px] rounded-full bg-white/95" style={{ top: 1, left: '50%' }} />
                {proj.crit && <span className="absolute w-1.5 h-1.5 -ml-[3px] rounded-full bg-white/95" style={{ bottom: 1, left: '50%' }} />}
              </motion.div>
            )}
            {/* anel de impacto */}
            {ring && (
              <motion.div
                key={ring.key}
                initial={{ scale: 0.2, opacity: 0.95 }} animate={{ scale: 2.4, opacity: 0 }} transition={{ duration: 0.55 }}
                className="absolute w-16 h-16 -ml-8 -mt-8 rounded-full border-4 pointer-events-none z-30"
                style={{ left: `${ANCHORS[ring.side].x}%`, top: `${ANCHORS[ring.side].y}%`, borderColor: ring.color }}
              />
            )}
            {/* estilhaços do impacto crítico */}
            {ring && ring.crit && Array.from({ length: 6 }).map((_, i) => {
              const angle = (i / 6) * Math.PI * 2;
              return (
                <motion.div
                  key={`${ring.key}-frag-${i}`}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{ x: Math.cos(angle) * 46, y: Math.sin(angle) * 46, opacity: 0, scale: 0.3 }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                  className="absolute w-2 h-2 -ml-1 -mt-1 rounded-sm pointer-events-none z-30"
                  style={{ left: `${ANCHORS[ring.side].x}%`, top: `${ANCHORS[ring.side].y}%`, background: lightenHex(ring.color, 0.5) }}
                />
              );
            })}
            {/* fumaça da magia falhando (wrong-cast) */}
            {smoke && (
              <motion.div
                key={smoke.key}
                initial={{ scale: 0.4, opacity: 0.85, y: 0 }} animate={{ scale: 1.6, opacity: 0, y: -20 }} transition={{ duration: 0.94 }}
                className="absolute w-12 h-12 -ml-6 -mt-6 rounded-full pointer-events-none z-20"
                style={{ left: `${ANCHORS[smoke.side].x}%`, top: `${ANCHORS[smoke.side].y - 6}%`, background: 'radial-gradient(circle, rgba(60,60,60,0.9), rgba(40,40,40,0.2) 70%, transparent)' }}
              />
            )}
            {/* dano / cura flutuante */}
            {pops.map(p => (
              <motion.div
                key={p.id}
                initial={{ opacity: 1, y: 0, scale: 0.8 }} animate={{ opacity: 0, y: -48, scale: 1.15 }} transition={{ duration: 0.99 }}
                className="absolute font-black text-2xl pointer-events-none z-40 -translate-x-1/2"
                style={{ left: `${ANCHORS[p.side].x}%`, top: `${ANCHORS[p.side].y - 16}%`, color: p.color, textShadow: '0 2px 0 rgba(0,0,0,0.7), 0 0 14px rgba(0,0,0,0.5)' }}
              >{p.heal ? '+' : '−'}{p.val}</motion.div>
            ))}
            {/* intro VS — nome de cima (lutador da ilha de cima), VS no meio, nome de baixo.
                Faixas coloridas entram de lados opostos, o VS estampa com onda de choque + flash. */}
            {phase === 'intro' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="absolute inset-0 z-40 overflow-hidden bg-black/55">
                {/* faixa de cima — desliza da esquerda com a cor do time */}
                <motion.div
                  initial={{ x: '-110%' }} animate={{ x: 0 }} transition={{ type: 'spring', damping: 17, stiffness: 130 }}
                  className="absolute top-[16%] inset-x-0"
                >
                  <div className="py-4 text-center -skew-y-2" style={{ background: `linear-gradient(90deg, transparent 2%, ${fighters[1].color}e0 22%, ${fighters[1].color}e0 78%, transparent 98%)`, boxShadow: '0 5px 20px rgba(0,0,0,0.4)' }}>
                    <p className="font-pixel text-white text-[13px] leading-relaxed px-6" style={{ textShadow: '0 2px 0 rgba(0,0,0,0.6)' }}>{fighters[1].emoji} {fighters[1].name}</p>
                  </div>
                </motion.div>
                {/* faixa de baixo — desliza da direita */}
                <motion.div
                  initial={{ x: '110%' }} animate={{ x: 0 }} transition={{ type: 'spring', damping: 17, stiffness: 130 }}
                  className="absolute bottom-[16%] inset-x-0"
                >
                  <div className="py-4 text-center skew-y-2" style={{ background: `linear-gradient(90deg, transparent 2%, ${fighters[0].color}e0 22%, ${fighters[0].color}e0 78%, transparent 98%)`, boxShadow: '0 -5px 20px rgba(0,0,0,0.4)' }}>
                    <p className="font-pixel text-white text-[13px] leading-relaxed px-6" style={{ textShadow: '0 2px 0 rgba(0,0,0,0.6)' }}>{fighters[0].emoji} {fighters[0].name}</p>
                  </div>
                </motion.div>
                {/* flash branco no momento em que o VS estampa */}
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: [0, 0.55, 0] }} transition={{ delay: 0.5, duration: 0.4, times: [0, 0.25, 1] }}
                  className="absolute inset-0 bg-white pointer-events-none"
                />
                {/* onda de choque atrás do VS */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <motion.div
                    initial={{ scale: 0.2, opacity: 0 }} animate={{ scale: 2.8, opacity: [0.9, 0] }} transition={{ delay: 0.52, duration: 0.65, ease: 'easeOut' }}
                    className="w-28 h-28 rounded-full border-4 border-amber-300"
                  />
                </div>
                {/* VS gigante estampando com giro */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <motion.span
                    initial={{ scale: 4.5, opacity: 0, rotate: -20 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    transition={{ delay: 0.45, type: 'spring', damping: 12, stiffness: 220 }}
                    className="font-pixel text-5xl text-amber-400"
                    style={{ textShadow: '0 0 32px rgba(251,191,36,0.9), 0 5px 0 rgba(0,0,0,0.55)' }}
                  >VS</motion.span>
                </div>
                {/* faíscas saindo do impacto do VS */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  {Array.from({ length: 8 }).map((_, i) => {
                    const angle = (i / 8) * Math.PI * 2 + 0.4;
                    return (
                      <motion.span
                        key={i}
                        initial={{ x: 0, y: 0, opacity: 0, scale: 1 }}
                        animate={{ x: Math.cos(angle) * 90, y: Math.sin(angle) * 70, opacity: [0, 1, 0], scale: 0.2 }}
                        transition={{ delay: 0.55, duration: 0.7, ease: 'easeOut' }}
                        className="absolute w-2 h-2 rounded-full bg-amber-300"
                        style={{ boxShadow: '0 0 8px 2px rgba(251,191,36,0.8)' }}
                      />
                    );
                  })}
                </div>
              </motion.div>
            )}
            {/* ── Vitória ── */}
            {phase === 'end' && winner !== null && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 p-5">
                <ConfettiBurst />
                <div className="relative bg-[#f8f0dc] border-4 border-[#5a4a3a] rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl">
                  <div className="relative inline-flex mb-3">
                    <span className="w-20 h-20 rounded-full flex items-center justify-center text-4xl overflow-visible" style={{ background: `radial-gradient(circle at 32% 28%, ${fighters[winner].color}dd, ${fighters[winner].color}55 62%, transparent 78%)` }}>
                      {TEAM_SPRITES[(fighters[winner].color || '').toLowerCase()] ? (
                        <motion.img
                          animate={{ y: [0, -6, 0], rotate: [0, -3, 3, 0] }} transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
                          src={(TEAM_SPRITES[fighters[winner].color.toLowerCase()].victory ?? TEAM_SPRITES[fighters[winner].color.toLowerCase()].idle)[0]}
                          alt={fighters[winner].name} draggable={false} className="h-24 w-auto object-contain select-none drop-shadow-[0_4px_6px_rgba(0,0,0,0.4)]"
                        />
                      ) : fighters[winner].emoji}
                    </span>
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 border-2 border-white flex items-center justify-center shadow-lg">
                      <Crown size={15} className="text-amber-900" />
                    </span>
                  </div>
                  <h3 className="font-pixel text-xs text-[#3a3020] leading-relaxed">{fighters[winner].name} venceu a batalha!</h3>
                  <div className="space-y-1.5 mt-3">
                    {([winner, (1 - winner) as 0 | 1]).map((i, pos) => (
                      <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-xl border-2 ${pos === 0 ? 'bg-amber-100 border-amber-500/60' : 'bg-[#efe5cc] border-[#5a4a3a]/30'}`}>
                        <span className="font-bold text-[#3a3020] text-xs">{pos === 0 ? '🏆' : '💔'} {fighters[i].emoji} {fighters[i].name}</span>
                        <span className="font-pixel text-[#3a3020] text-[9px] tabular-nums">{hp[i]}/{TEAM_MAX} HP</span>
                      </div>
                    ))}
                  </div>
                  {hasRealTeams && !awarded && winnerIds.length > 0 && (
                    <button
                      onClick={() => { onAwardTeam(pick[winner], winnerIds, 3); setAwarded(true); }}
                      className="mt-4 w-full bg-gradient-to-r from-emerald-500 to-green-600 text-white font-bold py-3 rounded-xl border-2 border-emerald-700 shadow-[0_4px_0_rgba(0,0,0,0.2)]"
                    >⚡ Dar +3 XP à equipe vencedora</button>
                  )}
                  {hasRealTeams && !awarded && winnerIds.length === 0 && (
                    <p className="text-[11px] text-[#8a7a5a] font-bold mt-3">Vincule alunos a esta equipe na aba Equipes para premiar com XP.</p>
                  )}
                  {awarded && <p className="text-emerald-700 text-sm font-bold mt-3">XP entregue! ✓</p>}
                  <div className="flex justify-center gap-6 mt-4">
                    <button onClick={startBattle} className="font-pixel text-[#8a5a1a] text-[9px] flex items-center gap-1.5"><Swords size={13} />Revanche</button>
                    <button onClick={() => setPhase('setup')} className="font-pixel text-[#7a2a2a] text-[9px] flex items-center gap-1.5"><RotateCcw size={13} />Nova batalha</button>
                  </div>
                </div>
              </div>
            )}
          </div>
      {/* ── Painel inferior ── */}
      {inBattle && (
        <div className="bg-[#3d4a7d] border-t-4 border-[#2c3763] px-3 pt-3 pb-6 shrink-0">
          <div className="bg-[#f8f0dc] border-2 border-[#5a4a3a] rounded-xl px-5 py-3.5 min-h-[71px] flex items-center max-w-lg w-full mx-auto shadow-[inset_0_-3px_0_rgba(0,0,0,0.12)]">
            <p className="font-vt text-xl text-[#3a3020] leading-snug">
              {phase === 'intro' ? `${fighters[0].name} desafia ${fighters[1].name}! Que vença o conhecimento! ⚔️`
                : phase === 'anim' ? msg
                : current ? <>{current.q} <span className="block font-pixel text-[8px] uppercase text-[#8a7a5a] mt-2 leading-relaxed">Pergunta {qNum} · vez de {fighters[turn].emoji} {fighters[turn].name}</span></> : ''}
            </p>
          </div>
          {current && phase !== 'intro' && (
            <div className="grid grid-cols-2 gap-2.5 max-w-lg w-full mx-auto my-5">
              {current.options.map((opt, i) => {
                const palette = ['#e05252', '#f0a03c', '#5cb85c', '#5b8def'];
                const locked = phase === 'anim';
                const isCorrect = locked && i === current.correct;
                const isWrongPick = locked && selected === i && i !== current.correct;
                const dimmed = locked && !isCorrect && !isWrongPick;
                return (
                  <button
                    key={i}
                    onClick={() => answer(i)}
                    disabled={locked}
                    className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all active:translate-y-0.5 active:shadow-none border-2 border-black/25 shadow-[0_4px_0_rgba(0,0,0,0.35)] ${dimmed ? 'opacity-35 saturate-0' : ''} ${isCorrect ? 'ring-2 ring-white scale-[1.02]' : ''}`}
                    style={{ backgroundColor: isWrongPick ? '#7f1d1d' : palette[i] }}
                  >
                    <span className="w-6 h-6 shrink-0 rounded bg-black/20 flex items-center justify-center font-pixel text-[10px] text-white/90 leading-none">{['A', 'B', 'C', 'D'][i]}</span>
                    <p className="flex-1 font-vt text-lg text-white leading-tight">{opt}</p>
                    {isCorrect && <span className="shrink-0 text-white font-black">✓</span>}
                    {isWrongPick && <span className="shrink-0 text-white font-black">✗</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};

// ─── Kit do Professor (ferramentas de IA + diário de classe) ──────────────────
type FerramentaId = 'parecer' | 'inclusao' | 'rubrica' | 'nivelador' | 'familia' | 'video' | 'pdf';

interface DiarioEntry {
  id: string;            // `${classId}_${date}`
  classId: string;
  date: string;          // YYYY-MM-DD
  att: Record<string, 'P' | 'F' | 'A'>;
  note?: string;
  grades?: Record<string, string>;
}

const FERRAMENTAS_META: { id: FerramentaId; title: string; icon: any; color: string; bg: string; desc: string }[] = [
  { id: 'parecer',   title: 'Parecer Descritivo',     icon: GraduationCap,  color: 'text-indigo-600',  bg: 'bg-indigo-50 border-indigo-200',   desc: 'Comentários de boletim e pareceres individuais' },
  { id: 'inclusao',  title: 'Adaptação Inclusiva',    icon: Accessibility,  color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', desc: 'Adapte atividades para TEA, TDAH, dislexia e mais' },
  { id: 'rubrica',   title: 'Rubrica de Avaliação',   icon: ListChecks,     color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200',     desc: 'Critérios e níveis prontos para qualquer trabalho' },
  { id: 'nivelador', title: 'Nivelador de Texto',     icon: BookOpen,       color: 'text-blue-600',    bg: 'bg-blue-50 border-blue-200',       desc: 'Reescreva textos no nível de leitura da turma' },
  { id: 'familia',   title: 'Comunicação c/ Famílias', icon: HeartHandshake, color: 'text-rose-600',    bg: 'bg-rose-50 border-rose-200',       desc: 'Bilhetes, comunicados e mensagens de WhatsApp' },
  { id: 'video',     title: 'Material de Vídeo',      icon: Youtube,        color: 'text-red-600',     bg: 'bg-red-50 border-red-200',         desc: 'Transforme vídeos do YouTube em aula e atividades' },
  { id: 'pdf',       title: 'Material do meu PDF',    icon: FileUp,         color: 'text-violet-600',  bg: 'bg-violet-50 border-violet-200',   desc: 'Gere materiais a partir do seu livro ou apostila' },
];

// ── Impressão: Parecer Descritivo (papel timbrado sóbrio, com assinaturas) ──
const printParecer = (opts: { text: string; studentName: string; period: string; teacherName?: string; schoolName?: string; className?: string }) => {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast.error('O navegador bloqueou a janela de impressão. Permita pop-ups e tente de novo.'); return; }
  const today = new Date().toLocaleDateString('pt-BR');
  const body = escapeHtml(opts.text)
    .replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .split(/\n{2,}/)
    .map(p => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`)
    .join('');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Parecer Descritivo — ${escapeHtml(opts.studentName)}</title><style>
    @page { size: A4; margin: 2.2cm; }
    * { box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #111827; margin: 0; font-size: 12.5px; line-height: 1.75; }
    .letterhead { text-align: center; border-bottom: 1.5px solid #111827; padding-bottom: 10px; margin-bottom: 22px; }
    .school { font-size: 15px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
    .doc-title { text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 20px; }
    .meta { width: 100%; border-collapse: collapse; margin-bottom: 22px; font-size: 12px; }
    .meta td { padding: 4px 0; vertical-align: bottom; }
    .meta .lbl { font-weight: 700; white-space: nowrap; padding-right: 6px; width: 1%; }
    .meta .val { border-bottom: 1px solid #9ca3af; padding-left: 4px; }
    .body p { margin: 0 0 12px; text-align: justify; text-indent: 2em; }
    .sigs { display: flex; gap: 28px; margin-top: 70px; page-break-inside: avoid; }
    .sig { flex: 1; text-align: center; font-size: 11px; }
    .sig .line { border-top: 1px solid #111827; padding-top: 5px; }
  </style></head><body>
    <div class="letterhead"><div class="school">${escapeHtml(opts.schoolName || 'Escola')}</div></div>
    <h1 class="doc-title">Parecer Descritivo</h1>
    <table class="meta">
      <tr><td class="lbl">Aluno(a):</td><td class="val">${escapeHtml(opts.studentName)}</td><td class="lbl" style="padding-left:18px">Período:</td><td class="val" style="width:140px">${escapeHtml(opts.period)}</td></tr>
      <tr><td class="lbl">Professor(a):</td><td class="val">${escapeHtml(opts.teacherName || '')}</td><td class="lbl" style="padding-left:18px">Data:</td><td class="val" style="width:140px">${today}</td></tr>
      ${opts.className ? `<tr><td class="lbl">Turma:</td><td class="val" colspan="3">${escapeHtml(opts.className)}</td></tr>` : ''}
    </table>
    <div class="body">${body}</div>
    <div class="sigs">
      <div class="sig"><div class="line">Professor(a)</div></div>
      <div class="sig"><div class="line">Coordenação</div></div>
      <div class="sig"><div class="line">Responsável</div></div>
    </div>
    <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`);
  w.document.close();
};

// ── Impressão: Bilhete para famílias (2 vias por folha A4, com linha de corte) ──
const printBilhete = (opts: { text: string; teacherName?: string; schoolName?: string; className?: string }) => {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast.error('O navegador bloqueou a janela de impressão. Permita pop-ups e tente de novo.'); return; }
  const today = new Date().toLocaleDateString('pt-BR');
  const msg = escapeHtml(opts.text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
  const copy = `
    <div class="copy">
      <div class="copy-head">
        <span>${escapeHtml(opts.schoolName || 'Escola')}</span>
        <span>Prof(a). ${escapeHtml(opts.teacherName || '')}${opts.className ? ' · ' + escapeHtml(opts.className) : ''} · ${today}</span>
      </div>
      <div class="msg">${msg}</div>
      <div class="sig">Assinatura do responsável: <span class="sig-line"></span></div>
    </div>`;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comunicado — ${escapeHtml(opts.schoolName || 'Escola')}</title><style>
    @page { size: A4; margin: 1.2cm; }
    * { box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #111827; margin: 0; font-size: 12.5px; line-height: 1.6; }
    .copy { height: 12.6cm; display: flex; flex-direction: column; padding: 0.5cm 0.3cm; }
    .copy-head { display: flex; justify-content: space-between; gap: 12px; font-family: Arial, sans-serif; font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px; color: #374151; border-bottom: 1px solid #111827; padding-bottom: 6px; margin-bottom: 12px; }
    .msg { flex: 1; overflow: hidden; }
    .sig { margin-top: 14px; font-size: 11.5px; display: flex; align-items: flex-end; gap: 6px; }
    .sig-line { flex: 1; border-bottom: 1px solid #111827; min-width: 160px; height: 14px; }
    .cut { display: flex; align-items: center; gap: 8px; color: #6b7280; font-family: Arial, sans-serif; font-size: 11px; margin: 0.25cm 0; }
    .cut::before, .cut::after { content: ''; flex: 1; border-top: 1.5px dashed #9ca3af; }
  </style></head><body>
    ${copy}
    <div class="cut">✂ recorte aqui</div>
    ${copy}
    <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`);
  w.document.close();
};

// ── Impressão: Chamada do Diário de Classe (folha de frequência sóbria) ──
const printChamada = (opts: {
  className: string; dateBr: string; teacherName?: string; schoolName?: string; note?: string; withGrades: boolean;
  rows: { n: number; name: string; att?: 'P' | 'F' | 'A'; grade?: string }[];
  totals: { p: number; f: number; a: number };
}) => {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast.error('O navegador bloqueou a janela de impressão. Permita pop-ups e tente de novo.'); return; }
  const sq = (marked: boolean) => `<span class="sq">${marked ? '✕' : ''}</span>`;
  const rowsHtml = opts.rows.map(r => `<tr>
    <td class="c">${r.n}</td>
    <td>${escapeHtml(r.name)}</td>
    <td class="c">${sq(r.att === 'P')}</td>
    <td class="c">${sq(r.att === 'F')}</td>
    <td class="c">${sq(r.att === 'A')}</td>
    ${opts.withGrades ? `<td class="c">${escapeHtml(r.grade || '')}</td>` : ''}
  </tr>`).join('');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Diário de Classe — ${escapeHtml(opts.className)} — ${escapeHtml(opts.dateBr)}</title><style>
    @page { size: A4; margin: 1.6cm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; margin: 0; }
    .head { border-bottom: 1.5px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
    .school { text-align: center; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1.5px; }
    .doc { text-align: center; font-size: 10px; letter-spacing: 2px; margin-top: 2px; }
    .meta { display: flex; gap: 24px; margin-bottom: 10px; }
    table.list { width: 100%; border-collapse: collapse; }
    .list th, .list td { border: 1px solid #111; padding: 3.5px 6px; text-align: left; }
    .list th { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
    .list tr { page-break-inside: avoid; }
    .c { text-align: center; }
    th.st { width: 34px; text-align: center; }
    .sq { display: inline-block; width: 13px; height: 13px; border: 1.2px solid #111; line-height: 13px; font-size: 10px; text-align: center; vertical-align: middle; }
    .totals { margin-top: 6px; font-size: 10.5px; }
    .conteudo { margin-top: 18px; page-break-inside: avoid; }
    .conteudo .lbl { font-weight: 700; margin-bottom: 4px; }
    .note { margin-bottom: 4px; }
    .wline { border-bottom: 1px solid #6b7280; height: 22px; }
    .psig { margin-top: 46px; display: flex; justify-content: center; page-break-inside: avoid; }
    .pline { border-top: 1px solid #111; padding-top: 4px; width: 60%; text-align: center; font-size: 10.5px; }
  </style></head><body>
    <div class="head">
      <div class="school">${escapeHtml(opts.schoolName || 'Escola')}</div>
      <div class="doc">DIÁRIO DE CLASSE — REGISTRO DE FREQUÊNCIA</div>
    </div>
    <div class="meta">
      <span><strong>Turma:</strong> ${escapeHtml(opts.className)}</span>
      <span><strong>Data:</strong> ${escapeHtml(opts.dateBr)}</span>
      <span><strong>Professor(a):</strong> ${escapeHtml(opts.teacherName || '')}</span>
    </div>
    <table class="list">
      <thead><tr><th style="width:28px" class="c">Nº</th><th>Nome do aluno</th><th class="st">P</th><th class="st">F</th><th class="st">A</th>${opts.withGrades ? '<th style="width:60px" class="c">Nota</th>' : ''}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="totals">Presentes: ${opts.totals.p} · Faltas: ${opts.totals.f} · Atrasos: ${opts.totals.a} · Total de alunos: ${opts.rows.length}</div>
    <div class="conteudo">
      <div class="lbl">Conteúdo ministrado:</div>
      ${opts.note ? `<div class="note">${escapeHtml(opts.note).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="wline"></div>
      <div class="wline"></div>
      ${opts.note ? '' : '<div class="wline"></div>'}
    </div>
    <div class="psig"><div class="pline">Assinatura do(a) professor(a)</div></div>
    <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`);
  w.document.close();
};

const FerramentaChips = ({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map(o => (
      <button key={o} type="button" onClick={() => onChange(o)} className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${value === o ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200'}`}>
        {o}
      </button>
    ))}
  </div>
);

const FerramentasScreen = ({
  profile,
  schedules,
  user,
  setScreen,
  notifications,
  setNotifications,
  initialTool,
  clearInitialTool,
  classes,
}: {
  profile: UserProfile;
  schedules: ClassSchedule[];
  user: any;
  setScreen: (s: Screen) => void;
  notifications?: any[];
  setNotifications?: (n: any[]) => void;
  initialTool?: string | null;
  clearInitialTool?: () => void;
  classes?: ClassItem[];
}) => {
  const [activeTool, setActiveTool] = useState<FerramentaId | null>(null);
  const [showDiario, setShowDiario] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState('');
  const loadingMsg = useFunnyLoadingMessage(isGenerating, 'studio');

  // Campos do formulário (compartilhados entre ferramentas)
  const [classId, setClassId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [period, setPeriod] = useState('1º bimestre');
  const [strengths, setStrengths] = useState('');
  const [struggles, setStruggles] = useState('');
  const [observations, setObservations] = useState('');
  const [tone, setTone] = useState('acolhedor');
  const [need, setNeed] = useState('TDAH');
  const [originalActivity, setOriginalActivity] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [criteriaCount, setCriteriaCount] = useState(4);
  const [levelsCount, setLevelsCount] = useState(4);
  const [originalText, setOriginalText] = useState('');
  const [targetLevel, setTargetLevel] = useState('3º a 5º ano');
  const [msgType, setMsgType] = useState('Bilhete na agenda');
  const [msgContext, setMsgContext] = useState('');
  const [familiaTone, setFamiliaTone] = useState('acolhedor');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoGoal, setVideoGoal] = useState('Roteiro de aula');
  const [pdfGoal, setPdfGoal] = useState('Atividade com questões');
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const selectedClass = schedules.find(s => s.id === classId);
  const ctxLevel = selectedClass?.level || 'Ensino Fundamental';
  const ctxSubject = selectedClass?.subject || profile.subject || 'Geral';

  useEffect(() => {
    if (!initialTool) return;
    if (initialTool === 'diario') setShowDiario(true);
    else if (FERRAMENTAS_META.some(t => t.id === initialTool)) setActiveTool(initialTool as FerramentaId);
    clearInitialTool?.();
  }, [initialTool, clearInitialTool]);

  // Sequência de geração: fechar/trocar a ferramenta invalida respostas em voo,
  // senão o resultado da ferramenta anterior "vaza" para a próxima aberta.
  const genSeqRef = useRef(0);

  const closeTool = () => {
    genSeqRef.current++;
    setActiveTool(null); setResult(''); setIsGenerating(false); setPdfFile(null);
  };

  const runGeneration = async (prompt: string, extraParts?: any[]) => {
    const seq = ++genSeqRef.current;
    setIsGenerating(true);
    setResult('');
    try {
      const parts: any[] = [...(extraParts || []), { text: prompt }];
      const response = await generateContentWithRetry({
        model: AI_MODEL,
        contents: [{ role: 'user', parts }],
      });
      if (genSeqRef.current !== seq) return;
      const text = response.text || '';
      if (!text.trim()) throw new Error('Resposta vazia');
      setResult(text.trim());
    } catch (e: any) {
      if (genSeqRef.current !== seq) return;
      toast.error(formatApiError(e, 'A geração não saiu dessa vez. Tente de novo.'));
    } finally {
      if (genSeqRef.current === seq) setIsGenerating(false);
    }
  };

  const generate = async () => {
    if (!activeTool) return;
    const baseCtx = `Disciplina: ${ctxSubject} | Nível: ${ctxLevel}${selectedClass ? ` | Turma: ${selectedClass.name}` : ''}`;

    if (activeTool === 'parecer') {
      if (!studentName.trim()) { toast.error('Informe o nome do aluno.'); return; }
      await runGeneration(`Você é um professor brasileiro experiente escrevendo um PARECER DESCRITIVO individual para o boletim.
${baseCtx} | Período: ${period} | Aluno(a): ${studentName.trim()}
Pontos fortes observados: ${strengths.trim() || 'não informados — infira com cautela a partir do contexto'}
Dificuldades observadas: ${struggles.trim() || 'não informadas'}
Outras observações: ${observations.trim() || 'nenhuma'}
Tom desejado: ${tone}

Escreva o parecer em 3 a 4 parágrafos, em português brasileiro natural:
1. Desenvolvimento cognitivo e aprendizagem (com exemplos concretos do que foi informado)
2. Aspectos socioemocionais e convivência
3. Evolução no período e participação
4. Encaminhamentos e sugestões para o próximo período (parceria com a família)

REGRAS: linguagem respeitosa e construtiva, NUNCA rotule a criança, descreva comportamentos e não julgamentos, evite jargão pedagógico excessivo. Comece direto no texto do parecer, sem título nem preâmbulo. NÃO invente fatos específicos que não foram informados.`);
    } else if (activeTool === 'inclusao') {
      if (!originalActivity.trim()) { toast.error('Descreva a atividade ou conteúdo a adaptar.'); return; }
      await runGeneration(`Você é um especialista em educação inclusiva brasileira (AEE).
${baseCtx}
Necessidade do aluno: ${need}
Atividade/conteúdo original: ${originalActivity.trim()}

Crie uma ADAPTAÇÃO completa em Markdown com as seções:

## 🎯 Objetivo Flexibilizado
(o mesmo objetivo de aprendizagem, com critério de sucesso adequado)

## ✂️ Atividade Adaptada
(versão pronta para aplicar, passo a passo, com os ajustes específicos para ${need})

## 🛠️ Recursos e Apoios
(materiais concretos, apoios visuais, tecnologia assistiva de baixo custo)

## 🧭 Estratégias de Mediação
(4-5 dicas práticas de manejo durante a atividade, específicas para ${need})

## 📋 Avaliação Adaptada
(como avaliar o mesmo objetivo por outros meios)

REGRAS: baseie-se em práticas reconhecidas (DUA - Desenho Universal para Aprendizagem), seja concreto e aplicável amanhã de manhã, sem teoria longa. Português brasileiro.`);
    } else if (activeTool === 'rubrica') {
      if (!taskDesc.trim()) { toast.error('Descreva o trabalho ou atividade a avaliar.'); return; }
      const levelNames = levelsCount === 3 ? 'Iniciante | Em desenvolvimento | Proficiente' : 'Iniciante | Em desenvolvimento | Proficiente | Avançado';
      await runGeneration(`Você é um especialista em avaliação educacional. Crie uma RUBRICA DE AVALIAÇÃO em Markdown.
${baseCtx}
Trabalho/atividade avaliada: ${taskDesc.trim()}
Número de critérios: ${criteriaCount} | Níveis de desempenho: ${levelNames}

Formato EXATO:
1. Título curto da rubrica (linha com ##)
2. Uma TABELA Markdown: primeira coluna "Critério" (com peso sugerido em %), demais colunas os níveis (${levelNames}). Cada célula descreve de forma OBSERVÁVEL o que o aluno demonstra naquele nível (1-2 frases).
3. Após a tabela, seção "## Como usar" com 3 dicas rápidas de aplicação e devolutiva.

REGRAS: critérios relevantes para a atividade descrita, descrições paralelas entre níveis (mesma dimensão, intensidade crescente), linguagem que o próprio aluno entenda. Português brasileiro.`);
    } else if (activeTool === 'nivelador') {
      if (!originalText.trim()) { toast.error('Cole o texto que deseja adaptar.'); return; }
      await runGeneration(`Você é um especialista em leiturabilidade e alfabetização no Brasil.
Reescreva o texto abaixo para o nível de leitura: ${targetLevel}.

TEXTO ORIGINAL:
"""
${originalText.trim()}
"""

Retorne em Markdown:

## 📖 Texto Adaptado
(o texto reescrito: vocabulário, tamanho de frases e complexidade sintática adequados a ${targetLevel}; preserve TODAS as informações essenciais e o sentido original)

## 🔤 Glossário
(4-6 palavras que permaneceram desafiadoras, com definição simples de 1 linha)

## 💬 Perguntas de Compreensão
(3 perguntas sobre o texto adaptado, em ordem crescente de complexidade)

REGRAS: não infantilize além do necessário, não adicione informações novas, mantenha o gênero textual. Português brasileiro.`);
    } else if (activeTool === 'familia') {
      if (!msgContext.trim()) { toast.error('Descreva o assunto da mensagem.'); return; }
      await runGeneration(`Você é um professor brasileiro experiente em comunicação com famílias.
Escreva: ${msgType}
Contexto/assunto: ${msgContext.trim()}
${selectedClass ? `Turma: ${selectedClass.name}` : ''} | Tom: ${familiaTone}

REGRAS:
- ${msgType.includes('WhatsApp') ? 'Mensagem curta de WhatsApp (máx. 6 linhas), pode usar 1-2 emojis discretos' : 'Texto pronto para copiar, com saudação e despedida'}
- Linguagem ${familiaTone === 'formal' ? 'formal e institucional' : 'acolhedora, próxima e respeitosa'}
- Se o assunto for delicado (comportamento, dificuldade), use abordagem construtiva: comece com algo positivo, descreva o fato sem julgamento, proponha parceria
- NUNCA exponha ou compare a criança
- Inclua espaço [NOME] onde o nome do aluno deve entrar, se aplicável
- Comece direto na mensagem, sem título nem explicações antes ou depois. Português brasileiro.`);
    } else if (activeTool === 'video') {
      const url = videoUrl.trim();
      if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) { toast.error('Cole um link válido do YouTube.'); return; }
      await runGeneration(`Você é um designer instrucional brasileiro. Assista ao vídeo e crie: ${videoGoal}.
${baseCtx}

Formato em Markdown conforme o tipo:
- "Resumo para a turma": ## Resumo (linguagem adequada ao nível) + ## Pontos-chave (lista) + ## Vocabulário novo
- "Roteiro de aula": ## Antes do vídeo (ativação, 2-3 min) + ## Durante (3 pausas estratégicas com minutagem e pergunta) + ## Depois (atividade de consolidação de 10 min)
- "Atividade com questões": ## Atividade sobre o vídeo com 6 questões variadas (compreensão, análise, opinião) + gabarito comentado no final
- "Debate guiado": ## Pergunta disparadora + ## 4 perguntas de aprofundamento + ## Posições possíveis + ## Fechamento

Cite minutagens do vídeo quando relevante. Português brasileiro.`, [{ fileData: { fileUri: url } }]);
    } else if (activeTool === 'pdf') {
      if (!pdfFile) { toast.error('Selecione um arquivo PDF primeiro.'); return; }
      if (pdfFile.size > 15 * 1024 * 1024) { toast.error('PDF pesado demais! O limite é 15 MB.'); return; }
      setIsGenerating(true);
      try {
        const base64 = await fileToBase64(pdfFile);
        await runGeneration(`Você é um designer instrucional brasileiro. Com base EXCLUSIVAMENTE no conteúdo do PDF anexado (livro/apostila do professor), crie: ${pdfGoal}.
${baseCtx}

Formato em Markdown conforme o tipo:
- "Resumo do capítulo": ## Resumo + ## Conceitos-chave + ## O que cai na prova
- "Atividade com questões": ## Atividade com 8 questões baseadas no material (cite a página quando possível) + gabarito no final
- "Prova rápida": ## Avaliação com 5 questões objetivas + 2 dissertativas + gabarito
- "Plano de aula": plano completo de 1 aula usando o material como base (objetivos, momentos da aula com tempos, avaliação)
- "Slides em tópicos": ## estrutura de 8-10 slides, cada um com título + 3-4 bullets prontos

REGRAS: fidelidade total ao material anexado, não invente conteúdo externo. Português brasileiro.`, [{ inlineData: { data: base64, mimeType: pdfFile.type || 'application/pdf' } }]);
      } catch (e: any) {
        toast.error('Não consegui ler esse PDF. Tente outro arquivo.');
        setIsGenerating(false);
      }
    }
  };

  const copyResult = () => {
    navigator.clipboard.writeText(result).then(() => toast.success('Copiado!')).catch(() => toast.error('Não foi possível copiar.'));
  };

  const toolTitle = activeTool ? FERRAMENTAS_META.find(t => t.id === activeTool)!.title : '';

  const printResult = () => {
    if (!result || !activeTool) return;
    if (activeTool === 'parecer') {
      printParecer({ text: result, studentName: studentName.trim(), period, teacherName: profile.name, schoolName: profile.schoolName, className: selectedClass?.name });
      return;
    }
    if (activeTool === 'familia') {
      printBilhete({ text: result, teacherName: profile.name, schoolName: profile.schoolName, className: selectedClass?.name });
      return;
    }
    const tagLabels: Record<FerramentaId, string> = { parecer: 'Parecer', inclusao: 'Inclusão', rubrica: 'Avaliação', nivelador: 'Leitura', familia: 'Famílias', video: 'Vídeo', pdf: 'Material' };
    printPlannerContent(toolTitle, result, tagLabels[activeTool], profile.name, profile.schoolName, activeTool === 'rubrica' ? { landscape: true } : undefined);
  };

  const classSelectorEl = schedules.length > 0 ? (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">Turma (opcional)</label>
      <select value={classId} onChange={e => setClassId(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm">
        <option value="">Sem turma específica</option>
        {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  ) : null;

  const Chips = FerramentaChips;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title="Kit do Professor" subtitle="Ferramentas inteligentes" profile={profile} notifications={notifications} setNotifications={setNotifications} bannerImage="https://i.ibb.co/fz8jPCN3/Design-sem-nome-20260616-144136-0000.png" />

      {/* Diário de Classe — destaque */}
      <button
        onClick={() => setShowDiario(true)}
        className="w-full relative overflow-hidden rounded-[2rem] p-6 mb-4 shadow-xl text-left bg-gradient-to-br from-indigo-600 to-indigo-800 active:scale-[0.98] transition-transform"
      >
        <div className="absolute -top-6 -right-6 opacity-20">
          <NotebookPen size={130} className="text-white" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-black tracking-widest uppercase text-amber-300 bg-white/10 px-2 py-0.5 rounded-full backdrop-blur">★ Dia a dia</span>
          </div>
          <h2 className="text-3xl font-black text-white mb-2 leading-tight">Diário de Classe</h2>
          <p className="text-sm text-indigo-100 max-w-[80%] leading-relaxed mb-4">
            Chamada, anotações e notas do dia. Rápido, offline e sincronizado com sua turma gamificada.
          </p>
          <div className="inline-flex items-center gap-2 bg-white text-indigo-700 font-bold px-4 py-2 rounded-full text-sm">
            <NotebookPen size={16} /> Abrir diário
          </div>
        </div>
      </button>

      {/* Ferramentas de IA */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {FERRAMENTAS_META.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              className={`relative rounded-3xl p-4 text-left shadow-sm border-2 ${t.bg} active:scale-[0.97] transition-transform`}
            >
              <Icon size={28} className={`${t.color} mb-2`} />
              <h3 className={`font-bold text-sm ${t.color}`}>{t.title}</h3>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">{t.desc}</p>
            </button>
          );
        })}
      </div>

      {/* MODAL de ferramenta */}
      <AnimatePresence>
        {activeTool && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => { if (!isGenerating) closeTool(); }}
          >
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="bg-white w-full sm:max-w-lg rounded-t-[2rem] sm:rounded-[2rem] max-h-[92vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  {(() => { const meta = FERRAMENTAS_META.find(t => t.id === activeTool)!; const Icon = meta.icon; return <Icon size={22} className={meta.color} />; })()}
                  <h3 className="font-bold text-lg text-gray-900">{toolTitle}</h3>
                </div>
                <button onClick={closeTool} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {!result && !isGenerating && (
                  <>
                    {classSelectorEl}

                    {activeTool === 'parecer' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Nome do aluno *</label>
                          <input value={studentName} onChange={e => setStudentName(e.target.value)} maxLength={80} placeholder="Ex: Maria Clara" className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Período</label>
                          <Chips options={['1º bimestre', '2º bimestre', '3º bimestre', '4º bimestre', '1º semestre', '2º semestre']} value={period} onChange={setPeriod} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Pontos fortes observados</label>
                          <textarea value={strengths} onChange={e => setStrengths(e.target.value)} rows={2} maxLength={1500} placeholder="Ex: participa bastante, ajuda os colegas, evoluiu na leitura..." className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm resize-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Dificuldades observadas</label>
                          <textarea value={struggles} onChange={e => setStruggles(e.target.value)} rows={2} maxLength={1500} placeholder="Ex: dispersa com facilidade, dificuldade em frações..." className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm resize-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Outras observações (opcional)</label>
                          <textarea value={observations} onChange={e => setObservations(e.target.value)} rows={2} maxLength={1500} placeholder="Contexto familiar, saúde, episódios marcantes..." className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm resize-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Tom</label>
                          <Chips options={['acolhedor', 'formal', 'objetivo']} value={tone} onChange={setTone} />
                        </div>
                      </>
                    )}

                    {activeTool === 'inclusao' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Necessidade do aluno</label>
                          <Chips options={['TDAH', 'TEA (autismo)', 'Dislexia', 'Deficiência intelectual', 'Baixa visão', 'Surdez', 'Altas habilidades', 'Dificuldade de aprendizagem']} value={need} onChange={setNeed} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Atividade ou conteúdo original *</label>
                          <textarea value={originalActivity} onChange={e => setOriginalActivity(e.target.value)} rows={4} maxLength={4000} placeholder="Descreva ou cole a atividade que será adaptada..." className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm resize-none" />
                        </div>
                      </>
                    )}

                    {activeTool === 'rubrica' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Trabalho ou atividade avaliada *</label>
                          <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} rows={3} maxLength={2000} placeholder="Ex: Seminário em grupo sobre biomas brasileiros, com cartaz e apresentação oral de 10 min" className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm resize-none" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Critérios</label>
                            <select value={criteriaCount} onChange={e => setCriteriaCount(parseInt(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm">
                              {[3, 4, 5, 6].map(n => <option key={n} value={n}>{n} critérios</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Níveis</label>
                            <select value={levelsCount} onChange={e => setLevelsCount(parseInt(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm">
                              <option value={3}>3 níveis</option>
                              <option value={4}>4 níveis</option>
                            </select>
                          </div>
                        </div>
                      </>
                    )}

                    {activeTool === 'nivelador' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Texto original *</label>
                          <textarea value={originalText} onChange={e => setOriginalText(e.target.value)} rows={6} maxLength={12000} placeholder="Cole aqui o texto do livro, notícia ou material que deseja simplificar (ou sofisticar)..." className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm resize-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Nível de leitura alvo</label>
                          <Chips options={['1º e 2º ano', '3º a 5º ano', '6º e 7º ano', '8º e 9º ano', 'Ensino Médio', 'EJA']} value={targetLevel} onChange={setTargetLevel} />
                        </div>
                      </>
                    )}

                    {activeTool === 'familia' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de mensagem</label>
                          <Chips options={['Bilhete na agenda', 'Mensagem de WhatsApp', 'Comunicado geral', 'Convite para reunião', 'Elogio ao aluno', 'Alerta construtivo']} value={msgType} onChange={setMsgType} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Assunto / contexto *</label>
                          <textarea value={msgContext} onChange={e => setMsgContext(e.target.value)} rows={3} maxLength={2000} placeholder="Ex: festa junina dia 20/06, trazer prato típico. Ou: aluno melhorou muito em matemática este mês." className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm resize-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Tom</label>
                          <Chips options={['acolhedor', 'formal']} value={familiaTone} onChange={setFamiliaTone} />
                        </div>
                      </>
                    )}

                    {activeTool === 'video' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Link do vídeo (YouTube) *</label>
                          <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." inputMode="url" className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-sm" />
                          <p className="text-[11px] text-gray-400 mt-1">A IA assiste ao vídeo e gera o material com base no conteúdo real.</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">O que gerar</label>
                          <Chips options={['Roteiro de aula', 'Resumo para a turma', 'Atividade com questões', 'Debate guiado']} value={videoGoal} onChange={setVideoGoal} />
                        </div>
                      </>
                    )}

                    {activeTool === 'pdf' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Seu material (PDF, máx. 15 MB) *</label>
                          <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-2xl p-6 cursor-pointer transition-colors ${pdfFile ? 'border-violet-300 bg-violet-50' : 'border-gray-200 bg-gray-50'}`}>
                            <FileUp size={28} className={pdfFile ? 'text-violet-500' : 'text-gray-300'} />
                            <span className={`text-sm font-bold ${pdfFile ? 'text-violet-700' : 'text-gray-400'}`}>
                              {pdfFile ? pdfFile.name : 'Toque para escolher o PDF'}
                            </span>
                            {pdfFile && <span className="text-[11px] text-violet-400">{fmtBytes(pdfFile.size)}</span>}
                            <input type="file" accept="application/pdf" className="hidden" onChange={e => setPdfFile(e.target.files?.[0] || null)} />
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">O que gerar</label>
                          <Chips options={['Atividade com questões', 'Resumo do capítulo', 'Prova rápida', 'Plano de aula', 'Slides em tópicos']} value={pdfGoal} onChange={setPdfGoal} />
                        </div>
                      </>
                    )}

                    <button
                      onClick={generate}
                      disabled={
                        (activeTool === 'parecer' && !studentName.trim()) ||
                        (activeTool === 'inclusao' && !originalActivity.trim()) ||
                        (activeTool === 'rubrica' && !taskDesc.trim()) ||
                        (activeTool === 'nivelador' && !originalText.trim()) ||
                        (activeTool === 'familia' && !msgContext.trim()) ||
                        (activeTool === 'video' && !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(videoUrl.trim())) ||
                        (activeTool === 'pdf' && !pdfFile)
                      }
                      className="w-full bg-indigo-600 text-white rounded-2xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40"
                    >
                      <Sparkles size={16} /> Gerar com o Corujão
                    </button>
                  </>
                )}

                {isGenerating && (
                  <div className="flex flex-col items-center justify-center py-14 gap-4">
                    <Loader2 size={36} className="animate-spin text-indigo-500" />
                    <p className="text-sm text-gray-500 font-medium">{loadingMsg || 'Gerando...'}</p>
                    {(activeTool === 'video' || activeTool === 'pdf') && <p className="text-[11px] text-gray-400 text-center max-w-[240px]">Analisar {activeTool === 'video' ? 'o vídeo' : 'o PDF'} pode levar um pouco mais de tempo.</p>}
                  </div>
                )}

                {result && !isGenerating && (
                  <>
                    {(() => {
                      const meta = FERRAMENTAS_META.find(t => t.id === activeTool)!;
                      const Icon = meta.icon;
                      const ctxParts: string[] = [];
                      if (activeTool === 'parecer') {
                        if (studentName.trim()) ctxParts.push(studentName.trim());
                        ctxParts.push(period);
                      } else if (activeTool === 'inclusao') ctxParts.push(need);
                      else if (activeTool === 'nivelador') ctxParts.push(targetLevel);
                      else if (activeTool === 'familia') ctxParts.push(msgType);
                      else if (activeTool === 'video') ctxParts.push(videoGoal);
                      else if (activeTool === 'pdf') ctxParts.push(pdfGoal);
                      if (selectedClass) ctxParts.push(selectedClass.name);
                      return (
                        <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${meta.bg}`}>
                          <Icon size={20} className={`${meta.color} shrink-0`} />
                          <div className="min-w-0">
                            <p className={`text-sm font-bold leading-tight ${meta.color}`}>{meta.title}</p>
                            {ctxParts.length > 0 && <p className="text-[11px] text-gray-500 truncate">{ctxParts.join(' · ')}</p>}
                          </div>
                        </div>
                      );
                    })()}
                    <div className={`markdown-body prose prose-sm max-w-none bg-gray-50 border border-gray-100 rounded-2xl p-4 max-h-[48vh] overflow-y-auto ${activeTool === 'rubrica' ? 'overflow-x-auto [&_table]:min-w-[540px]' : ''}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
                    </div>
                    <p className="text-[11px] text-gray-400 text-center">Material gerado por IA. Revise antes de usar.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={copyResult} className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 rounded-2xl py-3 text-sm font-bold active:scale-[0.98] transition-transform">
                        <Copy size={15} /> Copiar
                      </button>
                      <button onClick={printResult} className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 rounded-2xl py-3 text-sm font-bold active:scale-[0.98] transition-transform">
                        <Printer size={15} /> Imprimir
                      </button>
                      {activeTool === 'familia' && (
                        <button
                          onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(result)}`, '_blank')}
                          className="col-span-2 flex items-center justify-center gap-2 bg-emerald-500 text-white rounded-2xl py-3 text-sm font-bold active:scale-[0.98] transition-transform"
                        >
                          <MessageCircle size={15} /> Enviar pelo WhatsApp
                        </button>
                      )}
                      <button onClick={() => setResult('')} className="col-span-2 flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-2xl py-3 text-sm font-bold active:scale-[0.98] transition-transform">
                        <RefreshCw size={15} /> Gerar outro
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DIÁRIO DE CLASSE */}
      <AnimatePresence>
        {showDiario && (
          <DiarioModal user={user} schedules={schedules} profile={profile} onClose={() => setShowDiario(false)} setScreen={setScreen} classes={classes} />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const DiarioModal = ({ user, schedules, profile, onClose, setScreen, classes }: {
  user: any; schedules: ClassSchedule[]; profile: UserProfile; onClose: () => void; setScreen: (s: Screen) => void; classes?: ClassItem[];
}) => {
  const [gamiClasses, setGamiClasses] = useFirestoreSync<ClassGamification>('gamification', user, []);
  const [entries, setEntries] = useFirestoreSync<DiarioEntry>('diario', user, []);
  const [classId, setClassId] = useState(schedules[0]?.id ?? '');
  const [date, setDate] = useState(() => gamiTodayKey());

  useEffect(() => {
    if (schedules.length > 0 && (!classId || !schedules.some(s => s.id === classId))) {
      setClassId(schedules[0].id);
    }
  }, [schedules, classId]);
  const [showGrades, setShowGrades] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [diarioBulkNames, setDiarioBulkNames] = useState('');

  const cls = gamiClasses.find(c => c.id === classId);
  const students = useMemo(() => [...(cls?.students ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [cls]);
  const entryId = `${classId}_${date}`;
  const entry = entries.find(e => e.id === entryId);

  const updateEntry = (updater: (prev: DiarioEntry) => DiarioEntry) => {
    const prev: DiarioEntry = entry ?? { id: entryId, classId, date, att: {} };
    const next = updater(prev);
    setEntries(list => entry ? list.map(e => e.id === entryId ? next : e) : [...list, next]);
  };

  const cycleAtt = (studentId: string) => {
    const order: ('P' | 'F' | 'A')[] = ['P', 'F', 'A'];
    updateEntry(e => {
      const cur = e.att[studentId];
      const next = cur === undefined ? 'P' : order[(order.indexOf(cur) + 1) % 3];
      return { ...e, att: { ...e.att, [studentId]: next } };
    });
  };

  const markAll = (v: 'P' | 'F') => {
    updateEntry(e => ({ ...e, att: Object.fromEntries(students.map(s => [s.id, v])) }));
  };

  const addStudent = () => {
    const name = newStudentName.trim();
    if (!name || !classId) return;
    setGamiClasses(list => {
      const existing = list.find(c => c.id === classId);
      const newStudent: GamiStudent = { id: gamiRid(), name, xp: 0, totalXp: 0, weekXp: 0, coins: 0, badges: [], streak: 0 };
      if (existing) return list.map(c => c.id === classId ? { ...c, students: [...c.students, newStudent] } : c);
      return [...list, { ...gamiDefaultClass(classId), students: [newStudent] }];
    });
    setNewStudentName('');
  };

  const presentCount = students.filter(s => entry?.att[s.id] === 'P').length;
  const absentCount = students.filter(s => entry?.att[s.id] === 'F').length;
  const lateCount = students.filter(s => entry?.att[s.id] === 'A').length;

  const printDay = () => {
    const schedule = schedules.find(s => s.id === classId);
    const dateBr = new Date(date + 'T12:00:00').toLocaleDateString('pt-BR');
    const withGrades = showGrades || students.some(s => (entry?.grades?.[s.id] ?? '').trim() !== '');
    printChamada({
      className: schedule?.name ?? 'Turma',
      dateBr,
      teacherName: profile.name,
      schoolName: profile.schoolName,
      note: entry?.note,
      withGrades,
      rows: students.map((s, i) => ({ n: i + 1, name: s.name, att: entry?.att[s.id], grade: entry?.grades?.[s.id] })),
      totals: { p: presentCount, f: absentCount, a: lateCount },
    });
  };

  const attStyle = (a?: 'P' | 'F' | 'A') =>
    a === 'P' ? 'bg-emerald-500 text-white' :
    a === 'F' ? 'bg-red-500 text-white' :
    a === 'A' ? 'bg-amber-400 text-white' :
    'bg-gray-100 text-gray-400';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] bg-[#F8F9FE] flex flex-col">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <NotebookPen size={22} className="text-indigo-600" />
          <h2 className="text-lg font-black text-gray-900">Diário de Classe</h2>
        </div>
        <div className="flex items-center gap-2">
          {students.length > 0 && (
            <button onClick={printDay} className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <Printer size={16} />
            </button>
          )}
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-10">
        {/* Seletores */}
        <div className="flex gap-2 mb-3">
          <select value={classId} onChange={e => setClassId(e.target.value)} className="flex-1 bg-white border border-gray-200 rounded-xl py-2.5 px-3 text-sm font-bold min-w-0">
            {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            {schedules.length === 0 && <option value="">Sem turmas</option>}
          </select>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-white border border-gray-200 rounded-xl py-2.5 px-3 text-sm font-bold" />
        </div>

        {schedules.length === 0 ? (
          <div className="text-center py-16">
            <CalendarDays size={48} className="mx-auto text-gray-300" />
            <p className="text-gray-500 mt-3 text-sm font-bold">Cadastre suas turmas na Agenda primeiro.</p>
            <button onClick={() => { onClose(); setScreen('calendar'); }} className="mt-4 bg-indigo-600 text-white text-sm font-bold px-5 py-2.5 rounded-2xl">Ir para a Agenda</button>
          </div>
        ) : students.length === 0 ? (
          <div className="py-6 space-y-4">
            <div className="text-center">
              <img src="https://i.ibb.co/Y7df80LZ/1781545849687.png" alt="Corujão" className="w-24 h-auto object-contain mx-auto" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
              <p className="text-gray-700 text-sm font-bold mt-3">Nenhum aluno nessa turma ainda.</p>
              <p className="text-[11px] text-gray-400 mt-1">Cole a lista da chamada abaixo, um nome por linha. Funciona nas duas telas.</p>
            </div>
            <textarea
              value={diarioBulkNames}
              onChange={e => setDiarioBulkNames(e.target.value)}
              rows={8}
              placeholder={"Ana Beatriz\nCarlos Eduardo\nMariana Souza\nPedro Henrique\n..."}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400 resize-none bg-white"
            />
            {(() => {
              const seen = new Set((cls?.students ?? []).map(s => s.name.toLowerCase()));
              const names = diarioBulkNames.split('\n').map(n => n.trim()).filter(n => {
                const k = n.toLowerCase();
                if (!n || seen.has(k)) return false;
                seen.add(k);
                return true;
              });
              return (
                <button
                  onClick={() => {
                    if (names.length === 0 || !classId) return;
                    const newStudents: GamiStudent[] = names.map(name => ({ id: gamiRid(), name, xp: 0, totalXp: 0, weekXp: 0, coins: 0, badges: [], streak: 0 }));
                    setGamiClasses(list => {
                      const existing = list.find(c => c.id === classId);
                      if (existing) return list.map(c => c.id === classId ? { ...c, students: [...c.students, ...newStudents] } : c);
                      return [...list, { ...gamiDefaultClass(classId), students: newStudents }];
                    });
                    setDiarioBulkNames('');
                    toast.success(`${names.length} aluno${names.length > 1 ? 's' : ''} cadastrado${names.length > 1 ? 's' : ''}!`);
                  }}
                  disabled={diarioBulkNames.trim().length === 0}
                  className="w-full bg-indigo-600 disabled:opacity-40 text-white font-bold py-3 rounded-xl text-sm active:scale-[0.98] transition-transform"
                >
                  {names.length > 0 ? `+ Cadastrar ${names.length} aluno${names.length > 1 ? 's' : ''}` : 'Digite os nomes acima'}
                </button>
              );
            })()}
          </div>
        ) : (
          <>
            {/* Resumo + ações em massa */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex gap-3 text-xs font-bold">
                <span className="text-emerald-600">{presentCount} P</span>
                <span className="text-red-500">{absentCount} F</span>
                <span className="text-amber-500">{lateCount} A</span>
                <span className="text-gray-300">/ {students.length}</span>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => markAll('P')} className="text-[11px] font-bold bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-full border border-emerald-200">Todos P</button>
                <button onClick={() => markAll('F')} className="text-[11px] font-bold bg-red-50 text-red-500 px-2.5 py-1 rounded-full border border-red-200">Todos F</button>
                <button onClick={() => setShowGrades(g => !g)} className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${showGrades ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200'}`}>Notas</button>
              </div>
            </div>

            {/* Lista de alunos */}
            <div className="space-y-1.5 mb-4">
              {students.map((s, i) => {
                const a = entry?.att[s.id];
                return (
                  <div key={s.id} className="bg-white rounded-xl px-3 py-2 flex items-center gap-2.5 shadow-sm border border-gray-100">
                    <span className="text-[10px] font-black text-gray-300 w-5 text-right shrink-0">{i + 1}</span>
                    <p className="flex-1 text-sm font-bold text-gray-800 truncate">{s.name}</p>
                    {showGrades && (
                      <input
                        value={entry?.grades?.[s.id] ?? ''}
                        onChange={e => updateEntry(en => ({ ...en, grades: { ...(en.grades ?? {}), [s.id]: e.target.value } }))}
                        placeholder="nota"
                        className="w-14 text-center text-xs font-bold border border-gray-200 rounded-lg py-1.5 bg-gray-50"
                      />
                    )}
                    <button
                      onClick={() => cycleAtt(s.id)}
                      aria-label={`${s.name}: ${a === 'P' ? 'presente' : a === 'F' ? 'falta' : a === 'A' ? 'atraso' : 'sem marcação'}. Toque para alternar presente, falta, atraso.`}
                      className={`w-9 h-9 rounded-xl font-black text-sm shrink-0 transition-colors ${attStyle(a)}`}
                    >
                      {a ?? '·'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Adicionar aluno inline */}
            {diarioBulkNames ? (
              <div className="space-y-2 mb-4">
                <textarea
                  value={diarioBulkNames}
                  onChange={e => setDiarioBulkNames(e.target.value)}
                  rows={5}
                  placeholder={"Um nome por linha:\nAna\nCarlos\n..."}
                  className="w-full border border-indigo-300 rounded-xl px-3 py-2 text-sm focus:outline-none bg-white resize-none"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={() => setDiarioBulkNames('')} className="flex-1 bg-gray-100 text-gray-600 font-bold py-2 rounded-xl text-sm">Cancelar</button>
                  <button
                    onClick={() => {
                      const seen = new Set((cls?.students ?? []).map(s => s.name.toLowerCase()));
                      const names = diarioBulkNames.split('\n').map(n => n.trim()).filter(n => {
                        const k = n.toLowerCase();
                        if (!n || seen.has(k)) return false;
                        seen.add(k);
                        return true;
                      });
                      if (names.length === 0 || !classId) { setDiarioBulkNames(''); return; }
                      const newStudents: GamiStudent[] = names.map(name => ({ id: gamiRid(), name, xp: 0, totalXp: 0, weekXp: 0, coins: 0, badges: [], streak: 0 }));
                      setGamiClasses(list => {
                        const existing = list.find(c => c.id === classId);
                        if (existing) return list.map(c => c.id === classId ? { ...c, students: [...c.students, ...newStudents] } : c);
                        return [...list, { ...gamiDefaultClass(classId), students: newStudents }];
                      });
                      setDiarioBulkNames('');
                      toast.success(`${names.length} aluno${names.length > 1 ? 's' : ''} adicionado${names.length > 1 ? 's' : ''}!`);
                    }}
                    className="flex-1 bg-indigo-600 text-white font-bold py-2 rounded-xl text-sm"
                  >Adicionar lista</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mb-4 items-center">
                <input
                  value={newStudentName}
                  onChange={e => setNewStudentName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addStudent()}
                  placeholder="+ Adicionar aluno"
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                />
                {newStudentName.trim() ? (
                  <button onClick={addStudent} className="bg-indigo-600 text-white px-4 rounded-xl font-bold py-2"><Plus size={16} /></button>
                ) : (
                  <button onClick={() => setDiarioBulkNames(' ')} className="text-indigo-500 text-xs font-bold whitespace-nowrap px-1">Colar lista</button>
                )}
              </div>
            )}

            {/* Anotações do dia */}
            {(() => {
              const sched = schedules.find(s => s.id === classId);
              const scheduledLesson = sched && classes?.find(c =>
                c.className === sched.name && c.status === 'pending' &&
                toISODate(new Date(c.timestamp)) === date
              );
              return (
                <div>
                  {scheduledLesson && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2 mb-2 flex items-start gap-2">
                      <BookOpen size={14} className="text-indigo-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-indigo-700 truncate">{scheduledLesson.title}</p>
                        {scheduledLesson.topic && <p className="text-[11px] text-indigo-500 mt-0.5 line-clamp-2">{scheduledLesson.topic}</p>}
                      </div>
                      <button
                        onClick={() => updateEntry(en => ({ ...en, note: (en.note ? en.note + '\n' : '') + scheduledLesson.title + (scheduledLesson.topic ? ': ' + scheduledLesson.topic : '') }))}
                        className="ml-auto text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0"
                      >
                        Copiar
                      </button>
                    </div>
                  )}
                  <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">Anotações do dia</label>
                  <textarea
                    value={entry?.note ?? ''}
                    onChange={e => updateEntry(en => ({ ...en, note: e.target.value }))}
                    rows={3}
                    placeholder="Conteúdo dado, ocorrências, lembretes..."
                    className="w-full bg-white border border-gray-200 rounded-2xl py-3 px-4 text-sm resize-none"
                  />
                </div>
              );
            })()}
            <p className="text-[11px] text-gray-400 text-center mt-2">P = presente · F = falta · A = atraso. Toque para alternar. Salva automaticamente.</p>
          </>
        )}
      </div>
    </motion.div>
  );
};

// ─── Gamificação de Turma ─────────────────────────────────────────────────────
const GamificacaoScreen = ({
  schedules,
  user,
  profile,
  setScreen,
}: {
  schedules: ClassSchedule[];
  user: any;
  profile: UserProfile;
  setScreen: (s: Screen) => void;
}) => {
  const [gamiClasses, setGamiClasses] = useFirestoreSync<ClassGamification>('gamification', user, []);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(schedules[0]?.id ?? null);
  const [tab, setTab] = useState<'alunos' | 'equipes' | 'loja' | 'ajustes'>('alunos');
  const [liveTool, setLiveTool] = useState<string | null>(null);
  const [kitExpanded, setKitExpanded] = useState(false);
  const [awardingStudentId, setAwardingStudentId] = useState<string | null>(null);
  const [shopStudentId, setShopStudentId] = useState<string | null>(null);
  const [newStudentName, setNewStudentName] = useState('');
  const [showSeasonEnd, setShowSeasonEnd] = useState(false);
  const [teamStudentId, setTeamStudentId] = useState<string | null>(null);
  const [newBehaviorLabel, setNewBehaviorLabel] = useState('');
  const [newBehaviorPoints, setNewBehaviorPoints] = useState('3');
  const [newRewardLabel, setNewRewardLabel] = useState('');
  const [newRewardCost, setNewRewardCost] = useState('15');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkNames, setBulkNames] = useState('');

  // Schedules chegam do Firestore de forma assíncrona: garante turma selecionada válida
  useEffect(() => {
    if (schedules.length === 0) return;
    if (!selectedClassId || !schedules.some(s => s.id === selectedClassId)) {
      setSelectedClassId(schedules[0].id);
    }
  }, [schedules, selectedClassId]);

  const selectedSchedule = schedules.find(s => s.id === selectedClassId);
  const wk = gamiWeekKey();

  const currentCls = useMemo<ClassGamification | null>(() => {
    if (!selectedClassId) return null;
    return gamiClasses.find(c => c.id === selectedClassId) ?? gamiDefaultClass(selectedClassId);
  }, [gamiClasses, selectedClassId]);

  const weekXpOf = (s: GamiStudent) =>
    currentCls?.weekKey === wk ? (s.weekXp ?? 0) : 0;

  const skin = GAMI_SKINS[currentCls?.skin ?? 'coruja'];

  const updateCls = (updater: (prev: ClassGamification) => ClassGamification) => {
    if (!selectedClassId) return;
    const existing = gamiClasses.find(c => c.id === selectedClassId);
    const prev = existing ?? gamiDefaultClass(selectedClassId);
    const next = updater(prev);
    if (existing) {
      setGamiClasses(list => list.map(c => c.id === selectedClassId ? next : c));
    } else {
      setGamiClasses(list => [...list, next]);
    }
  };

  const checkBadges = (students: GamiStudent[], _cls: ClassGamification): GamiStudent[] => {
    return students.map(s => {
      const badges = [...s.badges];
      GAMI_BADGES.forEach(b => {
        if (!badges.includes(b.id) && b.check(s)) badges.push(b.id);
      });
      return { ...s, badges };
    });
  };

  const awardPoints = (studentIds: string[], behavior: GamiBehavior) => {
    const points = behavior.points;
    const coins = points > 0 ? Math.max(1, Math.floor(points / 5)) : 0;
    const today = gamiTodayKey();

    updateCls(cls => {
      const isNewWeek = cls.weekKey !== wk;
      const students = cls.students.map(raw => {
        // Virada de semana: zera o XP semanal de todos antes de acumular
        const s = isNewWeek ? { ...raw, weekXp: 0 } : raw;
        if (!studentIds.includes(s.id)) return s;
        const newXp = Math.max(0, s.xp + points);
        const newTotal = s.totalXp + (points > 0 ? points : 0);
        const newWeekXp = (s.weekXp ?? 0) + (points > 0 ? points : 0);
        const newCoins = Math.max(0, s.coins + coins);
        const streak = points > 0
          ? (s.lastPointDay === today ? s.streak : s.lastPointDay === gamiYesterdayKey() ? s.streak + 1 : 1)
          : s.streak;
        return { ...s, xp: newXp, totalXp: newTotal, weekXp: newWeekXp, coins: newCoins, streak, lastPointDay: points > 0 ? today : s.lastPointDay };
      });
      const checked = checkBadges(students, { ...cls, weekKey: wk, students });
      // Missão de semana anterior expira na virada — sem isso ela ficava "morta"
      // no estado: parava de contar e nunca era limpa.
      let mission = cls.mission && cls.mission.weekKey === wk ? cls.mission : null;
      if (mission && points > 0) {
        mission = { ...mission, progress: mission.progress + points * studentIds.length };
      }
      const logEntry: GamiLogEntry = { id: gamiRid(), studentIds, label: behavior.label, emoji: behavior.emoji, points, coins, kind: 'award', date: Date.now() };
      return { ...cls, students: checked, weekKey: wk, log: [logEntry, ...cls.log].slice(0, 200), mission };
    });

    if (currentCls?.soundOn !== false) playChime();
    setAwardingStudentId(null);
  };

  const purchaseReward = (studentId: string, reward: GamiReward) => {
    let ok = true;
    updateCls(cls => {
      const s = cls.students.find(x => x.id === studentId);
      if (!s || s.coins < reward.cost) { ok = false; return cls; }
      const students = cls.students.map(x => x.id === studentId ? { ...x, coins: x.coins - reward.cost } : x);
      const logEntry: GamiLogEntry = { id: gamiRid(), studentIds: [studentId], label: reward.label, emoji: reward.emoji, points: 0, coins: -reward.cost, kind: 'purchase', date: Date.now() };
      return { ...cls, students, log: [logEntry, ...cls.log].slice(0, 200) };
    });
    if (!ok) { toast.error('Corujinhas insuficientes!'); return; }
    toast.success(`${reward.emoji} ${reward.label} resgatada!`);
    setShopStudentId(null);
  };

  const addStudent = () => {
    const name = newStudentName.trim();
    if (!name) return;
    updateCls(cls => ({ ...cls, students: [...cls.students, { id: gamiRid(), name, xp: 0, totalXp: 0, weekXp: 0, coins: 0, badges: [], streak: 0 }] }));
    setNewStudentName('');
  };

  const removeStudent = (id: string) => {
    updateCls(cls => ({ ...cls, students: cls.students.filter(s => s.id !== id) }));
  };

  const endSeason = () => {
    if (!currentCls) return;
    const top = [...currentCls.students].sort((a, b) => b.totalXp - a.totalXp).slice(0, 5);
    const entry: GamiHallEntry = { season: currentCls.season, date: Date.now(), top: top.map(s => ({ name: s.name, xp: s.totalXp })) };
    updateCls(cls => ({
      ...cls,
      season: cls.season + 1,
      hallOfFame: [...(cls.hallOfFame ?? []), entry],
      // totalXp é vitalício (nível/skins/badges) e sobrevive à virada de temporada.
      students: cls.students.map(s => ({ ...s, xp: 0, weekXp: 0, coins: 0, streak: 0, lastPointDay: undefined, participatedDay: undefined })),
      log: [],
      mission: null,
      weekKey: gamiWeekKey(),
    }));
    setShowSeasonEnd(false);
    toast.success('🏆 Nova temporada iniciada!');
  };

  const LIVE_TOOLS = [
    { id: 'sorteio', icon: Ticket, grad: 'from-violet-500 to-indigo-600', label: 'Sorteador' },
    { id: 'timer', icon: TimerIcon, grad: 'from-sky-500 to-blue-600', label: 'Timer' },
    { id: 'grupos', icon: Users, grad: 'from-teal-400 to-cyan-600', label: 'Grupos' },
    { id: 'barulho', icon: Volume2, grad: 'from-emerald-400 to-green-600', label: 'Barulho' },
    { id: 'semaforo', icon: Siren, grad: 'from-emerald-400 via-amber-400 to-red-500', label: 'Semáforo' },
    { id: 'dado', icon: Dices, grad: 'from-slate-500 to-slate-700', label: 'Dado' },
    { id: 'placar', icon: Trophy, grad: 'from-amber-500 to-orange-600', label: 'Placar' },
    { id: 'batalha', icon: Swords, grad: 'from-rose-500 to-red-600', label: 'Batalha' },
  ];

  if (schedules.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center min-h-[70vh] gap-6 px-6 text-center">
        <img src="https://i.ibb.co/FbhRcLsz/Sem-nome-1300-x-1300-px-20260616-150714-0000.png" alt="" className="w-32 h-auto object-contain" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
        <div>
          <h2 className="text-xl font-black text-gray-900 mb-2">Nenhuma turma cadastrada</h2>
          <p className="text-gray-500 text-sm">Cadastre suas turmas na Agenda para ativar a gamificação.</p>
        </div>
        <button onClick={() => setScreen('calendar')} className="bg-indigo-600 text-white font-bold px-6 py-3 rounded-2xl text-sm">
          Ir para a Agenda
        </button>
      </motion.div>
    );
  }

  if (!currentCls) return null;

  const awardingStudent = currentCls.students.find(s => s.id === awardingStudentId) ?? null;

  const bannerColor = selectedSchedule?.color || '#4F46E5';
  const totalXp = currentCls.students.reduce((sum, s) => sum + (s.totalXp ?? s.xp ?? 0), 0);
  const topStudent = [...currentCls.students].sort((a, b) => (b.totalXp ?? b.xp ?? 0) - (a.totalXp ?? a.xp ?? 0))[0];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pb-44">
      {/* Placeholder no topo (mesmo padrão do Header bannerPlaceholder) */}
      <div className="mb-3 relative z-50">
        <div className="absolute -top-12 -left-6 -right-6 h-36 z-[-1] overflow-hidden">
          <img src="https://i.ibb.co/tTT0VWnH/Design-sem-nome-20260616-142319-0000.png" alt="Banner" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
        </div>
        {/* Título e controles da turma */}
        <div className="flex items-center justify-between pt-28 mb-1">
        <div>
          <h1 className="text-xl font-black text-gray-900">{selectedSchedule?.name ?? 'Turma Gamificada'}</h1>
          <p className="text-[11px] text-indigo-500 font-bold uppercase tracking-widest">{selectedSchedule?.subject ?? ''} · Temporada {currentCls.season}</p>
        </div>
        <button
          onClick={() => updateCls(c => ({ ...c, soundOn: c.soundOn === false ? true : false }))}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${currentCls.soundOn !== false ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}
        >
          <Volume2 size={16} />
        </button>
      </div>
      </div>{/* fecha .mb-3.relative */}
      {/* Seletor de turma */}
      {schedules.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar pb-1">
          {schedules.map(s => (
            <button
              key={s.id}
              onClick={() => { setSelectedClassId(s.id); setTab('alunos'); }}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${selectedClassId === s.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Summary strip — faixa fina única */}
      <div className="flex items-center justify-around bg-white rounded-2xl border border-gray-100 shadow-sm py-2.5 px-3 mb-4">
        <div className="text-center px-2">
          <span className="text-lg font-black text-indigo-700 tabular-nums">{currentCls.students.length}</span>
          <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide">Alunos</span>
        </div>
        <div className="w-px h-7 bg-gray-100" />
        <div className="text-center px-2">
          <span className="text-lg font-black text-amber-600 tabular-nums">{currentCls.students.reduce((a, s) => a + weekXpOf(s), 0)}</span>
          <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide">XP semana</span>
        </div>
        <div className="w-px h-7 bg-gray-100" />
        <div className="text-center px-2">
          <span className="text-lg font-black text-emerald-600 tabular-nums">{currentCls.teams.length}</span>
          <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide">Equipes</span>
        </div>
      </div>

      {/* Tabs */}
      <PillTabs
        layoutKey="gami"
        className="mb-4"
        stretch
        tabs={[
          { id: 'alunos', label: 'Alunos', icon: Users },
          { id: 'equipes', label: 'Equipes', icon: Trophy },
          { id: 'loja', label: 'Loja', icon: Gift },
          { id: 'ajustes', label: 'Ajustes', icon: Settings },
        ]}
        active={tab}
        onChange={id => setTab(id as any)}
      />

      {/* ── Kit ao Vivo — fixado logo abaixo das abas ── */}
      <div className="mb-4">
        <button
          onClick={() => setKitExpanded(e => !e)}
          className="w-full bg-gradient-to-br from-indigo-600 to-indigo-800 text-white font-bold py-3 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 active:scale-[0.98] transition-transform"
        >
          <Zap size={16} />
          <span className="text-sm">Kit ao Vivo</span>
          <ChevronDown size={14} className={`transition-transform duration-200 ${kitExpanded ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence>
          {kitExpanded && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              className="bg-white rounded-3xl p-3 mt-2 shadow-xl border border-gray-100 grid grid-cols-4 gap-1.5"
            >
              {LIVE_TOOLS.map(tool => (
                <button
                  key={tool.id}
                  onClick={() => { setLiveTool(tool.id); setKitExpanded(false); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-2xl active:scale-90 transition-transform"
                >
                  <span className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${tool.grad} flex items-center justify-center shadow-md`}>
                    <tool.icon size={19} className="text-white" strokeWidth={2.4} />
                  </span>
                  <span className="text-[9px] font-bold text-gray-600 leading-tight text-center">{tool.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">

        {/* ── Alunos ─────────────────────────────────────────────────────────── */}
        {tab === 'alunos' && (
          <motion.div key="alunos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            {currentCls.students.length === 0 ? (
              <div className="text-center py-10">
                <img src="https://i.ibb.co/FbhRcLsz/Sem-nome-1300-x-1300-px-20260616-150714-0000.png" alt="" className="w-28 h-auto object-contain mx-auto mb-2" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
                <p className="text-gray-500 mt-3 text-sm font-bold">Nenhum aluno ainda</p>
                <p className="text-gray-400 text-xs mt-1">Adicione alunos abaixo para começar.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {[...currentCls.students].sort((a, b) => b.totalXp - a.totalXp).map(s => {
                  const lvl = gamiLevel(s.totalXp);
                  const pct = gamiLevelProgress(s.totalXp) * 100;
                  const sWXp = weekXpOf(s);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setAwardingStudentId(s.id)}
                      className="bg-white rounded-2xl p-3 text-center shadow-sm border border-gray-100 active:scale-95 transition-transform"
                    >
                      <div className="relative mx-auto w-10 h-10 mb-1.5 flex items-center justify-center">
                        <span className="text-[30px] leading-none">{skin[lvl]}</span>
                        {s.streak >= 3 && (
                          <span className="absolute -top-1 -right-1 text-[9px] bg-orange-400 text-white rounded-full w-4 h-4 flex items-center justify-center leading-none">🔥</span>
                        )}
                      </div>
                      <p className="text-[11px] font-bold text-gray-800 truncate leading-tight">{s.name}</p>
                      <p className="text-[9px] text-indigo-400 font-bold leading-tight">{GAMI_LEVELS[lvl].name}</p>
                      <div className="h-1 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      {sWXp > 0 && <p className="text-[9px] text-amber-500 font-black mt-1">+{sWXp}</p>}
                      {s.coins > 0 && <p className="text-[9px] text-yellow-500 font-bold">🪙{s.coins}</p>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Gerenciar alunos (inline) */}
            <div className="pt-1 space-y-2">
              <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">Gerenciar alunos</p>
              {/* Modo individual vs. lista em lote */}
              <div className="flex gap-2 mb-1">
                <button onClick={() => { setBulkMode(false); setBulkNames(''); }} className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${!bulkMode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200'}`}>
                  Um por vez
                </button>
                <button onClick={() => setBulkMode(true)} className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${bulkMode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200'}`}>
                  Lista em lote
                </button>
              </div>

              {!bulkMode ? (
                <div className="flex gap-2">
                  <input
                    value={newStudentName}
                    onChange={e => setNewStudentName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addStudent()}
                    placeholder="Nome do aluno (Enter para adicionar)"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400"
                  />
                  <button onClick={addStudent} className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-bold">
                    <Plus size={16} />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    value={bulkNames}
                    onChange={e => setBulkNames(e.target.value)}
                    rows={8}
                    placeholder={"Cole ou escreva os nomes, um por linha:\n\nAna Beatriz\nCarlos Eduardo\nMariana\nPedro Henrique\n..."}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400 resize-none bg-white"
                  />
                  {(() => {
                    const names = bulkNames.split('\n').map(n => n.trim()).filter(n => n.length > 0);
                    const newNames = names.filter(n => !currentCls.students.some(s => s.name.toLowerCase() === n.toLowerCase()));
                    return (
                      <button
                        onClick={() => {
                          if (newNames.length === 0) return;
                          updateCls(cls => ({
                            ...cls,
                            students: [
                              ...cls.students,
                              ...newNames.map(name => ({ id: gamiRid(), name, xp: 0, totalXp: 0, weekXp: 0, coins: 0, badges: [], streak: 0 }))
                            ]
                          }));
                          setBulkNames('');
                          setBulkMode(false);
                          toast.success(`${newNames.length} aluno${newNames.length > 1 ? 's' : ''} adicionado${newNames.length > 1 ? 's' : ''}!`);
                        }}
                        disabled={newNames.length === 0}
                        className="w-full bg-indigo-600 disabled:opacity-40 text-white font-bold py-3 rounded-xl text-sm active:scale-[0.98] transition-transform"
                      >
                        {newNames.length > 0 ? `+ Adicionar ${newNames.length} aluno${newNames.length > 1 ? 's' : ''}` : 'Digite nomes acima'}
                      </button>
                    );
                  })()}
                  {bulkNames.split('\n').some(n => {
                    const t = n.trim();
                    return t.length > 0 && currentCls.students.some(s => s.name.toLowerCase() === t.toLowerCase());
                  }) && (
                    <p className="text-[11px] text-amber-600 font-medium px-1">Nomes já cadastrados serão ignorados automaticamente.</p>
                  )}
                </div>
              )}

              {currentCls.students.length > 0 && (
                <p className="text-[11px] text-gray-400 px-1">{currentCls.students.length} aluno{currentCls.students.length !== 1 ? 's' : ''} cadastrado{currentCls.students.length !== 1 ? 's' : ''}. Ficam salvos automaticamente.</p>
              )}
              {currentCls.students.map(s => (
                <div key={s.id} className="bg-white rounded-xl px-3 py-2.5 flex items-center justify-between shadow-sm border border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{skin[gamiLevel(s.totalXp)]}</span>
                    <div>
                      <p className="text-sm font-bold text-gray-800">{s.name}</p>
                      <p className="text-[10px] text-gray-400">{GAMI_LEVELS[gamiLevel(s.totalXp)].name} · {s.totalXp} XP · 🪙{s.coins}</p>
                    </div>
                  </div>
                  <button onClick={() => removeStudent(s.id)} className="text-red-300 hover:text-red-500 p-1.5 transition-colors"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Equipes ─────────────────────────────────────────────────────────── */}
        {tab === 'equipes' && (
          <motion.div key="equipes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            {currentCls.teams.length === 0 ? (
              <div className="text-center py-10">
                <span className="text-4xl">🏆</span>
                <p className="text-gray-500 mt-2 text-sm font-bold">Nenhuma equipe configurada</p>
                <p className="text-gray-400 text-xs mt-1">Crie equipes abaixo.</p>
              </div>
            ) : (
              <>
                <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Ranking desta semana</p>
                {(() => {
                  const sorted = [...currentCls.teams].map(t => ({
                    team: t,
                    xp: currentCls.students.filter(s => s.teamId === t.id).reduce((a, s) => a + weekXpOf(s), 0),
                    total: currentCls.students.filter(s => s.teamId === t.id).reduce((a, s) => a + s.totalXp, 0),
                    count: currentCls.students.filter(s => s.teamId === t.id).length,
                  })).sort((a, b) => b.xp - a.xp || b.total - a.total);
                  const maxXp = Math.max(1, ...sorted.map(t => t.xp));
                  return sorted.map((t, i) => (
                    <div key={t.team.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-black text-gray-400">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}°`}</span>
                          <span className="text-2xl">{t.team.emoji}</span>
                          <span className="font-black text-gray-800">{t.team.name}</span>
                        </div>
                        <span className="font-black text-indigo-600 text-lg tabular-nums">{t.xp} <span className="text-xs font-bold text-indigo-300">XP</span></span>
                      </div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(t.xp / maxXp) * 100}%`, backgroundColor: t.team.color }} />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-[10px] text-gray-400">{t.count} aluno{t.count !== 1 ? 's' : ''}</p>
                        <p className="text-[10px] text-gray-400">{t.total} XP total</p>
                      </div>
                    </div>
                  ));
                })()}
                {currentCls.students.some(s => !s.teamId) && (
                  <div className="bg-amber-50 rounded-2xl p-3 border border-amber-100">
                    <p className="text-xs font-bold text-amber-700 mb-2">Sem equipe. Toque para atribuir:</p>
                    <div className="flex flex-wrap gap-1">
                      {currentCls.students.filter(s => !s.teamId).map(s => (
                        <button key={s.id} onClick={() => setTeamStudentId(s.id)} className="bg-white text-gray-700 text-xs font-bold px-2.5 py-1 rounded-full border border-amber-200 active:scale-95 transition-transform">
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Gerenciar equipes (inline) */}
            <div className="pt-1 space-y-3">
              <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">Gerenciar equipes</p>
              {currentCls.teams.length === 0 ? (
                <button onClick={() => updateCls(cls => ({ ...cls, teams: GAMI_TEAM_PRESETS.slice(0, 4).map(t => ({ ...t, id: gamiRid() })) }))} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl text-sm active:scale-[0.98] transition-transform">
                  + Criar 4 equipes padrão
                </button>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {GAMI_TEAM_PRESETS.filter(p => !currentCls.teams.some(t => t.name === p.name)).map(p => (
                    <button
                      key={p.name}
                      onClick={() => updateCls(cls => ({ ...cls, teams: [...cls.teams, { ...p, id: gamiRid() }] }))}
                      className="flex items-center gap-1 bg-white border border-gray-200 text-gray-700 text-xs font-bold px-3 py-1.5 rounded-full active:scale-95 transition-transform"
                    >
                      {p.emoji} + {p.name}
                    </button>
                  ))}
                </div>
              )}
              {currentCls.teams.map(team => {
                const members = currentCls.students.filter(s => s.teamId === team.id);
                return (
                  <div key={team.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-black text-gray-800">{team.emoji} {team.name}</span>
                      <button onClick={() => updateCls(cls => ({ ...cls, teams: cls.teams.filter(t => t.id !== team.id), students: cls.students.map(s => s.teamId === team.id ? { ...s, teamId: undefined } : s) }))} className="text-red-300 hover:text-red-500 transition-colors p-1">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {members.map(s => <span key={s.id} className="bg-gray-100 text-gray-700 text-xs font-bold px-2 py-0.5 rounded-full">{s.name}</span>)}
                      {members.length === 0 && <span className="text-xs text-gray-300 italic">Sem membros</span>}
                    </div>
                  </div>
                );
              })}
              {currentCls.students.some(s => !s.teamId) && currentCls.teams.length > 0 && (
                <div className="bg-amber-50 rounded-2xl p-3 border border-amber-100 space-y-2">
                  <p className="text-xs font-bold text-amber-700">Atribuir equipe:</p>
                  {currentCls.students.filter(s => !s.teamId).map(s => (
                    <div key={s.id} className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-gray-700 shrink-0">{s.name}:</span>
                      {currentCls.teams.map(t => (
                        <button key={t.id} onClick={() => updateCls(cls => ({ ...cls, students: cls.students.map(x => x.id === s.id ? { ...x, teamId: t.id } : x) }))} className="text-xs bg-white font-bold px-2 py-0.5 rounded-full border border-amber-200 active:scale-95 transition-transform">
                          {t.emoji} {t.name}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Loja ─────────────────────────────────────────────────────────── */}
        {tab === 'loja' && (
          <motion.div key="loja" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">Resgatar</p>
            <p className="text-xs text-gray-400 font-medium">Alunos trocam 🪙 corujinhas por privilégios. Selecione um aluno e depois resgate.</p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
              {currentCls.students.map(s => (
                <button
                  key={s.id}
                  onClick={() => setShopStudentId(shopStudentId === s.id ? null : s.id)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold transition-all ${shopStudentId === s.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}
                >
                  <span>{skin[gamiLevel(s.totalXp)]}</span>
                  <span className="max-w-[60px] truncate">{s.name}</span>
                  <span className={`font-black ${shopStudentId === s.id ? 'text-amber-300' : 'text-amber-500'}`}>🪙{s.coins}</span>
                </button>
              ))}
              {currentCls.students.length === 0 && <p className="text-xs text-gray-400 py-1">Adicione alunos na aba Alunos.</p>}
            </div>
            {currentCls.rewards.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                <Gift size={36} className="mx-auto text-gray-300" />
                <p className="mt-2 font-bold">Sem recompensas configuradas</p>
                <p className="text-xs mt-1">Adicione recompensas abaixo.</p>
              </div>
            ) : (
              currentCls.rewards.map(r => {
                const buyer = shopStudentId ? currentCls.students.find(s => s.id === shopStudentId) : null;
                const canAfford = buyer ? buyer.coins >= r.cost : false;
                return (
                  <div key={r.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-xl shrink-0">{r.emoji}</span>
                      <div>
                        <p className="font-bold text-gray-800 text-sm">{r.label}</p>
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 font-black bg-amber-100 rounded-full px-2 py-0.5 mt-1">🪙 {r.cost} corujinhas</span>
                      </div>
                    </div>
                    {shopStudentId ? (
                      <button
                        onClick={() => purchaseReward(shopStudentId, r)}
                        disabled={!canAfford}
                        className={`font-bold text-xs px-3 py-2 rounded-xl active:scale-95 transition-all ${canAfford ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                      >
                        {canAfford ? 'Resgatar' : 'Sem saldo'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300 font-bold">↑ selecione</span>
                    )}
                  </div>
                );
              })
            )}

            {/* Configurar recompensas (inline) */}
            <div className="pt-1 space-y-2">
              <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">Configurar recompensas</p>
              <p className="text-xs text-gray-400">Recompensas que alunos resgatam com 🪙 corujinhas.</p>
              {currentCls.rewards.map(r => (
                <div key={r.id} className="bg-white rounded-xl px-3 py-2.5 flex items-center gap-3 shadow-sm border border-gray-100">
                  <span className="text-xl">{r.emoji}</span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-gray-800">{r.label}</p>
                    <p className="text-xs text-amber-500 font-black">🪙 {r.cost}</p>
                  </div>
                  <button onClick={() => updateCls(cls => ({ ...cls, rewards: cls.rewards.filter(x => x.id !== r.id) }))} className="text-red-300 hover:text-red-500 p-1 transition-colors"><Trash2 size={14} /></button>
                </div>
              ))}
              {currentCls.rewards.length === 0 && (
                <button onClick={() => updateCls(cls => ({ ...cls, rewards: GAMI_DEFAULT_REWARDS }))} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl text-sm">
                  + Restaurar recompensas padrão
                </button>
              )}
              <div className="bg-gray-50 rounded-xl p-3 space-y-2 border border-gray-200">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Nova recompensa personalizada</p>
                <input value={newRewardLabel} onChange={e => setNewRewardLabel(e.target.value)} placeholder="Ex: Jogar jogo no computador..." maxLength={60} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white" />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] font-bold text-gray-400 mb-0.5 block">Custo em 🪙 corujinhas</label>
                    <input type="number" value={newRewardCost} onChange={e => setNewRewardCost(e.target.value)} min={1} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white" />
                  </div>
                  <button
                    onClick={() => {
                      const label = newRewardLabel.trim();
                      const cost = parseInt(newRewardCost) || 1;
                      if (!label) return;
                      updateCls(cls => ({ ...cls, rewards: [...cls.rewards, { id: gamiRid(), label, cost, emoji: '🎁' }] }));
                      setNewRewardLabel(''); setNewRewardCost('15');
                      toast.success('Recompensa adicionada!');
                    }}
                    className="self-end bg-amber-500 text-white px-4 py-2 rounded-lg font-bold text-sm"
                  >+ Add</button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Ajustes ─────────────────────────────────────────────────────────── */}
        {tab === 'ajustes' && (
          <motion.div key="ajustes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">Pontuações</p>
            <div className="space-y-2">
                <p className="text-xs text-gray-400">Ações disponíveis ao pontuar alunos.</p>
                {currentCls.behaviors.map(b => (
                  <div key={b.id} className="bg-white rounded-xl px-3 py-2.5 flex items-center gap-3 shadow-sm border border-gray-100">
                    <span className="text-xl">{b.emoji}</span>
                    <span className="flex-1 text-sm font-bold text-gray-800">{b.label}</span>
                    <span className={`text-sm font-black tabular-nums mr-1 ${b.points > 0 ? 'text-emerald-500' : 'text-red-400'}`}>{b.points > 0 ? '+' : ''}{b.points} XP</span>
                    <button onClick={() => updateCls(cls => ({ ...cls, behaviors: cls.behaviors.filter(x => x.id !== b.id) }))} className="text-red-300 hover:text-red-500 p-1 transition-colors"><Trash2 size={14} /></button>
                  </div>
                ))}
                {currentCls.behaviors.length === 0 && (
                  <button onClick={() => updateCls(cls => ({ ...cls, behaviors: GAMI_DEFAULT_BEHAVIORS }))} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl text-sm">
                    + Restaurar ações padrão
                  </button>
                )}
                <div className="bg-gray-50 rounded-xl p-3 space-y-2 border border-gray-200">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Nova ação personalizada</p>
                  <input value={newBehaviorLabel} onChange={e => setNewBehaviorLabel(e.target.value)} placeholder="Ex: Apresentou trabalho..." maxLength={60} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white" />
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-gray-400 mb-0.5 block">Pontos (negativo = penalidade)</label>
                      <input type="number" value={newBehaviorPoints} onChange={e => setNewBehaviorPoints(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white" />
                    </div>
                    <button
                      onClick={() => {
                        const label = newBehaviorLabel.trim();
                        const pts = parseInt(newBehaviorPoints) || 0;
                        if (!label) return;
                        const emoji = pts > 0 ? '⭐' : '⚠️';
                        updateCls(cls => ({ ...cls, behaviors: [...cls.behaviors, { id: gamiRid(), label, points: pts, emoji }] }));
                        setNewBehaviorLabel(''); setNewBehaviorPoints('3');
                        toast.success('Ação adicionada!');
                      }}
                      className="self-end bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm"
                    >+ Add</button>
                  </div>
                </div>
              </div>

            <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1 pt-2">Temporada e visual</p>
            <div className="space-y-4">
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  <p className="font-black text-gray-900 mb-1">Temporada {currentCls.season}</p>
                  <p className="text-xs text-gray-500 mb-4">Encerrar salva o pódio no Hall da Fama e zera XP e moedas de todos os alunos. Use no fim do bimestre.</p>
                  <button onClick={() => setShowSeasonEnd(true)} className="w-full bg-red-500 text-white font-bold py-3 rounded-xl text-sm active:scale-[0.98] transition-transform">
                    🏆 Encerrar Temporada {currentCls.season}
                  </button>
                </div>
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  <p className="font-black text-gray-900 mb-3">Visual dos avatares</p>
                  <div className="flex gap-3">
                    {(Object.keys(GAMI_SKINS) as Array<keyof typeof GAMI_SKINS>).map(skinKey => (
                      <button
                        key={skinKey}
                        onClick={() => updateCls(cls => ({ ...cls, skin: skinKey }))}
                        className={`flex-1 p-3 rounded-xl border-2 text-center transition-all ${(currentCls.skin ?? 'coruja') === skinKey ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white'}`}
                      >
                        <div className="flex justify-center gap-0.5 mb-1">{GAMI_SKINS[skinKey].slice(0, 3).map((e, i) => <span key={i} className="text-base">{e}</span>)}</div>
                        <p className="text-[10px] font-bold text-gray-600 capitalize">{skinKey}</p>
                      </button>
                    ))}
                  </div>
                </div>
                {(currentCls.hallOfFame ?? []).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">🏛️ Hall da Fama</p>
                    {[...(currentCls.hallOfFame ?? [])].reverse().map((entry, i) => (
                      <div key={i} className="bg-amber-50 rounded-2xl p-4 border border-amber-100">
                        <p className="text-xs font-bold text-amber-600 mb-2">Temporada {entry.season} · {new Date(entry.date).toLocaleDateString('pt-BR')}</p>
                        {entry.top.map((t, j) => (
                          <div key={j} className="flex items-center justify-between py-0.5">
                            <span className="text-xs font-bold text-gray-700">{j === 0 ? '🥇' : j === 1 ? '🥈' : j === 2 ? '🥉' : `${j + 1}°`} {t.name}</span>
                            <span className="text-xs font-black text-amber-600 tabular-nums">{t.xp} XP</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Award modal ───────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {awardingStudent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/50 flex items-end justify-center"
            onClick={e => { if (e.target === e.currentTarget) setAwardingStudentId(null); }}
          >
            <motion.div
              initial={{ y: 60 }}
              animate={{ y: 0 }}
              exit={{ y: 60 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="bg-white rounded-t-3xl w-full max-w-md px-4 pb-10 pt-4 max-h-[80vh] overflow-y-auto"
            >
              <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{skin[gamiLevel(awardingStudent.totalXp)]}</span>
                <div>
                  <p className="font-black text-gray-900 text-base">{awardingStudent.name}</p>
                  <p className="text-xs text-indigo-400 font-bold">{GAMI_LEVELS[gamiLevel(awardingStudent.totalXp)].name} · {awardingStudent.totalXp} XP · 🪙{awardingStudent.coins}</p>
                </div>
                {awardingStudent.streak >= 3 && (
                  <span className="ml-auto bg-orange-100 text-orange-500 text-xs font-black px-2 py-1 rounded-full">🔥 {awardingStudent.streak} dias</span>
                )}
              </div>
              {awardingStudent.badges.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-4">
                  {awardingStudent.badges.map(bid => {
                    const badge = GAMI_BADGES.find(b => b.id === bid);
                    return badge ? <span key={bid} className="bg-amber-50 text-amber-600 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200">{badge.emoji} {badge.name}</span> : null;
                  })}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {currentCls.behaviors.map(b => (
                  <button
                    key={b.id}
                    onClick={() => awardPoints([awardingStudent.id], b)}
                    className={`flex items-center gap-2 p-3 rounded-xl border-2 text-left transition-all active:scale-95 ${b.points > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-100 bg-red-50'}`}
                  >
                    <span className="text-xl">{b.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-800 truncate">{b.label}</p>
                      <p className={`text-xs font-black tabular-nums ${b.points > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{b.points > 0 ? '+' : ''}{b.points} XP</p>
                    </div>
                  </button>
                ))}
                <button
                  onClick={() => {
                    const b = currentCls.behaviors.find(x => x.points > 0) ?? { id: 'all', label: 'Toda a turma', points: 5, emoji: '⭐' };
                    awardPoints(currentCls.students.map(s => s.id), b);
                    toast.success(`${b.emoji} +${b.points} XP para toda a turma!`);
                  }}
                  className="col-span-2 flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-indigo-200 bg-indigo-50 active:scale-95 transition-all"
                >
                  <Star size={16} className="text-indigo-500" />
                  <span className="text-xs font-bold text-indigo-700">Pontuar toda a turma</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Season end confirmation ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showSeasonEnd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center px-6">
            <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }} className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
              <p className="text-xl font-black text-gray-900 text-center mb-2">🏆 Encerrar Temporada {currentCls.season}?</p>
              <p className="text-sm text-gray-500 text-center mb-6">O ranking será salvo no Hall da Fama e todos os XP e moedas serão zerados.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowSeasonEnd(false)} className="flex-1 bg-gray-100 text-gray-700 font-bold py-3 rounded-2xl text-sm">Cancelar</button>
                <button onClick={endSeason} className="flex-1 bg-red-500 text-white font-bold py-3 rounded-2xl text-sm">Encerrar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Team assignment modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {teamStudentId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/50 flex items-end justify-center"
            onClick={e => { if (e.target === e.currentTarget) setTeamStudentId(null); }}
          >
            <motion.div
              initial={{ y: 40 }}
              animate={{ y: 0 }}
              exit={{ y: 40 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="bg-white rounded-t-3xl w-full max-w-md px-4 pb-10 pt-4"
            >
              <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
              <p className="font-black text-gray-900 mb-3">Equipe de {currentCls.students.find(s => s.id === teamStudentId)?.name}</p>
              <div className="space-y-2">
                {currentCls.teams.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { updateCls(cls => ({ ...cls, students: cls.students.map(s => s.id === teamStudentId ? { ...s, teamId: t.id } : s) })); setTeamStudentId(null); }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200 active:scale-[0.98] transition-transform"
                  >
                    <span className="text-2xl">{t.emoji}</span>
                    <span className="font-bold text-gray-800">{t.name}</span>
                  </button>
                ))}
                <button onClick={() => { updateCls(cls => ({ ...cls, students: cls.students.map(s => s.id === teamStudentId ? { ...s, teamId: undefined } : s) })); setTeamStudentId(null); }} className="w-full p-3 rounded-xl bg-gray-100 text-gray-500 font-bold text-sm">
                  Sem equipe
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Live tool overlays ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {liveTool === 'sorteio' && (
          <GamiSorteio
            students={currentCls.students}
            onClose={() => setLiveTool(null)}
            onAwardParticipation={id => {
              const b = currentCls.behaviors.find(x => x.label.toLowerCase().includes('particip')) ?? { id: 'part', label: 'Participação', points: 3, emoji: '✋' };
              awardPoints([id], b);
            }}
          />
        )}
        {liveTool === 'timer' && <GamiTimer onClose={() => setLiveTool(null)} />}
        {liveTool === 'grupos' && (
          <GamiGrupos students={currentCls.students} onClose={() => setLiveTool(null)} />
        )}
        {liveTool === 'barulho' && (
          <GamiBarulho
            onClose={() => setLiveTool(null)}
            onRewardClass={points => awardPoints(currentCls.students.map(s => s.id), { id: 'silencio', label: 'Desafio do Silêncio', points, emoji: '🤫' })}
          />
        )}
        {liveTool === 'semaforo' && <GamiSemaforo onClose={() => setLiveTool(null)} />}
        {liveTool === 'dado' && <GamiDado onClose={() => setLiveTool(null)} />}
        {liveTool === 'placar' && <GamiPlacar teams={currentCls.teams} onClose={() => setLiveTool(null)} />}
        {liveTool === 'batalha' && (
          <GamiBatalha
            isAdmin={isAdminAccount(profile, user)}
            teams={currentCls.teams}
            students={currentCls.students}
            subject={selectedSchedule?.subject ?? selectedSchedule?.name ?? 'Geral'}
            level={selectedSchedule?.level ?? 'Fundamental'}
            onClose={() => setLiveTool(null)}
            onAwardTeam={(teamIdx, _names, points) => {
              const team = currentCls.teams[teamIdx];
              if (!team) return;
              const ids = currentCls.students.filter(s => s.teamId === team.id).map(s => s.id);
              if (ids.length === 0) return;
              awardPoints(ids, { id: 'batalha', label: 'Batalha de Revisão', points, emoji: '⚔️' });
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// --- Global Task Indicator ---

const TaskCard = ({ task, onTaskClick }: { task: BackgroundTask, onTaskClick?: (task: BackgroundTask) => void }) => {
  const ctx: 'planner' | 'studio' = isStudioTaskType(task.type) ? 'studio' : 'planner';
  const rotatingMsg = useFunnyLoadingMessage(task.status === 'processing', ctx);
  return (
    <motion.div
      key={task.id}
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      onClick={() => task.status === 'completed' && onTaskClick?.(task)}
      className={`pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl p-3 shadow-xl border border-indigo-100 flex items-center justify-between gap-4 max-w-sm mx-auto overflow-hidden relative ${task.status === 'completed' ? 'cursor-pointer hover:bg-slate-50' : ''}`}
    >
      {task.status === 'processing' && (
        <motion.div
          className="absolute bottom-0 left-0 h-1 bg-indigo-500"
          initial={{ width: '0%' }}
          animate={{ width: '95%' }}
          transition={{ duration: 25, ease: 'linear' }}
        />
      )}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          task.status === 'processing' ? 'bg-indigo-600 text-white' :
          task.status === 'completed' ? 'bg-emerald-500 text-white' :
          'bg-red-500 text-white'
        }`}>
          {task.status === 'processing' ? <Loader2 className="animate-spin" size={18} /> :
           task.status === 'completed' ? <CheckCircle2 size={18} /> :
           <Sparkles size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black text-gray-900 truncate uppercase tracking-tight">{task.title}</p>
          <p className="text-[10px] text-gray-500 font-bold truncate">
            {task.status === 'processing' ? (rotatingMsg || 'Iniciando...') :
             task.status === 'completed' ? 'Pronto! Toque para abrir.' :
             task.error || 'Erro ao processar'}
          </p>
        </div>
      </div>
      {task.status === 'completed' && (
        <div className="w-6 h-6 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500">
          <CheckCircle2 size={14} />
        </div>
      )}
    </motion.div>
  );
};

const GlobalTaskIndicator = ({ tasks, onTaskClick }: { tasks: Record<string, BackgroundTask>, onTaskClick?: (task: BackgroundTask) => void }) => {
  const activeTasksList = Object.values(tasks);
  if (activeTasksList.length === 0) return null;

  return (
    <div className="fixed bottom-28 left-4 right-4 z-[100] space-y-2 pointer-events-none">
      <AnimatePresence>
        {activeTasksList.map(task => (
          <TaskCard key={task.id} task={task} onTaskClick={onTaskClick} />
        ))}
      </AnimatePresence>
    </div>
  );
};

// ─── Biblioteca (professor view) ──────────────────────────────────────────────
const LibraryScreen = ({ user, setScreen, profile, notifications, setNotifications }: {
  user: any; setScreen: (s: any) => void; profile: any;
  notifications?: any[]; setNotifications?: (n: any[]) => void;
}) => {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [todayStats, setTodayStats] = useState({ count: 0, bytes: 0 });
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'library'),
      snap => {
        setItems(snap.docs.map(d => d.data() as LibraryItem).sort((a, b) => b.uploadDate - a.uploadDate));
        setLoading(false);
      },
      _err => {
        setLoading(false);
        setErrMsg('Não foi possível carregar os materiais. Verifique sua conexão.');
      }
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'downloadStats', user.uid)).then(snap => {
      if (!snap.exists()) return;
      const s = snap.data();
      const today = new Date().toISOString().slice(0, 10);
      if (s.date === today) setTodayStats({ count: s.count || 0, bytes: s.bytes || 0 });
    });
  }, [user]);

  const handleDownload = async (item: LibraryItem) => {
    if (!user) return;
    setErrMsg('');
    const today = new Date().toISOString().slice(0, 10);
    if (todayStats.count >= DOWNLOAD_LIMIT_PER_DAY) {
      setErrMsg(`Limite de ${DOWNLOAD_LIMIT_PER_DAY} downloads/dia atingido. Tente amanhã.`); return;
    }
    if (todayStats.bytes + item.fileSizeBytes > DOWNLOAD_MB_PER_DAY * 1024 * 1024) {
      setErrMsg(`Limite de ${DOWNLOAD_MB_PER_DAY} MB/dia atingido. Tente amanhã.`); return;
    }
    setDownloading(item.id);
    try {
      window.open(item.fileUrl, '_blank');
      const newStats = { date: today, count: todayStats.count + 1, bytes: todayStats.bytes + item.fileSizeBytes, lastDownload: Date.now() };
      await setDoc(doc(db, 'downloadStats', user.uid), newStats);
      await setDoc(doc(db, 'library', item.id), { downloadCount: increment(1) }, { merge: true });
      setTodayStats({ count: newStats.count, bytes: newStats.bytes });
    } catch {
      setErrMsg('Erro ao baixar. Tente novamente.');
    } finally {
      setDownloading(null);
    }
  };

  const filtered = filter === 'all' ? items : items.filter(i => i.type === filter);
  const typeMeta: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    slides:     { color: 'bg-indigo-500', label: 'Slides',    icon: <Presentation size={18} /> },
    activities: { color: 'bg-amber-500',  label: 'Atividades',icon: <FileText size={18} /> },
    exam:       { color: 'bg-red-500',    label: 'Prova',     icon: <FileQuestion size={18} /> },
    plan:       { color: 'bg-cyan-500',   label: 'Plano',     icon: <BookOpen size={18} /> },
  };
  const usedPct = Math.round((todayStats.bytes / (DOWNLOAD_MB_PER_DAY * 1024 * 1024)) * 100);
  const dlPct   = Math.round((todayStats.count / DOWNLOAD_LIMIT_PER_DAY) * 100);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title="Biblioteca" subtitle="Materiais prontos para download" profile={profile} notifications={notifications} setNotifications={setNotifications} bannerImage="https://i.ibb.co/d0my4Y3R/Design-sem-nome-20260614-135925-0000.png" />

      {/* Daily quota card */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm mb-4 space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Cota diária</p>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">Downloads</span>
            <span className="font-bold text-gray-700">{todayStats.count} / {DOWNLOAD_LIMIT_PER_DAY}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${Math.min(dlPct, 100)}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">Volume</span>
            <span className="font-bold text-gray-700">{fmtBytes(todayStats.bytes)} / {DOWNLOAD_MB_PER_DAY} MB</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${Math.min(usedPct, 100)}%` }} />
          </div>
        </div>
      </div>

      {/* Filters */}
      <PillTabs
        layoutKey="biblioteca"
        className="mb-4"
        tabs={[
          { id: 'all', label: 'Todos', icon: Filter },
          { id: 'slides', label: 'Slides', icon: Presentation },
          { id: 'activities', label: 'Atividades', icon: FileText },
          { id: 'exam', label: 'Provas', icon: FileQuestion },
          { id: 'plan', label: 'Planos', icon: BookOpen },
        ]}
        active={filter}
        onChange={setFilter}
      />

      {errMsg && <div className="bg-red-50 border border-red-100 text-red-600 text-sm font-medium rounded-xl p-3 mb-4">{errMsg}</div>}

      {loading ? (
        <div className="text-center py-16 text-gray-400">
          <Loader2 size={32} className="mx-auto mb-3 animate-spin text-indigo-400" />
          <p className="text-sm font-medium">Carregando materiais...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Library size={44} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">Nenhum material disponível</p>
          <p className="text-xs mt-1">Em breve novos materiais serão adicionados</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item, index) => {
            const meta = typeMeta[item.type] || typeMeta.activities;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.06, duration: 0.28 }}
                className="bg-white rounded-2xl p-4 border border-gray-50 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 ${meta.color}`}>
                    {meta.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-900 leading-snug">{item.title}</h3>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      <span className={`text-[10px] text-white px-2 py-0.5 rounded-full font-bold ${meta.color}`}>{meta.label}</span>
                      {item.subject && <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">{item.subject}</span>}
                      {item.grade   && <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{item.grade}</span>}
                    </div>
                    {item.description && <p className="text-xs text-gray-400 mt-1.5 leading-relaxed line-clamp-2">{item.description}</p>}
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400">
                      <span className="flex items-center gap-1"><HardDrive size={10} />{fmtBytes(item.fileSizeBytes)}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1"><Download size={10} />{item.downloadCount || 0} downloads</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(item)}
                  disabled={!!downloading}
                  className="mt-3 w-full bg-indigo-600 active:bg-indigo-700 text-white rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  {downloading === item.id ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {downloading === item.id ? 'Baixando...' : 'Baixar PDF'}
                </button>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};
// ─────────────────────────────────────────────────────────────────────────────

// --- Main App ---

const USERS_PAGE_SIZE = 20;

const AdminScreen = () => {
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [sysUsers, setSysUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [usersError, setUsersError] = useState('');
  const [activeTab, setActiveTab] = useState<'users' | 'feedbacks' | 'biblioteca' | 'metrics' | 'holidays'>('users');
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<'all' | 'pro' | 'free' | 'limit' | 'admin'>('all');
  const [confirmDeleteFbId, setConfirmDeleteFbId] = useState<string | null>(null);
  const [confirmUserAction, setConfirmUserAction] = useState<string | null>(null); // "pro:<id>" | "admin:<id>"
  const [usersPage, setUsersPage] = useState(0);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [globalStats, setGlobalStats] = useState<any>(null);
  const [monthlyStats, setMonthlyStats] = useState<{key: string, label: string, inp: number, out: number, gens: number}[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [announcementActive, setAnnouncementActive] = useState(false);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [holidays, setHolidays] = useState<{id: string, name: string, date: string}[]>([]);
  const [newHoliday, setNewHoliday] = useState({ name: '', date: '' });
  const [holidaySaving, setHolidaySaving] = useState(false);

  // ── Biblioteca state ──────────────────────────────────────────────────────
  const [libItems, setLibItems] = useState<LibraryItem[]>([]);
  const [storageUsed, setStorageUsed] = useState(0);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState({ title: '', type: 'activities' as LibraryItem['type'], subject: '', grade: '', description: '' });
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadErr, setUploadErr] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const reloadStorage = async () => {
    try {
      const snap = await getDoc(doc(db, 'config', 'storage'));
      setStorageUsed(snap.exists() ? (snap.data().totalBytes || 0) : 0);
    } catch { /* ignore — storage meter is non-critical */ }
  };

  useEffect(() => {
    if (activeTab !== 'biblioteca') return;
    const unsubLib = onSnapshot(collection(db, 'library'), snap => {
      setLibItems(snap.docs.map(d => d.data() as LibraryItem).sort((a, b) => b.uploadDate - a.uploadDate));
    });
    reloadStorage();
    return unsubLib;
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'metrics') return;
    getDoc(doc(db, 'config', 'stats')).then(snap => {
      if (snap.exists()) setGlobalStats(snap.data());
    }).catch(() => {});
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'metrics') return;
    getDoc(doc(db, 'config', 'announcement')).then(snap => {
      if (snap.exists()) {
        setAnnouncement(snap.data().message || '');
        setAnnouncementActive(snap.data().active || false);
      }
    }).catch(() => {});
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'metrics') return;
    const months: {key: string, label: string}[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      months.push({ key, label });
    }
    Promise.all(months.map(m => getDoc(doc(db, 'config', `stats_${m.key}`)))).then(snaps => {
      setMonthlyStats(months.map((m, i) => {
        const d = snaps[i].exists() ? snaps[i].data()! : {};
        return { key: m.key, label: m.label, inp: d.totalInputTokens || 0, out: d.totalOutputTokens || 0, gens: d.totalGenerations || 0 };
      }));
    }).catch(() => {});
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'holidays') return;
    getDoc(doc(db, 'config', 'feriados')).then(snap => {
      if (snap.exists()) setHolidays(snap.data().list || []);
    }).catch(() => {});
  }, [activeTab]);

  const handleUpload = async () => {
    if (!uploadFile || !uploadForm.title.trim()) { setUploadErr('Preencha o título e selecione um arquivo.'); return; }
    if (uploadFile.type !== 'application/pdf') { setUploadErr('Apenas arquivos PDF são permitidos.'); return; }
    if (uploadFile.size > 50 * 1024 * 1024) { setUploadErr('Arquivo muito grande. O limite é 50 MB por arquivo.'); return; }
    setUploadErr('');
    if (storageUsed + uploadFile.size > LIBRARY_LIMIT_BYTES) {
      setUploadErr(`Limite de 4.9 GB atingido. Apague materiais para liberar espaço.`); return;
    }
    const id = Math.random().toString(36).slice(2, 11);
    const sRef = storageRef(storage, `library/${id}/${uploadFile.name}`);
    const task = uploadBytesResumable(sRef, uploadFile);
    setUploadProgress(0);
    task.on('state_changed',
      snap => setUploadProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
      err  => { setUploadErr(`Erro: ${err.message}`); setUploadProgress(null); },
      async () => {
        const fileUrl = await getDownloadURL(task.snapshot.ref);
        const item: LibraryItem = { id, ...uploadForm, fileUrl, fileName: uploadFile.name, fileSizeBytes: uploadFile.size, uploadDate: Date.now(), downloadCount: 0 };
        await setDoc(doc(db, 'library', id), item);
        await setDoc(doc(db, 'config', 'storage'), { totalBytes: increment(uploadFile.size) }, { merge: true });
        setStorageUsed(p => p + uploadFile.size);
        setUploadProgress(null);
        setUploadFile(null);
        setUploadForm({ title: '', type: 'activities', subject: '', grade: '', description: '' });
      }
    );
  };

  const handleDeleteLib = async (item: LibraryItem) => {
    if (confirmDeleteId !== item.id) { setConfirmDeleteId(item.id); return; }
    setConfirmDeleteId(null);
    try {
      await deleteObject(storageRef(storage, `library/${item.id}/${item.fileName}`));
      await deleteDoc(doc(db, 'library', item.id));
      await setDoc(doc(db, 'config', 'storage'), { totalBytes: increment(-item.fileSizeBytes) }, { merge: true });
      setStorageUsed(p => Math.max(0, p - item.fileSizeBytes));
    } catch (e: any) { toast.error(formatApiError(e, 'Algo deu errado. Tente de novo.')); }
  };
  // ─────────────────────────────────────────────────────────────────────────

  // Contagem barata para o badge da aba (agregação no servidor); a coleção
  // completa de feedbacks só é assinada quando a aba abre.
  const [feedbackCount, setFeedbackCount] = useState(0);
  useEffect(() => {
    getCountFromServer(collection(db, 'feedback'))
      .then(snap => setFeedbackCount(snap.data().count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab !== 'feedbacks') return;
    const unsubFeedbacks = onSnapshot(collection(db, 'feedback'), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFeedbacks(items.sort((a: any, b: any) => b.date - a.date));
      setFeedbackCount(items.length);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching feedback:", error);
      setIsLoading(false);
    });
    return unsubFeedbacks;
  }, [activeTab]);

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSysUsers(items.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || '')));
      setUsersError('');
    }, (error) => {
      console.error("Error fetching users:", error);
      setUsersError('Sem permissão para listar usuários. Verifique as regras do Firestore.');
    });
    return unsubUsers;
  }, []);

  const togglePro = async (userId: string, currentStatus: boolean) => {
    try {
      await setDoc(doc(db, 'users', userId), { isPro: !currentStatus }, { merge: true });
    } catch (e: any) {
      toast.error(formatApiError(e, 'Não consegui alterar o PRO deste usuário.'));
    }
  };

  const toggleAdmin = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await setDoc(doc(db, 'users', userId), { role: newRole }, { merge: true });
    } catch (e: any) {
      toast.error(formatApiError(e, 'Não consegui alterar o papel deste usuário.'));
    }
  };

  const resetGenerations = async (userId: string) => {
    try {
      await setDoc(doc(db, 'users', userId), { generationsUsed: 0 }, { merge: true });
      toast.success('Gerações zeradas!');
    } catch (e: any) { toast.error(formatApiError(e, 'Não consegui zerar as gerações.')); }
  };

  const deleteFeedback = async (id: string) => {
    if (confirmDeleteFbId !== id) { setConfirmDeleteFbId(id); return; }
    setConfirmDeleteFbId(null);
    try {
      await deleteDoc(doc(db, 'feedback', id));
    } catch (e: any) { toast.error(formatApiError(e, 'Não consegui apagar o feedback.')); }
  };

  const saveAnnouncement = async () => {
    setAnnouncementSaving(true);
    try {
      await setDoc(doc(db, 'config', 'announcement'), { message: announcement, active: announcementActive, updatedAt: Date.now() });
      toast.success('Aviso salvo!');
    } catch (e: any) { toast.error(formatApiError(e, 'Não consegui salvar o aviso.')); } finally { setAnnouncementSaving(false); }
  };

  const saveHoliday = async () => {
    if (!newHoliday.name.trim() || !newHoliday.date) return;
    setHolidaySaving(true);
    try {
      const newList = [...holidays, { id: Math.random().toString(36).slice(2), ...newHoliday }];
      await setDoc(doc(db, 'config', 'feriados'), { list: newList });
      setHolidays(newList);
      setNewHoliday({ name: '', date: '' });
    } catch (e: any) { toast.error(formatApiError(e, 'Não consegui salvar o feriado.')); } finally { setHolidaySaving(false); }
  };

  const deleteHoliday = async (id: string) => {
    const newList = holidays.filter(h => h.id !== id);
    try {
      await setDoc(doc(db, 'config', 'feriados'), { list: newList });
      setHolidays(newList);
    } catch (e: any) { toast.error(formatApiError(e, 'Não consegui apagar o feriado.')); }
  };

  const exportCsv = () => {
    const rows = [['Nome', 'Email', 'Status', 'Gerações', 'Tokens Entrada', 'Tokens Saída', 'Cadastro']];
    sysUsers.forEach(u => {
      rows.push([u.name || '', u.email || '', u.isPro ? 'PRO' : u.role === 'admin' ? 'ADMIN' : 'FREE', u.generationsUsed ?? 0, u.inputTokens ?? 0, u.outputTokens ?? 0, u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '']);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `usuarios_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const FREE_LIMIT = 10;

  const getUsageStatus = (u: any) => {
    if (u.isPro || u.role === 'admin') return null;
    const used = u.generationsUsed ?? 0;
    if (used >= FREE_LIMIT) return 'limite';
    return `${used}/${FREE_LIMIT} gerações`;
  };

  const totalUsers = sysUsers.length;
  const proUsers = sysUsers.filter(u => u.isPro).length;
  const adminUsers = sysUsers.filter(u => u.role === 'admin').length;
  const expiredUsers = sysUsers.filter(u => !u.isPro && u.role !== 'admin' && (u.generationsUsed ?? 0) >= FREE_LIMIT).length;

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    let list = sysUsers;
    if (userFilter === 'pro') list = list.filter(u => u.isPro);
    else if (userFilter === 'admin') list = list.filter(u => u.role === 'admin');
    else if (userFilter === 'limit') list = list.filter(u => !u.isPro && u.role !== 'admin' && (u.generationsUsed ?? 0) >= FREE_LIMIT);
    else if (userFilter === 'free') list = list.filter(u => !u.isPro && u.role !== 'admin');
    if (!q) return list;
    return list.filter(u => (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
  }, [sysUsers, userSearch, userFilter]);
  const usersPageCount = Math.ceil(filteredUsers.length / USERS_PAGE_SIZE);
  const pagedUsers = filteredUsers.slice(usersPage * USERS_PAGE_SIZE, (usersPage + 1) * USERS_PAGE_SIZE);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 rounded-[2rem] p-5 mb-5 shadow-lg">
        <div className="absolute -top-12 -right-12 w-44 h-44 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-10 w-40 h-40 bg-violet-400/20 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-center gap-3 relative">
          <div className="w-12 h-12 bg-white/15 backdrop-blur rounded-2xl flex items-center justify-center text-white border border-white/20">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">Painel Admin</h1>
            <p className="text-indigo-200 text-[10px] font-black uppercase tracking-[0.2em]">Gerenciamento do sistema</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-4 relative">
          {[
            { v: totalUsers, l: 'Usuários' },
            { v: proUsers, l: 'PRO' },
            { v: adminUsers, l: 'Admins' },
            { v: expiredUsers, l: 'No limite' },
          ].map((s, i) => (
            <div key={i} className="bg-white/10 border border-white/15 backdrop-blur rounded-xl py-2 text-center">
              <p className="text-lg font-black text-white leading-tight tabular-nums">{s.v}</p>
              <p className="text-[9px] text-indigo-200 font-bold uppercase tracking-wider">{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      <PillTabs
        layoutKey="admin"
        className="mb-5"
        tabs={[
          { id: 'users', label: 'Usuários', icon: Users },
          { id: 'feedbacks', label: 'Feedbacks', icon: MessageSquare, badge: feedbackCount },
          { id: 'biblioteca', label: 'Biblioteca', icon: Library },
          { id: 'metrics', label: 'Métricas', icon: Database },
          { id: 'holidays', label: 'Feriados', icon: CalendarIcon },
        ]}
        active={activeTab}
        onChange={id => setActiveTab(id as any)}
      />

      {activeTab === 'feedbacks' && (
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-50 mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <MessageSquare size={20} className="text-indigo-600" />
            Feedbacks dos Usuários
          </h2>

          {isLoading ? (
            <div className="py-20 flex items-center justify-center">
              <Loader2 className="animate-spin text-indigo-600" size={32} />
            </div>
          ) : feedbacks.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-gray-400">
              <MessageSquare size={48} className="mb-4 opacity-20" />
              <p>Nenhum feedback recebido ainda.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {feedbacks.map((fb) => (
                <div key={fb.id} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <div className="flex justify-between items-start mb-2 gap-2">
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center text-sm font-black shrink-0">
                        {(fb.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="overflow-hidden">
                        <p className="font-bold text-gray-900 text-sm truncate">{fb.name || 'Usuário Anônimo'}</p>
                        <p className="text-xs text-gray-500 truncate">{fb.email || 'Sem e-mail'}</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 bg-white px-2 py-1 rounded-lg border border-gray-100 shrink-0">
                      {new Date(fb.date).toLocaleDateString('pt-BR')} {new Date(fb.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-gray-700 text-sm mt-2 leading-relaxed">{fb.text}</p>
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={() => deleteFeedback(fb.id)}
                      onBlur={() => setConfirmDeleteFbId(null)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1 ${confirmDeleteFbId === fb.id ? 'bg-red-500 text-white' : 'text-red-400 hover:bg-red-50'}`}
                    >
                      <Trash2 size={12} /> {confirmDeleteFbId === fb.id ? 'Confirmar?' : 'Apagar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'biblioteca' && (
        <div className="space-y-4 mb-8">
          {/* Storage bar */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-gray-700 flex items-center gap-2"><HardDrive size={16} className="text-indigo-500" />Armazenamento</span>
              <span className="text-xs font-bold text-gray-500">{fmtBytes(storageUsed)} / 4.9 GB</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${storageUsed / LIBRARY_LIMIT_BYTES > 0.9 ? 'bg-red-500' : 'bg-indigo-500'}`}
                style={{ width: `${Math.min((storageUsed / LIBRARY_LIMIT_BYTES) * 100, 100)}%` }}
              />
            </div>
            {storageUsed / LIBRARY_LIMIT_BYTES > 0.85 && (
              <p className="text-xs text-red-500 font-medium mt-1">⚠ Espaço quase esgotado. Apague materiais antigos.</p>
            )}
          </div>

          {/* Upload form */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Upload size={16} className="text-indigo-500" />Adicionar Material</h3>
            <div className="space-y-2">
              <input value={uploadForm.title} onChange={e => setUploadForm(f => ({...f, title: e.target.value}))} placeholder="Título do material *"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" />
              <div className="grid grid-cols-2 gap-2">
                <select value={uploadForm.type} onChange={e => setUploadForm(f => ({...f, type: e.target.value as LibraryItem['type']}))}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white">
                  <option value="activities">Atividades</option>
                  <option value="exam">Prova</option>
                  <option value="plan">Plano de Aula</option>
                  <option value="slides">Slides (PDF)</option>
                </select>
                <input value={uploadForm.subject} onChange={e => setUploadForm(f => ({...f, subject: e.target.value}))} placeholder="Disciplina"
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" />
              </div>
              <input value={uploadForm.grade} onChange={e => setUploadForm(f => ({...f, grade: e.target.value}))} placeholder="Série / Nível (ex: 8º ano)"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" />
              <textarea value={uploadForm.description} onChange={e => setUploadForm(f => ({...f, description: e.target.value}))} placeholder="Descrição breve (opcional)" rows={2}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 resize-none" />
              <label className="flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl p-3 cursor-pointer hover:border-indigo-400 transition-colors">
                <Upload size={20} className="text-gray-400 shrink-0" />
                <span className="text-sm text-gray-500 truncate">{uploadFile ? uploadFile.name : 'Selecionar PDF…'}</span>
                <input type="file" accept=".pdf" className="hidden" onChange={e => { setUploadFile(e.target.files?.[0] || null); setUploadErr(''); }} />
              </label>
              {uploadFile && <p className="text-xs text-gray-400 text-right">{fmtBytes(uploadFile.size)}</p>}
              {uploadErr && <p className="text-xs text-red-500 font-medium">{uploadErr}</p>}
              {uploadProgress !== null && (
                <div className="space-y-1">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="text-xs text-gray-500 text-right">{uploadProgress}%</p>
                </div>
              )}
              <button onClick={handleUpload} disabled={uploadProgress !== null || !uploadFile}
                className="w-full bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                {uploadProgress !== null ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {uploadProgress !== null ? 'Enviando...' : 'Fazer Upload'}
              </button>
            </div>
          </div>

          {/* Existing items */}
          <div className="space-y-2">
            {libItems.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-6">Nenhum material na biblioteca ainda</p>
            ) : libItems.map(item => (
              <div key={item.id} className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-900 truncate">{item.title}</p>
                  <p className="text-xs text-gray-400">{item.subject} · {item.grade} · {fmtBytes(item.fileSizeBytes)} · {item.downloadCount} downloads</p>
                </div>
                <button
                  onClick={() => handleDeleteLib(item)}
                  onBlur={() => setConfirmDeleteId(null)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition-colors shrink-0 ${confirmDeleteId === item.id ? 'bg-red-500 text-white' : 'text-red-400 hover:bg-red-50'}`}
                >
                  {confirmDeleteId === item.id ? 'Confirmar?' : <Trash2 size={16} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-50 mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Shield size={20} className="text-indigo-600" />
            Gerenciamento de Usuários
          </h2>

          {usersError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium">
              {usersError}
            </div>
          )}

          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={userSearch}
              onChange={e => { setUserSearch(e.target.value); setUsersPage(0); }}
              placeholder="Buscar por nome ou e-mail…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div className="flex gap-1.5 mb-4 overflow-x-auto no-scrollbar">
            {([['all', 'Todos'], ['pro', 'PRO'], ['free', 'Free'], ['limit', 'No limite'], ['admin', 'Admins']] as const).map(([id, label]) => (
              <button key={id} onClick={() => { setUserFilter(id); setUsersPage(0); }}
                className={`flex-none px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${userFilter === id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {pagedUsers.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-10">Nenhum usuário encontrado com esse filtro.</p>
            )}
            {pagedUsers.map(u => {
              const trialStatus = getUsageStatus(u);
              const isAdmin = u.role === 'admin';
              return (
                <div key={u.id} className="p-3 border border-gray-100 rounded-2xl bg-gray-50">
                  <div className="flex items-start gap-2.5 mb-2">
                    <div className={`w-9 h-9 rounded-full text-white flex items-center justify-center text-sm font-black shrink-0 bg-gradient-to-br ${isAdmin ? 'from-indigo-500 to-violet-700' : u.isPro ? 'from-emerald-400 to-green-600' : 'from-gray-400 to-gray-500'}`}>
                      {(u.name || u.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="overflow-hidden flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-gray-900 truncate">{u.name || 'Sem nome'}</p>
                        {isAdmin && <span className="text-[10px] font-black bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-md">ADMIN</span>}
                        {u.isPro && <span className="text-[10px] font-black bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md">PRO</span>}
                        {trialStatus === 'limite' && <span className="text-[10px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md">LIMITE</span>}
                        {trialStatus && trialStatus !== 'limite' && <span className="text-[10px] font-medium bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-md">{trialStatus}</span>}
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{u.email || u.id}</p>
                      {u.createdAt && <p className="text-[10px] text-gray-400 mt-0.5">Desde {new Date(u.createdAt).toLocaleDateString('pt-BR')}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={() => {
                        if (confirmUserAction !== `pro:${u.id}`) { setConfirmUserAction(`pro:${u.id}`); return; }
                        setConfirmUserAction(null);
                        togglePro(u.id, u.isPro);
                      }}
                      onBlur={() => setConfirmUserAction(c => c === `pro:${u.id}` ? null : c)}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${confirmUserAction === `pro:${u.id}` ? 'bg-amber-500 text-white border-amber-600' : u.isPro ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-400 hover:text-emerald-600'}`}
                    >
                      {confirmUserAction === `pro:${u.id}` ? (u.isPro ? 'Remover PRO?' : 'Confirmar PRO?') : u.isPro ? 'PRO ATIVO' : 'ATIVAR PRO'}
                    </button>
                    <button
                      onClick={() => {
                        if (confirmUserAction !== `admin:${u.id}`) { setConfirmUserAction(`admin:${u.id}`); return; }
                        setConfirmUserAction(null);
                        toggleAdmin(u.id, u.role);
                      }}
                      onBlur={() => setConfirmUserAction(c => c === `admin:${u.id}` ? null : c)}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${confirmUserAction === `admin:${u.id}` ? 'bg-amber-500 text-white border-amber-600' : isAdmin ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-400 hover:text-indigo-600'}`}
                    >
                      {confirmUserAction === `admin:${u.id}` ? (isAdmin ? 'Remover admin?' : 'Confirmar admin?') : isAdmin ? 'ADMIN ATIVO' : 'DAR ADMIN'}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => resetGenerations(u.id)} className="flex-1 py-1.5 text-xs font-bold rounded-lg border border-gray-200 bg-white text-amber-600 hover:border-amber-400 transition-colors">
                      Zerar gerações
                    </button>
                    <button onClick={() => setExpandedUserId(expandedUserId === u.id ? null : u.id)} className="flex-1 py-1.5 text-xs font-bold rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                      {expandedUserId === u.id ? 'Fechar' : 'Ver detalhes'}
                    </button>
                  </div>
                  {expandedUserId === u.id && (
                    <div className="mt-2 p-3 bg-indigo-50 rounded-xl text-xs space-y-1 border border-indigo-100">
                      <p><span className="font-bold text-indigo-700">Gerações usadas:</span> {u.generationsUsed ?? 0}</p>
                      <p><span className="font-bold text-indigo-700">Tokens entrada:</span> {(u.inputTokens || 0).toLocaleString()}</p>
                      <p><span className="font-bold text-indigo-700">Tokens saída:</span> {(u.outputTokens || 0).toLocaleString()}</p>
                      {(() => {
                        const cost = estimateCostUSD(u.inputTokens || 0, u.outputTokens || 0) * AI_PRICING.usdToBrl;
                        return <p><span className="font-bold text-indigo-700">Custo estimado:</span> R$ {cost.toFixed(5)}</p>;
                      })()}
                      <p><span className="font-bold text-indigo-700">Telefone:</span> {u.phone || 'Não verificado'}</p>
                      {u.createdAt && <p><span className="font-bold text-indigo-700">Cadastro:</span> {new Date(u.createdAt).toLocaleDateString('pt-BR')}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {usersPageCount > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
              <button
                onClick={() => setUsersPage(p => Math.max(0, p - 1))}
                disabled={usersPage === 0}
                className="px-3 py-1.5 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← Anterior
              </button>
              <span className="text-xs text-gray-500 font-medium">
                {usersPage + 1} / {usersPageCount} ({filteredUsers.length} usuários)
              </span>
              <button
                onClick={() => setUsersPage(p => Math.min(usersPageCount - 1, p + 1))}
                disabled={usersPage >= usersPageCount - 1}
                className="px-3 py-1.5 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Próxima →
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'metrics' && (
        <div className="space-y-4 mb-8">
          {/* API Cost Dashboard */}
          {globalStats && (() => {
            const inputCost = (globalStats.totalInputTokens || 0) * AI_PRICING.inputUsdPer1M / 1_000_000;
            const outputCost = (globalStats.totalOutputTokens || 0) * AI_PRICING.outputUsdPer1M / 1_000_000;
            const totalCostUSD = inputCost + outputCost;
            const totalCostBRL = totalCostUSD * AI_PRICING.usdToBrl;
            return (
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-50">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Coins size={18} className="text-amber-500" /> Custo Real da API</h3>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-indigo-50 rounded-2xl p-3 text-center">
                    <p className="text-xl font-black text-indigo-600">R$ {totalCostBRL.toFixed(4)}</p>
                    <p className="text-xs text-indigo-500 font-medium">Custo total (BRL)</p>
                  </div>
                  <div className="bg-emerald-50 rounded-2xl p-3 text-center">
                    <p className="text-xl font-black text-emerald-600">$ {totalCostUSD.toFixed(5)}</p>
                    <p className="text-xs text-emerald-500 font-medium">Custo total (USD)</p>
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-3 text-center">
                    <p className="text-lg font-black text-gray-700">{(globalStats.totalGenerations || 0).toLocaleString()}</p>
                    <p className="text-xs text-gray-500 font-medium">Gerações totais</p>
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-3 text-center">
                    <p className="text-lg font-black text-gray-700">{((globalStats.totalInputTokens || 0) + (globalStats.totalOutputTokens || 0)).toLocaleString()}</p>
                    <p className="text-xs text-gray-500 font-medium">Tokens totais</p>
                  </div>
                </div>
                <div className="text-xs text-gray-400 bg-gray-50 rounded-xl p-2 text-center">
                  Entrada: {(globalStats.totalInputTokens || 0).toLocaleString()} tokens · Saída: {(globalStats.totalOutputTokens || 0).toLocaleString()} tokens
                </div>
              </div>
            );
          })()}

          {/* Monthly consumption chart */}
          {monthlyStats.length > 0 && (() => {
            const now = new Date();
            const currentKey = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
            const current = monthlyStats.find(m => m.key === currentKey);
            const currentCost = current ? estimateCostUSD(current.inp, current.out) : 0;
            const maxCostMonth = Math.max(...monthlyStats.map(m => estimateCostUSD(m.inp, m.out)), 0.000001);
            return (
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-50">
                <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2"><CalendarDays size={18} className="text-indigo-500" /> Consumo Mensal</h3>
                <p className="text-xs text-gray-400 mb-3">Últimos 6 meses · custo estimado em USD</p>
                {current && (
                  <div className="bg-indigo-50 rounded-2xl p-3 mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-indigo-500 font-medium">Mês atual</p>
                      <p className="text-2xl font-black text-indigo-700">${currentCost.toFixed(5)}</p>
                      <p className="text-xs text-indigo-400">{current.gens.toLocaleString()} gerações · {(current.inp + current.out).toLocaleString()} tokens</p>
                    </div>
                    <img src="https://i.ibb.co/JwXsb4D4/20260521-154229-0000.png" alt="Corujão" className="w-12 h-12 object-contain" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
                  </div>
                )}
                <div className="flex items-end gap-2 h-24">
                  {monthlyStats.map((m, i) => {
                    const cost = estimateCostUSD(m.inp, m.out);
                    const pct = (cost / maxCostMonth) * 100;
                    const isCurrent = m.key === currentKey;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-[9px] font-bold text-gray-600">${cost.toFixed(4)}</span>
                        <div className="w-full flex items-end" style={{ height: '60px' }}>
                          <div
                            className={`w-full rounded-t-lg transition-all duration-700 ${isCurrent ? 'bg-indigo-500' : 'bg-indigo-200'}`}
                            style={{ height: `${Math.max(pct, 2)}%` }}
                          />
                        </div>
                        <span className={`text-[9px] font-semibold ${isCurrent ? 'text-indigo-600' : 'text-gray-400'}`}>{m.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Per-user cost chart */}
          {(() => {
            const usersWithCost = sysUsers
              .map(u => {
                const inp = u.inputTokens || 0;
                const out = u.outputTokens || 0;
                const cost = estimateCostUSD(inp, out);
                return { name: u.displayName || u.email || u.id, cost, inp, out };
              })
              .filter(u => u.cost > 0)
              .sort((a, b) => b.cost - a.cost)
              .slice(0, 10);
            if (usersWithCost.length === 0) return null;
            const maxCost = usersWithCost[0].cost;
            return (
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-50">
                <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2"><BarChart3 size={18} className="text-violet-500" /> Top Consumidores (API)</h3>
                <p className="text-xs text-gray-400 mb-4">Custo estimado por usuário em USD</p>
                <div className="space-y-3">
                  {usersWithCost.map((u, i) => {
                    const pct = maxCost > 0 ? (u.cost / maxCost) * 100 : 0;
                    const colors = ['bg-indigo-500','bg-purple-500','bg-pink-500','bg-rose-500','bg-orange-500','bg-amber-500','bg-yellow-500','bg-lime-500','bg-emerald-500','bg-teal-500'];
                    return (
                      <div key={i}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-semibold text-gray-700 truncate max-w-[60%]">{u.name}</span>
                          <span className="text-xs font-black text-gray-900">${u.cost.toFixed(5)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${colors[i % colors.length]}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">{u.inp.toLocaleString()} in · {u.out.toLocaleString()} out tokens</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Input vs Output split bar */}
          {globalStats && (() => {
            const inp = globalStats.totalInputTokens || 0;
            const out = globalStats.totalOutputTokens || 0;
            const total = inp + out;
            const inpPct = total > 0 ? (inp / total) * 100 : 50;
            return (
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-50">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Scale size={18} className="text-emerald-500" /> Input vs Output</h3>
                <div className="flex rounded-full overflow-hidden h-4 mb-2">
                  <div className="bg-indigo-500 transition-all duration-700" style={{ width: `${inpPct}%` }} />
                  <div className="bg-emerald-400 flex-1" />
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span><span className="inline-block w-2 h-2 rounded-full bg-indigo-500 mr-1" />Input {inpPct.toFixed(1)}%</span>
                  <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1" />Output {(100 - inpPct).toFixed(1)}%</span>
                </div>
              </div>
            );
          })()}

          {/* Announcement */}
          <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-50">
            <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Megaphone size={18} className="text-rose-500" /> Aviso Global</h3>
            <textarea
              value={announcement}
              onChange={e => setAnnouncement(e.target.value)}
              placeholder="Digite um aviso para todos os usuários..."
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 resize-none mb-3"
            />
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                <input type="checkbox" checked={announcementActive} onChange={e => setAnnouncementActive(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
                Aviso ativo
              </label>
              <button onClick={saveAnnouncement} disabled={announcementSaving} className="bg-indigo-600 text-white text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-50">
                {announcementSaving ? 'Salvando...' : 'Publicar'}
              </button>
            </div>
          </div>

          {/* Export CSV */}
          <button onClick={exportCsv} className="w-full bg-emerald-600 text-white font-bold py-3 rounded-2xl flex items-center justify-center gap-2">
            <Download size={16} /> Exportar usuários (CSV)
          </button>
        </div>
      )}

      {activeTab === 'holidays' && (
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-50 mb-8">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><PartyPopper size={18} className="text-amber-500" /> Feriados Globais</h3>
          <p className="text-xs text-gray-400 mb-4">Aparecem no calendário de todos os professores automaticamente.</p>

          <div className="space-y-2 mb-4">
            {holidays.sort((a,b) => a.date.localeCompare(b.date)).map(h => {
              const d = new Date(h.date + 'T00:00:00');
              return (
                <div key={h.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100">
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex flex-col items-center justify-center shrink-0">
                    <span className="text-sm font-black text-indigo-700 leading-none">{d.getDate()}</span>
                    <span className="text-[9px] font-bold text-indigo-400 uppercase">{d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{h.name}</p>
                    <p className="text-xs text-gray-400">{d.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric' })}</p>
                  </div>
                  <button onClick={() => deleteHoliday(h.id)} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors shrink-0">
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
            {holidays.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Nenhum feriado cadastrado.</p>}
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-4">
            <input
              type="text"
              placeholder="Nome do feriado"
              value={newHoliday.name}
              onChange={e => setNewHoliday(h => ({...h, name: e.target.value}))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={newHoliday.date}
                onChange={e => setNewHoliday(h => ({...h, date: e.target.value}))}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white"
              />
              <button onClick={saveHoliday} disabled={holidaySaving || !newHoliday.name.trim() || !newHoliday.date}
                className="bg-indigo-600 text-white font-bold px-4 py-2 rounded-xl disabled:opacity-50 flex items-center gap-1.5 text-sm">
                {holidaySaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const generateTurmaItems = (
  seedPrefix: string,
  turmaName: string,
  classDays: number[],
  startDateStr: string,
  lessons: { title: string; topic: string }[],
  holidayISOs: Set<string>,
  anchorIndex: number = 0,
): ClassItem[] => {
  const items: ClassItem[] = [];
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const [yr, mo, dy] = startDateStr.split('-').map(Number);
  // startDateStr é a data da aula de índice `anchorIndex`. Recua para achar a data da aula 0,
  // contando para trás apenas dias de aula válidos (pulando feriados), para que as aulas
  // anteriores ao ponto de partida fiquem retroativas (já realizadas).
  let cur = new Date(yr, mo - 1, dy, 12, 0, 0, 0);
  let back = anchorIndex;
  while (back > 0) {
    cur.setDate(cur.getDate() - 1);
    const iso = toISODate(cur);
    if (classDays.includes(cur.getDay()) && !holidayISOs.has(iso)) {
      back--;
    }
  }
  let guard = 3000;
  let i = 0;
  while (i < lessons.length && guard > 0) {
    const iso = toISODate(cur);
    if (classDays.includes(cur.getDay()) && !holidayISOs.has(iso)) {
      const lesson = lessons[i];
      items.push({
        id: `${seedPrefix}-${i}`,
        title: lesson.title,
        date: `${cur.getDate()} ${MONTH_ABBR_IMPORT[cur.getMonth()]}`,
        status: cur.getTime() <= today.getTime() ? 'done' : 'pending',
        className: turmaName,
        timestamp: cur.getTime(),
        topic: lesson.topic,
      });
      i++;
    }
    cur.setDate(cur.getDate() + 1);
    guard--;
  }
  return items;
};

function AppInner() {
  const [user, setUser] = useState<any>(null);
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  const [resetMessage, setResetMessage] = useState({ type: '', text: '' });
  const [authError, setAuthError] = useState('');
  const [isAuthProcessing, setIsAuthProcessing] = useState(false);
  const [phoneStep, setPhoneStep] = useState<'idle' | 'enter' | 'code'>('idle');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneVerifId, setPhoneVerifId] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [phoneSending, setPhoneSending] = useState(false);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const [globalAnnouncement, setGlobalAnnouncement] = useState<{message:string,active:boolean,updatedAt:number}|null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'config', 'announcement'), snap => {
      if (!snap.exists()) { setGlobalAnnouncement(null); return; }
      const data = snap.data() as {message:string,active:boolean,updatedAt:number};
      if (!data.active || !data.message) { setGlobalAnnouncement(null); return; }
      const dismissed = (() => { try { return localStorage.getItem('prof-coruja-announcement-seen'); } catch { return null; } })();
      if (dismissed && Number(dismissed) === data.updatedAt) { setGlobalAnnouncement(null); return; }
      setGlobalAnnouncement(data);
    }, () => {});
    return unsub;
  }, [user]);

  const dismissAnnouncement = () => {
    if (globalAnnouncement?.updatedAt) {
      try { localStorage.setItem('prof-coruja-announcement-seen', String(globalAnnouncement.updatedAt)); } catch {}
    }
    setGlobalAnnouncement(null);
  };

  const [screen, setScreen] = useState<Screen>('home');
  const [plannerMode, setPlannerMode] = useState<PlannerMode>('plan');
  const [ferramentasTool, setFerramentasTool] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<number>(new Date().getDate());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  // PDF Import (calendário letivo / ementa) — estado compartilhado
  const [importRequest, setImportRequest] = useState<null | { mode: 'calendar' | 'syllabus', targetClass?: ClassSchedule }>(null);

  // Background Task Management
  const [activeTasks, setActiveTasks] = useState<Record<string, BackgroundTask>>({});
  const [studioReopenTaskId, setStudioReopenTaskId] = useState<string | null>(null);
  
  const addTask = (task: Omit<BackgroundTask, 'id' | 'status' | 'startTime'>): string => {
    const id = Math.random().toString(36).slice(2, 11);
    setActiveTasks(prev => ({
      ...prev,
      [id]: {
        ...task,
        id,
        status: 'processing',
        startTime: Date.now()
      }
    }));
    return id;
  };

  const removeTask = (id: string) => {
    setActiveTasks(prev => {
      const newState = { ...prev };
      delete newState[id];
      return newState;
    });
  };

  const updateTask = (id: string, updates: Partial<BackgroundTask>) => {
    setActiveTasks(prev => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: { ...prev[id], ...updates }
      };
    });

    if (updates.status === 'completed' || updates.status === 'error') {
      setTimeout(() => {
        setActiveTasks(prev => {
          const task = prev[id];
          if (!task) return prev;
          // Keep completed studio tasks alive until user clicks to reopen the result.
          if (task.status === 'completed' && isStudioTaskType(task.type)) return prev;
          const newState = { ...prev };
          delete newState[id];
          return newState;
        });
      }, 8000);
    }
  };

  // Watchdog: any task processing for more than the per-type limit is auto-failed.
  // Prevents the UI from being stuck in "loading" forever if a Promise hangs silently.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      Object.values(activeTasks).forEach(task => {
        const limit = task.type === 'plan' ? 150000 : isStudioTaskType(task.type) ? 150000 : 90000;
        if (task.status === 'processing' && now - task.startTime > limit) {
          console.warn(`Task ${task.id} (${task.type}) stuck > ${limit / 1000}s — auto-failing.`);
          updateTask(task.id, { status: 'error', error: 'A geração demorou demais e foi cancelada. Tente novamente.' });
        }
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [activeTasks]);

  const [profile, setProfile, profileLoaded] = useFirestoreDoc<UserProfile>(
    user ? `users/${user.uid}` : 'users/temp',
    user,
    {
      name: '',
      subject: 'História • Ensino Fundamental II',
      photo: ''
    }
  );
  
  const [schedules, setSchedules] = useFirestoreSync<ClassSchedule>('schedules', user, []);
  const [classes, setClasses] = useFirestoreSync<ClassItem>('classes', user, []);
  const [customEvents, setCustomEvents] = useFirestoreSync<{id: string, title: string, date: string, type: 'prep' | 'admin' | 'holiday' | 'commemorative'}>('events', user, []);
  const [savedResources, setSavedResources] = useFirestoreSync<SavedResource>('resources', user, []);
  const [notifications, setNotifications] = useFirestoreSync<any>('notifications', user, []);

  // ── Auto-notifications from schedule ─────────────────────────────────────
  const [readAutoIds, setReadAutoIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('readAutoNotifs') || '[]')); } catch { return new Set(); }
  });

  const autoNotifications = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDow = today.getDay();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const tomorrowDow = tomorrow.getDay();
    const todayStr = today.toISOString().slice(0, 10);
    const notifs: any[] = [];

    // Today's classes
    schedules.forEach(s => {
      if (s.days.includes(todayDow)) {
        const id = `auto-class-today-${s.id}-${todayStr}`;
        notifs.push({ id, title: `Aula hoje: ${s.name}`, message: `${[s.subject, s.time, s.school].filter(Boolean).join(' · ')}`, date: today.getTime(), read: readAutoIds.has(id), auto: true, icon: 'class' });
      }
    });

    // Tomorrow's classes
    schedules.forEach(s => {
      if (s.days.includes(tomorrowDow)) {
        const id = `auto-class-tomorrow-${s.id}-${todayStr}`;
        notifs.push({ id, title: `Aula amanhã: ${s.name}`, message: `${[s.subject, s.time, s.school].filter(Boolean).join(' · ')}`, date: today.getTime() - 1, read: readAutoIds.has(id), auto: true, icon: 'class' });
      }
    });

    // Upcoming events (holidays, prep, admin) within 7 days
    customEvents.forEach(e => {
      const eventDate = new Date(e.date + 'T00:00:00');
      const diff = Math.round((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diff < 0 || diff > 7) return;
      const id = `auto-event-${e.id}-${todayStr}`;
      const when = diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : `Em ${diff} dias`;
      const typeLabel: Record<string, string> = { holiday: 'Feriado', prep: 'Preparação de aula', admin: 'Tarefa administrativa', commemorative: 'Data comemorativa' };
      notifs.push({ id, title: `${typeLabel[e.type] || 'Evento'}: ${e.title}`, message: `${when} — ${eventDate.toLocaleDateString('pt-BR')}`, date: today.getTime() - 2, read: readAutoIds.has(id), auto: true, icon: e.type });
    });

    return notifs;
  }, [schedules, customEvents, readAutoIds]);

  const allNotifications = useMemo(() =>
    [...autoNotifications, ...notifications].sort((a, b) => b.date - a.date).slice(0, 10),
    [autoNotifications, notifications]
  );

  const handleSetNotifications = (updater: any[] | ((prev: any[]) => any[])) => {
    const updated = typeof updater === 'function' ? updater(allNotifications) : updater;
    const newReadIds = new Set(readAutoIds);
    updated.filter(n => n.auto && n.read).forEach(n => newReadIds.add(n.id));
    // Clear all: mark all auto as read
    if (updated.length === 0) autoNotifications.forEach(n => newReadIds.add(n.id));
    setReadAutoIds(newReadIds);
    try { localStorage.setItem('readAutoNotifs', JSON.stringify([...newReadIds])); } catch {}
    setNotifications(updated.filter(n => !n.auto));
  };
  const [inboxMessages, setInboxMessages] = useFirestoreSync<{id: string, role: 'user' | 'model', text: string, date: number, attachment?: { mimeType: string, url: string, data: string, name: string }}>('messages', user, [
    { id: 'welcome', role: 'model', text: 'Olá! Eu sou o assistente do **Prof. Corujão**. Envie ideias rápidas, lembretes ou faça perguntas. Eu organizo tudo para você!', date: Date.now() }
  ]);
  
  const [estudioContext, setEstudioContext] = useState<string>('');

  // ── Notificações locais de aula ───────────────────────────────────────────
  const scheduledNotifsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!user || !schedules.length || !('Notification' in window) || Notification.permission !== 'granted') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const today = new Date();
    const todayDay = today.getDay();
    const dateStr = today.toDateString();

    schedules.forEach(sched => {
      if (!sched.days.includes(todayDay)) return;
      // Usa horário real do dia (dayTimes) com fallback para o campo legado time
      const classTimeStr = sched.dayTimes?.[todayDay] || sched.time;
      if (!classTimeStr) return;
      const key = `${sched.id}-${dateStr}`;
      if (scheduledNotifsRef.current.has(key)) return;

      const [h, m] = classTimeStr.split(':').map(Number);
      const classTime = new Date(); classTime.setHours(h, m, 0, 0);
      const msUntil = classTime.getTime() - 30 * 60 * 1000 - Date.now();
      if (msUntil <= 0 || msUntil > 24 * 60 * 60 * 1000) return;

      scheduledNotifsRef.current.add(key);
      timers.push(setTimeout(async () => {
        const title = 'Aula em 30 minutos';
        const body = `${sched.subject ? `${sched.subject} — ` : ''}${sched.name} às ${sched.time}`;
        const icon = '/icon-512.png';
        // Mesma tag usada pela Cloud Function (FCM) — evita notificação duplicada:
        // o sistema substitui em vez de empilhar quando local e push coincidem.
        const tag = `aula-${sched.id}-${dateStr}`;
        try {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification(title, { body, icon, tag, requireInteraction: false });
        } catch { new Notification(title, { body, icon }); }
      }, msUntil));
    });

    return () => timers.forEach(clearTimeout);
  }, [user, schedules]);

  // ── Registro do token FCM (push com app fechado) ──────────────────────────
  // Salva o token do dispositivo no Firestore para a Cloud Function enviar os
  // lembretes de aula mesmo quando o app não está aberto.
  // Recarrega quando um service worker NOVO assume o controle (versão nova
  // publicada). Guardado contra a primeira instalação para não recarregar à toa.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let hadController = !!navigator.serviceWorker.controller;
    let refreshed = false;
    const onChange = () => {
      if (!hadController) { hadController = true; return; }
      if (refreshed) return;
      refreshed = true;
      toast.success('Nova versão do Corujão! Atualizando…');
      setTimeout(() => window.location.reload(), 900);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, []);

  useEffect(() => {
    if (!user || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const token = await getFcmToken(reg);
        if (!token || cancelled) return;
        await setDoc(doc(db, `users/${user.uid}/fcmTokens/${token}`), {
          token,
          uid: user.uid,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
          platform: navigator.userAgent.slice(0, 200),
          updatedAt: Date.now(),
        }, { merge: true });
      } catch (e) {
        console.error('Falha ao registrar token FCM:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [user, schedules]);

  // ── Onboarding ────────────────────────────────────────────────────────────
  const [onboardingStep, setOnboardingStep] = useState<0 | 1 | 2 | 3>(0);
  const [onboardingName, setOnboardingName] = useState('');
  const [onboardingClass, setOnboardingClass] = useState({ name: '', subject: '', school: '', shift: 'Manhã', level: 'Ensino Fundamental II' });
  const [onboardingCreatedClass, setOnboardingCreatedClass] = useState<ClassSchedule | null>(null);

  // localStorage key is per-user so switching accounts on the same device doesn't bleed over
  const onboardingLsKey = user ? `prof-coruja-onboarded-${user.uid}` : null;
  const localOnboarded = !!onboardingLsKey && (() => { try { return localStorage.getItem(onboardingLsKey) === 'true'; } catch { return false; } })();
  // Wait for Firestore to respond (profileLoaded) before deciding — prevents flash on new users
  const showOnboarding = !!user && profileLoaded && !profile.onboarded && !localOnboarded;

  // Sync to localStorage once Firestore confirms the user is onboarded
  useEffect(() => {
    if (!onboardingLsKey || !profileLoaded) return;
    if (profile.onboarded) {
      try { localStorage.setItem(onboardingLsKey, 'true'); } catch {}
    }
  }, [onboardingLsKey, profileLoaded, profile.onboarded]);

  const buildOnboardingClass = (): ClassSchedule => ({
    id: Math.random().toString(36).slice(2, 11),
    name: onboardingClass.name,
    days: [1, 2, 3, 4, 5],
    time: '08:00',
    subject: onboardingClass.subject || undefined,
    school: onboardingClass.school || undefined,
    shift: onboardingClass.shift || undefined,
    level: onboardingClass.level,
  });

  // Cria a turma e avança para o passo de configuração do ano letivo (importações)
  const goToYearSetup = () => {
    if (onboardingClass.name.trim() && !onboardingCreatedClass) {
      const newClass = buildOnboardingClass();
      setSchedules([...schedules, newClass]);
      setOnboardingCreatedClass(newClass);
    }
    setOnboardingStep(3);
  };

  const finishOnboarding = async (skipClass = false) => {
    const newName = onboardingName.trim() || 'Professor';
    setProfile({ ...profile, name: newName, onboarded: true } as UserProfile);
    try { if (onboardingLsKey) localStorage.setItem(onboardingLsKey, 'true'); } catch {}
    if (!skipClass && onboardingClass.name.trim() && !onboardingCreatedClass) {
      setSchedules([...schedules, buildOnboardingClass()]);
    }
    setOnboardingCreatedClass(null);
    setOnboardingStep(0);
  };
  const [studioMessages, setStudioMessages] = useFirestoreSync<{ id: string; role: 'user' | 'model'; text: string; date: number }>('studioMessages', user, [
    { id: 'studio-welcome', role: 'model', text: 'Olá! Sou o assistente do seu material. O que você gostaria de saber sobre o conteúdo que você adicionou?', date: Date.now() }
  ]);

  // Global Planner States (for persistence across screens)
  const [plannerTopic, setPlannerTopic] = useState('');
  const [plannerSelectedClassId, setPlannerSelectedClassId] = useState('');
  const [plannerPlan, setPlannerPlan] = useState('');
  const [plannerPresentationData, setPlannerPresentationData] = useState<PresentationData | null>(null);
  const [plannerActivity, setPlannerActivity] = useState('');
  const [plannerExam, setPlannerExam] = useState('');
  
  // Generation Settings (moved to global for Chat Control)
  const [plannerDuration, setPlannerDuration] = useState(1);
  const [plannerLessonTime, setPlannerLessonTime] = useState(50);
  const [plannerTone, setPlannerTone] = useState<'formal' | 'didactic' | 'technical' | 'concise'>('didactic');
  const [plannerComplexity, setPlannerComplexity] = useState<'basic' | 'intermediate' | 'advanced'>('intermediate');
  const [plannerFocus, setPlannerFocus] = useState<'practical' | 'theoretical' | 'balanced'>('balanced');
  const [plannerGroundingContent, setPlannerGroundingContent] = useState('');
  const [plannerQuestionCount, setPlannerQuestionCount] = useState(5);
  const [plannerSlideCount, setPlannerSlideCount] = useState(10);
  const [plannerTurn, setPlannerTurn] = useState<'matutino' | 'vespertino' | 'noturno'>('matutino');
  const [plannerQuestionType, setPlannerQuestionType] = useState<'mista' | 'multipla_escolha' | 'dissertativa'>('mista');
  const [plannerExamValue, setPlannerExamValue] = useState(10);
  const [plannerExamDuration, setPlannerExamDuration] = useState(60);

  const processedTasksRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    Object.values(activeTasks).forEach(task => {
      if (task.status === 'completed' && task.result && !processedTasksRef.current.has(task.id)) {
        processedTasksRef.current.add(task.id);
        const topicLabel = task.title.replace(/^(Slides|Atividades|Plano|Prova): /, '');
        const newResourceId = Math.random().toString(36).slice(2, 11);
        let saved = false;
        if (task.type === 'slides' && typeof task.result === 'object') {
          setSavedResources(prev => [...prev, {
            id: newResourceId, type: 'slides',
            title: (task.result as PresentationData).presentationTitle || topicLabel,
            date: Date.now(), presentationData: task.result as PresentationData
          }]);
          saved = true;
        } else if ((task.type === 'activities' || task.type === 'exam' || task.type === 'plan') && typeof task.result === 'string' && task.result.trim()) {
          setSavedResources(prev => [...prev, {
            id: newResourceId, type: task.type as 'activities' | 'exam' | 'plan',
            title: topicLabel, date: Date.now(), content: task.result as string
          }]);
          saved = true;
        }
      }
    });
  }, [activeTasks]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setResetMessage({ type: '', text: '' });
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setAuthError('Por favor, insira seu e-mail para recuperar a senha.');
      return;
    }
    setIsAuthProcessing(true);
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setResetMessage({ type: 'success', text: 'E-mail de recuperação enviado! Verifique sua caixa de entrada (e a pasta de spam).' });
      setTimeout(() => setIsResetMode(false), 6000);
    } catch (error: any) {
      console.error('Reset error:', error);
      const code = error?.code || '';
      let message = '';
      switch (code) {
        case 'auth/user-not-found':
          message = 'Nenhuma conta encontrada com este e-mail.';
          break;
        case 'auth/invalid-email':
          message = 'O formato do e-mail é inválido.';
          break;
        case 'auth/too-many-requests':
          message = 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.';
          break;
        case 'auth/network-request-failed':
          message = 'Sem conexão com a internet. Verifique sua rede e tente novamente.';
          break;
        case 'auth/operation-not-allowed':
          message = 'Recuperação por e-mail está desativada no Firebase. Ative o provedor "E-mail/Senha" no Firebase Console > Authentication > Sign-in method.';
          break;
        case 'auth/unauthorized-continue-uri':
        case 'auth/invalid-continue-uri':
        case 'auth/missing-continue-uri':
          message = 'Domínio do app não autorizado no Firebase. Adicione o domínio em Authentication > Settings > Authorized domains.';
          break;
        case 'auth/missing-android-pkg-name':
        case 'auth/missing-ios-bundle-id':
          message = 'Configuração do Firebase incompleta. Contate o administrador.';
          break;
        default:
          message = `Erro ao enviar e-mail (${code || error?.message || 'desconhecido'}). Tente novamente em instantes.`;
      }
      setAuthError(message);
    } finally {
      setIsAuthProcessing(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthProcessing(true);
    try {
      if (isLoginMode) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        if (userCredential.user) {
          await setDoc(doc(db, 'users', userCredential.user.uid), {
            name: '',
            email: email.toLowerCase().trim(),
            role: 'user',
            isPro: false,
            onboarded: false,
            createdAt: new Date().toISOString(),
            phoneVerified: false,
          });
          // Trigger phone verification step
          setPhoneStep('enter');
        }
      }
    } catch (error: any) {
      console.error('Auth error:', error);
      let message = 'Erro de autenticação. Verifique seus dados.';
      if (error.code === 'auth/email-already-in-use') {
        message = 'Este e-mail já está em uso. Tente fazer login ou recupere sua senha.';
      } else if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
        message = 'E-mail ou senha incorretos.';
      } else if (error.code === 'auth/user-not-found') {
        message = 'Conta não encontrada. Cadastre-se primeiro.';
      } else if (error.code === 'auth/weak-password') {
        message = 'A senha deve ter pelo menos 6 caracteres.';
      }
      setAuthError(message);
    } finally {
      setIsAuthProcessing(false);
    }
  };

  const sendPhoneSms = async () => {
    setPhoneError('');
    const raw = phoneNumber.replace(/\D/g, '');
    if (raw.length < 10) { setPhoneError('Digite um número de celular válido.'); return; }
    const formatted = '+55' + raw;
    setPhoneSending(true);
    try {
      // Check if phone already used by another account
      const snap = await getDocs(query(collection(db, 'users'), where('phone', '==', formatted)));
      if (!snap.empty) { setPhoneError('Este número já está vinculado a outra conta.'); setPhoneSending(false); return; }

      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      }
      const provider = new PhoneAuthProvider(auth);
      const verifId = await provider.verifyPhoneNumber(formatted, recaptchaRef.current);
      setPhoneVerifId(verifId);
      setPhoneStep('code');
    } catch (e: any) {
      setPhoneError(e.code === 'auth/invalid-phone-number' ? 'Número inválido. Use o formato: (11) 91234-5678' : 'Erro ao enviar SMS. Tente novamente.');
      recaptchaRef.current = null;
    } finally {
      setPhoneSending(false);
    }
  };

  const verifyPhoneCode = async () => {
    setPhoneError('');
    if (phoneCode.length !== 6) { setPhoneError('O código tem 6 dígitos.'); return; }
    setPhoneSending(true);
    try {
      const raw = phoneNumber.replace(/\D/g, '');
      const formatted = '+55' + raw;
      const credential = PhoneAuthProvider.credential(phoneVerifId, phoneCode);
      await linkWithCredential(auth.currentUser!, credential);
      await setDoc(doc(db, 'users', auth.currentUser!.uid), { phone: formatted, phoneVerified: true }, { merge: true });
      setPhoneStep('idle');
    } catch (e: any) {
      setPhoneError(e.code === 'auth/invalid-verification-code' ? 'Código incorreto. Verifique o SMS.' : 'Erro ao verificar. Tente novamente.');
    } finally {
      setPhoneSending(false);
    }
  };

  const FREE_GENERATION_LIMIT = 10;

  const isLimitReached = useMemo(() => {
    if (!user) return false;
    if (isAdminAccount(profile, user)) return false;
    if (profile?.isPro) return false;
    return (profile?.generationsUsed ?? 0) >= FREE_GENERATION_LIMIT;
  }, [user, profile]);

  const recordGeneration = async () => {
    if (!user) return;
    const isPrivileged = profile?.isPro || profile?.role === 'admin';
    const inputT = _pendingInputTokens; const outputT = _pendingOutputTokens;
    _pendingInputTokens = 0; _pendingOutputTokens = 0;
    try {
      const userUpdate: any = { generationsUsed: increment(1), inputTokens: increment(inputT), outputTokens: increment(outputT) };
      await setDoc(doc(db, 'users', user.uid), userUpdate, { merge: true });
      const monthKey = new Date().toISOString().slice(0, 7).replace('-', '_');
      const statsPayload = { totalGenerations: increment(1), totalInputTokens: increment(inputT), totalOutputTokens: increment(outputT) };
      await Promise.all([
        setDoc(doc(db, 'config', 'stats'), statsPayload, { merge: true }),
        setDoc(doc(db, 'config', `stats_${monthKey}`), statsPayload, { merge: true }),
      ]);
    } catch { /* best-effort */ }
  };

  if (!isAuthLoaded) {
    return <div className="min-h-screen flex items-center justify-center bg-[#F8F9FE]"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div></div>;
  }

  if (!user) {
    const formKey = isResetMode ? 'reset' : isLoginMode ? 'login' : 'register';
    return (
      <div
        className="min-h-screen bg-cover bg-center flex flex-col items-center justify-center p-6 relative"
        style={{ backgroundImage: 'url(https://i.ibb.co/XZyfzNYw/Design-sem-nome-20260426-213935-0000.png)' }}
      >
        <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-6">
          <motion.h1
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="text-4xl font-black text-black tracking-wider drop-shadow-sm text-center"
          >
            Prof. Corujão
          </motion.h1>

          <motion.form
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
            onSubmit={isResetMode ? handleResetPassword : handleEmailAuth}
            className="w-full bg-white p-6 rounded-3xl shadow-xl flex flex-col gap-4 mb-4"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={formKey}
                initial={{ opacity: 0, ...(isResetMode ? { y: 24 } : { x: isLoginMode ? -24 : 24 }) }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, ...(isResetMode ? { y: -16 } : { x: isLoginMode ? 24 : -24 }) }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="flex flex-col gap-4"
              >
                <h2 className="text-xl font-bold text-gray-900 mb-2 text-center">
                  {isResetMode ? 'Recuperar senha' : (isLoginMode ? 'Acesse sua conta' : 'Crie sua conta')}
                </h2>

                {authError && <div className="text-red-500 text-sm text-center bg-red-50 p-2 rounded-lg">{authError}</div>}
                {resetMessage.text && (
                  <div className={`text-sm text-center p-3 rounded-xl font-medium ${resetMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-blue-50 text-blue-700'}`}>
                    {resetMessage.text}
                    {resetMessage.type === 'success' && (
                      <p className="text-xs font-normal mt-1 text-green-600">Redirecionando para o login em instantes...</p>
                    )}
                  </div>
                )}

                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="email"
                    placeholder="Seu e-mail"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>

                {!isResetMode && (
                  <div className="flex flex-col gap-2">
                    <div className="relative">
                      <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="password"
                        placeholder="Sua senha"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>
                    {isLoginMode && (
                      <button
                        type="button"
                        onClick={() => { setIsResetMode(true); setAuthError(''); setResetMessage({type:'',text:''}); }}
                        className="text-sm text-indigo-600 hover:text-indigo-800 font-medium self-end"
                      >
                        Esqueceu a senha?
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isAuthProcessing}
                  className={`w-full text-white font-bold py-3 px-6 rounded-xl transition-all ${isAuthProcessing ? 'bg-gray-400 cursor-not-allowed shadow-md' : 'bg-gradient-to-br from-indigo-600 to-indigo-800 shadow-lg shadow-indigo-600/30 active:scale-[0.98]'}`}
                >
                  {isAuthProcessing ? 'Processando...' : (isResetMode ? 'Enviar link' : (isLoginMode ? 'Entrar' : 'Cadastrar'))}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (isResetMode) {
                      setIsResetMode(false);
                    } else {
                      setIsLoginMode(!isLoginMode);
                    }
                    setAuthError('');
                  }}
                  className="text-sm text-gray-500 hover:text-gray-800 font-medium mt-2"
                >
                  {isResetMode ? 'Voltar para o login' : (isLoginMode ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entre')}
                </button>
              </motion.div>
            </AnimatePresence>
          </motion.form>
        </div>
      </div>
    );
  }

  // Phone verification screen — shown to new users right after registration
  if (user && phoneStep !== 'idle') {
    return (
      <div className="min-h-screen bg-[#F8F9FE] flex flex-col items-center justify-center p-6">
        <div id="recaptcha-container" />
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-xl border border-indigo-100 flex flex-col items-center gap-5">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center text-3xl">📱</div>
          <div className="text-center">
            <h2 className="text-xl font-black text-gray-900">Verificação de celular</h2>
            <p className="text-sm text-gray-500 mt-1">
              {phoneStep === 'enter'
                ? 'Digite seu celular para receber um código de confirmação via SMS.'
                : `Código enviado para +55 ${phoneNumber}. Digite os 6 dígitos abaixo.`}
            </p>
          </div>

          {phoneError && <p className="text-sm text-red-500 font-medium text-center bg-red-50 p-2 rounded-xl w-full">{phoneError}</p>}

          {phoneStep === 'enter' && (
            <>
              <div className="w-full">
                <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Número do celular</label>
                <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-indigo-400">
                  <span className="px-3 py-3 bg-gray-50 text-sm font-bold text-gray-500 border-r border-gray-200">🇧🇷 +55</span>
                  <input
                    type="tel"
                    placeholder="(11) 91234-5678"
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                    className="flex-1 px-3 py-3 text-sm focus:outline-none"
                    inputMode="tel"
                  />
                </div>
              </div>
              <button
                onClick={sendPhoneSms}
                disabled={phoneSending}
                className="w-full bg-indigo-600 text-white font-bold py-3 rounded-2xl disabled:opacity-50"
              >
                {phoneSending ? 'Enviando SMS...' : 'Enviar código'}
              </button>
              <button onClick={() => setPhoneStep('idle')} className="text-xs text-gray-400 underline">
                Pular por agora
              </button>
            </>
          )}

          {phoneStep === 'code' && (
            <>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={phoneCode}
                onChange={e => setPhoneCode(e.target.value.replace(/\D/g, ''))}
                className="w-full text-center text-2xl font-black tracking-widest border border-gray-200 rounded-2xl py-4 focus:outline-none focus:border-indigo-400"
              />
              <button
                onClick={verifyPhoneCode}
                disabled={phoneSending || phoneCode.length !== 6}
                className="w-full bg-indigo-600 text-white font-bold py-3 rounded-2xl disabled:opacity-50"
              >
                {phoneSending ? 'Verificando...' : 'Confirmar código'}
              </button>
              <button onClick={() => { setPhoneStep('enter'); setPhoneCode(''); setPhoneError(''); }} className="text-xs text-gray-400 underline">
                Reenviar SMS
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (isLimitReached && screen !== 'admin' && screen !== 'profile') {
    return (
      <div className="min-h-screen bg-[#F8F9FE] flex flex-col items-center justify-center p-6 relative">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-xl border border-indigo-100 flex flex-col items-center">
          <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-6">
            <Sparkles size={32} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Limite do plano gratuito</h2>
          <p className="text-gray-500 mb-2">
            Você usou todas as <strong>{FREE_GENERATION_LIMIT} gerações gratuitas</strong>. Ative o plano Pro para continuar gerando planos, atividades e slides ilimitados.
          </p>
          <p className="text-sm text-gray-400 mb-6">Seu histórico e materiais já gerados continuam disponíveis.</p>
          <div className="p-4 bg-indigo-50 text-indigo-800 rounded-xl mb-4 text-sm">
            Ative o plano Pro e gere conteúdo ilimitado — planos de aula, slides, atividades e provas.
          </div>
          <a
            href="https://wa.me/5598981796309?text=Olá! Quero ativar o plano Pro do Prof. Corujão."
            target="_blank"
            rel="noopener noreferrer"
            className="w-full bg-green-500 hover:bg-green-600 text-white rounded-2xl py-3.5 text-base font-bold flex items-center justify-center gap-2 mb-4 transition-colors"
          >
            <MessageCircle size={20} /> Ativar Pro via WhatsApp
          </a>
          <button onClick={() => setScreen('profile')} className="text-indigo-600 font-bold mb-3">Ver meu perfil</button>
          <button onClick={() => logOut()} className="text-gray-500 hover:text-gray-700 font-medium text-sm">Sair da conta</button>
        </div>
      </div>
    );
  }

  const addClassItems = (newItems: ClassItem[]) => {
    setClasses(prev => [...prev, ...newItems].sort((a, b) => a.timestamp - b.timestamp));
    setNotifications(prev => [...prev, {
      id: Math.random().toString(36).slice(2, 11),
      title: 'Plano Gerado',
      message: `O plano de aula para ${newItems[0]?.className || 'sua turma'} está pronto para revisão.`,
      date: Date.now(),
      read: false
    }]);
  };

  const handleAddClassWithTrigger = (newClass: ClassSchedule) => {
    setSchedules(prev => [...prev, newClass]);
    setInboxMessages(prev => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2, 11),
        role: 'model',
        text: `Vi que você adicionou a turma **${newClass.name}**${newClass.level ? ` (${newClass.level})` : ''}! Quer que eu monte uma sugestão de planejamento anual para eles baseada na BNCC da sua disciplina?`,
        date: Date.now()
      }
    ]);
    setNotifications(prev => [...prev, {
      id: Math.random().toString(36).slice(2, 11),
      title: 'Nova Turma Adicionada',
      message: `A turma ${newClass.name} foi adicionada ao seu calendário.`,
      date: Date.now(),
      read: false
    }]);
  };

  const getSlidesPrompt = (topicText: string, className: string, tone: string, complexity: string, focus: string, groundingContent: string, slideCount: number, level?: string) => `Você é um Diretor de Arte Sênior. Sua tarefa é analisar o conteúdo do usuário e transformá-lo em uma apresentação de ${slideCount} slides sobre "${topicText}".
        Turma: "${className}"${level ? `\n        Nível de ensino: ${level}${level.toLowerCase().includes('infantil') ? ' — linguagem MUITO simples e lúdica, frases curtíssimas, priorize slides visuais (LAYOUT_FULL_IMAGE, LAYOUT_TOPICS com poucos itens), sem textos longos' : level.toLowerCase().includes('fundamental') ? ' — linguagem clara e acessível, exemplos do cotidiano' : level.toLowerCase().includes('médio') || level.toLowerCase().includes('medio') ? ' — pode aprofundar conceitos e usar vocabulário técnico com definições' : ''}` : ''}
        Tom: ${tone}
        Complexidade: ${complexity}
        Foco: ${focus}
        ${groundingContent ? `Conteúdo Base para Grounding: ${groundingContent}` : ''}

        Crie uma apresentação adaptada a estes parâmetros.
        
        LAYOUTS DISPONÍVEIS — escolha o mais adequado para cada slide:
        1. LAYOUT_COVER: Capa. Título à esquerda, subtítulo abaixo, imagem à direita. Campos: title, subtitle, illustrationQuery.
        2. LAYOUT_CONTENT_LEFT: Conteúdo com imagem. Título + texto à esquerda, imagem à direita. Campos: title, text, illustrationQuery.
        3. LAYOUT_CONTENT_RIGHT: Conteúdo invertido. Imagem à esquerda, título + texto à direita. Campos: title, text, illustrationQuery.
        4. LAYOUT_CONTENT_TOP: Horizontal. Título + texto no topo, imagem larga embaixo. Campos: title, text, illustrationQuery.
        5. LAYOUT_TOPICS: 3 colunas de tópicos com ícone Lucide, título e texto curto. Campos: title, topics[{title,content,icon}].
        6. LAYOUT_REFERENCES: Referências com fundo na cor primária. Campos: title, references[].
        7. LAYOUT_QUOTE: Citação impactante centralizada com aspas gigantes. Ideal para abrir ou fechar seções. Campos: title, quote, author.
        8. LAYOUT_TWO_COLUMNS: Dois blocos de texto lado a lado. Ideal para comparação, prós/contras, causa/efeito. Campos: title, column1, column2.
        9. LAYOUT_FULL_IMAGE: Imagem em tela cheia com sobreposição de gradiente escuro e título em destaque. Máximo impacto visual. Campos: title, subtitle, illustrationQuery.
        10. LAYOUT_STATS: 3 ou 4 cards de estatísticas/dados com valor em destaque, rótulo e ícone. Ideal para dados numéricos. Campos: title, stats[{value,label,icon}].
        11. LAYOUT_TIMELINE: Linha do tempo horizontal com 3 a 5 eventos. Ideal para cronologias e processos. Campos: title, events[{year,title,description}].

        REGRAS DE DESIGN:
        - COREOGRAFIA DE LAYOUTS (REGRA CRÍTICA — o ritmo visual importa tanto quanto o conteúdo):
            • NUNCA repita o mesmo layoutID em dois slides consecutivos.
            • LAYOUT_CONTENT_LEFT/RIGHT são o "arroz com feijão": use no MÁXIMO 40% do deck, sempre alternando LEFT e RIGHT entre si.
            • Deck com 6+ slides DEVE conter: 1 LAYOUT_TOPICS (cards), 1 momento de impacto (LAYOUT_FULL_IMAGE, LAYOUT_QUOTE ou LAYOUT_STATS) no meio do deck, e um slide final de revisão/encerramento.
            • Deck com 8+ slides DEVE usar pelo menos 6 layoutIDs diferentes.
            • Conteúdo tem números, quantidades ou percentuais? → inclua 1 LAYOUT_STATS.
            • Conteúdo tem processo, etapas, evolução ou datas? → inclua 1 LAYOUT_TIMELINE.
            • Conteúdo compara dois conceitos/tipos/lados? → inclua 1 LAYOUT_TWO_COLUMNS.
            • Use LAYOUT_FULL_IMAGE como "respiro" divisor entre blocos do conteúdo (funciona como capítulo).
            • LAYOUT_QUOTE: ótimo para frase de impacto, citação de autor ou pergunta provocadora à turma.
        - PALETA MONOCROMÁTICA: escolha UMA única cor base (primaryColor) adequada ao tema. Acento e fundo devem ser tons da MESMA cor (mais claro/mais escuro). NUNCA combine cores de matizes diferentes (ex: azul com amarelo, azul com verde). primaryColor deve ser escura o suficiente para texto branco por cima.
        - KICKER (obrigatório em TODO slide): campo "kicker" com um rótulo editorial curto de 1-2 palavras em MAIÚSCULAS que aparece acima do título (ex: "CONCEITO", "CONTEXTO", "EXEMPLO", "APLICAÇÃO", "RESUMO", "DEFINIÇÃO"). Deve resumir o papel do slide.
        - ALTO CONTRASTE: nunca texto claro sobre fundo claro.
        - CONCISÃO (REGRA CRÍTICA — slide NÃO é documento):
            • Campo "text" (LAYOUT_CONTENT_*): no MÁXIMO 4 a 5 linhas curtas OU ~60 palavras. Frases curtas e diretas, nunca parágrafos longos.
            • Cada "topics[].content": 1 frase curta, no máximo 12 palavras.
            • Colunas (column1/column2): no máximo 4 linhas curtas cada, além do título da coluna.
            • Prefira listas curtas a texto corrido. Cada linha = uma ideia. Não encha o slide.
            • É melhor cortar conteúdo e criar mais slides do que espremer texto demais em um só.
        - FORMATAÇÃO DE TEXTO RICA (use com MODERAÇÃO nos campos "text", "column1", "column2"):
            **palavra** → negrito para termos-chave (feche SEMPRE com **; sem espaço logo após o ** de abertura)
            ==palavra== → termo em destaque com cor de acento (use em definições e conceitos centrais)
            [[palavra]] → palavra-chave colorida em destaque primário (2-3 por slide máximo)
            {IconName} → ícone Lucide inline antes de tópicos (ex: {Target} Objetivo, {Brain} Conceito)
            ## Subtítulo → use no MÁXIMO 1 vez por slide, só para separar dois blocos
            - item → listas: comece a linha com "- " (hífen e espaço). Uma ideia por linha.
        - Combine as marcações: ex: {Target} **[[Objetivo]]**: ==aprender a== estrutura...
        - NUNCA use emojis. NUNCA coloque nomes de ícones entre parênteses no texto (ERRADO: "(CheckCircle) Título", "(User) Pessoas", "(Nature) Natureza"). Use APENAS a sintaxe {IconName}. NUNCA use ### ou mais de dois # para títulos.
        - LAYOUT_TWO_COLUMNS — IMPORTANTE: a PRIMEIRA linha de column1 e column2 é tratada como título da coluna (renderizado em destaque). Coloque o título da coluna na primeira linha, depois uma quebra de linha (\n), depois o conteúdo. Ex: column1: "Título da Coluna 1\n\nConteúdo detalhado com **marcações**..."
        - illustrationQuery: 2-3 palavras-chave em inglês (ex: 'science lab', 'ancient rome').

        SAÍDA: JSON estrito (sem Markdown ao redor):
        {
          "presentationTitle": "...",
          "theme": { "primaryColor": "#hex", "accentColor": "#hex", "backgroundColor": "#hex", "fontTitle": "...", "fontBody": "..." },
          "slides": [
            { "layoutID": "LAYOUT_COVER",        "data": { "kicker": "APRESENTAÇÃO", "title": "...", "subtitle": "...", "illustrationQuery": "..." } },
            { "layoutID": "LAYOUT_QUOTE",         "data": { "kicker": "REFLEXÃO", "title": "...", "quote": "...", "author": "..." } },
            { "layoutID": "LAYOUT_TWO_COLUMNS",   "data": { "kicker": "COMPARAÇÃO", "title": "...", "column1": "Título Coluna A\n\nConteúdo com **marcações**...", "column2": "Título Coluna B\n\nConteúdo com **marcações**..." } },
            { "layoutID": "LAYOUT_FULL_IMAGE",    "data": { "kicker": "VISUAL", "title": "...", "subtitle": "...", "illustrationQuery": "..." } },
            { "layoutID": "LAYOUT_STATS",         "data": { "kicker": "DADOS", "title": "...", "stats": [{ "value": "...", "label": "...", "icon": "TrendingUp" }] } },
            { "layoutID": "LAYOUT_TIMELINE",      "data": { "kicker": "HISTÓRIA", "title": "...", "events": [{ "year": "...", "title": "...", "description": "..." }] } },
            { "layoutID": "LAYOUT_TOPICS",        "data": { "kicker": "ESTRUTURA", "title": "...", "topics": [{ "title": "...", "content": "...", "icon": "BookOpen" }] } },
            { "layoutID": "LAYOUT_CONTENT_LEFT",  "data": { "kicker": "CONCEITO", "title": "...", "text": "...", "illustrationQuery": "..." } },
            { "layoutID": "LAYOUT_REFERENCES",    "data": { "kicker": "FONTES", "title": "Referências", "references": ["..."] } }
          ]
        }`;

  const getSuggestion = async (optTopic?: string, optClassId?: string) => {
    const targetTopic = optTopic || plannerTopic;
    const targetClassId = optClassId || plannerSelectedClassId;
    if (!targetTopic || !targetClassId) return;
    
    const taskId = addTask({ type: 'plan', title: `Sugerindo duração: ${targetTopic.substring(0, 30)}...` });
    try {
      const prompt = `Como um assistente pedagógico, analise o conteúdo: "${targetTopic}". 
      Sugira quantas aulas (de ${plannerLessonTime}min cada) são necessárias para cobrir esse conteúdo de forma eficaz. 
      Responda apenas o número bruto.`;
      
      const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt });
      const match = response.text?.match(/\d+/);
      const suggested = match ? parseInt(match[0], 10) : 1;
      const finalDuration = isNaN(suggested) || suggested < 1 ? 1 : Math.min(suggested, 20);
      setPlannerDuration(finalDuration);
      updateTask(taskId, { status: 'completed', result: finalDuration });
    } catch (error) {
      updateTask(taskId, { status: 'error', error: 'Erro ao sugerir duração.' });
      setPlannerDuration(1);
    }
  };

  const getScheduleBuffer = (
    topic: string, 
    duration: number, 
    startDateStr: string, 
    avoidCollisions: boolean, 
    selectedClass: ClassSchedule,
    existingClasses: ClassItem[]
  ): ClassItem[] => {
    const newItems: ClassItem[] = [];
    const [year, month, day] = startDateStr.split('-').map(Number);
    let currentDate = new Date(year, month - 1, day, 12, 0, 0, 0); 
    
    let addedCount = 0;
    let maxIterations = 365;

    const isDayOccupied = (dateToCheck: Date) => {
       const startOfDay = new Date(dateToCheck.getFullYear(), dateToCheck.getMonth(), dateToCheck.getDate()).getTime();
       const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
       return existingClasses.some(c =>
         c.className === selectedClass.name &&
         c.timestamp >= startOfDay &&
         c.timestamp < endOfDay
       );
    };

    const isHolidayDate = (date: Date): boolean => {
      const iso = toISODate(date);
      const yr = date.getFullYear();
      return customEvents.some(e => e.type === 'holiday' && e.date.startsWith(iso)) ||
             getDefaultHolidays(yr).some(h => h.type === 'holiday' && h.date.startsWith(iso));
    };

    while (addedCount < duration && maxIterations > 0) {
      if (selectedClass.days.includes(currentDate.getDay()) && !isHolidayDate(currentDate)) {
         const collision = avoidCollisions && isDayOccupied(currentDate);

         if (!collision) {
            newItems.push({
              id: Math.random().toString(36).slice(2, 11),
              title: `${topic} - Parte ${addedCount + 1}`,
              date: `${currentDate.getDate()} ${['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][currentDate.getMonth()]}`,
              status: 'pending',
              className: selectedClass.name,
              timestamp: currentDate.getTime()
            });
            addedCount++;
         }
      }
      currentDate.setDate(currentDate.getDate() + 1);
      maxIterations--;
    }
    return newItems;
  };

  const seedAdminData = () => {
    const holidayISOs = buildHolidayISOs(customEvents as any);
    // Todas as turmas aos sábados, em horários sequenciais de 2h
    const turmaDefs: { id: string; name: string; subject: string; time: string; color: string }[] = [
      { id: 'seed-t1', name: 'Turma 1', subject: 'Informática',      time: '07:00', color: '#4F46E5' },
      { id: 'seed-t2', name: 'Turma 2', subject: 'Informática',      time: '09:00', color: '#7C3AED' },
      { id: 'seed-t3', name: 'Turma 3', subject: 'Informática',      time: '11:00', color: '#0891B2' },
      { id: 'seed-t4', name: 'Turma 4', subject: 'Criação de Jogos', time: '13:00', color: '#D97706' },
      { id: 'seed-t5', name: 'Turma 5', subject: 'Informática',      time: '15:00', color: '#059669' },
    ];
    // Upsert: cria a turma se não existir, ou corrige dias/horário se já existir
    const updatedSchedules = [...schedules];
    for (const def of turmaDefs) {
      const idx = updatedSchedules.findIndex(s => s.name === def.name);
      if (idx >= 0) {
        updatedSchedules[idx] = { ...updatedSchedules[idx], days: [6], subject: def.subject, time: def.time, color: def.color };
      } else {
        updatedSchedules.push({ id: def.id, name: def.name, days: [6], subject: def.subject, time: def.time, color: def.color });
      }
    }
    // Regenera as aulas seed do zero (remove as antigas para corrigir dias errados)
    const keptClasses = classes.filter(c => !c.id.startsWith('seed-t'));
    const allItems: ClassItem[] = [
      ...generateTurmaItems('seed-t1', 'Turma 1', [6], '2026-06-13', INFORMATICA_LESSONS, holidayISOs),
      ...generateTurmaItems('seed-t2', 'Turma 2', [6], '2026-04-18', INFORMATICA_LESSONS, holidayISOs),
      // Turma 3: cronograma completo (38 aulas). Em 14/03 está na 2ª aula de Excel (índice 19);
      // as aulas anteriores ficam retroativas (já realizadas).
      ...generateTurmaItems('seed-t3', 'Turma 3', [6], '2026-03-14', INFORMATICA_LESSONS, holidayISOs, 19),
      ...generateTurmaItems('seed-t4', 'Turma 4', [6], '2026-03-14', JOGOS_LESSONS, holidayISOs),
      // Turma 5: cronograma completo (38 aulas). Em 14/03 está na 1ª aula de Word (índice 12);
      // as aulas anteriores ficam retroativas (já realizadas).
      ...generateTurmaItems('seed-t5', 'Turma 5', [6], '2026-03-14', INFORMATICA_LESSONS, holidayISOs, 12),
    ];
    setSchedules(updatedSchedules);
    setClasses([...keptClasses, ...allItems]);
    const done = allItems.filter(i => i.status === 'done').length;
    toast.success(`5 turmas e ${allItems.length} aulas importadas (${done} já realizadas)!`);
  };

  const generatePlan = async (optTopic?: string, optClassId?: string) => {
    const targetTopic = optTopic || plannerTopic;
    const targetClassId = optClassId || plannerSelectedClassId;

    if (!targetTopic.trim()) return;
    if (isLimitReached) return;

    const taskId = addTask({ type: 'plan', title: `Plano: ${targetTopic}` });
    try {
      const selectedClass = schedules.find(s => s.id === targetClassId);
      const className = selectedClass ? selectedClass.name : 'Geral';
      const toneMap: Record<string, string> = { formal: 'Formal', didactic: 'Didático', technical: 'Técnico', concise: 'Conciso' };
      const complexityMap: Record<string, string> = { basic: 'Básico', intermediate: 'Intermediário', advanced: 'Avançado' };
      const focusMap: Record<string, string> = { practical: 'Exemplos Práticos', theoretical: 'Embasamento Teórico', balanced: 'Equilibrado' };

      const abertura = Math.round(plannerLessonTime * 0.15);
      const desenvolvimento = Math.round(plannerLessonTime * 0.65);
      const fechamento = plannerLessonTime - abertura - desenvolvimento;

      const classLevel = selectedClass?.level || '';
      const isEarlyChildhood = classLevel.toLowerCase().includes('infantil');
      const isFundamental = classLevel.toLowerCase().includes('fundamental');
      const isMedio = classLevel.toLowerCase().includes('médio') || classLevel.toLowerCase().includes('medio');

      // ── Solução 2: selecionar habilidades BNCC do banco local ──────────────
      const bnccSkills = isEarlyChildhood ? [] : selectBnccSkills(selectedClass?.subject || profile.subject || '', className, targetTopic, 4);
      const bnccBlock  = bnccSkills.length > 0
        ? bnccSkills.map(s => `- ${s.code} — ${s.desc}`).join('\n')
        : isEarlyChildhood
          ? '- [Campos de Experiências da BNCC-EI pertinentes]'
          : '- [escolha habilidades BNCC reais para a disciplina e série]';

      const levelContext = isEarlyChildhood
        ? `NÍVEL: Educação Infantil — use linguagem lúdica, brincadeiras, histórias, músicas e atividades sensoriais. Foco no brincar, explorar e interagir. Evite avaliações formais.`
        : isFundamental
          ? `NÍVEL: Ensino Fundamental — equilibre teoria e prática, use exemplos do cotidiano, atividades em grupo e recursos visuais.`
          : isMedio
            ? `NÍVEL: Ensino Médio — aprofunde conceitos, estimule pensamento crítico, análise e produção textual. Conecte com ENEM e vestibular quando pertinente.`
            : '';

      const bnccSectionTitle = isEarlyChildhood ? 'CAMPOS DE EXPERIÊNCIAS (BNCC-EI)' : 'HABILIDADE (BNCC)';
      const bnccSectionInstructions = isEarlyChildhood
        ? 'Liste os Campos de Experiências da BNCC da Educação Infantil relacionados (ex: O eu, o outro e o nós; Corpo, gestos e movimentos; Traços, sons, cores e formas; Espaços, tempos, quantidades, relações e transformações; Escuta, fala, pensamento e imaginação).'
        : 'USE OBRIGATORIAMENTE as habilidades abaixo (são códigos reais verificados). Copie os códigos exatamente:';

      const avaliacaoBlock = isEarlyChildhood
        ? '## AVALIAÇÃO / REGISTRO\n[Formas de registro e observação — ex: portfólio, registros fotográficos, roda de conversa, observação sistemática. SEM provas ou notas na Ed. Infantil.]'
        : `## AVALIAÇÃO\n[Instrumento de avaliação e critérios — ex: observação, exercícios, portfólio, rubricas]`;

      // ── Solução 1: injetar habilidades reais no prompt ──────────────────
      const prompt = `Você é um pedagogo especialista. Gere um PLANO DE AULA completo e profissional.
${levelContext ? levelContext + '\n' : ''}Tópico: "${targetTopic}" | Turma: "${className}" | Turno: ${plannerTurn.charAt(0).toUpperCase() + plannerTurn.slice(1)} | Tom: ${toneMap[plannerTone]} | Complexidade: ${complexityMap[plannerComplexity]} | Foco: ${focusMap[plannerFocus]}
Quantidade de aulas: ${plannerDuration} | Duração por aula: ${plannerLessonTime} min (abertura: ${abertura}min · desenvolvimento: ${desenvolvimento}min · fechamento: ${fechamento}min)

Responda SOMENTE com as seções abaixo em Markdown, substituindo todos os campos [ ] por conteúdo real e pertinente.
PROIBIDO: introduções, saudações, comentários, tabelas Markdown (| coluna |) ou qualquer texto fora da estrutura abaixo.

## ÁREA DE CONHECIMENTO
[Área — ex: Ciências da Natureza, Linguagens, Matemática, Ciências Humanas${isEarlyChildhood ? ', Educação Infantil' : ''}]

## EIXO/UNIDADE TEMÁTICA
[Eixo temático ou unidade curricular que abrange "${targetTopic}"]

## CONTEÚDO
[Lista dos conteúdos a serem trabalhados na(s) aula(s)]

## OBJETIVOS${isEarlyChildhood ? ' DE APRENDIZAGEM E DESENVOLVIMENTO' : ''}
[Lista de objetivos em verbos de ação — ${isEarlyChildhood ? 'explorar, criar, expressar, interagir, investigar, brincar, desenvolver' : 'identificar, analisar, comparar, produzir, argumentar, resolver'}]

## PERGUNTAS MOBILIZADORAS DE APRENDIZAGEM
[2 ou 3 perguntas que orientam e motivam a aprendizagem sobre "${targetTopic}"${isEarlyChildhood ? ' — linguagem acessível e lúdica para crianças' : ''}]

## METODOLOGIA
[Sequência didática detalhada:
• Abertura (${abertura}min): ${isEarlyChildhood ? 'roda de conversa, música, história ou brincadeira de apresentação do tema' : 'estratégia de motivação ou levantamento de conhecimentos prévios'}
• Desenvolvimento (${desenvolvimento}min): ${isEarlyChildhood ? 'atividades lúdicas, exploração sensorial, brincadeiras dirigidas, arte e expressão corporal relacionadas ao tema' : 'sequência de atividades com metodologia ativa, explicação e fixação'}
• Fechamento (${fechamento}min): ${isEarlyChildhood ? 'roda de socialização, registro expressivo (desenho, colagem), cantinho da descoberta' : 'síntese, avaliação formativa e consolidação'}]

## ${bnccSectionTitle}
${bnccSectionInstructions}
${bnccBlock}

## RECURSOS DIDÁTICOS
[Lista de recursos — ${isEarlyChildhood ? 'ex: livros ilustrados, fantasias, tintas, massinha, instrumentos musicais, natureza, fantoches, blocos, jogos simbólicos' : 'ex: quadro branco, projetor, materiais manipulativos, textos'}]

${avaliacaoBlock}

## REFERÊNCIAS
[2 ou 3 referências bibliográficas em formato ABNT${isEarlyChildhood ? ' — inclua documentos BNCC e Referencial Curricular Nacional para Educação Infantil (RCNEI)' : ''}]`;

      // Plano de aula exige raciocínio pedagógico real (sequência didática,
      // BNCC, adequação de nível) — vale a pena um orçamento extra de "pensar antes de responder".
      const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt, config: { thinkingConfig: { thinkingBudget: 4096 } } });
      const planDraft = response.text || '';

      // ── Validação local determinística das habilidades BNCC ──────────────
      // Substitui a chamada de IA por verificação contra o banco local.
      let planResult = planDraft;
      if (bnccSkills.length > 0) {
        const validCodes = new Set(bnccSkills.map(s => s.code.toUpperCase()));
        const allCodesInPlan = (planDraft.match(/\b(EF\d{2}[A-Z]{2}\d{2}|EM13[A-Z]{3}\d{3})\b/g) || [])
          .map(c => c.toUpperCase());
        const hasInvalidCode = allCodesInPlan.some(c => !validCodes.has(c));
        const hasMissingCode = bnccSkills.some(s => !allCodesInPlan.includes(s.code.toUpperCase()));
        if (hasInvalidCode || hasMissingCode || allCodesInPlan.length === 0) {
          const correctSection = `## HABILIDADE (BNCC)\n${bnccBlock}`;
          planResult = planDraft.replace(
            /## Habilidade \(BNCC\)[\s\S]*?(?=\n## |\n---|\n#[^#]|$)/i,
            correctSection + '\n'
          );
        }
      }

      setPlannerPlan(planResult);
      updateTask(taskId, { status: 'completed', result: planResult });
      recordGeneration();
    } catch (error) {
      updateTask(taskId, { status: 'error', error: formatApiError(error, 'Não consegui montar o plano dessa vez. Tente novamente.') });
    }
  };

  const generateResource = async (type: 'activities' | 'slides' | 'exam', optTopic?: string, optClassId?: string) => {
    const targetTopic = optTopic || plannerTopic;
    const targetClassId = optClassId || plannerSelectedClassId;
    if (!targetTopic.trim()) return;
    if (isLimitReached) return;

    const taskId = addTask({ type, title: `${type === 'slides' ? 'Slides' : type === 'exam' ? 'Prova' : 'Atividades'}: ${targetTopic}` });
    try {
      const selectedClass = schedules.find(c => c.id === targetClassId);
      const className = selectedClass ? selectedClass.name : 'Geral';

      if (type === 'slides') {
        const prompt = getSlidesPrompt(targetTopic, className, plannerTone, plannerComplexity, plannerFocus, plannerGroundingContent, plannerSlideCount, selectedClass?.level);
        // Coreografia de layouts + planejamento do arco do deck se beneficiam de
        // um orçamento extra de raciocínio antes de responder.
        const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt, config: { thinkingConfig: { thinkingBudget: 4096 } } });
        let text = (response.text || '{}').replace(/```json/g, '').replace(/```/g, '').trim();
        // Recover JSON even if the model wraps it in extra text
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace > 0 && lastBrace > firstBrace) {
          text = text.substring(firstBrace, lastBrace + 1);
        }
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          updateTask(taskId, { status: 'error', error: 'A IA retornou um formato inválido. Tente novamente — geralmente funciona na 2ª tentativa.' });
          return;
        }
        if (!parsed?.slides || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
          updateTask(taskId, { status: 'error', error: 'A IA não retornou slides válidos. Tente novamente.' });
          return;
        }
        // Image fetch is best-effort and bounded; never block more than 15s total.
        try {
          await withTimeout(
            Promise.all(parsed.slides.map(async (slide: any) => {
              const q = slide.data?.illustrationQuery || slide.data?.imagePrompt;
              if (q) {
                try { slide.data.imageUrl = await fetchPixabayImage(q, 1200, 800); } catch {}
              }
            })),
            15000,
            'busca de imagens'
          );
        } catch (e) {
          console.warn('Image fetch timed out — proceeding without all images.');
        }
        const sanitized = sanitizeSlideData(parsed);
        setPlannerPresentationData(sanitized);
        updateTask(taskId, { status: 'completed', result: sanitized });
        recordGeneration();
      } else {
        const escolaStr = selectedClass?.school || profile.schoolName || '_________________';
        const professorStr = profile.name || '_________________';
        const disciplinaStr = selectedClass?.subject || profile.subject || '_________________';
        
        const resClassLevel = selectedClass?.level || '';
        const resIsEarlyChildhood = resClassLevel.toLowerCase().includes('infantil');
        const complexityLabel = { basic: 'Básico (Ensino Fundamental)', intermediate: 'Intermediário (Ensino Médio)', advanced: 'Avançado (Superior/Técnico)' }[plannerComplexity] || plannerComplexity;
        const mcPts  = parseFloat((plannerExamValue / 10).toFixed(1));
        const dissPts = parseFloat((plannerExamValue / 4).toFixed(1));
        const examDurStr = plannerExamDuration < 60 ? `${plannerExamDuration} min` : plannerExamDuration === 60 ? '1 hora' : `${Math.floor(plannerExamDuration/60)}h${plannerExamDuration%60 > 0 ? plannerExamDuration%60+'min' : ''}`;

        const qtLabel: Record<string, string> = { mista: 'Varie os tipos entre as questões: múltipla escolha, completar lacunas, V/F com justificativa, relacionar colunas, produção textual ou resolução de problema.', multipla_escolha: 'Todas as questões são de MÚLTIPLA ESCOLHA com 4 alternativas (A, B, C, D), apenas uma correta.', dissertativa: 'Todas as questões são DISSERTATIVAS (resposta aberta), com 5 linhas de resposta.' };
        const qtInstruction = resIsEarlyChildhood
          ? 'Use atividades LÚDICAS e visuais adequadas à Ed. Infantil: colorir, ligar com setas, identificar figuras, completar com desenho, circular a resposta correta com imagens. SEM leitura extensa ou escrita formal.'
          : qtLabel[plannerQuestionType] || qtLabel.mista;

        const prompt = type === 'exam'
          ? `Você é um professor especialista. Gere uma AVALIAÇÃO FORMAL sobre "${targetTopic}" para a turma "${className}" (nível: ${complexityLabel}).
Valor total: ${plannerExamValue} pontos | Tempo: ${examDurStr}

ESTRUTURA OBRIGATÓRIA — siga EXATAMENTE (substitua tudo entre [ ] por conteúdo real):

# Avaliação: ${targetTopic}

## Parte I — Questões de Múltipla Escolha *(${mcPts} pts cada — total: ${(mcPts*5).toFixed(1)} pts)*

**Questão 1 (${mcPts} pts)** [enunciado claro e objetivo]

( ) A) [alternativa plausível]
( ) B) [alternativa plausível]
( ) C) [alternativa plausível]
( ) D) [alternativa plausível]

**Questão 2 (${mcPts} pts)** [enunciado]

( ) A) [alternativa]
( ) B) [alternativa]
( ) C) [alternativa]
( ) D) [alternativa]

**Questão 3 (${mcPts} pts)** [enunciado]

( ) A) [alternativa]
( ) B) [alternativa]
( ) C) [alternativa]
( ) D) [alternativa]

**Questão 4 (${mcPts} pts)** [enunciado]

( ) A) [alternativa]
( ) B) [alternativa]
( ) C) [alternativa]
( ) D) [alternativa]

**Questão 5 (${mcPts} pts)** [enunciado]

( ) A) [alternativa]
( ) B) [alternativa]
( ) C) [alternativa]
( ) D) [alternativa]

---

## Parte II — Questões Dissertativas *(${dissPts} pts cada — total: ${(dissPts*2).toFixed(1)} pts)*

**Questão 6 (${dissPts} pts)** [enunciado que exige desenvolvimento e reflexão]

_______________________________________________________________________________
_______________________________________________________________________________
_______________________________________________________________________________
_______________________________________________________________________________
_______________________________________________________________________________

**Questão 7 (${dissPts} pts)** [enunciado que exige desenvolvimento]

_______________________________________________________________________________
_______________________________________________________________________________
_______________________________________________________________________________
_______________________________________________________________________________
_______________________________________________________________________________

---

*Pontuação total: _______ / ${plannerExamValue} pontos*

---GABARITO---

## Gabarito — Avaliação: ${targetTopic}

**Q1:** [letra correta — ex: B]
**Q2:** [letra correta]
**Q3:** [letra correta]
**Q4:** [letra correta]
**Q5:** [letra correta]

**Q6:** [elementos essenciais esperados na resposta: liste 2-3 pontos chave]
**Q7:** [elementos essenciais esperados na resposta: liste 2-3 pontos chave]

REGRAS CRÍTICAS:
- A resposta correta aparece SOMENTE na seção GABARITO (após ---GABARITO---). Na Parte I, as 4 alternativas de cada questão devem ser TODAS plausíveis, SEM nenhuma marca, asterisco, negrito, "(correta)", nem qualquer pista de qual é a certa.
- Distribua a alternativa correta aleatoriamente entre A, B, C e D ao longo das 5 questões (não deixe sempre na mesma letra).
- Substitua TODOS os [ ] por conteúdo real sobre "${targetTopic}". PROIBIDO introduções, tabelas Markdown (| coluna |) ou texto fora da estrutura.`
          : `Você é um professor especialista. Gere ${plannerQuestionCount} QUESTÕES sobre "${targetTopic}" para a turma "${className}" (nível: ${complexityLabel}).
Tipo de questão: ${qtInstruction}

ESTRUTURA OBRIGATÓRIA — siga EXATAMENTE (substitua tudo entre [ ] por conteúdo real):

# Atividade: ${targetTopic}

## Questões

**1.** [Enunciado. ${qtInstruction}]

_______________________________________________________________________________
_______________________________________________________________________________
_______________________________________________________________________________

[Continue numerando até a questão ${plannerQuestionCount}, seguindo o mesmo formato e tipo de questão]

---GABARITO---

## Gabarito — Atividade: ${targetTopic}

**1.** [resposta correta ou critérios de correção objetivos]
[Continue para todas as ${plannerQuestionCount} questões]

REGRAS: Substitua TODOS os [ ] por conteúdo real sobre "${targetTopic}". PROIBIDO introduções, tabelas Markdown (| coluna |) ou texto fora da estrutura.`;
          
        const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt });
        const result = response.text || '';
        if (type === 'exam') setPlannerExam(result);
        else setPlannerActivity(result);
        updateTask(taskId, { status: 'completed', result });
        recordGeneration();
      }
    } catch (error) {
      updateTask(taskId, { status: 'error', error: formatApiError(error, 'Esse material não saiu como esperado. Tente novamente.') });
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FE] font-sans text-gray-900 selection:bg-indigo-100 selection:text-indigo-900">
      <ToastContainer />

      <AnimatePresence>
        {globalAnnouncement?.active && globalAnnouncement.message && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={dismissAnnouncement}
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 10 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="bg-gradient-to-br from-indigo-600 to-purple-600 px-6 py-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center"><Megaphone size={20} className="text-white" /></div>
                  <h3 className="text-white font-bold text-lg">Aviso</h3>
                </div>
                <button onClick={dismissAnnouncement} className="text-white/80 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="px-6 py-5">
                <p className="text-gray-700 text-base leading-relaxed whitespace-pre-wrap">{globalAnnouncement.message}</p>
              </div>
              <div className="px-6 pb-5">
                <button
                  onClick={dismissAnnouncement}
                  className="w-full bg-indigo-600 text-white font-bold py-3 rounded-2xl active:scale-[0.98] transition-transform shadow-md"
                >
                  Entendi
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Onboarding Modal ───────────────────────────────────────────── */}
      {showOnboarding && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-end justify-center p-0">
          <div className="bg-white w-full max-w-md rounded-t-[2.5rem] p-6 pb-10 shadow-2xl">
            <div className="flex justify-center gap-1.5 mb-5">
              {[0, 2, 3].map(stepId => (
                <div key={stepId} className={`h-1.5 rounded-full transition-all duration-300 ${onboardingStep === stepId ? 'w-6 bg-indigo-600' : 'w-1.5 bg-gray-200'}`} />
              ))}
            </div>
            {onboardingStep === 0 && (
              <>
                <div className="flex flex-col items-center text-center mb-6">
                  <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mb-3">
                    <img src="https://i.ibb.co/FbhRcLsz/Sem-nome-1300-x-1300-px-20260616-150714-0000.png" alt="Corujão" className="w-full h-full object-contain" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} />
                  </div>
                  <h2 className="text-2xl font-black text-gray-900">Bem-vindo ao Prof. Corujão!</h2>
                  <p className="text-sm text-gray-500 mt-1">Vamos configurar seu perfil em poucos passos.</p>
                </div>
                <div className="mb-5">
                  <label className="text-xs font-bold text-gray-400 uppercase ml-1">Qual é o seu nome?</label>
                  <input
                    autoFocus
                    value={onboardingName}
                    onChange={e => setOnboardingName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && onboardingName.trim() && setOnboardingStep(2)}
                    placeholder="Ex: Maria Souza"
                    className="w-full mt-2 p-4 border-2 border-gray-200 rounded-2xl text-lg font-bold focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  onClick={() => onboardingName.trim() && setOnboardingStep(2)}
                  disabled={!onboardingName.trim()}
                  className="w-full bg-indigo-600 text-white rounded-2xl py-4 text-base font-bold disabled:opacity-40"
                >
                  Continuar →
                </button>
              </>
            )}

            {onboardingStep === 2 && (
              <>
                <div className="mb-4">
                  <h2 className="text-xl font-black text-gray-900">Cadastre sua primeira turma</h2>
                  <p className="text-sm text-gray-400 mt-0.5">Você pode adicionar mais turmas depois no Perfil.</p>
                </div>
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase ml-1">Nome da Turma *</label>
                    <input
                      value={onboardingClass.name}
                      onChange={e => setOnboardingClass(c => ({...c, name: e.target.value}))}
                      placeholder="Ex: 6º Ano A"
                      className="w-full mt-1 p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase ml-1">Disciplina *</label>
                    <select
                      value={onboardingClass.subject}
                      onChange={e => setOnboardingClass(c => ({...c, subject: e.target.value}))}
                      className={`w-full mt-1 p-3 rounded-xl focus:outline-none transition-all ${onboardingClass.subject ? 'bg-indigo-600 text-white font-bold border-none' : 'border border-gray-200 bg-white text-gray-700'}`}
                    >
                      <option value="">Selecione</option>
                      {SUBJECT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase ml-1">Nível</label>
                    <select
                      value={onboardingClass.level}
                      onChange={e => setOnboardingClass(c => ({...c, level: e.target.value}))}
                      className="w-full mt-1 p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white text-gray-700"
                    >
                      <option value="Ensino Fundamental I">Ensino Fundamental I</option>
                      <option value="Ensino Fundamental II">Ensino Fundamental II</option>
                      <option value="Ensino Médio">Ensino Médio</option>
                      <option value="EJA">EJA</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase ml-1">Turno</label>
                    <div className="flex gap-2 mt-1">
                      {['Manhã', 'Tarde', 'Noite'].map(s => (
                        <button key={s} onClick={() => setOnboardingClass(c => ({...c, shift: s}))}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${onboardingClass.shift === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase ml-1">Escola</label>
                    <input
                      value={onboardingClass.school}
                      onChange={e => setOnboardingClass(c => ({...c, school: e.target.value}))}
                      placeholder="Nome da escola"
                      className="w-full mt-1 p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm"
                    />
                  </div>
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => finishOnboarding(true)}
                    className="flex-1 bg-gray-100 text-gray-600 rounded-2xl py-3.5 text-sm font-bold">
                    Pular
                  </button>
                  <button
                    onClick={goToYearSetup}
                    disabled={!onboardingClass.name.trim() || !onboardingClass.subject}
                    className="flex-[2] bg-indigo-600 text-white rounded-2xl py-3.5 text-sm font-bold disabled:opacity-40"
                  >
                    Continuar →
                  </button>
                </div>
              </>
            )}

            {onboardingStep === 3 && (
              <>
                <div className="flex flex-col items-center text-center mb-5">
                  <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mb-3">
                    <CalendarIcon size={28} className="text-indigo-600" />
                  </div>
                  <h2 className="text-xl font-black text-gray-900">Configurar Ano Letivo</h2>
                  <p className="text-sm text-gray-500 mt-1">Tem o PDF do calendário da escola ou a ementa? A IA preenche tudo pra você. (Opcional — dá pra fazer depois.)</p>
                </div>
                <div className="space-y-3">
                  <button
                    onClick={() => setImportRequest({ mode: 'calendar' })}
                    className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-gray-100 active:scale-[0.98] transition-transform text-left"
                  >
                    <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 shrink-0"><CalendarIcon size={22} /></div>
                    <div className="flex-1">
                      <p className="font-bold text-gray-900 text-sm">Importar calendário letivo</p>
                      <p className="text-xs text-gray-400">Feriados, recessos, reuniões e provas</p>
                    </div>
                    <ChevronRight size={18} className="text-gray-300" />
                  </button>
                  {onboardingCreatedClass && (
                    <button
                      onClick={() => setImportRequest({ mode: 'syllabus', targetClass: onboardingCreatedClass })}
                      className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-gray-100 active:scale-[0.98] transition-transform text-left"
                    >
                      <div className="w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0"><BookOpen size={22} /></div>
                      <div className="flex-1">
                        <p className="font-bold text-gray-900 text-sm">Importar ementa de {onboardingCreatedClass.name}</p>
                        <p className="text-xs text-gray-400">Distribui os módulos no calendário</p>
                      </div>
                      <ChevronRight size={18} className="text-gray-300" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => finishOnboarding(true)}
                  className="w-full bg-indigo-600 text-white rounded-2xl py-3.5 text-sm font-bold mt-5 active:scale-[0.98] transition-transform"
                >
                  Concluir →
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Modal de Importação (calendário letivo / ementa) ── */}
      <AnimatePresence>
        {importRequest && (
          <ImportModal
            mode={importRequest.mode}
            targetClass={importRequest.targetClass}
            year={currentYear}
            onClose={() => setImportRequest(null)}
            customEvents={customEvents as any}
            setCustomEvents={setCustomEvents as any}
            onAddClassItems={addClassItems}
          />
        )}
      </AnimatePresence>

      {canSeedTurmas(profile, user) && (
        <div className="fixed bottom-24 right-4 z-[55]">
          <button
            onClick={seedAdminData}
            className="bg-indigo-600 text-white text-xs font-bold px-3 py-2 rounded-full shadow-lg flex items-center gap-1.5 active:scale-95 transition-transform"
            title="Importar turmas pré-definidas (admin)"
          >
            <Upload size={13} /> Importar turmas
          </button>
        </div>
      )}
      <div className="max-w-md mx-auto h-screen relative px-6 pt-12 overflow-y-auto no-scrollbar">
        <AnimatePresence mode="wait">
          {screen === 'home' && <HomeScreen key="home" setScreen={setScreen} setPlannerMode={setPlannerMode} classes={classes} setClasses={setClasses} profile={profile} profileLoaded={profileLoaded} inboxMessages={inboxMessages} notifications={allNotifications} setNotifications={handleSetNotifications} openFerramenta={(tool) => { setFerramentasTool(tool); setScreen('ferramentas'); }} setSelectedDate={(d: Date) => {
            setSelectedDate(d.getDate());
            setCurrentMonth(d.getMonth());
            setCurrentYear(d.getFullYear());
          }} schedules={schedules} />}
          {screen === 'planner' && <PlannerScreen 
            key="planner" 
            setScreen={setScreen} 
            schedules={schedules} 
            setSchedules={setSchedules} 
            addClassItems={addClassItems} 
            classes={classes} 
            setClasses={setClasses} 
            mode={plannerMode} 
            profile={profile} 
            estudioContext={estudioContext} 
            savedResources={savedResources} 
            addTask={addTask} 
            updateTask={updateTask} 
            activeTasks={activeTasks}
            plannerTopic={plannerTopic}
            setPlannerTopic={setPlannerTopic}
            plannerSelectedClassId={plannerSelectedClassId}
            setPlannerSelectedClassId={setPlannerSelectedClassId}
            plannerPlan={plannerPlan}
            setPlannerPlan={setPlannerPlan}
            plannerPresentationData={plannerPresentationData}
            setPlannerPresentationData={setPlannerPresentationData}
            plannerActivity={plannerActivity}
            setPlannerActivity={setPlannerActivity}
            plannerExam={plannerExam}
            setPlannerExam={setPlannerExam}
            setSavedResources={(res) => {
              setSavedResources(res);
              if (res.length > savedResources.length) {
                setNotifications([...notifications, {
                  id: Math.random().toString(36).slice(2, 11),
                  title: 'Material Salvo',
                  message: 'Novo material gerado com sucesso.',
                  date: Date.now(),
                  read: false
                }]);
                // Auto-link new resource to next upcoming lesson for the selected class
                if (plannerSelectedClassId) {
                  const newResource = res[res.length - 1];
                  const sched = schedules.find(s => s.id === plannerSelectedClassId);
                  if (sched && newResource) {
                    const now = Date.now();
                    const nextLesson = classes
                      .filter(c => c.className === sched.name && c.status === 'pending' && c.timestamp >= now)
                      .sort((a, b) => a.timestamp - b.timestamp)[0];
                    if (nextLesson) {
                      setClasses(classes.map(c => c.id === nextLesson.id
                        ? { ...c, resourceIds: [...(c.resourceIds || []), newResource.id] }
                        : c
                      ));
                    }
                  }
                }
              }
            }}
            notifications={allNotifications} 
            setNotifications={handleSetNotifications}
            generatePlan={generatePlan}
            generateResource={generateResource}
            plannerDuration={plannerDuration}
            setPlannerDuration={setPlannerDuration}
            plannerLessonTime={plannerLessonTime}
            setPlannerLessonTime={setPlannerLessonTime}
            plannerTone={plannerTone}
            setPlannerTone={setPlannerTone}
            plannerComplexity={plannerComplexity}
            setPlannerComplexity={setPlannerComplexity}
            plannerFocus={plannerFocus}
            setPlannerFocus={setPlannerFocus}
            plannerGroundingContent={plannerGroundingContent}
            setPlannerGroundingContent={setPlannerGroundingContent}
            plannerQuestionCount={plannerQuestionCount}
            setPlannerQuestionCount={setPlannerQuestionCount}
            plannerSlideCount={plannerSlideCount}
            setPlannerSlideCount={setPlannerSlideCount}
            plannerTurn={plannerTurn}
            setPlannerTurn={setPlannerTurn}
            plannerQuestionType={plannerQuestionType}
            setPlannerQuestionType={setPlannerQuestionType}
            plannerExamValue={plannerExamValue}
            setPlannerExamValue={setPlannerExamValue}
            plannerExamDuration={plannerExamDuration}
            setPlannerExamDuration={setPlannerExamDuration}
            getSuggestion={getSuggestion}
            getScheduleBuffer={getScheduleBuffer}
            setPlannerMode={setPlannerMode}
            generationsUsed={profile?.generationsUsed ?? 0}
            isLimitReached={isLimitReached}
            freeGenerationLimit={FREE_GENERATION_LIMIT}
          />}
          {screen === 'chat' && <ChatScreen 
            key="chat" 
            setScreen={setScreen} 
            profile={profile} 
            setProfile={setProfile}
            estudioContext={estudioContext} 
            messages={inboxMessages} 
            setMessages={setInboxMessages} 
            classes={classes} 
            schedules={schedules} 
            savedResources={savedResources} 
            addClassItems={addClassItems} 
            customEvents={customEvents} 
            setCustomEvents={setCustomEvents} 
            notifications={allNotifications} 
            setNotifications={handleSetNotifications}
            generatePlan={generatePlan}
            generateResource={generateResource}
            plannerTopic={plannerTopic}
            setPlannerTopic={setPlannerTopic}
            plannerSelectedClassId={plannerSelectedClassId}
            setPlannerSelectedClassId={setPlannerSelectedClassId}
            setPlannerMode={setPlannerMode}
            getScheduleBuffer={getScheduleBuffer}
          />}
          {screen === 'calendar' && <CalendarScreen key="calendar" classes={classes} setClasses={setClasses} schedules={schedules} profile={profile} inboxMessages={inboxMessages} customEvents={customEvents} setCustomEvents={setCustomEvents} selectedDate={selectedDate} setSelectedDate={setSelectedDate} currentMonth={currentMonth} setCurrentMonth={setCurrentMonth} currentYear={currentYear} setCurrentYear={setCurrentYear} setScreen={setScreen} notifications={allNotifications} setNotifications={handleSetNotifications} onImport={() => setImportRequest({ mode: 'calendar' })} />}
          {screen === 'dayDetail' && <DayDetailScreen key="dayDetail"
            schedules={schedules}
            selectedDate={selectedDate}
            currentMonth={currentMonth}
            currentYear={currentYear}
            allEvents={[...classes.map(c => ({...c, type: 'class' as const})), ...customEvents, ...getDefaultHolidays(currentYear).filter(h => !customEvents.some(ce => ce.title === h.title && ce.date.startsWith(h.date.split(' ')[0])))]}
            setScreen={setScreen}
            setCustomEvents={setCustomEvents}
            setClasses={setClasses}
            onPrepareLesson={(topic, classId) => {
              setPlannerTopic(topic);
              setPlannerSelectedClassId(classId);
              setPlannerMode('plan');
              setScreen('planner');
            }}
            onRescheduleLesson={(classItemId) => {
              const item = classes.find(c => c.id === classItemId);
              if (!item) return;
              const sched = schedules.find(s => s.name === item.className);
              if (!sched) return;
              const classDays = sched.days?.length ? sched.days : [1, 2, 3, 4, 5];
              const holidayISOs = buildHolidayISOs(customEvents);
              let next = new Date(item.timestamp);
              next.setDate(next.getDate() + 1);
              let guard = 90;
              while (guard > 0) {
                const iso = toISODate(next);
                const alreadyOccupied = classes.some(c => c.id !== classItemId && c.className === item.className && toISODate(new Date(c.timestamp)) === iso);
                if (classDays.includes(next.getDay()) && !holidayISOs.has(iso) && !alreadyOccupied) break;
                next.setDate(next.getDate() + 1);
                guard--;
              }
              const newDate = `${next.getDate()} ${['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][next.getMonth()]}`;
              setClasses(classes.map(c => c.id === classItemId ? { ...c, date: newDate, timestamp: next.getTime(), status: 'pending' } : c));
              toast.success('Aula adiada para ' + next.toLocaleDateString('pt-BR'));
            }}
          />}
          {screen === 'profile' && <ProfileScreen key="profile" user={user} schedules={schedules} setSchedules={setSchedules} profile={profile} setProfile={setProfile} savedResources={savedResources} setScreen={setScreen} onAddClass={handleAddClassWithTrigger} customEvents={customEvents} setCustomEvents={setCustomEvents} notifications={allNotifications} setNotifications={handleSetNotifications} onResetAccount={() => {
            setSchedules([]);
            setClasses([]);
            setCustomEvents([]);
            setSavedResources([]);
            setNotifications([]);
            setInboxMessages([{ id: 'welcome', role: 'model', text: 'Olá! Eu sou o assistente do **Prof. Corujão**. Envie ideias rápidas, lembretes ou faça perguntas. Eu organizo tudo para você!', date: Date.now() }]);
            setProfile({ name: 'Professor', subject: 'Sem disciplina', role: 'user', photo: '' });
            setEstudioContext('');
          }} onDeleteAccount={async () => {
            if (!user) return;
            const uid = user.uid;
            try {
              const subcols = ['schedules', 'classes', 'events', 'resources', 'notifications', 'messages', 'studioMessages', 'gamification', 'diario', 'fcmTokens'];
              for (const col of subcols) {
                const snap = await getDocs(collection(db, `users/${uid}/${col}`));
                const batch = writeBatch(db);
                snap.docs.forEach(d => batch.delete(d.ref));
                if (snap.docs.length > 0) await batch.commit();
              }
              await deleteDoc(doc(db, 'users', uid));
              await deleteUser(user);
            } catch (e: any) {
              if (e?.code === 'auth/requires-recent-login') {
                toast.error('Por segurança, saia e entre novamente antes de excluir a conta.');
              } else {
                toast.error('Erro ao excluir conta. Tente novamente.');
              }
            }
          }} onImportSyllabus={(cls) => setImportRequest({ mode: 'syllabus', targetClass: cls })} />}
          {screen === 'estudio' && <EstudioScreen key="estudio" estudioContext={estudioContext} setEstudioContext={setEstudioContext} studioMessages={studioMessages} setStudioMessages={setStudioMessages} profile={profile} setScreen={setScreen} setPlannerMode={setPlannerMode} notifications={allNotifications} setNotifications={handleSetNotifications} schedules={schedules} addTask={addTask} updateTask={updateTask} activeTasks={activeTasks} removeTask={removeTask} studioReopenTaskId={studioReopenTaskId} setStudioReopenTaskId={setStudioReopenTaskId} />}
          {screen === 'biblioteca' && <LibraryScreen key="biblioteca" user={user} setScreen={setScreen} profile={profile} notifications={allNotifications} setNotifications={handleSetNotifications} />}
          {screen === 'gamificacao' && <GamificacaoScreen key="gamificacao" schedules={schedules} user={user} profile={profile} setScreen={setScreen} />}
          {screen === 'ferramentas' && <FerramentasScreen key="ferramentas" profile={profile} schedules={schedules} user={user} setScreen={setScreen} notifications={allNotifications} setNotifications={handleSetNotifications} initialTool={ferramentasTool} clearInitialTool={() => setFerramentasTool(null)} classes={classes} />}
          {screen === 'acervo' && <AcervoScreen key="acervo" savedResources={savedResources} setSavedResources={setSavedResources} profile={profile} setScreen={setScreen} notifications={allNotifications} setNotifications={handleSetNotifications} />}
          {screen === 'admin' && isAdminAccount(profile, user) && <AdminScreen key="admin" />}
        </AnimatePresence>

        <GlobalTaskIndicator 
          tasks={activeTasks} 
          onTaskClick={(task) => {
            if (isStudioTaskType(task.type)) {
              setStudioReopenTaskId(task.id);
              setScreen('estudio');
              return;
            }
            if (task.type === 'plan') setPlannerMode('plan');
            else if (task.type === 'slides') setPlannerMode('slides');
            else if (task.type === 'activities') setPlannerMode('activities');
            else if (task.type === 'exam') setPlannerMode('exam');
            setScreen('planner');
            removeTask(task.id);
          }}
        />
        <BottomNav activeScreen={screen} setScreen={setScreen} isAdmin={isAdminAccount(profile, user)} />
      </div>
      
      {/* Background decoration */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-100/30 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-amber-100/30 blur-[120px] rounded-full" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
