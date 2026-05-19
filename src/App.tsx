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
  Wand2, Grid3x3, Puzzle, Dice5, Map as MapIcon, Layers3, Trophy, ScrollText
} from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { auth, db, storage, logOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, RecaptchaVerifier, PhoneAuthProvider, linkWithCredential } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch, getDoc, increment, getDocs, query, where } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { selectBnccSkills, SUBJECT_OPTIONS } from './bncc-data';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("CRITICAL: GEMINI_API_KEY está ausente no ambiente!");
}
const ai = new GoogleGenAI({ apiKey: apiKey || 'fake-key-para-evitar-crash' });

const AI_MODEL = 'gemini-2.5-flash';

const formatApiError = (error: any, defaultMsg: string): string => {
  let msg = '';
  if (typeof error === 'string') {
    msg = error;
  } else if (error instanceof Error) {
    msg = error.message;
  } else if (error?.message) {
    msg = error.message;
  } else {
    try { msg = JSON.stringify(error); } catch (e) {}
  }

  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
    return 'Muita gente usando a IA agora. Ja estou tentando de novo — se continuar, aguarde 1 minuto.';
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return 'Calma, professor! Muitas perguntas de uma vez. Aguarde alguns segundos e tente de novo.';
  }
  return defaultMsg;
};

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
      toast.error("A internet cochilou. Suas mudancas nao foram salvas — tente de novo.");
    }
  };

  return [data, updateData];
}

function useFirestoreDoc<T>(
  docPath: string,
  user: any,
  initialData: T
): [T, (data: T | ((prev: T) => T)) => void] {
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
      toast.error("A internet cochilou. Suas mudancas nao foram salvas — tente de novo.");
    }
  };

  return [data, updateData];
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
              <span className="text-3xl">🦉</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Ih, o Corujão tropeçou!</h2>
            <p className="text-sm text-gray-500 mb-2">Algo inesperado aconteceu. Seus dados estao salvos na nuvem — so recarregue a pagina.</p>
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

let _toastSetter: ((t: Toast[]) => void) | null = null;

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
  if (!toasts.length) return null;
  return createPortal(
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 w-full max-w-sm px-4 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-lg pointer-events-auto flex items-start gap-2 ${
          t.type === 'error' ? 'bg-red-500' : t.type === 'success' ? 'bg-emerald-500' : 'bg-gray-800'
        }`}>
          <span className="flex-1">{t.message}</span>
          <button onClick={() => setToasts(p => p.filter(x => x.id !== t.id))} className="opacity-70 hover:opacity-100 shrink-0 mt-0.5">✕</button>
        </div>
      ))}
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
type Screen = 'home' | 'planner' | 'chat' | 'calendar' | 'dayDetail' | 'profile' | 'estudio' | 'biblioteca' | 'admin';
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
}

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
  days: number[]; // 0-6 (Sun-Sat)
  time: string;
  numberOfClasses?: number; // Legacy global
  periodsPerDay?: Record<number, number[]>; // dayIndex -> array of selected periods (e.g. 1st, 2nd)
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

const fmtBytes = (b: number) => {
  if (b < 1024)               return `${b} B`;
  if (b < 1024 * 1024)        return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
// ─────────────────────────────────────────────────────────────────────────────

interface ClassItem {
  id: string;
  title: string;
  date: string;
  status: 'pending' | 'done' | 'completed';
  className: string;
  timestamp: number;
  resourceIds?: string[];
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
    { id: 'biblioteca', icon: FolderOpen, label: 'Biblioteca' },
  ];

  if (isAdmin) {
    navItems.push({ id: 'admin', icon: Shield, label: 'Admin' });
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[95%] max-w-sm bg-indigo-600 rounded-[2rem] py-3 px-6 flex justify-between items-center shadow-2xl z-50">
      {navItems.map((item) => (
        <button
          key={item.id}
          onClick={() => setScreen(item.id)}
          className={`relative p-2 flex flex-col items-center gap-1 transition-all ${activeScreen === item.id ? 'text-white' : 'text-indigo-300 hover:text-indigo-200'}`}
        >
          <item.icon size={22} strokeWidth={activeScreen === item.id ? 2.5 : 2} className={activeScreen === item.id ? '-translate-y-1 transition-transform' : 'transition-transform'} />
          <span className={`text-[9px] font-bold tracking-wider transition-opacity ${activeScreen === item.id ? 'opacity-100' : 'opacity-0'}`}>{item.label}</span>
          {activeScreen === item.id && (
            <motion.div
              layoutId="nav-glow"
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-white rounded-full"
            />
          )}
        </button>
      ))}
    </div>
  );
};

const Header = ({ title, subtitle, profile, notifications = [], setNotifications, children, bannerImage, setScreen }: { title: string; subtitle: string; profile: UserProfile; notifications?: any[]; setNotifications?: (n: any[]) => void; children?: React.ReactNode; bannerImage?: string; setScreen?: (s: Screen) => void }) => {
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
    <div className="absolute -top-12 -left-6 -right-6 h-36 flex flex-col items-center justify-center z-[-1] shadow-sm overflow-hidden bg-transparent">
      <img src={bannerImage || "https://i.ibb.co/TDZNvsJv/20260420-121247-0000.png"} alt="Banner" className="w-full h-full object-cover top-center" referrerPolicy="no-referrer" />
    </div>
    
    <div className="flex justify-between items-start pt-28">
      <div className="px-2">
        <p className="text-gray-600 text-sm font-bold uppercase tracking-wider mb-1">{subtitle}</p>
        <h1 className="text-2xl font-black text-gray-900 drop-shadow-sm">{title}</h1>
      </div>
      <div className="flex gap-3 relative">
        {children}
      <button onClick={() => setShowNotifications(!showNotifications)} className="w-10 h-10 flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-100 relative">
        <Bell size={20} className="text-gray-600" />
        {unreadCount > 0 && (
          <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
        )}
      </button>
      <button onClick={() => setScreen?.('profile')} className="w-10 h-10 p-0 bg-indigo-600 rounded-xl shadow-sm border-2 border-indigo-500 overflow-hidden flex items-center justify-center">
        {profile.photo ? (
          <img src={profile.photo} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-indigo-600 text-white">
            <User className="w-6 h-6" />
          </div>
        )}
      </button>

      <AnimatePresence>
        {showNotifications && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute top-12 right-0 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 origin-top-right"
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-gray-900">Notificações</h3>
              {unreadCount > 0 && (
                <span className="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{unreadCount} nova{unreadCount > 1 ? 's' : ''}</span>
              )}
            </div>
            
            <div className="space-y-3 mb-4 max-h-[60vh] overflow-y-auto no-scrollbar">
              {notifications.length > 0 ? (
                notifications.map(notification => {
                  const iconMap: Record<string, string> = { class: '📚', holiday: '🎉', prep: '📝', admin: '📋', commemorative: '🎊' };
                  const emoji = notification.auto ? (iconMap[notification.icon] || '📌') : '✨';
                  return (
                    <div key={notification.id} className={`cursor-pointer p-3 rounded-xl border ${notification.read ? 'bg-gray-50 border-gray-100' : 'bg-indigo-50 border-indigo-100/50'}`} onClick={() => {
                      if (setScreen) setScreen('calendar');
                      if (setNotifications) {
                        setNotifications(notifications.map(n => n.id === notification.id ? {...n, read: true} : n));
                      }
                      setShowNotifications(false);
                    }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base leading-none">{emoji}</span>
                        <p className={`text-sm font-bold ${notification.read ? 'text-gray-700' : 'text-indigo-900'}`}>{notification.title}</p>
                      </div>
                      <p className={`text-xs leading-relaxed ${notification.read ? 'text-gray-600' : 'text-indigo-700'}`}>{notification.message}</p>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Bell size={32} className="text-gray-300 mb-3" />
                  <p className="text-sm font-bold text-gray-900">Tudo limpo!</p>
                  <p className="text-xs text-gray-500 mt-1">Você não tem novas notificações.</p>
                </div>
              )}
            </div>

            {notifications.length > 0 && setNotifications && (
              <div className="flex gap-2 mb-2">
                {unreadCount > 0 && (
                  <button
                    onClick={() => setNotifications(notifications.map(n => ({ ...n, read: true })))}
                    className="flex-1 text-[11px] font-bold bg-indigo-50 text-indigo-600 py-2.5 rounded-xl hover:bg-indigo-100 transition-colors"
                  >
                    Marcar lidas
                  </button>
                )}
                <button
                  onClick={() => setNotifications([])}
                  className="flex-1 text-[11px] font-bold bg-gray-50 text-gray-600 py-2.5 rounded-xl hover:bg-gray-100 transition-colors border border-gray-200"
                >
                  Limpar Histórico
                </button>
              </div>
            )}

            <button
              onClick={requestNotificationPermission}
              disabled={permissionStatus === 'granted'}
              className="w-full text-xs font-bold bg-gray-50 text-gray-600 py-2.5 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 border border-gray-200 mt-2"
            >
              <Bell size={14} />
              {permissionStatus === 'granted' ? 'Notificações do sistema ativadas' : 'Ativar notificações do sistema'}
            </button>
          </motion.div>
        )}
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

const EventItem = ({ e, onComplete, color }: { e: any, onComplete: () => void, color: string }) => {
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
        <p className="text-gray-400 text-sm mt-0.5 truncate">{formatEventDate(e.date)} • {e.type === 'class' ? 'Aula' : e.type === 'prep' ? 'Tempo de Foco' : e.type === 'holiday' ? 'Feriado Nacional' : e.type === 'commemorative' ? 'Data Comemorativa' : 'Prazo Administrativo'}</p>
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

const HomeScreen = ({ setScreen, setPlannerMode, classes, setClasses, profile, inboxMessages, notifications, setNotifications, setSelectedDate }: { setScreen: (s: Screen) => void, setPlannerMode: (m: PlannerMode) => void, classes: ClassItem[], setClasses: (c: ClassItem[]) => void, profile: UserProfile, inboxMessages: {id: string, role: 'user' | 'model', text: string, date: number, attachment?: { mimeType: string, url: string, data: string, name: string }}[], notifications?: any[], setNotifications?: (n: any[]) => void, setSelectedDate: (d: Date) => void }) => {
  const quickActions = [
    { title: 'Gamificar', illustration: 'https://i.ibb.co/vCp6TFqs/20260416-185756-0000.png', action: () => setScreen('estudio') },
    { title: 'Atividades', illustration: 'https://i.ibb.co/hx6b429b/20260416-183802-0002.png', action: () => { setPlannerMode('activities'); setScreen('planner'); } },
    { title: 'Slides', illustration: 'https://i.ibb.co/fYK9t24q/20260416-184831-0000.png', action: () => { setPlannerMode('slides'); setScreen('planner'); } },
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
  
  const firstName = getDisplayName(profile?.name || '');

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title={`${firstName}!`} subtitle={greeting} profile={profile} notifications={notifications} setNotifications={setNotifications} bannerImage="https://i.ibb.co/ymFbKT6r/20260419-204248-0000.png" />
      
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
          <img src="https://i.ibb.co/Q4fQx6f/20260419-215411-0000.png" alt="Mascote Mágico" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4 pl-0 pr-[9px] !pt-[12px] pb-0">Ações Rápidas</h2>
        <div className="grid grid-cols-3 gap-4">
          {quickActions.map((action, index) => (
            <button key={action.title} onClick={action.action} className="flex flex-col items-center gap-3 relative group">
              <div className={`w-16 h-16 rounded-[1.5rem] overflow-hidden shadow-sm bg-white border-[1.5px] border-indigo-600 flex flex-col items-center justify-center relative`}>
                {action.illustration.includes('dicebear') ? (
                  <div className="w-full h-full border-2 border-emerald-500 bg-emerald-100 flex flex-col items-center justify-center">
                    <span className="text-emerald-700 font-black text-[10px] leading-tight text-center">IMAGEM<br/>Ação {index + 1}</span>
                  </div>
                ) : (
                  <img src={action.illustration} alt={action.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                )}
              </div>
              <span className="text-sm font-medium text-gray-600 text-center leading-tight">{action.title}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900">Lembretes</h2>
          <button onClick={() => setScreen('calendar')} className="text-indigo-600 text-base font-medium">Ver todos</button>
        </div>
        <div className="space-y-4">
          {[...inboxMessages].sort((a,b) => (a.date||0) - (b.date||0)).filter(m => m.role === 'user').slice(-2).reverse().map((msg, i) => (
            <div key={`msg-${i}`} className="bg-amber-50 rounded-2xl p-4 border border-amber-100 shadow-sm flex items-center gap-4 cursor-pointer" onClick={() => setScreen('chat')}>
              <div className={`w-14 h-14 rounded-xl bg-amber-100 flex flex-col items-center justify-center text-amber-600 shrink-0`}>
                <Sparkles size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 text-base truncate">Nota Inteligente</h3>
                <p className="text-gray-600 text-sm mt-0.5 line-clamp-2 leading-snug">{msg.text}</p>
              </div>
              <ChevronRight size={20} className="text-amber-300 shrink-0" />
            </div>
          ))}

          <Reorder.Group axis="y" values={classes.filter(c => c.status === 'pending')} onReorder={(newPending) => setClasses([...newPending, ...classes.filter(c => c.status === 'completed')])} className="space-y-4">
            {classes.filter(c => c.status === 'pending').slice(0, 3).map((cls) => (
                <Reorder.Item key={cls.id} value={cls} className="w-full">
                  <ReminderItem cls={cls} setSelectedDate={setSelectedDate} setScreen={setScreen} setClasses={setClasses} classes={classes} />
                </Reorder.Item>
            ))}
          </Reorder.Group>
          {classes.filter(c => c.status === 'pending').length === 0 && inboxMessages.filter(m => m.role === 'user').length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center bg-gray-50/50 rounded-3xl border border-gray-100 border-dashed">
              <img src="https://i.ibb.co/vCWk2Fry/6-20260419-213906-0001.png" alt="Tudo Vazio" className="w-32 h-auto object-contain mb-4 rounded-xl opacity-60" referrerPolicy="no-referrer" />
              <h3 className="text-gray-600 font-bold mb-1">Tudo limpo por aqui!</h3>
              <p className="text-gray-400 text-sm max-w-[200px]">Nenhum lembrete ou aula pendente para hoje.</p>
            </div>
          )}
        </div>
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
            <input type="number" min="1" max="20" value={questionCount} onChange={(e) => setQuestionCount(parseInt(e.target.value))} className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-sm" />
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

const parseRichHtml = (text: string, primaryColor: string, accentColor: string): string => {
  if (!text) return '';
  const ac = accentColor || '#6366F1';
  const pc = primaryColor || '#4F46E5';
  return text
    .replace(/^## (.+)$/gm, `<div style="font-size:17px;font-weight:800;color:${pc};margin:10px 0 4px;letter-spacing:-0.3px">$1</div>`)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/==(.*?)==/g, `<mark style="background:${ac}44;color:inherit;padding:1px 5px;border-radius:4px;font-weight:600">$1</mark>`)
    .replace(/\[\[(.*?)\]\]/g, `<span style="color:${pc};font-weight:800">$1</span>`)
    .replace(/\{([A-Za-z0-9]+)\}/g, `<span data-icon="$1" style="color:${pc};font-size:0.85em;vertical-align:middle;margin-right:2px">◆</span>`)
    .replace(/\n/g, '<br/>');
};

// Extended parseMarkdown for pptxgenjs text runs
const parseRichMarkdown = (text: any, baseOpts: any, primaryColor?: string, accentColor?: string): any[] => {
  if (!text) return [];
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  const pc = (primaryColor || '#4F46E5').replace('#', '');
  const ac = (accentColor || '#6366F1').replace('#', '');
  const regex = /(\*\*.*?\*\*|==.*?==|\[\[.*?\]\]|\{[A-Za-z0-9]+\}|^## .+$)/gm;
  const parts = str.split(regex);
  const runs: any[] = [];
  parts.forEach(part => {
    if (!part) return;
    if (part.startsWith('## ')) {
      runs.push({ text: part.slice(3), options: { ...baseOpts, bold: true, fontSize: (baseOpts.fontSize || 12) + 4, color: pc, breakLine: true } });
    } else if (part.startsWith('**') && part.endsWith('**')) {
      runs.push({ text: part.slice(2, -2), options: { ...baseOpts, bold: true } });
    } else if (part.startsWith('==') && part.endsWith('==')) {
      runs.push({ text: part.slice(2, -2), options: { ...baseOpts, bold: true, highlight: ac.padEnd(6, '0') } });
    } else if (part.startsWith('[[') && part.endsWith(']]')) {
      runs.push({ text: part.slice(2, -2), options: { ...baseOpts, bold: true, color: pc } });
    } else if (/^\{[A-Za-z0-9]+\}$/.test(part)) {
      runs.push({ text: '◆ ', options: { ...baseOpts, bold: true, color: ac } });
    } else {
      runs.push({ text: part, options: baseOpts });
    }
  });
  return runs;
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

  const titleStyle = { color: isCover || isRef ? '#ffffff' : theme.primaryColor, fontFamily: 'system-ui, sans-serif', fontWeight: 800 };

  if (isCover) return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, position: 'relative', display: 'flex', overflow: 'hidden' }}>
      {/* Accent stripe */}
      <div style={{ position: 'absolute', left: 462, top: 0, width: 6, height: SLIDE_H, backgroundColor: theme.accentColor, zIndex: 2 }} />
      {/* Decorative circles */}
      <div style={{ position: 'absolute', left: -30, bottom: -30, width: 160, height: 160, borderRadius: '50%', backgroundColor: theme.accentColor, opacity: 0.25 }} />
      {/* Left panel */}
      <div style={{ width: 460, height: SLIDE_H, padding: '48px 48px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', zIndex: 1 }}>
        <div>
          {schoolName && <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16 }}>{schoolName}</div>}
          <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
            style={{ ...titleStyle, fontSize: 46, lineHeight: 1.15, background: 'transparent', border: 'none', borderBottom: '2px solid rgba(255,255,255,0.4)', width: '100%', outline: 'none', color: '#fff', marginBottom: 20, display: 'block' }} />
          <input value={slide.data.subtitle || ''} onChange={e => onUpdate({ subtitle: e.target.value })} placeholder="Subtítulo"
            style={{ fontSize: 17, color: 'rgba(255,255,255,0.85)', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.2)', width: '100%', outline: 'none', fontWeight: 600, letterSpacing: 1, display: 'block' }} />
        </div>
        {teacherName && <div style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 15 }}>Prof. {teacherName}</div>}
      </div>
      {/* Right panel image */}
      <div style={{ flex: 1, height: SLIDE_H, overflow: 'hidden' }}>
        <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" />
      </div>
    </div>
  );

  if (slide.layoutID === 'LAYOUT_CONTENT_LEFT' || slide.layoutID === 'LAYOUT_CONTENT_RIGHT') {
    const isLeft = slide.layoutID === 'LAYOUT_CONTENT_LEFT';
    const textPanel = (
      <div style={{ width: 480, padding: '44px 40px 44px', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative' }}>
        <div style={{ width: 60, height: 4, backgroundColor: theme.accentColor, marginBottom: 16 }} />
        <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
          style={{ ...titleStyle, fontSize: 30, lineHeight: 1.2, background: 'transparent', border: 'none', borderBottom: `2px solid ${theme.primaryColor}33`, width: '100%', outline: 'none', marginBottom: 20, display: 'block' }} />
        <RichBodyWithIcons value={slide.data.text || ''} onChange={v => onUpdate({ text: v })}
          primaryColor={theme.primaryColor} accentColor={theme.accentColor} style={{ flex: 1 }} />
        {/* Arrow pointing toward image */}
        <div style={{ position: 'absolute', top: '50%', [isLeft ? 'right' : 'left']: -18, transform: 'translateY(-50%)', fontSize: 28, color: theme.accentColor, fontWeight: 900, lineHeight: 1 }}>
          {isLeft ? '▶' : '◀'}
        </div>
      </div>
    );
    const imgPanel = (
      <div style={{ width: 480, height: SLIDE_H, overflow: 'hidden' }}>
        <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" />
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
      <div style={{ padding: '32px 48px 16px', flexShrink: 0 }}>
        <div style={{ width: 60, height: 4, backgroundColor: theme.accentColor, marginBottom: 14 }} />
        <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
          style={{ ...titleStyle, fontSize: 28, background: 'transparent', border: 'none', borderBottom: `2px solid ${theme.primaryColor}33`, width: '100%', outline: 'none', marginBottom: 12, display: 'block' }} />
        <RichBodyWithIcons value={slide.data.text || ''} onChange={v => onUpdate({ text: v })}
          primaryColor={theme.primaryColor} accentColor={theme.accentColor} style={{ minHeight: 80 }} />
        {/* Arrow pointing down to image */}
        <div style={{ textAlign: 'center', fontSize: 20, color: theme.accentColor, marginTop: 6, lineHeight: 1 }}>▼</div>
      </div>
      <div style={{ flex: 1, margin: '4px 48px 32px', borderRadius: 14, overflow: 'hidden' }}>
        <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" />
      </div>
    </div>
  );

  if (slide.layoutID === 'LAYOUT_TOPICS') return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', padding: '36px 48px 36px', overflow: 'hidden' }}>
      <div style={{ width: 60, height: 4, backgroundColor: theme.accentColor, marginBottom: 14 }} />
      <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
        style={{ ...titleStyle, fontSize: 28, background: 'transparent', border: 'none', borderBottom: `2px solid ${theme.primaryColor}33`, width: '100%', outline: 'none', marginBottom: 24, display: 'block' }} />
      <div style={{ display: 'flex', gap: 24, flex: 1 }}>
        {slide.data.topics?.slice(0, 3).map((t: any, i: number) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: theme.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', flexShrink: 0 }}>
              <DynamicIcon name={t.icon} size={26} color="white" />
            </div>
            <div style={{ flex: 1, width: '100%', borderRadius: 14, padding: '14px 12px', border: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', backgroundColor: `${theme.primaryColor}0A` }}>
              <input value={t.title || ''} onChange={e => onUpdate({ topics: slide.data.topics.map((t2: any, j: number) => j === i ? { ...t2, title: e.target.value } : t2) })} placeholder="Tópico"
                style={{ fontSize: 13, fontWeight: 700, color: theme.primaryColor, background: 'transparent', border: 'none', width: '100%', outline: 'none', textAlign: 'center', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }} />
              <textarea value={t.content || ''} onChange={e => onUpdate({ topics: slide.data.topics.map((t2: any, j: number) => j === i ? { ...t2, content: e.target.value } : t2) })} placeholder="Conteúdo"
                style={{ fontSize: 12, color: '#555', lineHeight: 1.55, background: 'transparent', border: 'none', width: '100%', outline: 'none', resize: 'none', flex: 1, fontFamily: 'inherit', textAlign: 'center' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (isRef) return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', padding: '48px', overflow: 'hidden' }}>
      <div style={{ width: 8, height: SLIDE_H, backgroundColor: theme.accentColor, position: 'absolute', left: 0, top: 0 }} />
      <div style={{ position: 'absolute', right: -60, bottom: -60, width: 300, height: 300, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Referências"
        style={{ fontSize: 34, fontWeight: 800, color: '#fff', background: 'transparent', border: 'none', borderBottom: '2px solid rgba(255,255,255,0.2)', width: '100%', outline: 'none', marginBottom: 28, display: 'block', fontFamily: 'inherit' }} />
      <textarea value={slide.data.references?.join('\n') || ''} onChange={e => onUpdate({ references: e.target.value.split('\n') })} placeholder="Uma referência por linha"
        style={{ fontSize: 15, color: 'rgba(255,255,255,0.88)', lineHeight: 1.7, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, padding: '16px', width: '100%', flex: 1, outline: 'none', resize: 'none', fontFamily: 'inherit' }} />
    </div>
  );

  if (slide.layoutID === 'LAYOUT_QUOTE') return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 100px', position: 'relative', overflow: 'hidden' }}>
      {/* Giant decorative quote marks */}
      <div style={{ position: 'absolute', top: 20, left: 48, fontSize: 200, lineHeight: 1, color: theme.primaryColor, opacity: 0.12, fontFamily: 'Georgia, serif', fontWeight: 900, userSelect: 'none' }}>"</div>
      <div style={{ position: 'absolute', bottom: -30, right: 48, fontSize: 200, lineHeight: 1, color: theme.primaryColor, opacity: 0.12, fontFamily: 'Georgia, serif', fontWeight: 900, userSelect: 'none', transform: 'rotate(180deg)' }}>"</div>
      {/* Accent bar */}
      <div style={{ width: 56, height: 5, backgroundColor: theme.accentColor, borderRadius: 3, marginBottom: 32 }} />
      <textarea value={slide.data.quote || ''} onChange={e => onUpdate({ quote: e.target.value })} placeholder="Citação impactante..."
        style={{ fontSize: 28, fontStyle: 'italic', color: theme.primaryColor, textAlign: 'center', lineHeight: 1.5, background: 'transparent', border: 'none', outline: 'none', width: '100%', resize: 'none', fontFamily: 'Georgia, serif', fontWeight: 600, marginBottom: 24, overflow: 'hidden' }}
        rows={4} />
      <div style={{ width: 56, height: 2, backgroundColor: theme.accentColor, borderRadius: 3, marginBottom: 16 }} />
      <input value={slide.data.author || ''} onChange={e => onUpdate({ author: e.target.value })} placeholder="— Autor"
        style={{ fontSize: 16, color: '#6B7280', textAlign: 'center', background: 'transparent', border: 'none', outline: 'none', fontWeight: 600, letterSpacing: 1 }} />
      {slide.data.title && <div style={{ position: 'absolute', top: 28, left: 0, right: 0, textAlign: 'center', fontSize: 12, color: theme.primaryColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 3, opacity: 0.6 }}>{slide.data.title}</div>}
    </div>
  );

  if (slide.layoutID === 'LAYOUT_TWO_COLUMNS') return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top accent bar */}
      <div style={{ height: 6, backgroundColor: theme.primaryColor, flexShrink: 0 }} />
      <div style={{ padding: '28px 48px 20px', flexShrink: 0 }}>
        <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
          style={{ fontSize: 28, fontWeight: 800, color: theme.primaryColor, background: 'transparent', border: 'none', outline: 'none', width: '100%', display: 'block' }} />
        <div style={{ width: 48, height: 4, backgroundColor: theme.accentColor, borderRadius: 2, marginTop: 8 }} />
      </div>
      <div style={{ display: 'flex', flex: 1, gap: 0, padding: '0 48px 32px' }}>
        {/* Column 1 */}
        <div style={{ flex: 1, paddingRight: 20, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: theme.accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 800, flexShrink: 0 }}>1</div>
            <div style={{ height: 2, flex: 1, backgroundColor: `${theme.primaryColor}22` }} />
          </div>
          <RichBodyWithIcons value={slide.data.column1 || ''} onChange={v => onUpdate({ column1: v })}
            primaryColor={theme.primaryColor} accentColor={theme.accentColor} style={{ flex: 1 }} />
        </div>
        {/* Arrow divider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 8px', flexShrink: 0 }}>
          <div style={{ width: 2, height: 60, backgroundColor: `${theme.primaryColor}22` }} />
          <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: theme.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', flexShrink: 0 }}>
            <span style={{ color: '#fff', fontSize: 16, fontWeight: 900 }}>⟺</span>
          </div>
          <div style={{ width: 2, height: 60, backgroundColor: `${theme.primaryColor}22` }} />
        </div>
        {/* Column 2 */}
        <div style={{ flex: 1, paddingLeft: 20, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ height: 2, flex: 1, backgroundColor: `${theme.primaryColor}22` }} />
            <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: theme.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 800, flexShrink: 0 }}>2</div>
          </div>
          <RichBodyWithIcons value={slide.data.column2 || ''} onChange={v => onUpdate({ column2: v })}
            primaryColor={theme.primaryColor} accentColor={theme.accentColor} style={{ flex: 1 }} />
        </div>
      </div>
    </div>
  );

  if (slide.layoutID === 'LAYOUT_FULL_IMAGE') {
    const imgSrcFull = slide.data.imageUrl || getImageUrl(slide.data.imagePrompt, 1200, 800);
    return (
      <div style={{ width: SLIDE_W, height: SLIDE_H, position: 'relative', overflow: 'hidden', backgroundColor: '#111' }}>
        <img src={imgSrcFull} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" />
        {/* Dark gradient overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.1) 100%)' }} />
        {/* Accent left bar */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 7, height: '100%', backgroundColor: theme.accentColor }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 64px 48px' }}>
          <div style={{ width: 48, height: 4, backgroundColor: theme.accentColor, borderRadius: 2, marginBottom: 18 }} />
          <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
            style={{ fontSize: 44, fontWeight: 900, color: '#ffffff', background: 'transparent', border: 'none', outline: 'none', width: '100%', display: 'block', lineHeight: 1.15, marginBottom: 12, textShadow: '0 2px 12px rgba(0,0,0,0.5)' }} />
          <input value={slide.data.subtitle || ''} onChange={e => onUpdate({ subtitle: e.target.value })} placeholder="Subtítulo"
            style={{ fontSize: 18, color: 'rgba(255,255,255,0.82)', background: 'transparent', border: 'none', outline: 'none', fontWeight: 500, letterSpacing: 0.5 }} />
        </div>
      </div>
    );
  }

  if (slide.layoutID === 'LAYOUT_STATS') return (
    <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ height: 6, backgroundColor: theme.primaryColor, flexShrink: 0 }} />
      <div style={{ padding: '24px 48px 16px', flexShrink: 0 }}>
        <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
          style={{ fontSize: 28, fontWeight: 800, color: theme.primaryColor, background: 'transparent', border: 'none', outline: 'none', width: '100%', display: 'block' }} />
        <div style={{ width: 48, height: 4, backgroundColor: theme.accentColor, borderRadius: 2, marginTop: 8 }} />
      </div>
      <div style={{ display: 'flex', gap: 20, flex: 1, padding: '0 48px 36px', alignItems: 'stretch' }}>
        {(slide.data.stats || [{ value: '', label: '' }, { value: '', label: '' }, { value: '', label: '' }]).slice(0, 4).map((s: any, i: number) => (
          <div key={i} style={{ flex: 1, background: i % 2 === 0 ? theme.primaryColor : `${theme.primaryColor}12`, borderRadius: 16, padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: `2px solid ${theme.primaryColor}22` }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: i % 2 === 0 ? 'rgba(255,255,255,0.2)' : theme.accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <DynamicIcon name={s.icon || 'BarChart2'} size={22} color={i % 2 === 0 ? '#fff' : '#fff'} />
            </div>
            <input value={s.value || ''} onChange={e => onUpdate({ stats: (slide.data.stats || []).map((s2: any, j: number) => j === i ? { ...s2, value: e.target.value } : s2) })} placeholder="00"
              style={{ fontSize: 38, fontWeight: 900, color: i % 2 === 0 ? '#fff' : theme.primaryColor, background: 'transparent', border: 'none', outline: 'none', textAlign: 'center', width: '100%', lineHeight: 1 }} />
            <input value={s.label || ''} onChange={e => onUpdate({ stats: (slide.data.stats || []).map((s2: any, j: number) => j === i ? { ...s2, label: e.target.value } : s2) })} placeholder="Rótulo"
              style={{ fontSize: 13, color: i % 2 === 0 ? 'rgba(255,255,255,0.8)' : '#6B7280', background: 'transparent', border: 'none', outline: 'none', textAlign: 'center', width: '100%', marginTop: 6, fontWeight: 600 }} />
          </div>
        ))}
      </div>
    </div>
  );

  if (slide.layoutID === 'LAYOUT_TIMELINE') {
    const events = slide.data.events || [];
    return (
      <div style={{ width: SLIDE_W, height: SLIDE_H, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ height: 6, backgroundColor: theme.primaryColor, flexShrink: 0 }} />
        <div style={{ padding: '24px 48px 16px', flexShrink: 0 }}>
          <input value={slide.data.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Título"
            style={{ fontSize: 28, fontWeight: 800, color: theme.primaryColor, background: 'transparent', border: 'none', outline: 'none', width: '100%', display: 'block' }} />
          <div style={{ width: 48, height: 4, backgroundColor: theme.accentColor, borderRadius: 2, marginTop: 8 }} />
        </div>
        {/* Timeline line */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 48px 32px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 0 }}>
            {/* Horizontal line */}
            <div style={{ position: 'absolute', top: 20, left: 20, right: 20, height: 3, backgroundColor: theme.primaryColor, zIndex: 0 }} />
            {events.slice(0, 5).map((ev: any, i: number) => {
              const cols = Math.min(events.length, 5);
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>
                  {/* Dot */}
                  <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: i % 2 === 0 ? theme.primaryColor : theme.accentColor, border: `4px solid ${bg}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', marginBottom: 14 }}>
                    <span style={{ fontSize: 11, color: '#fff', fontWeight: 800 }}>{i + 1}</span>
                  </div>
                  <div style={{ textAlign: 'center', padding: '0 6px', width: `${100 / cols}%` }}>
                    <div style={{ fontSize: 13, fontWeight: 900, color: theme.primaryColor, marginBottom: 4 }}>{ev.year || '____'}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1F2937', marginBottom: 4, lineHeight: 1.3 }}>{ev.title || 'Evento'}</div>
                    <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.4 }}>{ev.description || ''}</div>
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
  exportPPTX, savedResources, setSavedResources,
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
  savedResources: SavedResource[];
  setSavedResources: (r: any) => void;
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
      <div className="flex gap-2 mt-2">
        <button onClick={exportPPTX} disabled={isExporting}
          className="flex-1 bg-indigo-600 text-white rounded-2xl py-4 text-sm font-bold flex items-center justify-center gap-2 shadow-md disabled:opacity-50 transition-opacity">
          {isExporting ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
          {isExporting ? 'Gerando...' : 'Baixar PPTX'}
        </button>
        <button
          onClick={() => {
            const newResourceId = Math.random().toString(36).substr(2, 9);
            setSavedResources((prev: SavedResource[]) => [...prev, { id: newResourceId, type: 'slides' as const, title: presentationData.presentationTitle, date: Date.now(), presentationData }]);
          }}
          className="flex-1 bg-indigo-50 text-indigo-600 rounded-2xl py-4 text-sm font-bold flex items-center justify-center gap-2 shadow-sm">
          <Archive size={20} /> Salvar Histórico
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

  const accentHex = { plan: '059669', exam: 'DC2626', activities: '2563EB' };
  const darkHex   = { plan: '064E3B', exam: '7F1D1D', activities: '1E3A8A' };
  const ac = accentHex[docType];
  const dk = darkHex[docType];

  const parseInline = (text: string): TextRun[] => {
    const runs: TextRun[] = [];
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

  const mdParas = (md: string): Paragraph[] =>
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

  const docChildren: Paragraph[] = [];

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

    for (const { label, keys } of secDefs) {
      const content = get(...keys);
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: label, bold: true, size: 22, color: 'FFFFFF' })],
        shading: { fill: ac, type: ShadingType.CLEAR, color: 'auto' },
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
          children: [new TextRun({ text: line.slice(3), bold: true, color: 'FFFFFF', size: 24 })],
          shading: { fill: ac, type: ShadingType.CLEAR, color: 'auto' },
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

