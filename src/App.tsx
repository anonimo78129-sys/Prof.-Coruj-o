import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import * as LucideIcons from 'lucide-react';
import { 
  Search, Bell, Home, Calendar as CalendarIcon, User,
  MoreHorizontal, Play, Clock, CheckCircle2, ChevronRight, ChevronUp, ChevronDown,
  Sparkles, BookOpen, FileText, Presentation, GripVertical,
  Settings, Plus, Send, Loader2, FileQuestion, Image as ImageIcon,
  BrainCircuit, Layers, MessageCircle, MessageSquare, Camera, Database, Archive, Download, FileUp, Headphones, Square, Upload, Paperclip, Shield, LogOut, Trash2,
  MapPin, RefreshCw, ClipboardList, Coffee, Users, Library, Filter, HardDrive, FolderOpen
} from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import pptxgen from 'pptxgenjs';
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ShadingType, PageOrientation } from 'docx';
import { auth, db, storage, logOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch, getDoc, increment } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { selectBnccSkills } from './bncc-data';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("CRITICAL: GEMINI_API_KEY está ausente no ambiente!");
}
const ai = new GoogleGenAI({ apiKey: apiKey || 'fake-key-para-evitar-crash' });

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
    return 'Alta demanda nos servidores da IA. Estamos tentando novamente de forma automática... Se persistir, aguarde 1 minuto.';
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return 'Limite de requisições atingido. Por favor, aguarde alguns instantes antes de tentar novamente.';
  }
  return defaultMsg;
};

const withRetry = async <T,>(fn: () => Promise<T>, maxRetries = 4, baseDelayMs = 2000): Promise<T> => {
  let attempt = 0;
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

      if ((is503 || is429) && attempt < maxRetries) {
        const delay = (baseDelayMs * Math.pow(2, attempt - 1)) + (Math.random() * 1000);
        console.warn(`API overloaded (${is503 ? '503' : '429'}). Retrying in ${Math.round(delay)}ms... (Attempt ${attempt} of ${maxRetries})`);
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

const generateContentWithRetry = async (params: Parameters<typeof ai.models.generateContent>[0]) => {
  if (!apiKey) {
    throw new Error('Chave da IA não configurada. Contate o suporte.');
  }
  if (params.model === 'gemini-2.5-flash') {
    params.model = 'gemini-3-flash-preview';
  }
  return withRetry(() => withTimeout(ai.models.generateContent(params), 60000, 'geração de conteúdo'));
};

const generateImagesWithRetry = async (params: Parameters<typeof ai.models.generateImages>[0]) => {
  return withRetry(() => ai.models.generateImages(params));
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
      alert("Falha de conexão: As alterações não foram salvas na nuvem.");
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
      alert("Falha de conexão: As alterações não foram salvas na nuvem.");
    }
  };

  return [data, updateData];
}

// --- Helper Components ---
const DynamicIcon = ({ name, size = 20, color = 'currentColor', className = '' }: { name: string, size?: number, color?: string, className?: string }) => {
  // Normalize icon name (e.g., "BrainCircuit" or "brain-circuit")
  const normalizedName = name.charAt(0).toUpperCase() + name.slice(1).replace(/-([a-z])/g, (g) => g[1].toUpperCase());
  const IconComponent = (LucideIcons as any)[normalizedName] || LucideIcons.HelpCircle;
  return <IconComponent size={size} color={color} className={className} />;
};

const pixabayCache = new Map<string, string>();

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
  subject: string;
  photo: string;
  schoolName?: string;
  role?: string;
  email?: string;
  isPro?: boolean;
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
          <span className={`text-[9px] font-bold tracking-wider ${activeScreen === item.id ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'}`}>{item.label}</span>
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
                notifications.map(notification => (
                  <div key={notification.id} className={`cursor-pointer p-3 rounded-xl border ${notification.read ? 'bg-gray-50 border-gray-100' : 'bg-indigo-50 border-indigo-100/50'}`} onClick={() => {
                    if (setScreen) setScreen('calendar');
                    if (setNotifications) {
                      setNotifications(notifications.map(n => n.id === notification.id ? {...n, read: true} : n));
                    }
                    setShowNotifications(false);
                  }}>
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles size={14} className={notification.read ? 'text-gray-500' : 'text-indigo-600'} />
                      <p className={`text-sm font-bold ${notification.read ? 'text-gray-700' : 'text-indigo-900'}`}>{notification.title}</p>
                    </div>
                    <p className={`text-xs leading-relaxed ${notification.read ? 'text-gray-600' : 'text-indigo-700'}`}>{notification.message}</p>
                    <span className={`text-[10px] mt-2 block ${notification.read ? 'text-gray-400' : 'text-indigo-400'}`}>
                      {new Date(notification.date).toLocaleDateString()} às {new Date(notification.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                ))
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
    { title: 'Studio', illustration: 'https://i.ibb.co/vCp6TFqs/20260416-185756-0000.png', action: () => setScreen('estudio') },
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
  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          key="generate-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999]"
        >
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl flex flex-col max-h-[90vh]"
          >
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};