const sanitizeSlideData = (parsed: any): any => {
  if (!parsed?.slides) return parsed;
  return {
    ...parsed,
    slides: parsed.slides.map((slide: any) => {
      const d = slide.data || {};
      return {
        ...slide,
        data: {
          ...d,
          title: stripSlideMarkup(d.title),
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

const downloadDocx = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (document.body.contains(a)) document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
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
  h2 { font-size:10.5pt; font-weight:700; color:#fff; background:${ac}; padding:5px 12px; border-radius:4px; margin:22px 0 10px; }
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
  .gab-body h2 { background:${dk}; color:#fff; padding:5px 12px; border-radius:4px; margin:16px 0 8px; font-size:10.5pt; }
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
  plannerResources: resources,
  setPlannerResources: setResources,
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
  plannerResources: {type: 'activities' | 'slides' | 'exam', content: string}[],
  setPlannerResources: (r: {type: 'activities' | 'slides' | 'exam', content: string}[] | ((prev: {type: 'activities' | 'slides' | 'exam', content: string}[]) => {type: 'activities' | 'slides' | 'exam', content: string}[])) => void,
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

  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);

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

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      const messages = [
        "Deixe comigo, vou analisar o tema...",
        "Estruturando os tópicos da aula...",
        "Buscando as melhores imagens...",
        "Finalizando os detalhes..."
      ];
      let i = 0;
      setLoadingMessage(messages[0]);
      interval = setInterval(() => {
        i = (i + 1) % messages.length;
        setLoadingMessage(messages[i]);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const getSlidesPrompt = (topicText: string, className: string, tone: string, complexity: string, focus: string, groundingContent: string, slideCount: number) => `Você é um Diretor de Arte Sênior. Sua tarefa é analisar o conteúdo do usuário e transformá-lo em uma apresentação de ${slideCount} slides sobre "${topicText}". 
        Turma: "${className}"
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
        - Use pelo menos 4 layouts diferentes para variar o ritmo visual.
        - Use LAYOUT_QUOTE, LAYOUT_FULL_IMAGE ou LAYOUT_STATS para criar momentos de impacto.
        - Use LAYOUT_TIMELINE para conteúdos históricos ou sequenciais.
        - Use LAYOUT_TWO_COLUMNS para comparações ou definições contrastantes.
        - Paleta de NO MÁXIMO 3 CORES (Primária, Acento, Fundo) — escolha cores profissionais adequadas ao tema.
        - ALTO CONTRASTE: nunca texto claro sobre fundo claro.
        - FORMATAÇÃO DE TEXTO RICA (use obrigatoriamente nos campos "text", "column1", "column2"):
            **palavra** → negrito estratégico para termos-chave
            ==palavra== → marca-texto com cor de acento (use em definições e conceitos centrais)
            [[palavra]] → palavra-chave colorida em destaque primário (2-3 por slide máximo)
            {IconName} → ícone Lucide inline antes de tópicos (ex: {Target} Objetivo, {Brain} Conceito)
            ## Subtítulo → subtítulo dentro do corpo para hierarquia visual
        - Combine as marcações: ex: {Target} **[[Objetivo]]**: ==aprender a== estrutura...
        - NUNCA use emojis. Para icons, use nomes do Lucide-React (ex: 'Brain', 'TrendingUp', 'Globe', 'Target', 'CheckCircle', 'AlertTriangle', 'Lightbulb').
        - illustrationQuery: 2-3 palavras-chave em inglês (ex: 'science lab', 'ancient rome').

        SAÍDA: JSON estrito (sem Markdown ao redor):
        {
          "presentationTitle": "...",
          "theme": { "primaryColor": "#hex", "accentColor": "#hex", "backgroundColor": "#hex", "fontTitle": "...", "fontBody": "..." },
          "slides": [
            { "layoutID": "LAYOUT_COVER",        "data": { "title": "...", "subtitle": "...", "illustrationQuery": "..." } },
            { "layoutID": "LAYOUT_QUOTE",         "data": { "title": "...", "quote": "...", "author": "..." } },
            { "layoutID": "LAYOUT_TWO_COLUMNS",   "data": { "title": "...", "column1": "...", "column2": "..." } },
            { "layoutID": "LAYOUT_FULL_IMAGE",    "data": { "title": "...", "subtitle": "...", "illustrationQuery": "..." } },
            { "layoutID": "LAYOUT_STATS",         "data": { "title": "...", "stats": [{ "value": "...", "label": "...", "icon": "..." }] } },
            { "layoutID": "LAYOUT_TIMELINE",      "data": { "title": "...", "events": [{ "year": "...", "title": "...", "description": "..." }] } },
            { "layoutID": "LAYOUT_TOPICS",        "data": { "title": "...", "topics": [{ "title": "...", "content": "...", "icon": "..." }] } },
            { "layoutID": "LAYOUT_CONTENT_LEFT",  "data": { "title": "...", "text": "...", "illustrationQuery": "..." } },
            { "layoutID": "LAYOUT_REFERENCES",    "data": { "title": "Referências", "references": ["..."] } }
          ]
        }`;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Arquivo pesado demais! O limite e 10 MB.');
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
          toast.error(formatApiError(error, "Nao consegui ler esse arquivo. Tente outro formato."));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const addNewClass = () => {
    if (!newClassName.trim()) return;
    const newClass: ClassSchedule = {
      id: Math.random().toString(36).substr(2, 9),
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
  const [docReady, setDocReady] = useState<{url: string; filename: string; target: 'main' | number} | null>(null);

  // Clean up download URL and reset state on mode change
  useEffect(() => {
    if (docReady) URL.revokeObjectURL(docReady.url);
    setDocReady(null);
    setPreparingDoc(null);
  }, [mode]);

  // When content changes (new generation), reset download state
  useEffect(() => {
    if (docReady) URL.revokeObjectURL(docReady.url);
    setDocReady(null);
  }, [currentResult]);

  const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const exportPPTX = async () => {
    if (!presentationData) return;
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

      const addFooter = (slide: any, slideNum: number, darkBg = false) => {
        const fg = darkBg ? 'FFFFFF' : '9CA3AF';
        slide.addShape(pres.ShapeType.rect, { x: 0, y: 5.15, w: 10, h: 0.35, fill: { color: pc, transparency: darkBg ? 40 : 85 }, line: { color: pc, transparency: 85, width: 0 } });
        if (schoolLabel) slide.addText(schoolLabel, { x: 0.2, y: 5.17, w: 5.5, h: 0.28, fontSize: 8, color: darkBg ? 'FFFFFF' : pc, bold: false });
        if (teacherLabel) slide.addText(`Prof. ${teacherLabel}`, { x: 0.2, y: 5.17, w: 5.5, h: 0.28, fontSize: 8, color: darkBg ? 'FFFFFF' : pc, bold: false, align: schoolLabel ? 'right' as const : 'left' as const });
        slide.addText('Prof. Corujão', { x: 5.9, y: 5.17, w: 3.0, h: 0.28, fontSize: 7, color: darkBg ? 'FFFFFF' : pc, transparency: 20, align: 'center' as const, italic: true, fontFace: 'Calibri' });
        slide.addText(`${slideNum} / ${totalSlides}`, { x: 9.3, y: 5.17, w: 0.6, h: 0.28, fontSize: 8, color: fg, align: 'right' });
      };

      const addAccentBar = (slide: any, vertical = false) => {
        if (vertical) {
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 5.1, fill: { color: pc } });
          slide.addShape(pres.ShapeType.rect, { x: 0.18, y: 0, w: 0.06, h: 5.1, fill: { color: ac, transparency: 40 } });
        } else {
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: pc } });
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0.12, w: 10, h: 0.04, fill: { color: ac, transparency: 30 } });
        }
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
        const b64 = imageCache.get(url);
        if (b64) {
          slide.addImage({ data: `image/jpeg;base64,${b64}`, ...opts });
        } else {
          slide.addImage({ path: url, ...opts });
        }
      };

      for (let si = 0; si < presentationData.slides.length; si++) {
        const slideData = presentationData.slides[si];
        const slide = pres.addSlide();
        const titleOpts = { fontFace: 'Calibri', color: pc, bold: true };
        const bodyOpts = { fontFace: 'Calibri', color: '374151', fontSize: 13 };

        if (slideData.layoutID === 'LAYOUT_COVER') {
          slide.background = { color: pc };
          // Right panel light bg
          slide.addShape(pres.ShapeType.rect, { x: 5.4, y: 0, w: 4.6, h: 5.5, fill: { color: bg } });
          // Accent stripe
          slide.addShape(pres.ShapeType.rect, { x: 5.4, y: 0, w: 0.12, h: 5.5, fill: { color: ac } });
          // Decorative circles
          slide.addShape(pres.ShapeType.ellipse, { x: -0.4, y: 3.8, w: 1.8, h: 1.8, fill: { color: ac, transparency: 60 } });
          slide.addShape(pres.ShapeType.ellipse, { x: 3.5, y: -0.4, w: 1.2, h: 1.2, fill: { color: 'FFFFFF', transparency: 80 } });

          slide.addText(slideData.data.title || '', { x: 0.5, y: 1.1, w: 4.7, h: 2.2, fontSize: 38, fontFace: 'Calibri', color: 'FFFFFF', bold: true, align: 'left', valign: 'middle', charSpacing: -0.5 });
          slide.addShape(pres.ShapeType.rect, { x: 0.5, y: 3.35, w: 1.2, h: 0.06, fill: { color: ac } });
          slide.addText(slideData.data.subtitle || '', { x: 0.5, y: 3.5, w: 4.7, h: 0.7, fontSize: 14, fontFace: 'Calibri', color: 'D1D5DB', align: 'left' });
          slide.addText(`${teacherLabel ? `Prof. ${teacherLabel}` : ''}${schoolLabel ? `  ·  ${schoolLabel}` : ''}`.trim(), { x: 0.5, y: 4.6, w: 4.7, h: 0.35, fontSize: 9, fontFace: 'Calibri', color: 'A5B4FC', align: 'left' });

          if (slideData.data.imageUrl) {
            addSlideImage(slide, slideData.data.imageUrl, { x: 5.6, y: 0.3, w: 4.2, h: 4.8, sizing: { type: 'contain', w: 4.2, h: 4.8 } });
          }

        } else if (slideData.layoutID === 'LAYOUT_CONTENT_LEFT' || slideData.layoutID === 'LAYOUT_CONTENT_RIGHT') {
          slide.background = { color: bg };
          const isLeft = slideData.layoutID === 'LAYOUT_CONTENT_LEFT';
          addAccentBar(slide, false);
          const textX = isLeft ? 0.4 : 0.4;
          const imgX = isLeft ? 5.8 : 0.4;
          const contentX = isLeft ? 0.4 : 4.4;

          if (slideData.data.imageUrl) {
            addSlideImage(slide, slideData.data.imageUrl, { x: imgX, y: 0.2, w: 3.8, h: 4.8, sizing: { type: 'contain', w: 3.8, h: 4.8 } });
            slide.addShape(pres.ShapeType.rect, { x: imgX, y: 0.2, w: 3.8, h: 4.8, fill: { color: pc, transparency: 75 } });
          }

          // Title area with accent
          slide.addShape(pres.ShapeType.rect, { x: contentX, y: 0.22, w: 5.2, h: 0.08, fill: { color: ac } });
          slide.addText(slideData.data.title || '', { x: contentX, y: 0.38, w: 5.2, h: 0.8, fontSize: 24, ...titleOpts });
          const parsedText = parseMarkdown(slideData.data.text || '', { ...bodyOpts, fontSize: 12, lineSpacing: 22 });
          slide.addText(parsedText, { x: contentX, y: 1.3, w: 5.2, h: 3.6, valign: 'top', align: 'left' });
          // Arrow pointing toward image
          const arrowX = isLeft ? 5.45 : 4.35;
          slide.addShape(pres.ShapeType.rect, { x: arrowX, y: 2.45, w: 0.3, h: 0.06, fill: { color: ac } });
          slide.addShape(pres.ShapeType.rect, { x: isLeft ? arrowX + 0.22 : arrowX, y: 2.27, w: 0.08, h: 0.42, fill: { color: ac }, rotate: isLeft ? 45 : -45 });
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_CONTENT_TOP') {
          slide.background = { color: bg };
          addAccentBar(slide, false);
          slide.addShape(pres.ShapeType.rect, { x: 0.4, y: 0.22, w: 9.2, h: 0.06, fill: { color: ac } });
          slide.addText(slideData.data.title || '', { x: 0.4, y: 0.36, w: 9.2, h: 0.7, fontSize: 26, ...titleOpts });
          const parsedText = parseMarkdown(slideData.data.text || '', { ...bodyOpts, fontSize: 12, lineSpacing: 20 });
          slide.addText(parsedText, { x: 0.4, y: 1.2, w: 9.2, h: 1.35, valign: 'top', align: 'left' });
          // Down arrow between text and image
          slide.addShape(pres.ShapeType.rect, { x: 4.94, y: 2.62, w: 0.12, h: 0.28, fill: { color: ac } });
          slide.addShape(pres.ShapeType.rect, { x: 4.7, y: 2.78, w: 0.6, h: 0.08, fill: { color: ac }, rotate: 0 });
          if (slideData.data.imageUrl) {
            addSlideImage(slide, slideData.data.imageUrl, { x: 0.4, y: 3.0, w: 9.2, h: 2.0, sizing: { type: 'contain', w: 9.2, h: 2.0 } });
          }
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_TOPICS') {
          slide.background = { color: bg };
          addAccentBar(slide, true);
          slide.addText(slideData.data.title || '', { x: 0.4, y: 0.22, w: 9.2, h: 0.7, fontSize: 26, ...titleOpts });

          if (slideData.data.topics) {
            const cols = Math.min(slideData.data.topics.length, 3);
            const colW = 9.0 / cols;
            slideData.data.topics.slice(0, 3).forEach((topic: any, i: number) => {
              const xPos = 0.5 + i * colW;
              // Card background
              slide.addShape(pres.ShapeType.roundRect, { x: xPos, y: 1.1, w: colW - 0.2, h: 3.9, fill: { color: 'FFFFFF' }, line: { color: 'E5E7EB', width: 0.75 }, rectRadius: 0.12 });
              // Colored header strip on card
              slide.addShape(pres.ShapeType.roundRect, { x: xPos, y: 1.1, w: colW - 0.2, h: 0.7, fill: { color: pc }, rectRadius: 0.12 });
              slide.addShape(pres.ShapeType.rect, { x: xPos, y: 1.5, w: colW - 0.2, h: 0.3, fill: { color: pc } });
              // Icon circle
              slide.addShape(pres.ShapeType.ellipse, { x: xPos + (colW - 0.2) / 2 - 0.38, y: 1.75, w: 0.76, h: 0.76, fill: { color: ac } });
              slide.addText(topic.icon ? topic.icon.substring(0, 2).toUpperCase() : '★', { x: xPos + (colW - 0.2) / 2 - 0.38, y: 1.75, w: 0.76, h: 0.76, fontSize: 13, color: 'FFFFFF', align: 'center', bold: true });
              slide.addText(topic.title || '', { x: xPos + 0.1, y: 2.62, w: colW - 0.4, h: 0.4, fontSize: 12, bold: true, align: 'center', color: pc });
              slide.addText(topic.content || '', { x: xPos + 0.1, y: 3.08, w: colW - 0.4, h: 1.75, fontSize: 10, align: 'center', color: '4B5563', valign: 'top' });
            });
          }
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_REFERENCES') {
          slide.background = { color: pc };
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 10, h: 5.5, fill: { color: pc } });
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.4, h: 5.5, fill: { color: ac } });
          // Decorative elements
          slide.addShape(pres.ShapeType.ellipse, { x: 7.5, y: 3.5, w: 3.5, h: 3.5, fill: { color: 'FFFFFF', transparency: 92 } });
          slide.addShape(pres.ShapeType.ellipse, { x: 8.5, y: -0.5, w: 2, h: 2, fill: { color: ac, transparency: 70 } });

          slide.addText(slideData.data.title || 'Referências', { x: 0.7, y: 0.4, w: 8, h: 0.8, fontSize: 32, color: 'FFFFFF', bold: true, fontFace: 'Calibri' });
          slide.addShape(pres.ShapeType.rect, { x: 0.7, y: 1.3, w: 2.4, h: 0.06, fill: { color: ac } });
          if (slideData.data.references) {
            const refText = slideData.data.references.map((r: string) => ({ text: `• ${r}`, options: { breakLine: true, color: 'E0E7FF', fontSize: 13, fontFace: 'Calibri', paraSpaceBefore: 6 } }));
            slide.addText(refText, { x: 0.7, y: 1.5, w: 8.5, h: 3.5, valign: 'top' });
          }
          addFooter(slide, si + 1, true);

        } else if (slideData.layoutID === 'LAYOUT_QUOTE') {
          slide.background = { color: bg };
          // Giant decorative quote marks
          slide.addText('“', { x: 0.2, y: -0.3, w: 2.5, h: 2, fontSize: 160, color: pc, transparency: 88, fontFace: 'Georgia', bold: true });
          slide.addText('”', { x: 7.5, y: 3.0, w: 2.5, h: 2, fontSize: 160, color: pc, transparency: 88, fontFace: 'Georgia', bold: true });
          // Accent bar
          slide.addShape(pres.ShapeType.rect, { x: 4.35, y: 0.7, w: 1.3, h: 0.08, fill: { color: ac } });
          // Topic label
          if (slideData.data.title) {
            slide.addText(slideData.data.title, { x: 1, y: 0.55, w: 8, h: 0.35, fontSize: 10, color: pc, bold: true, align: 'center', charSpacing: 3 });
          }
          // Quote
          slide.addText(slideData.data.quote || '', { x: 1, y: 1.2, w: 8, h: 2.6, fontSize: 26, fontFace: 'Georgia', color: pc, bold: false, italic: true, align: 'center', valign: 'middle', lineSpacing: 36 });
          // Divider
          slide.addShape(pres.ShapeType.rect, { x: 4.35, y: 3.9, w: 1.3, h: 0.06, fill: { color: ac } });
          // Author
          slide.addText(`— ${slideData.data.author || ''}`, { x: 1, y: 4.1, w: 8, h: 0.4, fontSize: 14, color: '6B7280', align: 'center', bold: true, charSpacing: 1 });
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_TWO_COLUMNS') {
          slide.background = { color: bg };
          // Top accent
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: pc } });
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0.12, w: 10, h: 0.04, fill: { color: ac, transparency: 30 } });
          // Title
          slide.addText(slideData.data.title || '', { x: 0.4, y: 0.28, w: 9.2, h: 0.65, fontSize: 26, ...titleOpts });
          slide.addShape(pres.ShapeType.rect, { x: 0.4, y: 0.98, w: 1.0, h: 0.06, fill: { color: ac } });
          // Divider line
          slide.addShape(pres.ShapeType.rect, { x: 5.0, y: 1.2, w: 0.04, h: 3.7, fill: { color: pc, transparency: 80 } });
          // Col 1 label
          slide.addShape(pres.ShapeType.ellipse, { x: 0.4, y: 1.15, w: 0.35, h: 0.35, fill: { color: ac } });
          slide.addText('1', { x: 0.4, y: 1.15, w: 0.35, h: 0.35, fontSize: 10, color: 'FFFFFF', align: 'center', bold: true });
          const col1 = parseMarkdown(slideData.data.column1 || '', { ...bodyOpts, fontSize: 12, lineSpacing: 20 });
          slide.addText(col1, { x: 0.4, y: 1.65, w: 4.3, h: 3.2, valign: 'top', align: 'left' });
          // Central arrow divider
          slide.addShape(pres.ShapeType.ellipse, { x: 4.63, y: 2.5, w: 0.5, h: 0.5, fill: { color: pc } });
          slide.addText('⟺', { x: 4.63, y: 2.5, w: 0.5, h: 0.5, fontSize: 13, color: 'FFFFFF', align: 'center', bold: true });
          // Col 2 label
          slide.addShape(pres.ShapeType.ellipse, { x: 5.25, y: 1.15, w: 0.35, h: 0.35, fill: { color: pc } });
          slide.addText('2', { x: 5.25, y: 1.15, w: 0.35, h: 0.35, fontSize: 10, color: 'FFFFFF', align: 'center', bold: true });
          const col2 = parseMarkdown(slideData.data.column2 || '', { ...bodyOpts, fontSize: 12, lineSpacing: 20 });
          slide.addText(col2, { x: 5.3, y: 1.65, w: 4.3, h: 3.2, valign: 'top', align: 'left' });
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_FULL_IMAGE') {
          slide.background = { color: '111111' };
          if (slideData.data.imageUrl) {
            addSlideImage(slide, slideData.data.imageUrl, { x: 0, y: 0, w: 10, h: 5.5, sizing: { type: 'contain', w: 10, h: 5.5 } });
          }
          // Dark gradient overlay via semi-transparent rect
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 2.2, w: 10, h: 3.3, fill: { color: '000000', transparency: 25 } });
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 3.5, w: 10, h: 2.0, fill: { color: '000000', transparency: 10 } });
          // Left accent bar
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 5.5, fill: { color: ac } });
          // Accent line above title
          slide.addShape(pres.ShapeType.rect, { x: 0.5, y: 3.2, w: 1.0, h: 0.07, fill: { color: ac } });
          // Title
          slide.addText(slideData.data.title || '', { x: 0.5, y: 3.35, w: 9, h: 1.3, fontSize: 40, color: 'FFFFFF', bold: true, fontFace: 'Calibri', valign: 'middle', shadow: { type: 'outer', blur: 8, offset: 2, angle: 45, color: '000000' } });
          // Subtitle
          if (slideData.data.subtitle) {
            slide.addText(slideData.data.subtitle, { x: 0.5, y: 4.7, w: 9, h: 0.45, fontSize: 16, color: 'D1D5DB', fontFace: 'Calibri' });
          }

        } else if (slideData.layoutID === 'LAYOUT_STATS') {
          slide.background = { color: bg };
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: pc } });
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0.12, w: 10, h: 0.04, fill: { color: ac, transparency: 30 } });
          slide.addText(slideData.data.title || '', { x: 0.4, y: 0.28, w: 9.2, h: 0.65, fontSize: 26, ...titleOpts });
          slide.addShape(pres.ShapeType.rect, { x: 0.4, y: 0.95, w: 1.0, h: 0.06, fill: { color: ac } });

          const stats = (slideData.data.stats || []).slice(0, 4);
          const cardW = stats.length > 0 ? (9.2 / stats.length) - 0.2 : 2.2;
          stats.forEach((s: any, i: number) => {
            const xPos = 0.4 + i * (cardW + 0.2);
            const isDark = i % 2 === 0;
            slide.addShape(pres.ShapeType.roundRect, { x: xPos, y: 1.15, w: cardW, h: 3.8, fill: { color: isDark ? pc : 'FFFFFF' }, line: { color: isDark ? pc : 'E5E7EB', width: 0.75 }, rectRadius: 0.15 });
            // Icon circle
            slide.addShape(pres.ShapeType.ellipse, { x: xPos + cardW / 2 - 0.35, y: 1.45, w: 0.7, h: 0.7, fill: { color: isDark ? 'FFFFFF' : ac, transparency: isDark ? 80 : 0 } });
            // Value
            slide.addText(s.value || '—', { x: xPos + 0.1, y: 2.3, w: cardW - 0.2, h: 1.1, fontSize: 36, bold: true, align: 'center', color: isDark ? 'FFFFFF' : pc });
            // Label
            slide.addText(s.label || '', { x: xPos + 0.1, y: 3.45, w: cardW - 0.2, h: 0.9, fontSize: 12, align: 'center', color: isDark ? 'D1D5DB' : '6B7280', valign: 'top' });
          });
          addFooter(slide, si + 1);

        } else if (slideData.layoutID === 'LAYOUT_TIMELINE') {
          slide.background = { color: bg };
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: pc } });
          slide.addShape(pres.ShapeType.rect, { x: 0, y: 0.12, w: 10, h: 0.04, fill: { color: ac, transparency: 30 } });
          slide.addText(slideData.data.title || '', { x: 0.4, y: 0.28, w: 9.2, h: 0.65, fontSize: 26, ...titleOpts });
          slide.addShape(pres.ShapeType.rect, { x: 0.4, y: 0.95, w: 1.0, h: 0.06, fill: { color: ac } });

          const events = (slideData.data.events || []).slice(0, 5);
          if (events.length > 0) {
            const cols = events.length;
            const colW = 9.2 / cols;
            // Horizontal timeline line
            slide.addShape(pres.ShapeType.rect, { x: 0.4 + colW * 0.5, y: 2.0, w: colW * (cols - 1), h: 0.06, fill: { color: pc } });
            events.forEach((ev: any, i: number) => {
              const cx = 0.4 + colW * i + colW * 0.5 - 0.25;
              const isDot = i % 2 === 0;
              // Dot
              slide.addShape(pres.ShapeType.ellipse, { x: cx, y: 1.78, w: 0.5, h: 0.5, fill: { color: isDot ? pc : ac }, line: { color: 'FFFFFF', width: 2 } });
              slide.addText(`${i + 1}`, { x: cx, y: 1.78, w: 0.5, h: 0.5, fontSize: 11, color: 'FFFFFF', align: 'center', bold: true });
              // Year
              slide.addText(ev.year || '', { x: cx - 0.25, y: 1.25, w: 1.0, h: 0.4, fontSize: 12, bold: true, align: 'center', color: pc });
              // Event title
              slide.addText(ev.title || '', { x: cx - 0.55, y: 2.4, w: 1.6, h: 0.5, fontSize: 11, bold: true, align: 'center', color: '1F2937' });
              // Description
              slide.addText(ev.description || '', { x: cx - 0.55, y: 2.95, w: 1.6, h: 1.8, fontSize: 10, align: 'center', color: '6B7280', valign: 'top', lineSpacing: 16 });
            });
          }
          addFooter(slide, si + 1);
        }
      }
      await pres.writeFile({ fileName: `Aula_${presentationData.presentationTitle.replace(/\s+/g, '_')}.pptx` });
    } catch (e) {
      console.error(e);
      toast.error('A apresentacao nao saiu dessa vez. Confere a conexao e tenta de novo.');
    }
    setIsExporting(false);
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
            <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl mb-6">
              {([
                { key: 'plan', label: 'Plano' },
                { key: 'activities', label: 'Atividades' },
                { key: 'slides', label: 'Slides' },
                { key: 'exam', label: 'Prova' },
              ] as { key: PlannerMode; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setPlannerMode(key)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${mode === key ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                >
                  {label}
                </button>
              ))}
            </div>
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
                className="w-full bg-indigo-600 text-white rounded-2xl py-4 text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
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
                    onClick={() => generateResource('activities')}
                    className="flex-1 bg-indigo-50 text-indigo-600 rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <FileText size={16} /> Atividades
                  </button>
                  <button
                    onClick={() => generateResource('slides')}
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
                savedResources={savedResources}
                setSavedResources={setSavedResources}
                schedules={schedules}
                classes={classes}
                setClasses={setClasses}
                topic={topic}
                selectedClassId={selectedClassId}
              />
            )}
            
            {(currentResult && mode !== 'slides') && (
              <div className="flex flex-col gap-2 mb-4">
                <div className="max-h-64 overflow-y-auto no-scrollbar border border-gray-100 rounded-2xl p-4 bg-gray-50">
                  <div className="markdown-body text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentResult as string}</ReactMarkdown>
                  </div>
                </div>
                {docReady?.target === 'main' ? (
                  <a
                    href={docReady.url}
                    download={docReady.filename}
                    onClick={() => setTimeout(() => { URL.revokeObjectURL(docReady!.url); setDocReady(null); }, 1000)}
                    className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <Download size={16} /> Baixar Word
                  </a>
                ) : (
                  <button
                    onClick={async () => {
                      if (preparingDoc !== null || docReady !== null) return;
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
                        setDocReady({ url: URL.createObjectURL(blob), filename, target: 'main' });
                      } catch (e) {
                        console.error('Erro ao exportar Word:', e);
                        toast.error('O documento Word fugiu! Tenta gerar de novo.');
                      } finally {
                        setPreparingDoc(null);
                      }
                    }}
                    disabled={preparingDoc !== null || docReady !== null}
                    className="w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {preparingDoc === 'main' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Exportar Word
                  </button>
                )}
              </div>
            )}

            {mode !== 'slides' && resources.length > 0 && (
              <div className="space-y-4 border-t border-gray-100 pt-6">
                <h3 className="text-lg font-bold text-gray-900 mb-2">Materiais Complementares</h3>
                {resources.map((res, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="max-h-64 overflow-y-auto no-scrollbar border border-gray-100 rounded-2xl p-4 bg-white shadow-sm">
                      <div className="flex items-center gap-2 mb-4 font-bold text-indigo-600">
                        {res.type === 'activities' ? <FileText size={16} /> : <Presentation size={16} />}
                        {res.type === 'activities' ? 'Atividades' : 'Roteiro de Slides'}
                      </div>
                      <div className="markdown-body text-xs">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{res.content}</ReactMarkdown>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {docReady?.target === i ? (
                        <a
                          href={docReady.url}
                          download={docReady.filename}
                          onClick={() => setTimeout(() => { URL.revokeObjectURL(docReady!.url); setDocReady(null); }, 1000)}
                          className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                        >
                          <Download size={16} /> Baixar Word
                        </a>
                      ) : (
                        <button
                          onClick={async () => {
                            if (preparingDoc !== null || docReady !== null) return;
                            setPreparingDoc(i);
                            try {
                              const dt = res.type === 'activities' ? 'activities' : res.type === 'exam' ? 'exam' : 'plan';
                              const blob = await buildDocx(res.content, dt, {
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
                              const label = dt === 'plan' ? 'plano' : dt === 'exam' ? 'avaliacao' : 'atividades';
                              const filename = `${label}-${(topic || 'material').replace(/\s+/g, '-')}.docx`;
                              setDocReady({ url: URL.createObjectURL(blob), filename, target: i });
                            } catch (e) {
                              console.error('Erro ao exportar Word:', e);
                              toast.error('O documento Word fugiu! Tenta gerar de novo.');
                            } finally {
                              setPreparingDoc(null);
                            }
                          }}
                          disabled={preparingDoc !== null || docReady !== null}
                          className="w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          {preparingDoc === i ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Exportar Word
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showSchedulePrompt && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-gray-900/40 backdrop-blur-sm p-4 h-[100dvh]">
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
      id: Math.random().toString(36).substr(2, 9),
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

      const basePrompt = `Você é o "Prof. Corujão", o assistente pessoal definitivo para professores.
      Você atua como um CONTROLE REMOTO total do aplicativo. Você pode navegar entre telas, criar materiais, agendar aulas e atualizar o perfil.

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

      Suas Capacidades (USE AS FUNÇÕES SEMPRE QUE POSSÍVEL):
      1. NAVEGAÇÃO: Mudar para as telas 'home', 'planner', 'chat', 'calendar', 'profile', 'estudio', 'biblioteca'.
      2. MATERIAL DIDÁTICO: Gerar Planos de Aula, Slides, Atividades ou Provas. Os materiais ficam disponíveis no histórico ao concluir.
      3. AGENDAMENTO: Marcar uma aula individual (schedule_class) ou uma série de aulas (schedule_lesson_series).
      4. PERFIL: Atualizar nome, disciplina ou escola.

      Regras de Comportamento:
      1. Seja proativo, conciso e profissional.
      2. NUNCA use emojis.
      3. Se o usuário pedir algo genérico como "Gere um material sobre X", pergunte se ele quer Slides, Plano, Atividades ou Prova, ou sugira um deles.
      4. Quando usar uma função de geração, informe que o material ficará disponível no histórico ao concluir.
      5. Se o professor disser apenas "Oi", faça um resumo do dia baseado nas aulas e sugira algo.

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
                      enum: ['home', 'planner', 'chat', 'calendar', 'profile', 'estudio', 'biblioteca'],
                      description: 'Nome da tela de destino'
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
              id: Math.random().toString(36).substr(2, 9),
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
        setMessages([...newMessages, { id: Math.random().toString(36).substr(2, 9), role: 'model', text: responseText || "Tudo certo! Realizei as ações solicitadas.", date: Date.now() }]);
      } else {
        setMessages([...newMessages, { id: Math.random().toString(36).substr(2, 9), role: 'model', text: response.text || "Em que posso ajudar?", date: Date.now() }]);
      }
    } catch (error) {
      console.error(error);
      setMessages([...newMessages, { id: Math.random().toString(36).substr(2, 9), role: 'model', text: '❌ ' + formatApiError(error, 'Tive um branco aqui, professor. Envia de novo que eu respondo.'), date: Date.now() }]);
    }
    setLoading(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-28 h-full flex flex-col">
      <Header setScreen={setScreen} title="Prof. Corujão" subtitle="Inbox" profile={profile} notifications={notifications} setNotifications={setNotifications} bannerImage="https://i.ibb.co/yBsc48YK/20260419-204249-0001.png" />
      
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
        {filteredMessages.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">Nenhuma nota encontrada.</div>
        )}
        {filteredMessages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} items-end gap-2`}>
            {msg.role === 'model' && (
              <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center shrink-0 mb-1 shadow-sm overflow-hidden border border-white">
                <Sparkles className="w-5 h-5 text-indigo-600" />
              </div>
            )}
            <div className={`max-w-[85%] p-4 rounded-2xl ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white text-gray-800 rounded-bl-none shadow-sm border border-gray-50'}`}>
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
              <div className={`markdown-body text-sm ${msg.role === 'user' ? '!text-white' : ''}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
              </div>
              <div className={`text-[10px] mt-2 text-right ${msg.role === 'user' ? 'text-indigo-200' : 'text-gray-400'}`}>
                {new Date(msg.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white p-4 rounded-2xl rounded-bl-none shadow-sm border border-gray-50 flex gap-2 items-center">
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
            </div>
          </div>
        )}
      </div>

      <div className="bg-white p-2 rounded-3xl shadow-sm border border-gray-50 flex flex-col gap-2 shrink-0">
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
          <button 
            onClick={() => sendMessage()}
            disabled={loading || (!input.trim() && !selectedFile)}
            className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center disabled:opacity-50 shrink-0"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
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
  onResetAccount
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
  onResetAccount?: () => void
}) => {
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
  const [showScheduleConfig, setShowScheduleConfig] = useState(false);
  const [showAddClassModal, setShowAddClassModal] = useState(false);
  const [newClassData, setNewClassData] = useState({ name: '', level: 'Ensino Fundamental II', subject: '', school: '', shift: 'Manhã', profile: '', color: '#4F46E5' });
  const [classFormError, setClassFormError] = useState<string | null>(null);
  const classColors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState(profile.name);
  const [profileSubject, setProfileSubject] = useState(profile.subject);
  const [profileSchoolName, setProfileSchoolName] = useState(profile.schoolName || '');
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [importStatus, setImportStatus] = useState<{message: string, type: 'success' | 'info'} | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const daysOfWeek = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  useEffect(() => {
    if (showScheduleConfig && scheduleRef.current) {
      setTimeout(() => {
        scheduleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [showScheduleConfig]);

  const handleSaveNewClass = () => {
    setClassFormError(null);
    if (!newClassData.name.trim()) {
      setClassFormError('Por favor, preencha o nome da turma.');
      return;
    }
    const newClass: ClassSchedule = {
      id: Math.random().toString(36).substr(2, 9),
      name: newClassData.name,
      days: [1, 2, 3, 4, 5],
      time: '08:00',
      color: newClassData.color,
      level: newClassData.level,
      subject: newClassData.subject || undefined,
      school: newClassData.school || undefined,
      shift: newClassData.shift || undefined,
      classProfile: newClassData.profile
    };
    onAddClass(newClass);
    setShowAddClassModal(false);
    setNewClassData({ name: '', level: 'Ensino Fundamental II', subject: '', school: '', shift: 'Manhã', profile: '', color: '#4F46E5' });
  };

  const deleteClass = (id: string) => {
    setSchedules(schedules.filter(s => s.id !== id));
  };

  const toggleDay = (scheduleId: string, dayIndex: number) => {
    setSchedules(schedules.map(s => {
      if (s.id === scheduleId) {
        const newDays = s.days.includes(dayIndex) 
          ? s.days.filter(d => d !== dayIndex)
          : [...s.days, dayIndex];
        return { ...s, days: newDays };
      }
      return s;
    }));
  };

  const togglePeriod = (scheduleId: string, dayIndex: number, period: number) => {
    setSchedules(schedules.map(sch => {
      if (sch.id === scheduleId) {
        const pdMap = sch.periodsPerDay || {};
        const pds = pdMap[dayIndex] || [];
        const newPds = pds.includes(period) ? pds.filter(p => p !== period) : [...pds, period].sort();
        return { ...sch, periodsPerDay: { ...pdMap, [dayIndex]: newPds } };
      }
      return sch;
    }));
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
      
      <div className="bg-white rounded-[2rem] p-6 shadow-sm border-2 border-gray-50 mb-8 flex flex-col items-center text-center">
        <div className="relative">
          <div className="w-24 h-24 rounded-full overflow-hidden mb-4 shadow-md border-2 border-indigo-600 relative group cursor-pointer bg-indigo-600 flex items-center justify-center" onClick={() => !isUploadingPhoto && fileInputRef.current?.click()}>
            {profile.photo ? (
              <img src={profile.photo} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-indigo-600 text-white">
                <User size={48} />
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {isUploadingPhoto ? <Loader2 size={24} className="text-white animate-spin" /> : <Camera size={24} className="text-white" />}
            </div>
            {isUploadingPhoto && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 size={24} className="text-white animate-spin" /></div>}
          </div>
          <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handlePhotoUpload} disabled={isUploadingPhoto} />
        </div>
        {isEditingProfile ? (
          <div className="w-full space-y-3 mt-4">
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
            <h2 className="text-xl font-bold text-gray-900 mt-2">{profile.name || 'Professor'}</h2>
            {profile.subject && <p className="text-sm text-gray-400 mt-0.5">{profile.subject}</p>}
            {profile.schoolName && (
              <p className="text-sm text-indigo-600 font-medium mt-1 bg-indigo-50 px-3 py-1 rounded-full">
                {profile.schoolName}
              </p>
            )}
          </>
        )}

        <button
          onClick={() => isEditingProfile ? saveProfile() : setIsEditingProfile(true)}
          className="mt-6 bg-[#F8F9FE] text-indigo-600 px-6 py-2.5 rounded-full text-base font-bold w-full"
        >
          {isEditingProfile ? 'Salvar' : 'Editar Perfil'}
        </button>
      </div>



      <div className="space-y-3">
        <h3 className="text-lg font-bold text-gray-900 mb-4 px-2">Gestão de Turmas</h3>
        
        <div className="w-full h-32 rounded-2xl overflow-hidden mb-2 shadow-sm relative">
           <img src="https://i.ibb.co/N6j5Gwmy/20260419-204249-0004.png" alt="Painel de Turmas" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        </div>

        <button 
          onClick={() => setShowScheduleConfig(!showScheduleConfig)}
          className="w-full bg-white rounded-2xl p-4 border-2 border-gray-50 shadow-sm flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
            <Clock size={24} />
          </div>
          <span className="font-bold text-gray-900 text-base flex-1 text-left">Horário Semanal</span>
          <ChevronRight size={20} className={`text-gray-300 transition-transform ${showScheduleConfig ? 'rotate-90' : ''}`} />
        </button>

        <AnimatePresence>
          {showScheduleConfig && (
            <motion.div 
              ref={scheduleRef}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-3"
            >
              <button 
                onClick={() => setShowAddClassModal(true)}
                className="w-full bg-indigo-50 text-indigo-600 p-4 rounded-2xl mb-2 font-bold flex items-center justify-center gap-2"
              >
                <Plus size={20} />
                Adicionar Nova Turma
              </button>

              {showAddClassModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
                  <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
                    <h2 className="text-xl font-bold mb-4">Configurar Nova Turma</h2>
                    
                    {classFormError && (
                      <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100">
                        {classFormError}
                      </div>
                    )}

                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Nome da Turma *</label>
                        <input
                          type="text"
                          placeholder="Ex: 8º Ano A"
                          value={newClassData.name}
                          onChange={(e) => setNewClassData({...newClassData, name: e.target.value})}
                          className="w-full p-3 mt-1 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Disciplina *</label>
                        <select
                          value={newClassData.subject}
                          onChange={(e) => setNewClassData({...newClassData, subject: e.target.value})}
                          className={`w-full p-3 mt-1 rounded-xl focus:outline-none transition-all ${
                            newClassData.subject
                              ? 'bg-indigo-600 text-white font-bold border-none shadow-sm'
                              : 'bg-white text-gray-700 border border-gray-200'
                          }`}
                        >
                          <option value="">Selecione a disciplina</option>
                          {SUBJECT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Nível de Ensino</label>
                        <select
                          value={newClassData.level}
                          onChange={(e) => setNewClassData({...newClassData, level: e.target.value})}
                          className="w-full p-3 mt-1 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white text-gray-700"
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
                            <button
                              key={s}
                              onClick={() => setNewClassData({...newClassData, shift: s})}
                              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${newClassData.shift === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Nome da Escola</label>
                        <input
                          type="text"
                          placeholder="Ex: Escola Estadual João Silva"
                          value={newClassData.school}
                          onChange={(e) => setNewClassData({...newClassData, school: e.target.value})}
                          className="w-full p-3 mt-1 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Perfil da Turma (Opcional)</label>
                        <textarea
                          placeholder="Ex: Turma agitada, prefere aulas práticas. 2 alunos com TDAH."
                          value={newClassData.profile}
                          onChange={(e) => setNewClassData({...newClassData, profile: e.target.value})}
                          className="w-full p-3 mt-1 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 resize-none h-16 text-sm"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase ml-1 mb-2 block">Cor de Identificação</label>
                        <div className="flex gap-2 justify-between">
                          {classColors.map(color => (
                            <button
                              key={color}
                              onClick={() => setNewClassData({...newClassData, color})}
                              className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform ${newClassData.color === color ? 'scale-110 ring-2 ring-offset-2 ring-gray-400' : ''}`}
                              style={{ backgroundColor: color }}
                            >
                              {newClassData.color === color && <CheckCircle2 size={16} className="text-white" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4 mt-6">
                      <button onClick={() => setShowAddClassModal(false)} className="flex-1 p-3 rounded-xl bg-gray-100 font-bold">Cancelar</button>
                      <button onClick={handleSaveNewClass} className="flex-1 p-3 rounded-xl bg-indigo-600 text-white font-bold">Salvar Turma</button>
                    </div>
                  </div>
                </div>
              )}

              {schedules.map(s => {
                const isExpanded = expandedClassId === s.id;
                return (
                  <div key={s.id} className="bg-white rounded-2xl p-4 border border-gray-50 shadow-sm relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: s.color || '#4F46E5' }} />
                    <button 
                      onClick={() => setExpandedClassId(isExpanded ? null : s.id)}
                      className="w-full flex justify-between items-center mb-1 pl-2 text-left"
                    >
                      <div className="flex-1">
                        <h4 className="font-bold text-gray-900">{s.name}</h4>
                        <p className="text-xs text-gray-400">
                          {[s.subject, s.level, s.shift].filter(Boolean).join(' · ')}
                        </p>
                        {s.school && <p className="text-xs text-indigo-400 font-medium truncate">{s.school}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <div 
                          onClick={(e) => { e.stopPropagation(); deleteClass(s.id); }}
                          className="text-red-400 p-2 rounded-full hover:bg-red-50 transition-colors"
                        >
                          <Plus size={18} className="rotate-45" />
                        </div>
                        <ChevronRight size={20} className={`text-gray-300 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </div>
                    </button>
                    
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden pt-3 border-t border-gray-50 mt-2"
                        >
                          <div className="flex justify-between mb-3">
                            {daysOfWeek.map((day, i) => (
                              <button
                                key={day}
                                onClick={() => toggleDay(s.id, i)}
                                className={`w-9 h-9 rounded-lg text-xs font-bold transition-colors ${
                                  s.days.includes(i) ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-400'
                                }`}
                              >
                                {day}
                              </button>
                            ))}
                          </div>

                          {s.days.length > 0 && (
                            <div className="space-y-2 mt-4 bg-gray-50 p-3 rounded-xl border border-gray-100">
                              <span className="text-xs font-bold text-gray-500 uppercase">Aulas por Dia</span>
                              {s.days.sort((a,b) => a-b).map(dayIndex => (
                                <div key={dayIndex} className="flex flex-col gap-2 bg-white p-2 rounded-lg border border-gray-50 shadow-sm">
                                  <span className="text-sm font-bold text-gray-700">{daysOfWeek[dayIndex]}</span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {[1, 2, 3, 4, 5, 6].map(period => {
                                      const isSelected = (s.periodsPerDay?.[dayIndex] || []).includes(period);
                                      return (
                                        <button
                                          key={period}
                                          onClick={() => togglePeriod(s.id, dayIndex, period)}
                                          className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                                            isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                                          }`}
                                        >
                                          {period}ª
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Histórico do App */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900 !pt-[12px]">Histórico de Criações</h2>
          <button onClick={() => setScreen('biblioteca')} className="text-indigo-600 text-sm font-bold">Ver tudo</button>
        </div>
        <div className="space-y-3">
          {savedResources.length > 0 ? (
            savedResources.slice(0, 2).map(resource => (
              <div key={resource.id} className="bg-white rounded-2xl p-4 border border-gray-50 shadow-sm flex items-center gap-4 cursor-pointer" onClick={() => setScreen('biblioteca')}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0 ${
                  resource.type === 'slides' ? 'bg-indigo-500' : resource.type === 'activities' ? 'bg-amber-500' : resource.type === 'plan' ? 'bg-cyan-500' : 'bg-emerald-500'
                }`}>
                  {resource.type === 'slides' ? <Presentation size={20} /> : resource.type === 'activities' ? <FileText size={20} /> : resource.type === 'plan' ? <BookOpen size={20} /> : <FileQuestion size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 truncate text-sm">{resource.title}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(resource.date).toLocaleDateString()}</p>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </div>
            ))
          ) : (
            <div className="bg-white rounded-2xl p-6 border border-gray-50 shadow-sm text-center">
              <p className="text-sm text-gray-400">Nenhum material criado ainda.</p>
            </div>
          )}
        </div>
      </div>

      {/* Calendário Escolar */}
      <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-50 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <CalendarIcon size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Calendário Escolar</h2>
            <p className="text-sm text-gray-400">Feriados nacionais e datas comemorativas</p>
          </div>
        </div>
        <button
          onClick={() => {
            const currentYear = new Date().getFullYear();
            const holidays = getDefaultHolidays(currentYear);

            holidays.push({
              id: `recesso-${currentYear}`,
              title: 'Recesso Escolar (Fim de Ano)',
              date: `${currentYear}-12-20 00:00`,
              type: 'holiday' as const
            });

            const newEvents = holidays.filter(h =>
              !customEvents.some(ce => ce.title === h.title)
            );

            if (newEvents.length > 0) {
              setCustomEvents([...customEvents, ...newEvents]);
              const nat = newEvents.filter(h => h.type === 'holiday').length;
              const com = newEvents.filter(h => h.type === 'commemorative').length;
              setImportStatus({ message: `${nat} feriados nacionais e ${com} datas comemorativas importados!`, type: 'success' });
            } else {
              setImportStatus({ message: "O calendário já está atualizado com os feriados deste ano.", type: 'info' });
            }
            
            setTimeout(() => setImportStatus(null), 5000);
          }}
          className="w-full bg-[#F8F9FE] text-indigo-600 px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
        >
          <Download size={18} />
          Importar Calendário Nacional
        </button>
        {importStatus && (
          <div className={`mt-4 p-3 rounded-xl text-sm font-medium text-center ${importStatus.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-indigo-50 text-indigo-700 border border-indigo-100'}`}>
            {importStatus.message}
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

          <button 
            onClick={() => setShowResetConfirm(true)}
            className="w-full flex items-center justify-between p-4 rounded-2xl bg-red-50 hover:bg-red-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-red-600 shadow-sm">
                <Trash2 size={20} />
              </div>
              <div className="text-left">
                <h3 className="font-bold text-red-700">Resetar Conta</h3>
                <p className="text-xs text-red-500">Apagar todos os dados</p>
              </div>
            </div>
            <ChevronRight size={20} className="text-red-400" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showFeedbackModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6"
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
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6"
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
            className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-50 flex items-center justify-center p-6"
            onClick={() => setShowResetConfirm(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-[2rem] p-6 w-full max-w-md shadow-2xl border-4 border-red-50"
            >
              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-xl flex items-center justify-center mb-4">
                <Trash2 size={24} />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Resetar Conta (Ação Irreversível)</h2>
              <p className="text-sm text-gray-600 font-medium mb-2">Tem certeza <span className="text-red-600 font-bold">ABSOLUTA</span> que deseja fazer isso?</p>
              <p className="text-sm text-gray-500 mb-6">Todos os seus cronogramas, turmas, notas e acervo na nuvem serão brutalmente excluídos e não poderão ser recuperados de forma alguma.</p>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowResetConfirm(false)}
                  className="flex-1 py-3 bg-gray-50 text-gray-600 rounded-xl text-sm font-bold border border-gray-200"
                >
                  Não, cancelar
                </button>
                <button 
                  onClick={() => {
                    if (onResetAccount) onResetAccount();
                    setShowResetConfirm(false);
                    setScreen('home'); // Redireciona para o início após a deleção
                  }}
                  className="flex-1 bg-red-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-red-700 transition-colors shadow-sm"
                >
                  Sim, APAGAR TUDO
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
  setClasses
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
  setClasses: (c: ClassItem[]) => void
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
                />
              </Reorder.Item>
            ))}
          </Reorder.Group>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <img src="https://i.ibb.co/vCWk2Fry/6-20260419-213906-0001.png" alt="Calendário Vazio" className="w-48 h-auto object-contain mb-6 rounded-3xl opacity-80" referrerPolicy="no-referrer" />
            <h3 className="text-lg font-bold text-gray-900 mb-2">Dia Livre</h3>
            <p className="text-gray-500 text-sm max-w-[200px]">Nenhum evento programado para este dia.</p>
          </div>
        )}
      </div>
    </motion.div>
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
  setNotifications
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
  setNotifications?: (n: any[]) => void
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

  const changeMonth = (delta: number) => {
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
        <button 
          onClick={() => setIsModalOpen(true)} 
          className="w-10 h-10 bg-indigo-600 text-white rounded-xl shadow-sm flex items-center justify-center shrink-0"
        >
          <Plus size={24} />
        </button>
      </Header>
      
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" onClick={() => setIsModalOpen(false)}>
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
        
        <div className="grid grid-cols-7 gap-y-4 text-center">
          {days.map(d => <span key={d} className="text-xs font-bold text-gray-400 uppercase tracking-wider">{d}</span>)}
          
          {Array(startingEmptyCells).fill(0).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {dates.map(d => {
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
              <div key={d} className="relative flex justify-center py-0.5">
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
              </div>
            );
          })}
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
                          {e.type === 'class' ? `${e.className}${e.topic ? ` — ${e.topic}` : ''}` : e.title}
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

type GameMode = 'story' | 'quiz' | 'wordsearch' | 'crossword' | 'bingo' | 'trail' | 'memory';

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

const buildBingoCards = (items: string[], count: number): string[][][] => {
  const cards: string[][][] = [];
  for (let n = 0; n < count; n++) {
    const shuffled = [...items].sort(() => Math.random() - 0.5).slice(0, 24);
    const card: string[][] = [];
    let idx = 0;
    for (let r = 0; r < 5; r++) {
      const row: string[] = [];
      for (let c = 0; c < 5; c++) {
        if (r === 2 && c === 2) row.push('★ LIVRE');
        else row.push(shuffled[idx++] || '');
      }
      card.push(row);
    }
    cards.push(card);
  }
  return cards;
};

const printGameResult = (opts: { title: string, subject?: string, level?: string, className?: string, teacherName?: string, schoolName?: string, activityLabel: string }) => {
  const node = document.getElementById('game-print-area');
  if (!node) return;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  const todayStr = new Date().toLocaleDateString('pt-BR');
  const owlSvg = `<svg width="84" height="84" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style="opacity:0.88;flex-shrink:0">
    <ellipse cx="30" cy="43" rx="19" ry="16" fill="rgba(255,255,255,0.18)"/>
    <circle cx="30" cy="20" r="17" fill="rgba(255,255,255,0.18)"/>
    <polygon points="17,4 22,17 13,17" fill="rgba(255,255,255,0.28)"/>
    <polygon points="43,4 47,17 38,17" fill="rgba(255,255,255,0.28)"/>
    <circle cx="22" cy="20" r="8" fill="white"/><circle cx="38" cy="20" r="8" fill="white"/>
    <circle cx="23" cy="21" r="5" fill="#1e293b"/><circle cx="39" cy="21" r="5" fill="#1e293b"/>
    <circle cx="25" cy="19" r="2" fill="white"/><circle cx="41" cy="19" r="2" fill="white"/>
    <polygon points="30,27 25,33 35,33" fill="#fbbf24"/>
    <ellipse cx="10" cy="43" rx="10" ry="14" fill="rgba(255,255,255,0.13)" transform="rotate(-15,10,43)"/>
    <ellipse cx="50" cy="43" rx="10" ry="14" fill="rgba(255,255,255,0.13)" transform="rotate(15,50,43)"/>
    <text x="30" y="57" text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.65)" font-family="Arial" font-weight="bold" letter-spacing="1">CORUJAO</text>
  </svg>`;
  const headerHtml = `
    <div class="page-header">
      <div class="header-inner">
        <div class="header-top-row">
          <div class="header-text">
            <div class="school-row">
              <div class="school-name">${opts.schoolName || 'ESCOLA'}</div>
              <div class="school-meta">${opts.subject || ''}${opts.level ? ' • ' + opts.level : ''}</div>
            </div>
            <div class="activity-tag">${opts.activityLabel}</div>
            <h1 class="doc-title">${opts.title}</h1>
          </div>
          <div class="header-owl">${owlSvg}</div>
        </div>
        <div class="fields-grid">
          <div class="field"><span class="field-label">NOME</span><div class="field-line"></div></div>
          <div class="field"><span class="field-label">DATA</span><div class="field-line short">${todayStr}</div></div>
          <div class="field"><span class="field-label">TURMA</span><div class="field-line short">${opts.className || ''}</div></div>
          <div class="field"><span class="field-label">N&ordm;</span><div class="field-line tiny"></div></div>
          <div class="field full"><span class="field-label">PROFESSOR(A)</span><div class="field-line">${opts.teacherName || ''}</div></div>
        </div>
      </div>
    </div>
  `;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${opts.title}</title><style>
    @page { size: A4; margin: 1.4cm 1.4cm 2cm; }
    * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1f2937; line-height: 1.5; margin: 0; font-size: 12px; background: white; }

    /* ── HEADER ───────────────────────────────────────────── */
    .page-header { background: var(--ac,#4338ca); border-radius: 16px; padding: 14px 16px 16px; color: white; position: relative; overflow: hidden; margin-bottom: 18px; }
    .page-header::before { content:''; position:absolute; inset:0; background-image:radial-gradient(circle, rgba(255,255,255,0.14) 1.5px, transparent 1.5px); background-size:16px 16px; border-radius:16px; pointer-events:none; }
    .header-inner { position:relative; z-index:1; }
    .header-top-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    .header-text { flex:1; min-width:0; }
    .header-owl { flex-shrink:0; margin-top:-4px; }
    .school-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:8.5px; letter-spacing:1.5px; color:rgba(255,255,255,0.75); text-transform:uppercase; font-weight:700; }
    .school-name { font-weight:900; color:white; }
    .activity-tag { display:inline-flex; align-items:center; gap:5px; background:rgba(255,255,255,0.22); color:white; padding:4px 12px; border-radius:20px; font-size:10px; font-weight:900; letter-spacing:1px; text-transform:uppercase; margin-bottom:8px; border:1.5px solid rgba(255,255,255,0.45); }
    .doc-title { font-size:21px; font-weight:900; color:white; margin:0 0 14px; line-height:1.2; text-shadow:0 1px 6px rgba(0,0,0,0.18); }
    .fields-grid { display:grid; grid-template-columns:2fr 1fr 1fr 0.5fr; gap:7px 12px; margin-top:4px; }
    .field { display:flex; flex-direction:column; gap:2px; }
    .field.full { grid-column:1/-1; }
    .field-label { font-size:7px; font-weight:900; color:rgba(255,255,255,0.65); letter-spacing:1.5px; text-transform:uppercase; }
    .field-line { border-bottom:1.5px solid rgba(255,255,255,0.55); min-height:17px; padding:2px 4px; font-size:10.5px; color:white; font-weight:700; }

    /* ── HOW TO PLAY card ─────────────────────────────────── */
    .instructions { display:flex; gap:10px; align-items:flex-start; background:white; border:2px dashed var(--ac,#4338ca); padding:10px 14px; margin:10px 0 18px; border-radius:10px; font-size:11px; color:#1f2937; }
    .instructions-icon { font-size:22px; flex-shrink:0; line-height:1; }
    .instructions-body { flex:1; }
    .instructions-title { font-size:8.5px; font-weight:900; color:var(--ac,#4338ca); letter-spacing:1.5px; text-transform:uppercase; margin-bottom:4px; }

    /* ── GENERAL CONTENT ──────────────────────────────────── */
    h2 { font-size:13px; margin:18px 0 8px; color:white; font-weight:900; padding:5px 12px; background:var(--ac,#4338ca); border-radius:6px; display:inline-block; }
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
    .bingo-card { border:3px solid var(--ac,#4338ca); margin:0 0 22px; page-break-inside:avoid; break-inside:avoid; border-radius:14px; overflow:hidden; box-shadow:0 4px 14px rgba(0,0,0,0.12); }
    .bingo-card-title { display:flex; justify-content:center; gap:0; background:#1e293b; padding:8px 10px; }
    .bingo-letter { display:inline-flex; align-items:center; justify-content:center; width:46px; height:46px; font-size:28px; font-weight:900; color:white; border-radius:8px; margin:0 2px; }
    .bingo-sub { text-align:center; font-size:9px; color:#6b7280; padding:4px 0; background:#f8f7ff; border-bottom:1px solid #ddd6fe; letter-spacing:1px; font-weight:700; }
    .bingo-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:0; }
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
    .cut-hint { font-size:10px; color:#6b7280; font-style:italic; margin:0 0 8px; display:flex; align-items:center; gap:5px; }
    .memory-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; page-break-inside:avoid; break-inside:avoid; }
    .memory-pair { border:2px dashed #d1d5db; padding:12px 6px; min-height:82px; display:flex; align-items:center; justify-content:center; text-align:center; font-size:10px; page-break-inside:avoid; break-inside:avoid; background:white; border-radius:10px; position:relative; }
    .memory-pair::after { content:'✂'; position:absolute; top:-9px; right:4px; font-size:11px; color:#9ca3af; background:white; padding:0 2px; }
    .memory-pair.concept { background:var(--ac,#4338ca); color:white; font-weight:900; border-color:var(--ac,#4338ca); font-size:11px; border-style:solid; }
    .memory-pair.concept::after { display:none; }

    /* ── TRAIL ────────────────────────────────────────────── */
    .trail-wrapper { margin:14px 0; page-break-inside:avoid; break-inside:avoid; }
    .trail-board { display:grid; grid-template-columns:repeat(8,1fr); gap:5px; padding:14px; background:var(--ac-light,#eef2ff); border-radius:12px; border:2.5px solid var(--ac,#4338ca); }
    .trail-cell { border:2.5px solid var(--ac,#4338ca); border-radius:50%; aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:11px; background:white; color:var(--ac,#4338ca); }
    .trail-cell.special { background:#fbbf24; color:#78350f; border-color:#d97706; }
    .trail-cell.end { background:#dc2626; color:white; border-color:#991b1b; font-size:16px; }
    .trail-cell.start { background:#16a34a; color:white; border-color:#14532d; font-size:16px; }
    /* legend (injected) */
    .trail-legend { display:flex; align-items:center; justify-content:space-between; margin-top:8px; padding:8px 12px; background:white; border-radius:8px; border:1.5px solid #e5e7eb; }
    .trail-legend-title { font-size:8px; font-weight:900; color:var(--ac,#4338ca); letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
    .trail-legend-items { display:flex; gap:12px; flex-wrap:wrap; font-size:9.5px; font-weight:600; color:#374151; flex:1; }
    .trail-dice { flex-shrink:0; color:var(--ac,#4338ca); }

    /* ── CROSSWORD ────────────────────────────────────────── */
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

    /* ── SCORE TRACKER (injected) ─────────────────────────── */
    .score-tracker { margin:24px 0 8px; padding:12px 16px; border:2.5px solid var(--ac,#4338ca); border-radius:12px; background:var(--ac-light,#eef2ff); page-break-inside:avoid; break-inside:avoid; }
    .score-stars { font-size:22px; letter-spacing:4px; text-align:center; margin-bottom:8px; }
    .score-row { display:flex; align-items:center; justify-content:center; gap:20px; }
    .score-label { font-size:8px; font-weight:900; color:var(--ac,#4338ca); letter-spacing:1.5px; text-transform:uppercase; }
    .score-field { border-bottom:2px solid var(--ac,#4338ca); min-width:80px; text-align:center; font-size:14px; font-weight:900; color:#1f2937; padding:2px 8px; }

    /* ── ANSWER KEY ───────────────────────────────────────── */
    .answer-key-page { display:none; page-break-before:always; padding-top:8px; }
    @media print { .answer-key-page { display:block; } .quiz-answer, .cw-answer { display:none !important; } }
    .answer-key-title { font-size:14px; color:white; font-weight:900; letter-spacing:2px; text-transform:uppercase; background:#dc2626; padding:6px 14px; border-radius:6px; display:inline-block; margin-bottom:12px; }
    .answer-key-item { font-size:11px; margin-bottom:5px; padding:5px 10px; background:#fef2f2; border-radius:6px; border-left:3px solid #dc2626; }

    /* ── FOOTER ───────────────────────────────────────────── */
    .page-footer { position:fixed; bottom:0.5cm; right:1.4cm; font-size:8px; color:#9ca3af; letter-spacing:1px; opacity:0.8; }

    /* ── UTIL ─────────────────────────────────────────────── */
    .hide-on-screen { display:block; }
    button { display:none; }
  </style></head><body>
    ${headerHtml}
    ${node.innerHTML}
    <div class="page-footer">Gerado por Prof. Corujao • ${todayStr}</div>
    <script>
    (function(){
      var label = "${opts.activityLabel}";
      var themes = {
        'Campanha Narrativa':    { ac:'#7c3aed', light:'#f5f3ff', emoji:'📖' },
        'Quiz Avaliativo':       { ac:'#ea580c', light:'#fff7ed', emoji:'⚡' },
        'Caca-Palavras':         { ac:'#2563eb', light:'#eff6ff', emoji:'🔍' },
        'Palavras Cruzadas':     { ac:'#0d9488', light:'#f0fdfa', emoji:'✏️' },
        'Bingo Educativo':       { ac:'#7c3aed', light:'#f5f3ff', emoji:'🎱' },
        'Trilha do Conhecimento':{ ac:'#16a34a', light:'#f0fdf4', emoji:'🎲' },
        'Jogo da Memoria':       { ac:'#db2777', light:'#fdf2f8', emoji:'🃏' }
      };
      var t = themes[label] || { ac:'#4338ca', light:'#eef2ff', emoji:'🎮' };
      document.documentElement.style.setProperty('--ac', t.ac);
      document.documentElement.style.setProperty('--ac-light', t.light);

      // emoji on activity tag
      var tag = document.querySelector('.activity-tag');
      if (tag) tag.innerHTML = t.emoji + '&nbsp;&nbsp;' + tag.textContent.trim();

      // ── Instructions box: wrap with icon and title ──────
      var instr = document.querySelector('.instructions');
      if (instr) {
        var body = instr.innerHTML;
        instr.innerHTML = '<div class="instructions-icon">🎮</div><div class="instructions-body"><div class="instructions-title">Como Jogar</div>' + body + '</div>';
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

      // ── BINGO: colored B-I-N-G-O tiles + calling circles ─
      var bingoTitle = document.querySelector('.bingo-card-title');
      if (bingoTitle) {
        var cols = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6'];
        bingoTitle.innerHTML = 'BINGO'.split('').map(function(l,i){
          return '<span class="bingo-letter" style="background:' + cols[i] + '">' + l + '</span>';
        }).join('');
      }
      var bingoFree = document.querySelector('.bingo-cell.free');
      if (bingoFree) bingoFree.innerHTML = '&#11088;<br>FREE<br>&#11088;';
      document.querySelectorAll('.bingo-card').forEach(function(card) {
        var calling = document.createElement('div');
        calling.className = 'bingo-calling';
        calling.innerHTML = '<div class="bingo-calling-label">Termos sorteados — marque abaixo:</div><div class="bingo-calling-circles">'
          + Array(24).fill('<span class="bingo-circle"></span>').join('') + '</div>';
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

      // ── TRAIL: emoji cells + dice + legend ──────────────
      var cells = document.querySelectorAll('.trail-cell');
      if (cells.length) {
        cells[0].textContent = '🚀';
        cells[cells.length-1].textContent = '🏆';
        cells.forEach(function(c) { if (c.classList.contains('special') && !c.classList.contains('start') && !c.classList.contains('end')) c.textContent = '⭐'; });
        var board = document.querySelector('.trail-board');
        if (board) {
          var wrapper = document.createElement('div');
          wrapper.className = 'trail-wrapper';
          board.parentNode.insertBefore(wrapper, board);
          wrapper.appendChild(board);
          var diceSvg = '<svg class="trail-dice" width="38" height="38" viewBox="0 0 40 40"><rect x="2" y="2" width="36" height="36" rx="9" fill="white" stroke="currentColor" stroke-width="2.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="28" cy="12" r="3.2" fill="currentColor"/><circle cx="20" cy="20" r="3.2" fill="currentColor"/><circle cx="12" cy="28" r="3.2" fill="currentColor"/><circle cx="28" cy="28" r="3.2" fill="currentColor"/></svg>';
          var legend = document.createElement('div');
          legend.className = 'trail-legend';
          legend.innerHTML = '<div><div class="trail-legend-title">Legenda</div><div class="trail-legend-items"><span>🚀 Início</span><span>🏆 Chegada</span><span>⭐ Bônus: avance 2</span><span>💤 Fique parado</span><span>🔄 Volte 2</span></div></div>' + diceSvg;
          wrapper.appendChild(legend);
        }
      }

      // ── MEMORY: cut hint + scissors on grid ─────────────
      var memGrid = document.querySelector('.memory-grid');
      if (memGrid) {
        var hint = document.createElement('p');
        hint.className = 'cut-hint';
        hint.innerHTML = '✂&nbsp; Recorte as fichas e embaralhe &mdash; <strong>conceitos</strong> com fundo colorido, <strong>definições</strong> com fundo branco.';
        memGrid.before(hint);
      }

      // ── CROSSWORD: num badges ────────────────────────────
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

      // ── SCORE TRACKER ────────────────────────────────────
      var akPage = document.querySelector('.answer-key-page');
      var tracker = document.createElement('div');
      tracker.className = 'score-tracker';
      tracker.innerHTML = '<div class="score-stars">&#11088; &#11088; &#11088; &#11088; &#11088;</div><div class="score-row"><span class="score-label">Acertos</span><div class="score-field">___ / ___</div><span class="score-label">Nota</span><div class="score-field">___________</div></div>';
      if (akPage) akPage.before(tracker); else document.body.insertBefore(tracker, document.querySelector('.page-footer'));

      setTimeout(function(){ window.print(); }, 600);
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
  schedules
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
  schedules?: ClassSchedule[]
}) => {
  const [activeMode, setActiveMode] = useState<GameMode | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [classId, setClassId] = useState<string>('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<'fácil' | 'média' | 'difícil'>('média');
  const [genre, setGenre] = useState('aventura');
  const [duration, setDuration] = useState('1 aula');
  const [count, setCount] = useState(10);

  const selectedClass = (schedules || []).find(s => s.id === classId);
  const defaultSubject = selectedClass?.subject || profile.subject || '';
  const defaultLevel = selectedClass?.level || 'Ensino Fundamental II';

  const closeModal = () => { setActiveMode(null); setResult(null); setTopic(''); };

  const generate = async () => {
    if (!topic.trim()) { toast.error('Qual e o tema? O Corujao precisa saber para criar!'); return; }
    setIsGenerating(true);
    setResult(null);
    try {
      const context = `Disciplina: ${defaultSubject || 'Geral'} | Nível: ${defaultLevel}${selectedClass ? ` | Turma: ${selectedClass.name}` : ''} | Tema: ${topic}`;
      let prompt = '';
      if (activeMode === 'story') {
        prompt = `Você é um designer de jogos educacionais. Crie uma CAMPANHA narrativa gamificada completa para gamificar aulas.
${context}
Gênero: ${genre} | Duração: ${duration}

Retorne em Markdown brasileiro com EXATAMENTE as seções abaixo:

## 🌍 Cenário
(2 parágrafos imersivos onde os alunos são protagonistas. Inclua ambientação, conflito central e papel dos alunos.)

## 👥 Classes de Personagens
(4 classes que os alunos podem escolher, com nome criativo, descrição curta e habilidade especial em 1 frase. Use lista.)

## ⚔️ Missões
(${duration === '1 aula' ? '3' : duration.includes('semana') ? '5' : '8'} missões em sequência, cada uma com: **Missão N — Nome**, narrativa de abertura curta (3-4 linhas), desafio (relacionado ao conteúdo "${topic}"), recompensa em XP/moedas.)

## 🏆 Sistema de Pontos
(Tabela: ação → XP/moedas ganhos. Inclua: participar, acertar resposta, completar missão, ajudar colega.)

## 👑 Boss Final
(Desafio épico de encerramento, narrativa de 2-3 linhas + descrição da prova/trabalho final tematizada.)

## 📋 Roteiro do Professor
(Lista numerada de 5 passos práticos para conduzir essa campanha em sala.)

NÃO use código, NÃO use emojis fora dos títulos. Português brasileiro natural.`;
      } else if (activeMode === 'quiz') {
        prompt = `Gere um quiz de múltipla escolha sobre "${topic}" para ${defaultLevel}, disciplina ${defaultSubject}, dificuldade ${difficulty}.
Retorne APENAS JSON válido (sem markdown, sem \`\`\`):
{"title":"...","questions":[{"q":"pergunta","options":["a","b","c","d"],"correct":0,"explain":"justificativa breve"}]}
Gere exatamente ${count} perguntas. As 4 opções devem ser plausíveis. "correct" é o índice 0-3.`;
      } else if (activeMode === 'wordsearch') {
        prompt = `Liste ${count} palavras-chave sobre "${topic}" (${defaultSubject}, ${defaultLevel}) para caça-palavras.
Cada palavra: substantivo, SEM espaços, SEM acentos, entre 4 e 12 letras, MAIÚSCULAS.
Retorne APENAS JSON: {"title":"...","words":[{"word":"PALAVRA","hint":"dica curta para o aluno"}]}`;
      } else if (activeMode === 'crossword') {
        prompt = `Crie uma lista de ${count} palavras sobre "${topic}" (${defaultSubject}, ${defaultLevel}) com definições no estilo "palavras cruzadas".
Cada palavra entre 4 e 10 letras, SEM espaços, MAIÚSCULAS, sem acentos.
Retorne APENAS JSON: {"title":"...","words":[{"word":"PALAVRA","clue":"definição/pista clara, estilo dicionário"}]}`;
      } else if (activeMode === 'bingo') {
        prompt = `Liste 40 termos/conceitos importantes sobre "${topic}" (${defaultSubject}, ${defaultLevel}) para bingo educativo.
Cada termo: 1 a 3 palavras, claros e didáticos.
Retorne APENAS JSON: {"title":"Bingo de ${topic}","items":["termo1","termo2",...]}`;
      } else if (activeMode === 'trail') {
        prompt = `Crie uma trilha do conhecimento (jogo de tabuleiro) de ${count} casas sobre "${topic}" (${defaultSubject}, ${defaultLevel}).
Retorne APENAS JSON:
{"title":"...","instructions":"regras curtas (até 3 linhas)","questions":[{"casa":N,"type":"pergunta"|"desafio"|"bonus"|"penalidade","text":"o que acontece nessa casa"}]}
Gere ${Math.min(count, 12)} casas especiais (não precisa preencher todas). Use perguntas factuais sobre ${topic} para tipo "pergunta".`;
      } else if (activeMode === 'memory') {
        prompt = `Gere ${count} pares conceito↔definição sobre "${topic}" (${defaultSubject}, ${defaultLevel}) para jogo da memória.
Cada conceito: 1-3 palavras. Cada definição: 1 frase curta (max 12 palavras).
Retorne APENAS JSON: {"title":"...","pairs":[{"concept":"...","definition":"..."}]}`;
      }
      const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt });
      const raw = response.text || '';
      if (activeMode === 'story') {
        setResult({ markdown: raw });
      } else {
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        if (activeMode === 'wordsearch') {
          const built = buildWordSearchGrid(parsed.words.map((w: any) => w.word));
          setResult({ ...parsed, grid: built.grid });
        } else if (activeMode === 'bingo') {
          const cards = buildBingoCards(parsed.items, 10);
          setResult({ ...parsed, cards });
        } else {
          setResult(parsed);
        }
      }
    } catch (err: any) {
      console.error('[Gamification] error:', err);
      const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      toast.error(msg || 'A IA travou nessa. Aguarde um instante e tente de novo.');
    }
    setIsGenerating(false);
  };

  const modeMeta: Record<GameMode, { title: string, icon: any, color: string, bg: string }> = {
    story: { title: 'Storytelling', icon: ScrollText, color: 'text-white', bg: 'from-indigo-600 to-purple-600' },
    quiz: { title: 'Quiz', icon: Trophy, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
    wordsearch: { title: 'Caça-Palavras', icon: Grid3x3, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
    crossword: { title: 'Palavras Cruzadas', icon: Puzzle, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
    bingo: { title: 'Bingo Educativo', icon: Dice5, color: 'text-pink-600', bg: 'bg-pink-50 border-pink-200' },
    trail: { title: 'Trilha', icon: MapIcon, color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
    memory: { title: 'Memória', icon: Layers3, color: 'text-teal-600', bg: 'bg-teal-50 border-teal-200' },
  };

  const smallActivities: GameMode[] = ['quiz', 'wordsearch', 'crossword', 'bingo', 'trail', 'memory'];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title="Estúdio" subtitle="Gamificação de Aulas" profile={profile} notifications={notifications} setNotifications={setNotifications} bannerImage="https://i.ibb.co/vCp6TFqs/20260416-185756-0000.png" />

      <div className="px-1 mb-6">
        <p className="text-sm text-gray-500 leading-relaxed">Transforme qualquer conteúdo em atividades gamificadas que prendem a atenção da turma.</p>
      </div>

      {/* STORYTELLING — destaque */}
      <button
        onClick={() => setActiveMode('story')}
        className="w-full relative overflow-hidden rounded-[2rem] p-6 mb-4 shadow-xl text-left bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 active:scale-[0.98] transition-transform"
      >
        <div className="absolute -top-6 -right-6 opacity-20">
          <ScrollText size={130} className="text-white" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-black tracking-widest uppercase text-yellow-300 bg-white/10 px-2 py-0.5 rounded-full backdrop-blur">★ Principal</span>
          </div>
          <h2 className="text-3xl font-black text-white mb-2 leading-tight">Storytelling</h2>
          <p className="text-sm text-indigo-100 max-w-[80%] leading-relaxed mb-4">
            Crie uma campanha narrativa completa: cenário, personagens, missões e boss final para gamificar toda a aula.
          </p>
          <div className="inline-flex items-center gap-2 bg-white text-indigo-700 font-bold px-4 py-2 rounded-full text-sm">
            <Wand2 size={16} /> Criar campanha
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
              <p className="text-[11px] text-gray-500 mt-0.5">Gerar com IA</p>
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
                  {(() => { const Icon = modeMeta[activeMode].icon; return <Icon size={22} className={activeMode === 'story' ? 'text-indigo-600' : modeMeta[activeMode].color} />; })()}
                  <h3 className="font-bold text-lg text-gray-900">{modeMeta[activeMode].title}</h3>
                </div>
                <button onClick={closeModal} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"><X size={18} /></button>
              </div>

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
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Gênero narrativo</label>
                        <select value={genre} onChange={e => setGenre(e.target.value)} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm">
                          <option value="aventura">Aventura</option>
                          <option value="mistério">Mistério / Detetive</option>
                          <option value="ficção científica">Ficção Científica</option>
                          <option value="fantasia medieval">Fantasia Medieval</option>
                          <option value="exploração espacial">Exploração Espacial</option>
                          <option value="época histórica">Época Histórica</option>
                          <option value="apocalíptico">Pós-apocalíptico</option>
                          <option value="terror leve">Terror leve / Suspense</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Duração</label>
                        <select value={duration} onChange={e => setDuration(e.target.value)} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm">
                          <option value="1 aula">1 aula (3 missões)</option>
                          <option value="1 semana">1 semana (5 missões)</option>
                          <option value="1 bimestre">1 bimestre (8 missões)</option>
                        </select>
                      </div>
                    </>
                  )}

                  {activeMode === 'quiz' && (
                    <>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Quantidade de perguntas</label>
                        <input type="number" min={5} max={30} value={count} onChange={e => setCount(Math.max(5, Math.min(30, parseInt(e.target.value) || 10)))} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm" />
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

                  {(activeMode === 'wordsearch' || activeMode === 'crossword' || activeMode === 'memory') && (
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {activeMode === 'memory' ? 'Quantidade de pares' : 'Quantidade de palavras'}
                      </label>
                      <input type="number" min={5} max={20} value={count} onChange={e => setCount(Math.max(5, Math.min(20, parseInt(e.target.value) || 10)))} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm" />
                    </div>
                  )}

                  {activeMode === 'trail' && (
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tamanho da trilha (casas)</label>
                      <input type="number" min={20} max={48} value={count} onChange={e => setCount(Math.max(20, Math.min(48, parseInt(e.target.value) || 32)))} className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm" />
                    </div>
                  )}

                  <button onClick={generate} disabled={isGenerating || !topic.trim()} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50">
                    {isGenerating ? <><Loader2 size={18} className="animate-spin" /> Gerando…</> : <><Wand2 size={18} /> Gerar com IA</>}
                  </button>
                </div>
              )}

              {result && (() => {
                const activityLabels: Record<GameMode, string> = {
                  story: 'Campanha Narrativa', quiz: 'Quiz Avaliativo', wordsearch: 'Caca-Palavras',
                  crossword: 'Palavras Cruzadas', bingo: 'Bingo Educativo', trail: 'Trilha do Conhecimento', memory: 'Jogo da Memoria'
                };
                const printOpts = {
                  title: result.title || topic,
                  subject: defaultSubject,
                  level: defaultLevel,
                  className: selectedClass?.name,
                  teacherName: profile.name,
                  schoolName: profile.schoolName || selectedClass?.school,
                  activityLabel: activityLabels[activeMode!]
                };
                return (
                <div className="p-5">
                  <div className="flex gap-2 mb-4">
                    <button onClick={() => setResult(null)} className="flex-1 bg-gray-100 text-gray-700 font-bold py-2.5 rounded-xl text-sm">↻ Refazer</button>
                    <button onClick={() => printGameResult(printOpts)} className="flex-1 bg-emerald-600 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"><Download size={16} /> Imprimir / PDF</button>
                  </div>

                  <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-3 mb-3">
                    <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">{printOpts.activityLabel}</p>
                    <h1 className="text-base font-black text-indigo-900">{printOpts.title}</h1>
                    <p className="text-[10px] text-indigo-400 mt-0.5">{printOpts.subject} · {printOpts.level}{printOpts.className ? ` · ${printOpts.className}` : ''}</p>
                  </div>

                  <div id="game-print-area" className="bg-gray-50 rounded-2xl p-4 text-sm">
                    {activeMode === 'story' && result.markdown && (
                      <div className="markdown-body prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.markdown}</ReactMarkdown>
                      </div>
                    )}

                    {activeMode === 'quiz' && result.questions && (
                      <>
                        <div className="instructions"><b>Instrucoes:</b> Leia cada questao com atencao e marque a alternativa correta.</div>
                        <div className="space-y-3">
                          {result.questions.map((q: any, i: number) => (
                            <div key={i} className="quiz-q">
                              <p><b>{i + 1}.</b> {q.q}</p>
                              <div className="mt-2">
                                {q.options.map((opt: string, j: number) => (
                                  <p key={j} className="quiz-opt"><b>{String.fromCharCode(65 + j)})</b> {opt}</p>
                                ))}
                              </div>
                              <p className="quiz-answer text-xs text-emerald-700 mt-2"><b>Resposta:</b> {String.fromCharCode(65 + q.correct)} — {q.explain}</p>
                            </div>
                          ))}
                        </div>
                        <div className="answer-key-page">
                          <h2 className="answer-key-title">Gabarito</h2>
                          {result.questions.map((q: any, i: number) => (
                            <div key={i} className="answer-key-item"><b>{i + 1}.</b> {String.fromCharCode(65 + q.correct)} — {q.explain}</div>
                          ))}
                        </div>
                      </>
                    )}

                    {activeMode === 'wordsearch' && result.grid && (
                      <>
                        <div className="instructions"><b>Instrucoes:</b> Encontre todas as palavras da lista escondidas na grade. Elas podem aparecer na horizontal, vertical ou diagonal.</div>
                        <div className="ws-wrapper">
                          <div className="ws-grid" style={{ gridTemplateColumns: `repeat(${result.grid.length}, 24px)` }}>
                            {result.grid.flatMap((row: string[], r: number) => row.map((cell: string, c: number) => (
                              <div key={`${r}-${c}`} className="ws-cell">{cell}</div>
                            )))}
                          </div>
                        </div>
                        <h2>Palavras para encontrar</h2>
                        <ul className="clue-list">
                          {result.words.map((w: any, i: number) => <li key={i}><b>{w.word}</b> — {w.hint}</li>)}
                        </ul>
                      </>
                    )}

                    {activeMode === 'crossword' && result.words && (
                      <>
                        <div className="instructions"><b>Instrucoes:</b> Leia cada definicao e escreva a palavra correta nos quadradinhos, uma letra em cada caixa.</div>
                        <ol style={{ listStyle: 'decimal', paddingLeft: 20 }}>
                          {result.words.map((w: any, i: number) => (
                            <li key={i} className="cw-item">
                              <p className="cw-clue">{w.clue}</p>
                              <div className="cw-boxes">
                                {w.word.split('').map((_: string, j: number) => (<div key={j} className="cw-box"></div>))}
                              </div>
                              <p className="cw-answer" style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Resposta: {w.word}</p>
                            </li>
                          ))}
                        </ol>
                        <div className="answer-key-page">
                          <h2 className="answer-key-title">Gabarito</h2>
                          {result.words.map((w: any, i: number) => (
                            <div key={i} className="answer-key-item"><b>{i + 1}.</b> {w.word}</div>
                          ))}
                        </div>
                      </>
                    )}

                    {activeMode === 'bingo' && result.cards && (
                      <>
                        <div className="instructions"><b>Como jogar:</b> Distribua uma cartela para cada aluno. O professor sorteia os termos da lista — quem marcar uma linha, coluna ou diagonal completa grita BINGO!</div>
                        {result.cards.map((card: string[][], i: number) => (
                          <div key={i} className="bingo-card">
                            <div className="bingo-card-title">BINGO</div>
                            <div className="bingo-sub">Cartela {i + 1}</div>
                            <div className="bingo-grid">
                              {card.flatMap((row, r) => row.map((cell, c) => (
                                <div key={`${r}-${c}`} className={`bingo-cell ${cell.startsWith('★') ? 'free' : ''}`}>{cell.replace('★ ', '')}</div>
                              )))}
                            </div>
                          </div>
                        ))}
                        <h2>Termos para sortear</h2>
                        <ul className="clue-list">
                          {result.items.slice(0, 40).map((it: string, i: number) => <li key={i}>{it}</li>)}
                        </ul>
                      </>
                    )}

                    {activeMode === 'trail' && result.questions && (
                      <>
                        <div className="instructions"><b>Regras:</b> {result.instructions}</div>
                        <div className="trail-board">
                          {Array.from({ length: count }, (_, i) => {
                            const special = result.questions.find((q: any) => q.casa === i + 1);
                            const isEnd = i + 1 === count;
                            const isStart = i === 0;
                            return (
                              <div key={i} className={`trail-cell ${isStart ? 'start' : ''} ${special ? 'special' : ''} ${isEnd ? 'end' : ''}`}>{i + 1}</div>
                            );
                          })}
                        </div>
                        <h2>Casas especiais</h2>
                        <ol style={{ listStyle: 'decimal', paddingLeft: 20 }}>
                          {result.questions.map((q: any, i: number) => (
                            <li key={i} style={{ marginBottom: 6, pageBreakInside: 'avoid' }}><b>Casa {q.casa}</b> ({q.type}): {q.text}</li>
                          ))}
                        </ol>
                      </>
                    )}

                    {activeMode === 'memory' && result.pairs && (
                      <>
                        <div className="instructions"><b>Como jogar:</b> Imprima, recorte pelas linhas tracejadas e embaralhe as cartas. Cada aluno (ou dupla) tenta encontrar os pares conceito-definicao virando duas cartas por vez.</div>
                        <div className="memory-grid">
                          {result.pairs.flatMap((p: any, i: number) => [
                            <div key={`c-${i}`} className="memory-pair concept">{p.concept}</div>,
                            <div key={`d-${i}`} className="memory-pair">{p.definition}</div>
                          ])}
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

const AcervoScreen = ({ savedResources, setSavedResources, profile, setScreen, notifications, setNotifications }: { savedResources: SavedResource[], setSavedResources: (r: SavedResource[]) => void, profile: UserProfile, setScreen: (s: Screen) => void, notifications?: any[], setNotifications?: (n: any[]) => void }) => {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title="Histórico" subtitle="Materiais gerados recentemente" profile={profile} notifications={notifications} setNotifications={setNotifications} />
      {savedResources.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Archive size={44} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">Nenhum material salvo</p>
          <button onClick={() => setScreen('planner')} className="mt-4 bg-indigo-600 text-white px-6 py-2.5 rounded-full text-sm font-bold">Criar Material</button>
        </div>
      ) : (
        <div className="space-y-4">
          {savedResources.map(resource => (
            <div key={resource.id} className="bg-white rounded-2xl p-4 border border-gray-50 shadow-sm flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0 ${resource.type === 'slides' ? 'bg-indigo-500' : resource.type === 'activities' ? 'bg-amber-500' : resource.type === 'plan' ? 'bg-cyan-500' : 'bg-emerald-500'}`}>
                {resource.type === 'slides' ? <Presentation size={20} /> : resource.type === 'activities' ? <FileText size={20} /> : resource.type === 'plan' ? <BookOpen size={20} /> : <FileQuestion size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 truncate">{resource.title}</h3>
                <span className="text-xs text-gray-400">{new Date(resource.date).toLocaleDateString()}</span>
              </div>
              <button onClick={() => setSavedResources(savedResources.filter(r => r.id !== resource.id))} className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-colors">
                <Plus size={20} className="rotate-45" />
              </button>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};

// --- Global Task Indicator ---

const GlobalTaskIndicator = ({ tasks, onTaskClick }: { tasks: Record<string, BackgroundTask>, onTaskClick?: (task: BackgroundTask) => void }) => {
  const activeTasksList = Object.values(tasks);
  if (activeTasksList.length === 0) return null;

  return (
    <div className="fixed bottom-28 left-4 right-4 z-[100] space-y-2 pointer-events-none">
      <AnimatePresence>
        {activeTasksList.map(task => (
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
                initial={{ width: "0%" }}
                animate={{ width: "95%" }}
                transition={{ duration: 25, ease: "linear" }}
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
                <p className="text-[10px] text-gray-500 font-bold">
                  {task.status === 'processing' ? 'Processando em segundo plano...' :
                   task.status === 'completed' ? 'Finalizado com sucesso!' :
                   'Erro ao processar'}
                </p>
              </div>
            </div>
            {task.status === 'completed' && (
              <div className="w-6 h-6 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500">
                <CheckCircle2 size={14} />
              </div>
            )}
          </motion.div>
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
      <Header setScreen={setScreen} title="Biblioteca" subtitle="Materiais prontos para download" profile={profile} notifications={notifications} setNotifications={setNotifications} />

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
      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar pb-1">
        {[['all','Todos'],['slides','Slides'],['activities','Atividades'],['exam','Provas'],['plan','Planos']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex-shrink-0 transition-colors ${filter===v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>
            {l}
          </button>
        ))}
      </div>

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
          {filtered.map(item => {
            const meta = typeMeta[item.type] || typeMeta.activities;
            return (
              <div key={item.id} className="bg-white rounded-2xl p-4 border border-gray-50 shadow-sm">
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
              </div>
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
    const id = Math.random().toString(36).substr(2, 9);
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
    } catch (e: any) { toast.error(e?.message || 'Algo deu errado. Tente de novo.'); }
  };
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const unsubFeedbacks = onSnapshot(collection(db, 'feedback'), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFeedbacks(items.sort((a: any, b: any) => b.date - a.date));
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching feedback:", error);
      setIsLoading(false);
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSysUsers(items.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || '')));
      setUsersError('');
    }, (error) => {
      console.error("Error fetching users:", error);
      setUsersError('Sem permissão para listar usuários. Verifique as regras do Firestore.');
    });

    return () => {
      unsubFeedbacks();
      unsubUsers();
    };
  }, []);

  const togglePro = async (userId: string, currentStatus: boolean) => {
    try {
      await setDoc(doc(db, 'users', userId), { isPro: !currentStatus }, { merge: true });
    } catch (e) {
      console.error("Error toggling pro:", e);
    }
  };

  const toggleAdmin = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await setDoc(doc(db, 'users', userId), { role: newRole }, { merge: true });
    } catch (e) {
      console.error("Error toggling admin:", e);
    }
  };

  const resetGenerations = async (userId: string) => {
    try {
      await setDoc(doc(db, 'users', userId), { generationsUsed: 0 }, { merge: true });
    } catch (e) { console.error(e); }
  };

  const saveAnnouncement = async () => {
    setAnnouncementSaving(true);
    try {
      await setDoc(doc(db, 'config', 'announcement'), { message: announcement, active: announcementActive, updatedAt: Date.now() });
    } catch (e) { console.error(e); } finally { setAnnouncementSaving(false); }
  };

  const saveHoliday = async () => {
    if (!newHoliday.name.trim() || !newHoliday.date) return;
    setHolidaySaving(true);
    try {
      const newList = [...holidays, { id: Math.random().toString(36).slice(2), ...newHoliday }];
      await setDoc(doc(db, 'config', 'feriados'), { list: newList });
      setHolidays(newList);
      setNewHoliday({ name: '', date: '' });
    } catch (e) { console.error(e); } finally { setHolidaySaving(false); }
  };

  const deleteHoliday = async (id: string) => {
    const newList = holidays.filter(h => h.id !== id);
    try {
      await setDoc(doc(db, 'config', 'feriados'), { list: newList });
      setHolidays(newList);
    } catch (e) { console.error(e); }
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
  const expiredUsers = sysUsers.filter(u => !u.isPro && u.role !== 'admin' && (u.generationsUsed ?? 0) >= FREE_LIMIT).length;

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return sysUsers;
    return sysUsers.filter(u => (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
  }, [sysUsers, userSearch]);
  const usersPageCount = Math.ceil(filteredUsers.length / USERS_PAGE_SIZE);
  const pagedUsers = filteredUsers.slice(usersPage * USERS_PAGE_SIZE, (usersPage + 1) * USERS_PAGE_SIZE);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40 h-full flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-md">
          <Shield size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Painel Admin</h1>
          <p className="text-gray-500 text-sm">Gerenciamento do sistema</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-2xl p-3 text-center border border-gray-100 shadow-sm">
          <p className="text-2xl font-black text-indigo-600">{totalUsers}</p>
          <p className="text-xs text-gray-500 font-medium">Usuários</p>
        </div>
        <div className="bg-white rounded-2xl p-3 text-center border border-gray-100 shadow-sm">
          <p className="text-2xl font-black text-emerald-600">{proUsers}</p>
          <p className="text-xs text-gray-500 font-medium">PRO</p>
        </div>
        <div className="bg-white rounded-2xl p-3 text-center border border-gray-100 shadow-sm">
          <p className="text-2xl font-black text-red-500">{expiredUsers}</p>
          <p className="text-xs text-gray-500 font-medium">Expirados</p>
        </div>
      </div>

      <div className="flex bg-gray-200/50 p-1 rounded-xl mb-6 shadow-sm gap-1 overflow-x-auto no-scrollbar">
        {(['users','feedbacks','biblioteca','metrics','holidays'] as const).map(tab => {
          const labels: Record<string, string> = { users: 'Usuários', feedbacks: 'Feedbacks', biblioteca: 'Biblioteca', metrics: 'Métricas', holidays: 'Feriados' };
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-none px-3 py-2 text-xs font-bold rounded-lg transition-colors whitespace-nowrap ${activeTab === tab ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'}`}>
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {activeTab === 'feedbacks' && (
        <div className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-gray-50 mb-8 flex-1 flex flex-col">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <MessageSquare size={20} className="text-indigo-600" />
            Feedbacks dos Usuários
          </h2>

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="animate-spin text-indigo-600" size={32} />
            </div>
          ) : feedbacks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
              <MessageSquare size={48} className="mb-4 opacity-20" />
              <p>Nenhum feedback recebido ainda.</p>
            </div>
          ) : (
            <div className="space-y-4 overflow-y-auto no-scrollbar flex-1">
              {feedbacks.map((fb) => (
                <div key={fb.id} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-bold text-gray-900 text-sm">{fb.name || 'Usuário Anônimo'}</p>
                      <p className="text-xs text-gray-500">{fb.email || 'Sem e-mail'}</p>
                    </div>
                    <span className="text-xs text-gray-400 bg-white px-2 py-1 rounded-lg border border-gray-100">
                      {new Date(fb.date).toLocaleDateString('pt-BR')} {new Date(fb.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-gray-700 text-sm mt-2">{fb.text}</p>
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
              <p className="text-xs text-red-500 font-medium mt-1">⚠ Espaço quase esgotado — apague materiais antigos</p>
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
        <div className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-gray-50 mb-8 flex-1 flex flex-col">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Shield size={20} className="text-indigo-600" />
            Gerenciamento de Usuários
          </h2>

          {usersError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium">
              {usersError}
            </div>
          )}

          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={userSearch}
              onChange={e => { setUserSearch(e.target.value); setUsersPage(0); }}
              placeholder="Buscar por nome ou e-mail…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div className="space-y-3 overflow-y-auto no-scrollbar flex-1">
            {pagedUsers.map(u => {
              const trialStatus = getUsageStatus(u);
              const isAdmin = u.role === 'admin';
              return (
                <div key={u.id} className="p-3 border border-gray-100 rounded-xl bg-gray-50">
                  <div className="flex items-start justify-between gap-2 mb-2">
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
                      onClick={() => togglePro(u.id, u.isPro)}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${u.isPro ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-400 hover:text-emerald-600'}`}
                    >
                      {u.isPro ? 'PRO ATIVO' : 'ATIVAR PRO'}
                    </button>
                    <button
                      onClick={() => toggleAdmin(u.id, u.role)}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${isAdmin ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-400 hover:text-indigo-600'}`}
                    >
                      {isAdmin ? 'ADMIN ATIVO' : 'DAR ADMIN'}
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
                        const cost = ((u.inputTokens || 0) * 0.075 / 1_000_000 + (u.outputTokens || 0) * 0.30 / 1_000_000) * 5.2;
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
            const inputCost = (globalStats.totalInputTokens || 0) * 0.075 / 1_000_000;
            const outputCost = (globalStats.totalOutputTokens || 0) * 0.30 / 1_000_000;
            const totalCostUSD = inputCost + outputCost;
            const totalCostBRL = totalCostUSD * 5.2;
            return (
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-50">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><span>💰</span> Custo Real da API</h3>
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
            const currentCost = current ? (current.inp * 0.075 + current.out * 0.30) / 1_000_000 : 0;
            const maxCostMonth = Math.max(...monthlyStats.map(m => (m.inp * 0.075 + m.out * 0.30) / 1_000_000), 0.000001);
            return (
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-50">
                <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2"><span>📅</span> Consumo Mensal</h3>
                <p className="text-xs text-gray-400 mb-3">Últimos 6 meses · custo estimado em USD</p>
                {current && (
                  <div className="bg-indigo-50 rounded-2xl p-3 mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-indigo-500 font-medium">Mês atual</p>
                      <p className="text-2xl font-black text-indigo-700">${currentCost.toFixed(5)}</p>
                      <p className="text-xs text-indigo-400">{current.gens.toLocaleString()} gerações · {(current.inp + current.out).toLocaleString()} tokens</p>
                    </div>
                    <span className="text-3xl">🦉</span>
                  </div>
                )}
                <div className="flex items-end gap-2 h-24">
                  {monthlyStats.map((m, i) => {
                    const cost = (m.inp * 0.075 + m.out * 0.30) / 1_000_000;
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
                const cost = (inp * 0.075 + out * 0.30) / 1_000_000;
                return { name: u.displayName || u.email || u.id, cost, inp, out };
              })
              .filter(u => u.cost > 0)
              .sort((a, b) => b.cost - a.cost)
              .slice(0, 10);
            if (usersWithCost.length === 0) return null;
            const maxCost = usersWithCost[0].cost;
            return (
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-50">
                <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2"><span>📊</span> Top Consumidores (API)</h3>
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
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><span>⚖️</span> Input vs Output</h3>
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
            <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><span>📢</span> Aviso Global</h3>
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
        <div className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-gray-50 mb-8">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><span>🎉</span> Feriados Globais</h3>
          <p className="text-xs text-gray-400 mb-4">Aparecem no calendário de todos os professores automaticamente.</p>

          <div className="space-y-2 mb-4">
            {holidays.sort((a,b) => a.date.localeCompare(b.date)).map(h => (
              <div key={h.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <p className="text-sm font-bold text-gray-900">{h.name}</p>
                  <p className="text-xs text-gray-500">{new Date(h.date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                </div>
                <button onClick={() => deleteHoliday(h.id)} className="text-red-400 hover:text-red-600 p-1">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
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
            <input
              type="date"
              value={newHoliday.date}
              onChange={e => setNewHoliday(h => ({...h, date: e.target.value}))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
            />
            <button onClick={saveHoliday} disabled={holidaySaving || !newHoliday.name.trim() || !newHoliday.date}
              className="w-full bg-indigo-600 text-white font-bold py-3 rounded-2xl disabled:opacity-50">
              {holidaySaving ? 'Salvando...' : '+ Adicionar feriado'}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
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
  const [globalAnnouncement, setGlobalAnnouncement] = useState<{message:string,active:boolean}|null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'config', 'announcement')).then(snap => {
      if (snap.exists() && snap.data().active) setGlobalAnnouncement(snap.data() as any);
    }).catch(() => {});
  }, [user]);

  const [screen, setScreen] = useState<Screen>('home');
  const [plannerMode, setPlannerMode] = useState<PlannerMode>('plan');
  const [selectedDate, setSelectedDate] = useState<number>(new Date().getDate());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  
  // Background Task Management
  const [activeTasks, setActiveTasks] = useState<Record<string, BackgroundTask>>({});
  
  const addTask = (task: Omit<BackgroundTask, 'id' | 'status' | 'startTime'>): string => {
    const id = Math.random().toString(36).substr(2, 9);
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
          const newState = { ...prev };
          delete newState[id];
          return newState;
        });
      }, 8000);
    }
  };

  // Watchdog: any task processing for more than 90s is auto-failed.
  // Prevents the UI from being stuck in "loading" forever if a Promise hangs silently.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      Object.values(activeTasks).forEach(task => {
        const limit = task.type === 'plan' ? 150000 : 90000;
        if (task.status === 'processing' && now - task.startTime > limit) {
          console.warn(`Task ${task.id} (${task.type}) stuck > ${limit / 1000}s — auto-failing.`);
          updateTask(task.id, { status: 'error', error: 'A geração demorou demais e foi cancelada. Tente novamente.' });
        }
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [activeTasks]);

  const [profile, setProfile] = useFirestoreDoc<UserProfile>(
    user ? `users/${user.uid}` : 'users/temp',
    user,
    {
      name: 'Prof. Silva',
      subject: 'História • Ensino Fundamental II',
      photo: 'https://i.ibb.co/9mG1MVP1/20260417-114358-0000.png'
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
    [...autoNotifications, ...notifications].sort((a, b) => b.date - a.date),
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

  // ── Onboarding ────────────────────────────────────────────────────────────
  const [onboardingStep, setOnboardingStep] = useState<0 | 1 | 2>(0);
  const [onboardingName, setOnboardingName] = useState('');
  const [onboardingClass, setOnboardingClass] = useState({ name: '', subject: '', school: '', shift: 'Manhã', level: 'Ensino Fundamental II' });

  // Show onboarding only for genuinely new users: no onboarded flag AND still has the default name
  const showOnboarding = !!user && !profile.onboarded && profile.name === 'Prof. Silva';

  const finishOnboarding = async (skipClass = false) => {
    const newName = onboardingName.trim() || 'Professor';
    const updates: Partial<UserProfile> = { name: newName, onboarded: true };
    setProfile({ ...profile, ...updates } as UserProfile);
    if (!skipClass && onboardingClass.name.trim()) {
      const newClass: ClassSchedule = {
        id: Math.random().toString(36).substr(2, 9),
        name: onboardingClass.name,
        days: [1, 2, 3, 4, 5],
        time: '08:00',
        subject: onboardingClass.subject || undefined,
        school: onboardingClass.school || undefined,
        shift: onboardingClass.shift || undefined,
        level: onboardingClass.level,
      };
      setSchedules([...schedules, newClass]);
    }
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
  const [plannerResources, setPlannerResources] = useState<{type: 'activities' | 'slides' | 'exam', content: string}[]>([]);
  
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
        const newResourceId = Math.random().toString(36).substr(2, 9);
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
        if (saved) {
          const typeLabel = task.type === 'slides' ? 'Slides' : task.type === 'activities' ? 'Atividades' : task.type === 'exam' ? 'Prova' : 'Plano de Aula';
          setInboxMessages(prev => [...prev, {
            id: Math.random().toString(36).substr(2, 9),
            role: 'model' as const,
            text: `${typeLabel} sobre "${topicLabel}" gerado com sucesso.`,
            date: Date.now()
          }]);
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
            name: email.split('@')[0],
            email: email.toLowerCase().trim(),
            role: 'user',
            isPro: false,
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
    if (profile?.role === 'admin' || user?.email?.toLowerCase() === 'lyelsonmf520@gmail.com') return false;
    if (profile?.isPro) return false;
    return (profile?.generationsUsed ?? 0) >= FREE_GENERATION_LIMIT;
  }, [user, profile]);

  const recordGeneration = async () => {
    if (!user) return;
    const isPrivileged = profile?.isPro || profile?.role === 'admin';
    const inputT = _pendingInputTokens; const outputT = _pendingOutputTokens;
    _pendingInputTokens = 0; _pendingOutputTokens = 0;
    try {
      const userUpdate: any = { generationsUsed: increment(1) };
      if (!isPrivileged) { userUpdate.inputTokens = increment(inputT); userUpdate.outputTokens = increment(outputT); }
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
    return (
      <div 
        className="min-h-screen bg-cover bg-center flex flex-col items-center justify-center p-6 relative"
        style={{ backgroundImage: 'url(https://i.ibb.co/XZyfzNYw/Design-sem-nome-20260426-213935-0000.png)' }}
      >
        <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-6">
          <h1 className="text-4xl font-black text-black tracking-wider drop-shadow-sm text-center">
            Prof. Corujão
          </h1>
          <form onSubmit={isResetMode ? handleResetPassword : handleEmailAuth} className="w-full bg-white p-6 rounded-3xl shadow-xl flex flex-col gap-4 mb-4">
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
            
            <input
              type="email"
              placeholder="Seu e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
            
            {!isResetMode && (
              <div className="flex flex-col gap-2">
                <input
                  type="password"
                  placeholder="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
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
              className={`w-full text-white font-bold py-3 px-6 rounded-xl shadow-md transition-colors ${isAuthProcessing ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
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
          </form>
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
      id: Math.random().toString(36).substr(2, 9),
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
        id: Math.random().toString(36).substr(2, 9),
        role: 'model',
        text: `Vi que você adicionou a turma **${newClass.name}**${newClass.level ? ` (${newClass.level})` : ''}! Quer que eu monte uma sugestão de planejamento anual para eles baseada na BNCC da sua disciplina?`,
        date: Date.now()
      }
    ]);
    setNotifications(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      title: 'Nova Turma Adicionada',
      message: `A turma ${newClass.name} foi adicionada ao seu calendário.`,
      date: Date.now(),
      read: false
    }]);
  };

  const getSlidesPrompt = (topicText: string, className: string, tone: string, complexity: string, focus: string, groundingContent: string, slideCount: number) => `Você é um Diretor de Arte Sênior. Sua tarefa é analisar o conteúdo do usuário e transformá-lo em uma apresentação de ${slideCount} slides sobre "${topicText}". 
        Turma: "${className}"
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
        - Use pelo menos 4 layouts diferentes para variar o ritmo visual.
        - Use LAYOUT_QUOTE, LAYOUT_FULL_IMAGE ou LAYOUT_STATS para criar momentos de impacto.
        - Use LAYOUT_TIMELINE para conteúdos históricos ou sequenciais.
        - Use LAYOUT_TWO_COLUMNS para comparações ou definições contrastantes.
        - Paleta de NO MÁXIMO 3 CORES (Primária, Acento, Fundo) — escolha cores profissionais adequadas ao tema.
        - ALTO CONTRASTE: nunca texto claro sobre fundo claro.
        - FORMATAÇÃO DE TEXTO RICA (use obrigatoriamente nos campos "text", "column1", "column2"):
            **palavra** → negrito estratégico para termos-chave
            ==palavra== → marca-texto com cor de acento (use em definições e conceitos centrais)
            [[palavra]] → palavra-chave colorida em destaque primário (2-3 por slide máximo)
            {IconName} → ícone Lucide inline antes de tópicos (ex: {Target} Objetivo, {Brain} Conceito)
            ## Subtítulo → subtítulo dentro do corpo para hierarquia visual
        - Combine as marcações: ex: {Target} **[[Objetivo]]**: ==aprender a== estrutura...
        - NUNCA use emojis. Para icons, use nomes do Lucide-React (ex: 'Brain', 'TrendingUp', 'Globe', 'Target', 'CheckCircle', 'AlertTriangle', 'Lightbulb').
        - illustrationQuery: 2-3 palavras-chave em inglês (ex: 'science lab', 'ancient rome').

        SAÍDA: JSON estrito (sem Markdown ao redor):
        {
          "presentationTitle": "...",
          "theme": { "primaryColor": "#hex", "accentColor": "#hex", "backgroundColor": "#hex", "fontTitle": "...", "fontBody": "..." },
          "slides": [
            { "layoutID": "LAYOUT_COVER",        "data": { "title": "...", "subtitle": "...", "illustrationQuery": "..." } },
            { "layoutID": "LAYOUT_QUOTE",         "data": { "title": "...", "quote": "...", "author": "..." } },
            { "layoutID": "LAYOUT_TWO_COLUMNS",   "data": { "title": "...", "column1": "...", "column2": "..." } },
            { "layoutID": "LAYOUT_FULL_IMAGE",    "data": { "title": "...", "subtitle": "...", "illustrationQuery": "..." } },
            { "layoutID": "LAYOUT_STATS",         "data": { "title": "...", "stats": [{ "value": "...", "label": "...", "icon": "..." }] } },
            { "layoutID": "LAYOUT_TIMELINE",      "data": { "title": "...", "events": [{ "year": "...", "title": "...", "description": "..." }] } },
            { "layoutID": "LAYOUT_TOPICS",        "data": { "title": "...", "topics": [{ "title": "...", "content": "...", "icon": "..." }] } },
            { "layoutID": "LAYOUT_CONTENT_LEFT",  "data": { "title": "...", "text": "...", "illustrationQuery": "..." } },
            { "layoutID": "LAYOUT_REFERENCES",    "data": { "title": "Referências", "references": ["..."] } }
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

    while (addedCount < duration && maxIterations > 0) {
      if (selectedClass.days.includes(currentDate.getDay())) {
         const collision = avoidCollisions && isDayOccupied(currentDate);
         
         if (!collision) {
            newItems.push({
              id: Math.random().toString(36).substr(2, 9),
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

      // ── Solução 2: selecionar habilidades BNCC do banco local ──────────────
      const bnccSkills = selectBnccSkills(selectedClass?.subject || profile.subject || '', className, targetTopic, 4);
      const bnccBlock  = bnccSkills.length > 0
        ? bnccSkills.map(s => `- ${s.code} — ${s.desc}`).join('\n')
        : '- [escolha habilidades BNCC reais para a disciplina e série]';

      // ── Solução 1: injetar habilidades reais no prompt ──────────────────
      const prompt = `Você é um pedagogo especialista. Gere um PLANO DE AULA completo e profissional.
Tópico: "${targetTopic}" | Turma: "${className}" | Turno: ${plannerTurn.charAt(0).toUpperCase() + plannerTurn.slice(1)} | Tom: ${toneMap[plannerTone]} | Complexidade: ${complexityMap[plannerComplexity]} | Foco: ${focusMap[plannerFocus]}
Quantidade de aulas: ${plannerDuration} | Duração por aula: ${plannerLessonTime} min (abertura: ${abertura}min · desenvolvimento: ${desenvolvimento}min · fechamento: ${fechamento}min)

Responda SOMENTE com as seções abaixo em Markdown, substituindo todos os campos [ ] por conteúdo real e pertinente.
PROIBIDO: introduções, saudações, comentários, tabelas Markdown (| coluna |) ou qualquer texto fora da estrutura abaixo.

## ÁREA DE CONHECIMENTO
[Área — ex: Ciências da Natureza, Linguagens, Matemática, Ciências Humanas, Ensino Religioso]

## EIXO/UNIDADE TEMÁTICA
[Eixo temático ou unidade curricular que abrange "${targetTopic}"]

## CONTEÚDO
[Lista dos conteúdos a serem trabalhados na(s) aula(s)]

## OBJETIVOS
[Lista de objetivos de aprendizagem em verbos de ação — identificar, analisar, comparar, produzir, etc.]

## PERGUNTAS MOBILIZADORAS DE APRENDIZAGEM
[2 ou 3 perguntas que orientam e motivam a aprendizagem sobre "${targetTopic}"]

## METODOLOGIA
[Sequência didática detalhada:
• Abertura (${abertura}min): estratégia de motivação ou levantamento de conhecimentos prévios
• Desenvolvimento (${desenvolvimento}min): sequência de atividades com metodologia ativa, explicação e fixação
• Fechamento (${fechamento}min): síntese, avaliação formativa e consolidação]

## Habilidade (BNCC)
USE OBRIGATORIAMENTE as habilidades abaixo (são códigos reais verificados). Copie os códigos exatamente:
${bnccBlock}

## RECURSOS DIDÁTICOS
[Lista de recursos necessários — ex: quadro branco, projetor, materiais manipulativos, textos]

## AVALIAÇÃO
[Instrumento de avaliação e critérios — ex: observação, lista de exercícios, portfólio, rubricas]

## REFERÊNCIAS
[2 ou 3 referências bibliográficas em formato ABNT]`;

      const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt });
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
          const correctSection = `## Habilidade (BNCC)\n${bnccBlock}`;
          planResult = planDraft.replace(
            /## Habilidade \(BNCC\)[\s\S]*?(?=\n## |\n---|\n#[^#]|$)/,
            correctSection + '\n'
          );
        }
      }

      setPlannerPlan(planResult);
      updateTask(taskId, { status: 'completed', result: planResult });
      recordGeneration();
    } catch (error) {
      updateTask(taskId, { status: 'error', error: formatApiError(error, 'Nao consegui montar o plano dessa vez. Tente novamente.') });
    }
  };

  const generateResource = async (type: 'activities' | 'slides' | 'exam', optTopic?: string, optClassId?: string) => {
    const targetTopic = optTopic || plannerTopic;
    const targetClassId = optClassId || plannerSelectedClassId;
    if (!targetTopic.trim()) return;
    if (isLimitReached) return;

    const taskId = addTask({ type, title: `${type === 'slides' ? 'Slides' : 'Atividades'}: ${targetTopic}` });
    try {
      const selectedClass = schedules.find(c => c.id === targetClassId);
      const className = selectedClass ? selectedClass.name : 'Geral';

      if (type === 'slides') {
        const prompt = getSlidesPrompt(targetTopic, className, plannerTone, plannerComplexity, plannerFocus, plannerGroundingContent, plannerSlideCount);
        const response = await generateContentWithRetry({ model: AI_MODEL, contents: prompt });
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
        
        const complexityLabel = { basic: 'Básico (Ensino Fundamental)', intermediate: 'Intermediário (Ensino Médio)', advanced: 'Avançado (Superior/Técnico)' }[plannerComplexity] || plannerComplexity;
        const mcPts  = parseFloat((plannerExamValue / 10).toFixed(1));
        const dissPts = parseFloat((plannerExamValue / 4).toFixed(1));
        const examDurStr = plannerExamDuration < 60 ? `${plannerExamDuration} min` : plannerExamDuration === 60 ? '1 hora' : `${Math.floor(plannerExamDuration/60)}h${plannerExamDuration%60 > 0 ? plannerExamDuration%60+'min' : ''}`;

        const qtLabel: Record<string, string> = { mista: 'Varie os tipos entre as questões: múltipla escolha, completar lacunas, V/F com justificativa, relacionar colunas, produção textual ou resolução de problema.', multipla_escolha: 'Todas as questões são de MÚLTIPLA ESCOLHA com 4 alternativas (A, B, C, D), apenas uma correta.', dissertativa: 'Todas as questões são DISSERTATIVAS (resposta aberta), com 5 linhas de resposta.' };
        const qtInstruction = qtLabel[plannerQuestionType] || qtLabel.mista;

        const prompt = type === 'exam'
          ? `Você é um professor especialista. Gere uma AVALIAÇÃO FORMAL sobre "${targetTopic}" para a turma "${className}" (nível: ${complexityLabel}).
Valor total: ${plannerExamValue} pontos | Tempo: ${examDurStr}

ESTRUTURA OBRIGATÓRIA — siga EXATAMENTE (substitua tudo entre [ ] por conteúdo real):

# Avaliação: ${targetTopic}

## Parte I — Questões de Múltipla Escolha *(${mcPts} pts cada — total: ${(mcPts*5).toFixed(1)} pts)*

**Questão 1 (${mcPts} pts)** [enunciado claro e objetivo]

( ) A) [alternativa incorreta]
( ) B) [alternativa correta]
( ) C) [alternativa incorreta]
( ) D) [alternativa incorreta]

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

REGRAS: Substitua TODOS os [ ] por conteúdo real sobre "${targetTopic}". PROIBIDO introduções, tabelas Markdown (| coluna |) ou texto fora da estrutura.`
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
      updateTask(taskId, { status: 'error', error: formatApiError(error, 'Esse material nao saiu como esperado. Tente novamente.') });
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FE] font-sans text-gray-900 selection:bg-indigo-100 selection:text-indigo-900">
      <ToastContainer />

      {globalAnnouncement?.active && globalAnnouncement.message && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-indigo-600 text-white text-sm font-medium px-4 py-2 flex items-center justify-between shadow-lg">
          <span className="flex-1 text-center">{globalAnnouncement.message}</span>
          <button onClick={() => setGlobalAnnouncement(null)} className="ml-2 text-white/70 hover:text-white"><X size={16} /></button>
        </div>
      )}

      {/* ── Onboarding Modal ───────────────────────────────────────────── */}
      {showOnboarding && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-end justify-center p-0">
          <div className="bg-white w-full max-w-md rounded-t-[2.5rem] p-6 pb-10 shadow-2xl">
            {onboardingStep === 0 && (
              <>
                <div className="flex flex-col items-center text-center mb-6">
                  <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mb-3">
                    <span className="text-3xl">🦉</span>
                  </div>
                  <h2 className="text-2xl font-black text-gray-900">Bem-vindo ao Prof. Corujão!</h2>
                  <p className="text-sm text-gray-500 mt-1">Vamos configurar seu perfil em 2 passos rápidos.</p>
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
                    onClick={() => finishOnboarding(false)}
                    disabled={!onboardingClass.name.trim() || !onboardingClass.subject}
                    className="flex-[2] bg-indigo-600 text-white rounded-2xl py-3.5 text-sm font-bold disabled:opacity-40"
                  >
                    Começar →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="max-w-md mx-auto h-screen relative px-6 pt-12 overflow-y-auto no-scrollbar">
        <AnimatePresence mode="wait">
          {screen === 'home' && <HomeScreen key="home" setScreen={setScreen} setPlannerMode={setPlannerMode} classes={classes} setClasses={setClasses} profile={profile} inboxMessages={inboxMessages} notifications={allNotifications} setNotifications={handleSetNotifications} setSelectedDate={(d: Date) => {
            setSelectedDate(d.getDate());
            setCurrentMonth(d.getMonth());
            setCurrentYear(d.getFullYear());
          }} />}
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
            plannerResources={plannerResources}
            setPlannerResources={setPlannerResources}
            plannerActivity={plannerActivity}
            setPlannerActivity={setPlannerActivity}
            plannerExam={plannerExam}
            setPlannerExam={setPlannerExam}
            setSavedResources={(res) => {
              setSavedResources(res);
              if (res.length > savedResources.length) {
                setNotifications([...notifications, {
                  id: Math.random().toString(36).substr(2, 9),
                  title: 'Material Salvo',
                  message: 'Novo material gerado com sucesso.',
                  date: Date.now(),
                  read: false
                }]);
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
          {screen === 'calendar' && <CalendarScreen key="calendar" classes={classes} setClasses={setClasses} schedules={schedules} profile={profile} inboxMessages={inboxMessages} customEvents={customEvents} setCustomEvents={setCustomEvents} selectedDate={selectedDate} setSelectedDate={setSelectedDate} currentMonth={currentMonth} setCurrentMonth={setCurrentMonth} currentYear={currentYear} setCurrentYear={setCurrentYear} setScreen={setScreen} notifications={allNotifications} setNotifications={handleSetNotifications} />}
          {screen === 'dayDetail' && <DayDetailScreen key="dayDetail" 
            schedules={schedules} 
            selectedDate={selectedDate} 
            currentMonth={currentMonth} 
            currentYear={currentYear} 
            allEvents={[...classes.map(c => ({...c, type: 'class' as const})), ...customEvents, ...getDefaultHolidays(currentYear).filter(h => !customEvents.some(ce => ce.title === h.title && ce.date.startsWith(h.date.split(' ')[0])))]} 
            setScreen={setScreen} 
            setCustomEvents={setCustomEvents}
            setClasses={setClasses}
          />}
          {screen === 'profile' && <ProfileScreen key="profile" user={user} schedules={schedules} setSchedules={setSchedules} profile={profile} setProfile={setProfile} savedResources={savedResources} setScreen={setScreen} onAddClass={handleAddClassWithTrigger} customEvents={customEvents} setCustomEvents={setCustomEvents} notifications={allNotifications} setNotifications={handleSetNotifications} onResetAccount={() => {
            setSchedules([]);
            setClasses([]);
            setCustomEvents([]);
            setSavedResources([]);
            setNotifications([]);
            setInboxMessages([{ id: 'welcome', role: 'model', text: 'Olá! Eu sou o assistente do **Prof. Corujão**. Envie ideias rápidas, lembretes ou faça perguntas. Eu organizo tudo para você!', date: Date.now() }]);
            setProfile({ name: 'Professor', subject: 'Sem disciplina', role: 'user', photo: 'https://i.ibb.co/9mG1MVP1/20260417-114358-0000.png' });
            setEstudioContext('');
          }} />}
          {screen === 'estudio' && <EstudioScreen key="estudio" estudioContext={estudioContext} setEstudioContext={setEstudioContext} studioMessages={studioMessages} setStudioMessages={setStudioMessages} profile={profile} setScreen={setScreen} setPlannerMode={setPlannerMode} notifications={allNotifications} setNotifications={handleSetNotifications} schedules={schedules} />}
          {screen === 'biblioteca' && <LibraryScreen key="biblioteca" user={user} setScreen={setScreen} profile={profile} notifications={allNotifications} setNotifications={handleSetNotifications} />}
          {screen === 'admin' && (profile?.role === 'admin' || user?.email?.toLowerCase() === 'lyelsonmf520@gmail.com') && <AdminScreen key="admin" />}
        </AnimatePresence>

        <GlobalTaskIndicator 
          tasks={activeTasks} 
          onTaskClick={(task) => {
            if (task.type === 'plan') setPlannerMode('plan');
            else if (task.type === 'slides') setPlannerMode('slides');
            else if (task.type === 'activities') setPlannerMode('activities');
            else if (task.type === 'exam') setPlannerMode('exam');
            setScreen('planner');
            removeTask(task.id);
          }} 
        />
        <BottomNav activeScreen={screen} setScreen={setScreen} isAdmin={profile?.role === 'admin' || user?.email?.toLowerCase() === 'lyelsonmf520@gmail.com'} />
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
