import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import * as LucideIcons from 'lucide-react';
import { 
  Search, Bell, Home, Calendar as CalendarIcon, User,
  MoreHorizontal, Play, Clock, CheckCircle2, ChevronRight, ChevronUp, ChevronDown,
  Sparkles, BookOpen, FileText, Presentation, GripVertical,
  Settings, Plus, Send, Loader2, FileQuestion, Image as ImageIcon,
  BrainCircuit, Layers, MessageCircle, MessageSquare, Camera, Database, Archive, Download, FileUp, Headphones, Square, Upload, Paperclip, Shield, LogOut, Trash2
} from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import pptxgen from 'pptxgenjs';
import { auth, db, logOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';

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

const withRetry = async <T,>(fn: () => Promise<T>, maxRetries = 10, baseDelayMs = 3000): Promise<T> => {
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
        const delay = (baseDelayMs * Math.pow(2, attempt - 1)) + (Math.random() * 1000); // Add jitter
        console.warn(`API overloaded (${is503 ? '503' : '429'}). Retrying in ${Math.round(delay)}ms... (Attempt ${attempt} of ${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries reached");
};

const generateContentWithRetry = async (params: Parameters<typeof ai.models.generateContent>[0]) => {
  // Auto-fix for hallucinated model version that might cause issues or demand spikes on older aliases
  if (params.model === 'gemini-2.5-flash') {
    params.model = 'gemini-3-flash-preview';
  }
  return withRetry(() => ai.models.generateContent(params));
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
      await setDoc(doc(db, docPath), { ...resolvedData, uid: user.uid, email: user.email || '' });
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
    const res = await fetch(url);
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
type Screen = 'home' | 'planner' | 'chat' | 'calendar' | 'dayDetail' | 'profile' | 'estudio' | 'acervo' | 'admin';
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
  layoutID: 'LAYOUT_COVER' | 'LAYOUT_CONTENT_LEFT' | 'LAYOUT_CONTENT_RIGHT' | 'LAYOUT_CONTENT_TOP' | 'LAYOUT_TOPICS' | 'LAYOUT_REFERENCES';
  data: {
    title?: string;
    subtitle?: string;
    text?: string;
    topics?: { title: string; content: string; icon: string }[];
    references?: string[];
    imagePrompt?: string;
    imageUrl?: string;
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
    { id: 'acervo', icon: Archive, label: 'Acervo' },
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
  getSuggestion,
  getScheduleBuffer,
  setPlannerMode
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
  getSuggestion: (topic?: string, classId?: string) => Promise<void>,
  getScheduleBuffer: (topic: string, duration: number, startDateStr: string, avoidCollisions: boolean, selectedClass: ClassSchedule, existingClasses: ClassItem[]) => ClassItem[],
  setPlannerMode: (m: PlannerMode) => void
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
  
  // Check if there is a global task running for this topic
  const isGeneratingTask = Object.values(activeTasks).some(t => 
    t.status === 'processing' && 
    (t.title.includes(topic) || t.type === mode)
  );

  const [loading, setLoading] = useState(isGeneratingTask);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(isGeneratingTask);
  }, [isGeneratingTask]);

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
  const profileName = profile.name;
  const profileSchoolName = profile.schoolName;

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
        
        LAYOUTS OBRIGATÓRIOS (Baseados em referência visual):
        1. LAYOUT_COVER: Capa. Título à esquerda, Subtítulo abaixo, Imagem à direita.
        2. LAYOUT_CONTENT_LEFT: Conteúdo. Título topo-esquerda, Texto denso abaixo, Imagem à direita.
        3. LAYOUT_CONTENT_RIGHT: Conteúdo Invertido. Imagem à esquerda, Título e Texto à direita.
        4. LAYOUT_CONTENT_TOP: Conteúdo Horizontal. Título e Texto no topo, Imagem larga na base.
        5. LAYOUT_TOPICS: Tópicos. Título topo-esquerda (estilo conteúdo), 3 colunas com ícone (nome de ícone do Lucide), título e texto curto.
        6. LAYOUT_REFERENCES: Referências. Título topo-esquerda, Lista de fontes, Fundo escuro.

        REGRAS DE DESIGN:
        - Mantenha um estilo visual consistente.
        - Se o tema permitir, use cores profissionais adequadas ao tópico.
        - Use uma paleta de NO MÁXIMO 3 CORES (Primária, Acento, Fundo).
        - Garanta ALTO CONTRASTE e LEITURA (evite cores claras sobre fundos claros).
        - Use **negrito** para termos importantes.
        - NUNCA use emojis.
        - Para 'topics', escolha ícones do Lucide-React (ex: 'Brain', 'Target', 'Lightbulb').
        - Para 'illustrationQuery', forneça apenas 2 ou 3 palavras-chave em inglês que descrevam uma ilustração ou cenário representativo para o slide (ex: 'science, technology', 'classroom, teaching'). Nenhuma palavra escrita na descrição.
        
        SAÍDA: JSON estrito (sem Markdown ao redor) com a estrutura:
        { 
          "presentationTitle": "...", 
          "theme": { 
            "primaryColor": "...", 
            "accentColor": "...", 
            "backgroundColor": "...", 
            "fontTitle": "...", 
            "fontBody": "..."
          }, 
          "slides": [ 
            { "layoutID": "...", "data": { "title": "...", "subtitle": "...", "text": "...", "imagePrompt": "...", "topics": [{ "title": "...", "content": "...", "icon": "..." }], "references": ["..."] } } 
          ] 
        }`;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
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
            model: 'gemini-3-flash-preview',
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
          alert(formatApiError(error, "Erro ao extrair texto do arquivo."));
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

  const parseMarkdown = (text: any, baseOpts: any) => {
    if (!text) return [];
    const strText = typeof text === 'string' ? text : (text.event || text.name || JSON.stringify(text));
    const parts = strText.split(/(\*\*.*?\*\*)/g);
    return parts.map((part: string) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return { text: part.slice(2, -2), options: { ...baseOpts, bold: true } };
      }
      return { text: part, options: baseOpts };
    });
  };

  const generateDirectResource = async (targetMode: 'activities' | 'slides' | 'exam') => {
    generateResource(targetMode);
  };

  const [isExporting, setIsExporting] = useState(false);

  const exportPPTX = async () => {
    if (!presentationData) return;
    setIsExporting(true);
    try {
      const pres = new pptxgen();
      pres.layout = 'LAYOUT_16x9';
      const theme = presentationData.theme;

      for (const slideData of presentationData.slides) {
        const slide = pres.addSlide();
        slide.background = { color: theme.backgroundColor };
        
        const titleOpts = { fontFace: theme.fontTitle, color: theme.primaryColor, bold: true };
        const bodyOpts = { fontFace: theme.fontBody, color: '333333', fontSize: 14 };

        if (slideData.layoutID === 'LAYOUT_COVER') {
          // Alignment: Left-aligned text group
          slide.addText(slideData.data.title || '', { x: 0.5, y: 1.2, w: 5, h: 2, fontSize: 44, ...titleOpts, align: 'left', valign: 'middle' });
          slide.addText(slideData.data.subtitle || '', { x: 0.5, y: 3.2, w: 5, h: 0.8, fontSize: 16, color: theme.accentColor, align: 'left' });
          
          // Balance: Large image on the right
          if (slideData.data.imageUrl || slideData.data.imagePrompt) {
            slide.addImage({ 
              path: slideData.data.imageUrl || getImageUrl(slideData.data.imagePrompt, 1200, 800),
              x: 5.8, y: 0.4, w: 3.8, h: 4.8 
            });
          }
        } else if (slideData.layoutID === 'LAYOUT_CONTENT_LEFT' || slideData.layoutID === 'LAYOUT_CONTENT_RIGHT') {
          const isLeft = slideData.layoutID === 'LAYOUT_CONTENT_LEFT';
          const textX = isLeft ? 0.5 : 4.5;
          const imgX = isLeft ? 6 : 0.5;

          // Hierarchy: Clear title vs body distinction
          slide.addText(slideData.data.title || '', { x: textX, y: 0.4, w: 5, h: 0.8, fontSize: 28, ...titleOpts });
          const parsedText = parseMarkdown(slideData.data.text || '', { ...bodyOpts, fontSize: 13, lineSpacing: 24 });
          slide.addText(parsedText, { x: textX, y: 1.4, w: 5, h: 3.8, valign: 'top', align: 'justify' });
          
          if (slideData.data.imageUrl || slideData.data.imagePrompt) {
            slide.addImage({ 
              path: slideData.data.imageUrl || getImageUrl(slideData.data.imagePrompt, 1200, 800),
              x: imgX, y: 0.4, w: 3.5, h: 4.8 
            });
          }
        } else if (slideData.layoutID === 'LAYOUT_CONTENT_TOP') {
          // White Space: Generous top margin
          slide.addText(slideData.data.title || '', { x: 0.5, y: 0.4, w: 9, h: 0.6, fontSize: 28, ...titleOpts });
          const parsedText = parseMarkdown(slideData.data.text || '', { ...bodyOpts, fontSize: 12, lineSpacing: 20 });
          slide.addText(parsedText, { x: 0.5, y: 1.1, w: 9, h: 1.4, valign: 'top', align: 'justify' });
          
          if (slideData.data.imageUrl || slideData.data.imagePrompt) {
            slide.addImage({ 
              path: slideData.data.imageUrl || getImageUrl(slideData.data.imagePrompt, 1200, 800),
              x: 0.5, y: 2.8, w: 9, h: 2.6 
            });
          }
        } else if (slideData.layoutID === 'LAYOUT_TOPICS') {
          // Repetition: Consistent column widths and spacing
          slide.addText(slideData.data.title || '', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 28, ...titleOpts });
          
          if (slideData.data.topics) {
            slideData.data.topics.forEach((topic, i) => {
              const xPos = 0.5 + (i * 3.1);
              // Proximity: Icon grouped with title and content in a contrasting circle
              slide.addShape(pres.ShapeType.ellipse, { x: xPos + 0.9, y: 1.4, w: 1.2, h: 1.2, fill: { color: theme.primaryColor } });
              slide.addText(topic.icon || 'ICON', { x: xPos + 0.9, y: 1.4, w: 1.2, h: 1.2, fontSize: 10, color: 'FFFFFF', align: 'center', bold: true });
              
              slide.addShape(pres.ShapeType.rect, { x: xPos, y: 2.8, w: 2.8, h: 2.5, fill: { color: theme.primaryColor, transparency: 95 } });
              slide.addText(topic.title, { x: xPos, y: 3.0, w: 2.8, h: 0.4, fontSize: 14, bold: true, align: 'center', color: theme.primaryColor });
              slide.addText(topic.content, { x: xPos + 0.1, y: 3.5, w: 2.6, h: 1.5, fontSize: 11, align: 'center', color: '#333333' });
            });
          }
        } else if (slideData.layoutID === 'LAYOUT_REFERENCES') {
          slide.background = { color: theme.primaryColor };
          slide.addText(slideData.data.title || 'Referências', { x: 0.5, y: 0.5, w: 5, h: 1, fontSize: 36, color: 'FFFFFF', bold: true });
          if (slideData.data.references) {
            const refText = slideData.data.references.map(r => ({ text: r, options: { bullet: true, breakLine: true, color: 'FFFFFF', fontSize: 14 } }));
            slide.addText(refText, { x: 0.5, y: 1.8, w: 8, h: 3.3, valign: 'top' });
          }
          slide.addShape(pres.ShapeType.rect, { x: 8.5, y: 2, w: 1, h: 1, fill: { color: theme.accentColor }, rotate: 15 });
          slide.addShape(pres.ShapeType.rect, { x: 7.5, y: 4, w: 0.5, h: 0.5, fill: { color: theme.accentColor, transparency: 50 } });
        }
      }
      await pres.writeFile({ fileName: `Aula_${presentationData.presentationTitle.replace(/\s+/g, '_')}.pptx` });
    } catch (e) {
      console.error(e);
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

            {/* --- Advanced Config Settings (collapsible) --- */}
            {(() => {
              const [advOpen, setAdvOpen] = useState(false);
              return (
                <div className="mb-6">
                  <button
                    type="button"
                    onClick={() => setAdvOpen(o => !o)}
                    className="w-full flex items-center justify-between text-sm font-bold text-gray-500 bg-gray-50 px-4 py-3 rounded-2xl"
                  >
                    <span>Personalizar geração</span>
                    {advOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <AnimatePresence>
                    {advOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="bg-gray-50 px-4 pb-4 rounded-b-2xl space-y-4 pt-2">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Linguagem do texto</label>
                              <select value={tone} onChange={(e) => setTone(e.target.value as any)} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
                                <option value="didactic">Didática</option>
                                <option value="formal">Formal</option>
                                <option value="technical">Técnica</option>
                                <option value="concise">Direta e curta</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Nível da turma</label>
                              <select value={complexity} onChange={(e) => setComplexity(e.target.value as any)} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
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
                                    <option value={1}>1 aula</option>
                                    <option value={2}>2 aulas</option>
                                    <option value={3}>3 aulas</option>
                                    <option value={4}>4 aulas</option>
                                    <option value={5}>5 aulas</option>
                                    <option value={6}>6 aulas</option>
                                    <option value={8}>8 aulas</option>
                                    <option value={10}>10 aulas</option>
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
                              </>
                            )}
                            {(mode === 'activities' || mode === 'exam') && (
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                  {mode === 'exam' ? 'Questões de múltipla escolha' : 'Quantidade de questões'}
                                </label>
                                <input type="number" min="1" max="20" value={questionCount} onChange={(e) => setQuestionCount(parseInt(e.target.value))} className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-sm" />
                              </div>
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
                            <select value={focus} onChange={(e) => setFocus(e.target.value as any)} className="w-full bg-indigo-600 text-white border-none rounded-xl py-2 px-3 text-sm font-bold">
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
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })()}

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
            <button 
              onClick={handleMainAction}
              disabled={loading || !topic || !selectedClassId}
              className="w-full bg-indigo-600 text-white rounded-2xl py-4 text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
            >
              {loading ? <Loader2 className="animate-spin" /> : <Sparkles size={20} />} 
              {loading ? loadingMessage : (mode === 'plan' ? (duration === 0 ? 'Analisar Conteúdo' : 'Gerar Plano') : mode === 'activities' ? 'Gerar Atividades' : mode === 'exam' ? 'Gerar Prova' : 'Gerar Slides')}
            </button>
            {error && <p className="text-red-500 text-sm mt-3 text-center font-medium">{error}</p>}
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
              <div className="mb-8 border-t border-gray-100 pt-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Apresentação</h3>
                <div className="flex flex-col gap-8 pb-4">
                  {presentationData.slides.map((slide, idx) => {
                    const theme = presentationData.theme;
                    
                    const updateSlideData = (newData: any) => {
                      setPresentationData({
                        ...presentationData,
                        slides: presentationData.slides.map((s, i) => i === idx ? { ...s, data: { ...s.data, ...newData } } : s)
                      });
                    };

                    const handleManualImageChange = async (newQuery: string) => {
                        if (!newQuery) return;
                        const url = await fetchPixabayImage(newQuery, 1200, 800);
                        updateSlideData({ imagePrompt: newQuery, imageUrl: url });
                    };

                    const handleRegenerateSlide = async (newPrompt: string) => {
                        if (!newPrompt) return;
                        setLoading(true);
                        setLoadingMessage("Regenerando slide...");
                        
                        try {
                            const targetSlide = presentationData.slides[idx];
                            const prompt = `Regenere o slide ${idx + 1} da apresentação sobre "${presentationData.presentationTitle}".
                            Layout atual: ${targetSlide.layoutID}.
                            Nova instrução: ${newPrompt}.
                            Mantenha o estilo consistente com a apresentação: ${JSON.stringify(presentationData.theme)}.
                            
                            SAÍDA: JSON estrito apenas com os dados do slide:
                            { "title": "...", "text": "...", "illustrationQuery": "..." }`;

                            const response = await generateContentWithRetry({
                                model: 'gemini-2.5-flash',
                                contents: prompt,
                            });
                            
                            const newData = JSON.parse(response.text || '{}');
                            const newQuery = newData.illustrationQuery || targetSlide.data.imagePrompt;
                            const newImageUrl = newData.illustrationQuery
                                ? await fetchPixabayImage(newData.illustrationQuery, 1200, 800)
                                : targetSlide.data.imageUrl;
                            updateSlideData({
                                title: newData.title || targetSlide.data.title,
                                text: newData.text || targetSlide.data.text,
                                imagePrompt: newQuery,
                                imageUrl: newImageUrl
                            });
                        } catch (err) {
                            console.error("Erro ao regenerar slide", err);
                            setError("Erro ao regenerar slide. Tente novamente.");
                        } finally {
                            setLoading(false);
                        }
                    };

                    return (
                      <div key={idx} className="w-full max-w-4xl mx-auto aspect-[16/9] rounded-2xl shadow-lg overflow-hidden flex relative border border-gray-100 group" style={{ backgroundColor: (slide.layoutID === 'LAYOUT_REFERENCES' || slide.layoutID === 'LAYOUT_COVER') ? theme.primaryColor : theme.backgroundColor }}>
                        {/* Edit Controls Overlay */}
                        <div className="absolute top-4 right-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 p-3 rounded-xl shadow-lg flex gap-2">
                          {regenState?.idx === idx ? (
                            <>
                              <input
                                autoFocus
                                placeholder="Nova instrução para o slide..."
                                value={regenState.prompt}
                                onChange={(e) => setRegenState({ idx, prompt: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter') { handleRegenerateSlide(regenState.prompt); setRegenState(null); } if (e.key === 'Escape') setRegenState(null); }}
                                className="text-xs w-48 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                              />
                              <button onClick={() => { handleRegenerateSlide(regenState.prompt); setRegenState(null); }} className="text-xs bg-emerald-600 text-white px-3 py-2 rounded-lg font-bold">OK</button>
                              <button onClick={() => setRegenState(null)} className="text-xs bg-gray-200 text-gray-700 px-2 py-2 rounded-lg font-bold">✕</button>
                            </>
                          ) : (
                            <>
                              <input placeholder="Nova img..." className="text-xs w-32 p-2 border rounded-lg" onKeyDown={(e) => { if (e.key === 'Enter') handleManualImageChange(e.currentTarget.value); }} />
                              <button onClick={() => setRegenState({ idx, prompt: '' })} className="text-xs bg-emerald-600 text-white px-3 py-2 rounded-lg font-bold">Regerar</button>
                            </>
                          )}
                        </div>
                        
                        {slide.layoutID === 'LAYOUT_COVER' && (
                          <div className="absolute inset-0 flex w-full h-full p-10 gap-8">
                            <div className="w-1/2 flex flex-col justify-between text-left">
                              <div>
                                {profileSchoolName && <div className="text-white/80 font-medium text-sm uppercase tracking-widest mb-2">{profileSchoolName}</div>}
                                <input className="font-bold text-5xl leading-tight mb-4 drop-shadow-sm bg-transparent border-b border-white/50 w-full focus:outline-none placeholder:text-white/50" style={{ color: '#ffffff', fontFamily: theme.fontTitle }} value={slide.data.title} placeholder="Título" onChange={(e) => updateSlideData({ title: e.target.value })} />
                                <input className="text-lg font-bold uppercase tracking-wider bg-transparent border-b border-white/20 w-full focus:outline-none placeholder:text-white/50" style={{ color: 'rgba(255,255,255,0.9)' }} value={slide.data.subtitle} placeholder="Subtítulo" onChange={(e) => updateSlideData({ subtitle: e.target.value })} />
                              </div>
                              {profileName && <div className="text-white/90 font-bold text-lg">{profileName}</div>}
                            </div>
                            <div className="w-1/2 h-full rounded-2xl overflow-hidden shadow-lg border-2 border-white/20">
                              <img src={slide.data.imageUrl || getImageUrl(slide.data.imagePrompt, 1200, 800)} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                            </div>
                          </div>
                        )}
                        {(slide.layoutID === 'LAYOUT_CONTENT_LEFT' || slide.layoutID === 'LAYOUT_CONTENT_RIGHT') && (
                          <div className={`absolute inset-0 flex w-full h-full p-10 gap-8 ${slide.layoutID === 'LAYOUT_CONTENT_RIGHT' ? 'flex-row-reverse' : ''}`}>
                            <div className="w-1/2 flex flex-col text-left justify-center">
                              <input className="font-bold text-3xl mb-6 leading-tight bg-transparent border-b border-gray-300 w-full focus:outline-none" style={{ color: theme.primaryColor, fontFamily: theme.fontTitle }} value={slide.data.title} placeholder="Título" onChange={(e) => updateSlideData({ title: e.target.value })} />
                              <textarea className="text-lg leading-relaxed text-justify bg-transparent border border-gray-200 rounded-xl p-3 w-full h-64 focus:outline-none" style={{ color: '#444' }} value={slide.data.text} placeholder="Conteúdo do slide" onChange={(e) => updateSlideData({ text: e.target.value })} />
                            </div>
                            <div className="w-1/2 h-full rounded-2xl overflow-hidden bg-gray-100 shadow-inner">
                              <img src={slide.data.imageUrl || getImageUrl(slide.data.imagePrompt, 1200, 800)} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                            </div>
                          </div>
                        )}
                        {slide.layoutID === 'LAYOUT_CONTENT_TOP' && (
                          <div className="absolute inset-0 flex flex-col w-full h-full p-10 gap-6">
                            <div className="text-left">
                              <input className="font-bold text-3xl mb-4 leading-tight bg-transparent border-b border-gray-300 w-full focus:outline-none" style={{ color: theme.primaryColor, fontFamily: theme.fontTitle }} value={slide.data.title} placeholder="Título" onChange={(e) => updateSlideData({ title: e.target.value })} />
                              <textarea className="text-lg leading-relaxed text-justify bg-transparent border border-gray-200 rounded-xl p-3 w-full h-32 focus:outline-none" style={{ color: '#444' }} value={slide.data.text} placeholder="Conteúdo do slide" onChange={(e) => updateSlideData({ text: e.target.value })} />
                            </div>
                            <div className="flex-1 rounded-2xl overflow-hidden bg-gray-100 shadow-inner">
                              <img src={slide.data.imageUrl || getImageUrl(slide.data.imagePrompt, 1200, 800)} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                            </div>
                          </div>
                        )}
                        {slide.layoutID === 'LAYOUT_TOPICS' && (
                          <div className="absolute inset-0 w-full h-full p-10 relative flex flex-col">
                            <input className="font-bold text-3xl mb-8 text-left leading-tight bg-transparent border-b border-gray-300 w-full focus:outline-none" style={{ color: theme.primaryColor, fontFamily: theme.fontTitle }} value={slide.data.title} placeholder="Título" onChange={(e) => updateSlideData({ title: e.target.value })} />
                            <div className="flex gap-6 flex-1">
                              {slide.data.topics?.map((t, i) => (
                                <div key={i} className="flex-1 flex flex-col items-center text-center">
                                  <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 shadow-lg border-2 border-white" style={{ backgroundColor: theme.primaryColor }}>
                                    <DynamicIcon name={t.icon} size={28} color="white" />
                                  </div>
                                  <div className="w-full flex-1 rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col" style={{ backgroundColor: `${theme.primaryColor}08` }}>
                                    <input className="text-sm font-bold mb-2 uppercase tracking-tight bg-transparent border-none w-full focus:outline-none" style={{ color: theme.primaryColor }} value={t.title} placeholder="Tópico" onChange={(e) => updateSlideData({ topics: slide.data.topics.map((t2, j) => j === i ? {...t2, title: e.target.value} : t2) })} />
                                    <textarea className="text-sm leading-relaxed flex-1 bg-transparent border-none p-0 focus:outline-none" style={{ color: '#333' }} value={t.content} placeholder="Conteúdo" onChange={(e) => updateSlideData({ topics: slide.data.topics.map((t2, j) => j === i ? {...t2, content: e.target.value} : t2) })} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {slide.layoutID === 'LAYOUT_REFERENCES' && (
                          <div className="absolute inset-0 w-full h-full p-10 flex flex-col text-left">
                            <input className="font-bold text-3xl text-white mb-8 border-b border-white/20 pb-4 bg-transparent border-none w-full focus:outline-none" value={slide.data.title} placeholder="Referências" onChange={(e) => updateSlideData({ title: e.target.value })} />
                            <textarea className="text-lg text-white/90 w-full flex-1 bg-transparent border border-white/20 rounded-xl p-4 focus:outline-none" value={slide.data.references?.join('\n')} placeholder="Referências (cada uma em uma linha)" onChange={(e) => updateSlideData({ references: e.target.value.split('\n') })} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2 mt-2">
                  <button 
                    onClick={exportPPTX} 
                    disabled={isExporting}
                    className="flex-1 bg-indigo-600 text-white rounded-2xl py-4 text-sm font-bold flex items-center justify-center gap-2 shadow-md disabled:opacity-50 transition-opacity"
                  >
                    {isExporting ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />} 
                    {isExporting ? 'Gerando...' : 'Baixar PPTX'}
                  </button>
                  <button 
                    onClick={() => {
                      const newResourceId = Math.random().toString(36).substr(2, 9);
                      setSavedResources([...savedResources, {
                        id: newResourceId,
                        type: 'slides',
                        title: presentationData.presentationTitle,
                        date: Date.now(),
                        presentationData
                      }]);
                      
                      const selectedClass = schedules.find(c => c.id === selectedClassId);
                      const className = selectedClass ? selectedClass.name : 'Geral';
                      const classToUpdate = classes.find(c => c.className === className && c.title.includes(topic));
                      if (classToUpdate) {
                        setClasses(classes.map(c => c.id === classToUpdate.id ? { ...c, resourceIds: [...(c.resourceIds || []), newResourceId] } : c));
                      }

                      if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification('Salvo no Acervo!', { icon: '/favicon.ico' });
                      }
                    }}
                    className="flex-1 bg-indigo-50 text-indigo-600 rounded-2xl py-4 text-sm font-bold flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Archive size={20} /> Salvar Acervo
                  </button>
                </div>
              </div>
            )}
            
            {(currentResult && mode !== 'slides') && (
              <div className="flex flex-col gap-2 mb-4">
                <div className="max-h-64 overflow-y-auto no-scrollbar border border-gray-100 rounded-2xl p-4 bg-gray-50">
                  <div className="markdown-body text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentResult as string}</ReactMarkdown>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      const printWindow = window.open('', '_blank');
                      if (printWindow) {
                        printWindow.document.write(`
                          <html>
                            <head>
                              <title>Exportar Plano</title>
                              <style>
                                body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 40px; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
                                h1 { color: #4F46E5; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
                                h2 { color: #1f2937; margin-top: 30px; }
                                h3 { color: #4b5563; }
                                blockquote { border-left: 4px solid #4F46E5; padding-left: 16px; color: #6b7280; font-style: italic; }
                                ul, ol { padding-left: 24px; }
                                li { margin-bottom: 8px; }
                                .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
                                .school-name { font-weight: bold; font-size: 1.2rem; color: #4b5563; }
                                .teacher-name { font-size: 1rem; color: #6b7280; }
                                @media print {
                                  body { padding: 0; }
                                }
                              </style>
                            </head>
                            <body>
                              <div class="header">
                                ${profileSchoolName ? `<div class="school-name">${profileSchoolName}</div>` : ''}
                                ${profileName ? `<div class="teacher-name">${profileName}</div>` : ''}
                              </div>
                              ${(currentResult as string)
                                .replace(/^### (.*$)/gim, '<h3>$1</h3>')
                                .replace(/^## (.*$)/gim, '<h2>$1</h2>')
                                .replace(/^# (.*$)/gim, '<h1>$1</h1>')
                                .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
                                .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>')
                                .replace(/\*(.*)\*/gim, '<i>$1</i>')
                                .replace(/!\[(.*?)\]\((.*?)\)/gim, "<img alt='$1' src='$2' />")
                                .replace(/\[(.*?)\]\((.*?)\)/gim, "<a href='$2'>$1</a>")
                                .replace(/\n/gim, '<br />')
                              }
                            </body>
                          </html>
                        `);
                        printWindow.document.close();
                        // Small delay to ensure images load
                        setTimeout(() => {
                          printWindow.print();
                        }, 500);
                      }
                    }}
                    className="flex-1 bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <Download size={16} /> Exportar PDF
                  </button>
                  <button 
                    onClick={() => {
                      const newResourceId = Math.random().toString(36).substr(2, 9);
                      setSavedResources([...savedResources, {
                        id: newResourceId,
                        type: mode === 'plan' ? 'plan' : mode === 'exam' ? 'exam' : 'activities',
                        title: topic || 'Material Didático',
                        date: Date.now(),
                        content: currentResult
                      }]);
                      
                      const selectedClass = schedules.find(c => c.id === selectedClassId);
                      const className = selectedClass ? selectedClass.name : 'Geral';
                      const classToUpdate = classes.find(c => c.className === className && c.title.includes(topic));
                      if (classToUpdate) {
                        setClasses(classes.map(c => c.id === classToUpdate.id ? { ...c, resourceIds: [...(c.resourceIds || []), newResourceId] } : c));
                      }

                      if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification('Salvo no Acervo!', { icon: '/favicon.ico' });
                      }
                    }}
                    className="flex-1 bg-indigo-50 text-indigo-600 rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <Archive size={16} /> Salvar
                  </button>
                </div>
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
                      <button 
                        onClick={() => {
                          const printWindow = window.open('', '_blank');
                          if (printWindow) {
                            printWindow.document.write(`
                              <html>
                                <head>
                                  <title>Exportar ${res.type === 'activities' ? 'Atividades' : 'Roteiro'}</title>
                                  <style>
                                    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 40px; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
                                    h1 { color: #4F46E5; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
                                    h2 { color: #1f2937; margin-top: 30px; }
                                    h3 { color: #4b5563; }
                                    blockquote { border-left: 4px solid #4F46E5; padding-left: 16px; color: #6b7280; font-style: italic; }
                                    ul, ol { padding-left: 24px; }
                                    li { margin-bottom: 8px; }
                                    .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
                                    .school-name { font-weight: bold; font-size: 1.2rem; color: #4b5563; }
                                    .teacher-name { font-size: 1rem; color: #6b7280; }
                                    @media print { body { padding: 0; } }
                                  </style>
                                </head>
                                <body>
                                  <div class="header">
                                    ${profileSchoolName ? `<div class="school-name">${profileSchoolName}</div>` : ''}
                                    ${profileName ? `<div class="teacher-name">${profileName}</div>` : ''}
                                  </div>
                                  ${res.content
                                    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
                                    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
                                    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
                                    .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
                                    .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>')
                                    .replace(/\*(.*)\*/gim, '<i>$1</i>')
                                    .replace(/!\[(.*?)\]\((.*?)\)/gim, "<img alt='$1' src='$2' />")
                                    .replace(/\[(.*?)\]\((.*?)\)/gim, "<a href='$2'>$1</a>")
                                    .replace(/\n/gim, '<br />')
                                  }
                                </body>
                              </html>
                            `);
                            printWindow.document.close();
                            setTimeout(() => { printWindow.print(); }, 500);
                          }
                        }}
                        className="flex-1 bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                      >
                        <Download size={16} /> Exportar
                      </button>
                      <button 
                        onClick={() => {
                          const newResourceId = Math.random().toString(36).substr(2, 9);
                          setSavedResources([...savedResources, {
                            id: newResourceId,
                            type: res.type as any,
                            title: `${topic} - ${res.type === 'activities' ? 'Atividades' : 'Roteiro'}`,
                            date: Date.now(),
                            content: res.content
                          }]);
                          if ('Notification' in window && Notification.permission === 'granted') {
                            new Notification('Salvo no Acervo!', { icon: '/favicon.ico' });
                          }
                        }}
                        className="flex-1 bg-indigo-50 text-indigo-600 rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                      >
                        <Archive size={16} /> Salvar
                      </button>
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
        .join('\n') || 'Acervo vazio';

      const turmas = schedules.map(s => s.name).join(', ') || 'Nenhuma turma cadastrada';

      const basePrompt = `Você é o "Prof. Corujão", o assistente pessoal definitivo para professores.
      Você atua como um CONTROLE REMOTO total do aplicativo. Você pode navegar entre telas, criar materiais, agendar aulas e atualizar o perfil.

      Hoje é: ${today}.

      Contexto Atual:
      - Professor: ${profile.name} (${profile.subject})
      - Escola: ${profile.schoolName || 'Não informada'}
      - Turmas cadastradas: ${turmas}
      - Próximas aulas (máx. 10):
      ${upcomingClasses}
      - Próximos eventos:
      ${upcomingEvents}
      - Últimos materiais no Acervo:
      ${acervoSummary}
      - Conteúdo do Estúdio: ${estudioContext ? `${estudioContext.substring(0, 300)}...` : 'Vazio'}

      Suas Capacidades (USE AS FUNÇÕES SEMPRE QUE POSSÍVEL):
      1. NAVEGAÇÃO: Mudar para as telas 'home', 'planner', 'chat', 'calendar', 'profile', 'estudio', 'acervo'.
      2. MATERIAL DIDÁTICO: Gerar Planos de Aula, Slides, Atividades ou Provas. Os materiais são salvos automaticamente no Acervo ao concluir.
      3. AGENDAMENTO: Marcar uma aula individual (schedule_class) ou uma série de aulas (schedule_lesson_series).
      4. PERFIL: Atualizar nome, disciplina ou escola.

      Regras de Comportamento:
      1. Seja proativo, conciso e profissional.
      2. NUNCA use emojis.
      3. Se o usuário pedir algo genérico como "Gere um material sobre X", pergunte se ele quer Slides, Plano, Atividades ou Prova, ou sugira um deles.
      4. Quando usar uma função de geração, informe que o material será salvo automaticamente no Acervo ao concluir.
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
        model: 'gemini-3-flash-preview',
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
                      enum: ['home', 'planner', 'chat', 'calendar', 'profile', 'estudio', 'acervo'],
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
            responseText += `Criando slides sobre "${args.topic}". O material será salvo automaticamente no Acervo ao concluir. `;
          } else if (call.name === 'generate_lesson_plan') {
            const targetClass = schedules.find(s => s.name.toLowerCase().includes((args.className || '').toLowerCase()));
            setPlannerTopic(args.topic);
            if (targetClass) setPlannerSelectedClassId(targetClass.id);
            setPlannerMode('plan');
            generatePlan(args.topic, targetClass?.id);
            responseText += `Criando plano de aula sobre "${args.topic}". O material será salvo automaticamente no Acervo ao concluir. `;
          } else if (call.name === 'generate_activities') {
            const targetClass = schedules.find(s => s.name.toLowerCase().includes((args.className || '').toLowerCase()));
            setPlannerTopic(args.topic);
            if (targetClass) setPlannerSelectedClassId(targetClass.id);
            setPlannerMode('activities');
            generateResource('activities', args.topic, targetClass?.id);
            responseText += `Gerando atividades sobre "${args.topic}". O material será salvo automaticamente no Acervo ao concluir. `;
          } else if (call.name === 'generate_exam') {
            const targetClass = schedules.find(s => s.name.toLowerCase().includes((args.className || '').toLowerCase()));
            setPlannerTopic(args.topic);
            if (targetClass) setPlannerSelectedClassId(targetClass.id);
            setPlannerMode('exam');
            generateResource('exam', args.topic, targetClass?.id);
            responseText += `Gerando prova sobre "${args.topic}". O material será salvo automaticamente no Acervo ao concluir. `;
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
      setMessages([...newMessages, { id: Math.random().toString(36).substr(2, 9), role: 'model', text: '❌ ' + formatApiError(error, 'Desculpe, ocorreu um erro ao processar sua solicitação.'), date: Date.now() }]);
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
  const [newClassData, setNewClassData] = useState({ name: '', level: 'Ensino Fundamental II', profile: '', color: '#4F46E5' });
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
      classProfile: newClassData.profile
    };
    onAddClass(newClass);
    setShowAddClassModal(false);
    setNewClassData({ name: '', level: 'Ensino Fundamental II', profile: '', color: '#4F46E5' });
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
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 400;
          const MAX_HEIGHT = 400;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
          setProfile({ ...profile, photo: compressedBase64 });
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const saveProfile = () => {
    setProfile({ ...profile, name: profileName, subject: profileSubject, schoolName: profileSchoolName });
    setIsEditingProfile(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title="Meu Perfil" subtitle="Configurações" profile={profile} notifications={notifications} setNotifications={setNotifications} bannerImage="https://i.ibb.co/XZmvBD0Q/7-20260419-213906-0002.png" />
      
      <div className="bg-white rounded-[2rem] p-6 shadow-sm border-2 border-gray-50 mb-8 flex flex-col items-center text-center">
        <div className="relative">
          <div className="w-24 h-24 rounded-full overflow-hidden mb-4 shadow-md border-2 border-indigo-600 relative group cursor-pointer bg-indigo-600 flex items-center justify-center" onClick={() => fileInputRef.current?.click()}>
            {profile.photo ? (
              <img src={profile.photo} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-indigo-600 text-white">
                <User size={48} />
              </div>
            )}
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera size={24} className="text-white" />
            </div>
          </div>
          <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handlePhotoUpload} />
        </div>
        {isEditingProfile ? (
          <div className="w-full space-y-3 mt-4">
            <div className="text-left">
              <label className="text-xs font-bold text-gray-400 uppercase ml-1">Nome do Professor</label>
              <input 
                value={profileName} 
                onChange={e => setProfileName(e.target.value)} 
                className="w-full text-base font-bold text-gray-900 border-b-2 border-indigo-500 focus:outline-none pb-1 mt-1" 
                autoFocus
              />
            </div>
            <div className="text-left">
              <label className="text-xs font-bold text-gray-400 uppercase ml-1">Disciplina / Turmas</label>
              <input 
                value={profileSubject} 
                onChange={e => setProfileSubject(e.target.value)} 
                className="w-full text-sm text-gray-600 border-b-2 border-indigo-500 focus:outline-none pb-1 mt-1" 
              />
            </div>
            <div className="text-left">
              <label className="text-xs font-bold text-gray-400 uppercase ml-1">Nome da Escola (Cabeçalho)</label>
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
            <h2 className="text-xl font-bold text-gray-900 mt-2">{profile.name}</h2>
            <p className="text-base text-gray-500 mt-1">{profile.subject}</p>
            {profile.schoolName && (
              <p className="text-sm text-indigo-600 font-medium mt-2 bg-indigo-50 px-3 py-1 rounded-full">
                {profile.schoolName}
              </p>
            )}
          </>
        )}
        
        <button 
          onClick={() => isEditingProfile ? saveProfile() : setIsEditingProfile(true)}
          className="mt-6 bg-[#F8F9FE] text-indigo-600 px-6 py-2.5 rounded-full text-base font-bold w-full"
        >
          {isEditingProfile ? 'Salvar Identidade Padrão' : 'Editar Identidade Padrão'}
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

                    <div className="space-y-4">
                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Nome da Turma</label>
                        <input 
                          type="text" 
                          placeholder="Ex: 8º Ano A" 
                          value={newClassData.name} 
                          onChange={(e) => setNewClassData({...newClassData, name: e.target.value})}
                          className="w-full p-3 mt-1 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Nível de Ensino</label>
                        <select 
                          value={newClassData.level} 
                          onChange={(e) => setNewClassData({...newClassData, level: e.target.value})}
                          className={`w-full p-3 mt-1 rounded-xl focus:outline-none transition-all ${
                            newClassData.level 
                              ? 'bg-indigo-600 text-white font-bold border-none shadow-sm' 
                              : 'bg-white text-gray-700 border border-gray-200'
                          }`}
                        >
                          <option value="Ensino Fundamental I">Ensino Fundamental I</option>
                          <option value="Ensino Fundamental II">Ensino Fundamental II</option>
                          <option value="Ensino Médio">Ensino Médio</option>
                          <option value="EJA">EJA</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Perfil da Turma (Opcional)</label>
                        <textarea 
                          placeholder="Ex: Turma agitada, prefere aulas práticas. 2 alunos com TDAH." 
                          value={newClassData.profile} 
                          onChange={(e) => setNewClassData({...newClassData, profile: e.target.value})}
                          className="w-full p-3 mt-1 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 resize-none h-20 text-sm"
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
                        {s.level && <p className="text-xs text-gray-400">{s.level}</p>}
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
          <button onClick={() => setScreen('acervo')} className="text-indigo-600 text-sm font-bold">Ver tudo</button>
        </div>
        <div className="space-y-3">
          {savedResources.length > 0 ? (
            savedResources.slice(0, 2).map(resource => (
              <div key={resource.id} className="bg-white rounded-2xl p-4 border border-gray-50 shadow-sm flex items-center gap-4 cursor-pointer" onClick={() => setScreen('acervo')}>
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
                        alert('Não foi possível enviar o feedback. Tente novamente.');
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
          model: "gemini-3-flash-preview",
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
  const monthAbbrNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  
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

  const allEvents = [...filteredClasses.map(c => ({...c, type: 'class' as const})), ...customEvents, ...defaultHolidays];
  
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
  };

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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-xl font-bold mb-4">Novo Evento</h2>
            <input
              type="text"
              placeholder="Título do evento"
              value={newEventTitle}
              onChange={(e) => setNewEventTitle(e.target.value)}
              className="w-full p-3 mb-4 border border-gray-200 rounded-xl"
            />
            <div className="flex gap-2 mb-6">
              {(['prep', 'admin'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setNewEventType(t)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${newEventType === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}
                >
                  {t === 'prep' ? 'Preparação' : 'Administrativo'}
                </button>
              ))}
            </div>
            <div className="flex gap-4">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 p-3 rounded-xl bg-gray-100 font-bold">Cancelar</button>
              <button onClick={handleAddEvent} className="flex-1 p-3 rounded-xl bg-indigo-600 text-white font-bold">Adicionar</button>
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
            const isSelected = d === selectedDate;
            const dayEvents = getDayEvents(d);
            const isHoliday = dayEvents.some(e => e.type === 'holiday' || e.type === 'commemorative');
            const mainEvent = dayEvents.find(e => e.type === 'holiday') || dayEvents.find(e => e.type === 'commemorative') || dayEvents.find(e => e.type === 'class') || dayEvents[0];
            const dayColor = mainEvent ? getEventColorInternal(mainEvent) : null;

            const allDone = dayEvents.length > 0 && dayEvents.every(e => {
              if (e.type === 'holiday' || e.type === 'commemorative') return true;
              return e.status === 'done';
            });
            
            return (
              <div key={d} className="relative flex justify-center py-1">
                <button 
                  onClick={() => {
                    setSelectedDate(d);
                    setScreen('dayDetail');
                  }}
                  style={!isSelected && dayColor && !allDone ? { backgroundColor: dayColor + '20', color: dayColor } : {}}
                  className={`text-base font-medium w-9 h-9 flex items-center justify-center rounded-xl transition-all ${
                    isSelected ? 'bg-indigo-600 text-white shadow-md' : 
                    (!dayColor || allDone) ? 'text-gray-600 hover:bg-gray-50' : ''
                  } ${dayEvents.length > 0 && !isSelected ? 'font-bold' : ''}`}
                >
                  {d}
                </button>
                {dayEvents.length > 0 && !isSelected && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex gap-0.5">
                    {dayEvents.map((e, i) => (
                      <div key={i} className="w-1 h-1 rounded-full" style={{ backgroundColor: getEventColor(e) }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900">Eventos do Mês</h2>
        </div>
        <div className="space-y-4">
          {eventsThisMonth.length === 0 ? (
            <div className="text-center py-6 bg-white rounded-2xl border border-gray-50 shadow-sm">
              <CalendarIcon size={24} className="mx-auto text-gray-300 mb-2" />
              <p className="text-gray-400 text-sm font-medium">Nenhum evento este mês</p>
            </div>
          ) : (
            <Reorder.Group axis="y" values={eventsThisMonth} onReorder={(newEvents) => {
              const reorderedCustom = newEvents.filter(e => e.type === 'prep' || e.type === 'admin' || e.type === 'holiday' || e.type === 'commemorative') as any[];
              const nonCustoms = customEvents.filter(ce => !ce.type || (ce.type !== 'prep' && ce.type !== 'admin' && ce.type !== 'holiday' && ce.type !== 'commemorative'));
              setCustomEvents([...nonCustoms, ...reorderedCustom]);
            }} className="space-y-4">
              {eventsThisMonth.map((e) => (
                <Reorder.Item key={e.id} value={e} className="w-full" dragListener={true}>
                    <EventItem e={e} color={getEventColor(e)} onComplete={() => setCustomEvents(customEvents.filter(ce => ce.id !== e.id))} />
                </Reorder.Item>
              ))}
            </Reorder.Group>
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

const EstudioScreen = ({
  estudioContext,
  setEstudioContext,
  studioMessages,
  setStudioMessages,
  profile,
  setScreen,
  setPlannerMode,
  notifications,
  setNotifications
}: {
  estudioContext: string,
  setEstudioContext: (c: string | ((prev: string) => string)) => void,
  studioMessages: { id: string; role: 'user' | 'model'; text: string; date: number }[],
  setStudioMessages: (m: { id: string; role: 'user' | 'model'; text: string; date: number }[] | ((prev: { id: string; role: 'user' | 'model'; text: string; date: number }[]) => { id: string; role: 'user' | 'model'; text: string; date: number }[])) => void,
  profile: UserProfile,
  setScreen: (s: Screen) => void,
  setPlannerMode: (m: PlannerMode) => void,
  notifications?: any[],
  setNotifications?: (n: any[]) => void
}) => {
  const [activeTab, setActiveTab] = useState<'context' | 'chat'>('context');
  const [isUploading, setIsUploading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [studioMessages, activeTab]);

  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const addStudioMessage = (msg: Omit<typeof studioMessages[0], 'id' | 'date'>) => {
    const newMsg = { ...msg, id: Math.random().toString(36).substr(2, 9), date: Date.now() };
    setStudioMessages(prev => [...prev, newMsg]);
    return newMsg;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    
    const applyContextSafety = (newText: string) => {
      setEstudioContext(prev => {
        const MAX_CHAR_LIMIT = 100000;
        const updated = prev + (prev ? '\n\n' : '') + `--- Arquivo: ${file.name} ---\n` + newText;
        if (updated.length > MAX_CHAR_LIMIT) {
          alert('Base de Conhecimento cheia. O texto foi truncado para evitar excesso de memória e custos.');
          return updated.substring(0, MAX_CHAR_LIMIT);
        }
        return updated;
      });
    };

    try {
      if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.csv')) {
        const text = await file.text();
        applyContextSafety(text);
      } else {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const base64 = (event.target?.result as string).split(',')[1];
            const response = await generateContentWithRetry({
              model: 'gemini-2.5-flash',
              contents: [
                { role: 'user', parts: [
                    { inlineData: { data: base64, mimeType: file.type } },
                    { text: "Extraia todo o texto útil e informações deste arquivo para servir de base de conhecimento. Formate de forma clara em Markdown." }
                ]}
              ]
            });
            applyContextSafety(response.text || '');
          } catch (err) {
            console.error(err);
            alert(formatApiError(err, 'Erro ao processar o arquivo com a IA.'));
          } finally {
            setIsUploading(false);
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao ler o arquivo.');
    }
    setIsUploading(false);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    if (!estudioContext) {
      alert('Ops! Faça o Upload ou insira texto na "Base de Conhecimento" antes de inicializar o chat!');
      return;
    }

    const userText = chatInput;
    addStudioMessage({ role: 'user', text: userText });
    setChatInput('');
    setIsChatLoading(true);

    try {
      const historyForPrompt = [...studioMessages, { role: 'user' as const, text: userText }];
      const prompt = `Você é um assistente especialista no material fornecido pelo professor.
      Responda às perguntas baseando-se ESTRITAMENTE no seguinte conteúdo. NUNCA afirme ter gerado relatórios, aulas, ou ter agendado e executado ações. O seu único propósito nesta tela é analisar e responder sobre o texto fornecido.

      Conteúdo Base:
      ${estudioContext}

      Histórico da conversa:
      ${historyForPrompt.map(m => `${m.role === 'user' ? 'Professor' : 'Assistente'}: ${m.text}`).join('\n')}

      Assistente:`;

      const response = await generateContentWithRetry({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      addStudioMessage({ role: 'model', text: response.text || '' });
    } catch (error) {
      console.error(error);
      addStudioMessage({ role: 'model', text: formatApiError(error, 'Desculpe, ocorreu um erro ao analisar o material.') });
    }
    setIsChatLoading(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40 h-full flex flex-col">
      <Header setScreen={setScreen} title="Estúdio ML" subtitle="Laboratório de IA" profile={profile} notifications={notifications} setNotifications={setNotifications} bannerImage="https://i.ibb.co/vCp6TFqs/20260416-185756-0000.png" />
      
      <div className="flex gap-2 mb-6 pb-2 shrink-0">
        <button onClick={() => setActiveTab('context')} className={`flex-1 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${activeTab === 'context' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-500 border border-gray-100 shadow-sm'}`}>Base Conhecimento</button>
        <button onClick={() => setActiveTab('chat')} className={`flex-1 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${activeTab === 'chat' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-500 border border-gray-100 shadow-sm'}`}>Chat com IA</button>
      </div>

      {activeTab === 'context' && (
        <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-50 mb-8 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
                <Database size={20} />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Base de Conhecimento</h3>
                <p className="text-xs text-gray-400">Cole conteúdo ou envie arquivos para a IA</p>
              </div>
            </div>
            <label className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center cursor-pointer hover:bg-indigo-100 transition-colors">
              {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
              <input type="file" accept=".pdf,image/*" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
            </label>
          </div>
          
          <textarea
            value={estudioContext}
            onChange={(e) => setEstudioContext(e.target.value)}
            placeholder="Cole aqui o conteúdo da BNCC, capítulos de livros, apostilas ou envie um arquivo no botão acima..."
            className="w-full flex-1 bg-gray-50 border-none rounded-2xl p-4 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none mb-4"
          />
          
          {estudioContext.length === 0 && (
            <div className="text-center py-4 text-gray-400 text-xs italic mb-4">
              A IA ainda não tem contexto. Adicione conteúdo para começar.
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mt-auto shrink-0">
            <button onClick={() => { setPlannerMode('exam'); setScreen('planner'); }} className="bg-indigo-50 text-indigo-600 py-3 rounded-xl text-[10px] font-bold flex flex-col items-center justify-center gap-1 border border-indigo-200">
               <FileQuestion size={18} className="text-indigo-600" />
               Prova
            </button>
            <button onClick={() => { setPlannerMode('activities'); setScreen('planner'); }} className="bg-amber-50 text-amber-600 py-3 rounded-xl text-[10px] font-bold flex flex-col items-center justify-center gap-1 border border-amber-200">
               <FileText size={18} className="text-amber-600" />
               Atividade
            </button>
            <button onClick={() => { setPlannerMode('slides'); setScreen('planner'); }} className="bg-emerald-50 text-emerald-600 py-3 rounded-xl text-[10px] font-bold flex flex-col items-center justify-center gap-1 border border-emerald-200">
               <Presentation size={18} className="text-emerald-600" />
               Slides
            </button>
          </div>
        </div>
      )}

      {activeTab === 'chat' && (
        <div className="bg-white rounded-[2rem] p-4 shadow-sm border border-gray-50 mb-8 flex-1 flex flex-col min-h-[400px]">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs text-gray-400 font-medium">Conversa salva automaticamente</span>
            <button
              onClick={() => setStudioMessages([{ id: 'studio-welcome', role: 'model', text: 'Olá! Sou o assistente do seu material. O que você gostaria de saber sobre o conteúdo que você adicionou?', date: Date.now() }])}
              className="text-xs text-red-400 font-bold hover:text-red-600"
            >
              Limpar
            </button>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar mb-4 space-y-4 p-2">
            {!estudioContext && (
              <div className="text-center py-8 text-gray-400 text-sm">Adicione conteúdo na Base de Conhecimento primeiro.</div>
            )}
            {estudioContext && studioMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                <div className={`max-w-[85%] p-4 rounded-2xl ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-gray-50 text-gray-800 rounded-bl-none shadow-sm border border-gray-100'}`}>
                  <div className="markdown-body text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-50 p-4 rounded-2xl rounded-bl-none shadow-sm border border-gray-100 flex gap-2 items-center">
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="bg-gray-50 p-2 rounded-full flex items-center gap-2 shrink-0">
            <input 
              type="text" 
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
              placeholder="Pergunte sobre o material..." 
              className="flex-1 bg-transparent border-none px-4 py-2 text-sm focus:outline-none"
              disabled={!estudioContext}
            />
            <button 
              onClick={sendChatMessage}
              disabled={isChatLoading || !chatInput.trim() || !estudioContext}
              className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center disabled:opacity-50"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const AcervoScreen = ({ savedResources, setSavedResources, profile, setScreen, notifications, setNotifications }: { savedResources: SavedResource[], setSavedResources: (r: SavedResource[]) => void, profile: UserProfile, setScreen: (s: Screen) => void, notifications?: any[], setNotifications?: (n: any[]) => void }) => {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="pb-40">
      <Header setScreen={setScreen} title="Meu Acervo" subtitle="Histórico e Favoritos" profile={profile} notifications={notifications} setNotifications={setNotifications} />
      
      {savedResources.length === 0 ? (
        <div className="text-center py-6 px-4">
          <div className="w-full flex justify-center mb-6">
            <img src="https://i.ibb.co/QZxVTvB/Design-sem-nome-20260419-214616-0000.png" alt="Acervo Vazio" className="w-56 h-auto object-contain rounded-3xl" referrerPolicy="no-referrer" />
          </div>
          <h3 className="font-bold text-gray-900 mb-2">Acervo Vazio</h3>
          <p className="text-sm text-gray-400 mb-6">Você ainda não salvou nenhum material.</p>
          <button onClick={() => setScreen('planner')} className="bg-indigo-600 text-white px-6 py-2.5 rounded-full text-base font-bold shadow-sm">
            Criar Material
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {savedResources.map(resource => (
            <div key={resource.id} className="bg-white rounded-2xl p-4 border border-gray-50 shadow-sm flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0 ${
                resource.type === 'slides' ? 'bg-indigo-500' : resource.type === 'activities' ? 'bg-amber-500' : resource.type === 'plan' ? 'bg-cyan-500' : 'bg-emerald-500'
              }`}>
                {resource.type === 'slides' ? <Presentation size={20} /> : resource.type === 'activities' ? <FileText size={20} /> : resource.type === 'plan' ? <BookOpen size={20} /> : <FileQuestion size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 truncate">{resource.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-400">{new Date(resource.date).toLocaleDateString()}</span>
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold uppercase">
                    {resource.type === 'slides' ? 'Slides' : resource.type === 'activities' ? 'Atividades' : resource.type === 'plan' ? 'Plano de Aula' : 'Prova'}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setSavedResources(savedResources.filter(r => r.id !== resource.id))}
                className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-colors"
              >
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

// --- Main App ---

const AdminScreen = () => {
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [sysUsers, setSysUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'feedbacks'>('users');

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
    }, (error) => {
      console.error("Error fetching users:", error);
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

  const getTrialStatus = (u: any) => {
    if (u.isPro || u.role === 'admin') return null;
    if (!u.createdAt) return null;
    const hours = (Date.now() - new Date(u.createdAt).getTime()) / (1000 * 60 * 60);
    if (hours > 24) return 'expired';
    const remaining = Math.max(0, 24 - hours);
    return `${Math.floor(remaining)}h restantes`;
  };

  const totalUsers = sysUsers.length;
  const proUsers = sysUsers.filter(u => u.isPro).length;
  const expiredUsers = sysUsers.filter(u => !u.isPro && u.role !== 'admin' && u.createdAt && (Date.now() - new Date(u.createdAt).getTime()) / (1000 * 60 * 60) > 24).length;

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

      <div className="flex bg-gray-200/50 p-1 rounded-xl mb-6 shadow-sm">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${activeTab === 'users' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Usuários ({totalUsers})
        </button>
        <button
          onClick={() => setActiveTab('feedbacks')}
          className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${activeTab === 'feedbacks' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Feedbacks ({feedbacks.length})
        </button>
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

      {activeTab === 'users' && (
        <div className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-gray-50 mb-8 flex-1 flex flex-col">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Shield size={20} className="text-indigo-600" />
            Gerenciamento de Usuários
          </h2>

          <div className="space-y-3 overflow-y-auto no-scrollbar flex-1">
            {sysUsers.map(u => {
              const trialStatus = getTrialStatus(u);
              const isAdmin = u.role === 'admin';
              return (
                <div key={u.id} className="p-3 border border-gray-100 rounded-xl bg-gray-50">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="overflow-hidden flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-gray-900 truncate">{u.name || 'Sem nome'}</p>
                        {isAdmin && <span className="text-[10px] font-black bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-md">ADMIN</span>}
                        {u.isPro && <span className="text-[10px] font-black bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md">PRO</span>}
                        {trialStatus === 'expired' && <span className="text-[10px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md">EXPIRADO</span>}
                        {trialStatus && trialStatus !== 'expired' && <span className="text-[10px] font-medium bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-md">{trialStatus}</span>}
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{u.email || u.id}</p>
                      {u.createdAt && <p className="text-[10px] text-gray-400 mt-0.5">Desde {new Date(u.createdAt).toLocaleDateString('pt-BR')}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2">
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
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  const [resetMessage, setResetMessage] = useState({ type: '', text: '' });
  const [authError, setAuthError] = useState('');
  const [isAuthProcessing, setIsAuthProcessing] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthLoaded(true);
    });
    return () => unsubscribe();
  }, []);

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
      // Auto-remove completed/error tasks after some time
      setTimeout(() => {
        setActiveTasks(prev => {
          const newState = { ...prev };
          delete newState[id];
          return newState;
        });
      }, 8000);
    }
  };

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
  const [inboxMessages, setInboxMessages] = useFirestoreSync<{id: string, role: 'user' | 'model', text: string, date: number, attachment?: { mimeType: string, url: string, data: string, name: string }}>('messages', user, [
    { id: 'welcome', role: 'model', text: 'Olá! Eu sou o assistente do **Prof. Corujão**. Envie ideias rápidas, lembretes ou faça perguntas. Eu organizo tudo para você!', date: Date.now() }
  ]);
  
  const [estudioContext, setEstudioContext] = useState<string>('');
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
            text: `${typeLabel} sobre "${topicLabel}" gerado e salvo no Acervo automaticamente.`,
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
        // Initialize profile in Firestore for new users
        if (userCredential.user) {
          await setDoc(doc(db, 'users', userCredential.user.uid), {
            name: email.split('@')[0],
            email: email.toLowerCase().trim(),
            subject: 'Nova Disciplina',
            role: 'user',
            isPro: false,
            createdAt: new Date().toISOString()
          });
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

  const isTrialExpired = useMemo(() => {
    if (!user) return false;
    if (profile?.role === 'admin' || user?.email?.toLowerCase() === 'lyelsonmf520@gmail.com') return false;
    if (profile?.isPro) return false;
    
      const creationTime = user.metadata?.creationTime || profile?.createdAt;
      if (creationTime) {
        const creationDate = new Date(creationTime).getTime();
        const now = Date.now();
        const hoursPassed = (now - creationDate) / (1000 * 60 * 60);
        return hoursPassed > 24;
      }
    return false;
  }, [user, profile]);

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

  if (isTrialExpired && screen !== 'admin' && screen !== 'profile') {
    return (
      <div className="min-h-screen bg-[#F8F9FE] flex flex-col items-center justify-center p-6 relative">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-xl border border-red-100 flex flex-col items-center">
          <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-6">
            <Shield size={32} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Tempo Expirado</h2>
          <p className="text-gray-500 mb-6">
            Seu período de teste grátis de 24 horas chegou ao fim. Para continuar usando o aplicativo, ative a versão Pro.
          </p>
          <div className="p-4 bg-indigo-50 text-indigo-800 rounded-xl mb-6 text-sm">
            Fale com o administrador do sistema informando seu e-mail: <strong>{user.email}</strong> para liberação do acesso Permanente.
          </div>
          <button
            onClick={() => logOut()}
            className="text-gray-500 hover:text-gray-700 font-medium"
          >
            Sair da conta
          </button>
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
        
        LAYOUTS OBRIGATÓRIOS (Baseados em referência visual):
        1. LAYOUT_COVER: Capa. Título à esquerda, Subtítulo abaixo, Imagem à direita.
        2. LAYOUT_CONTENT_LEFT: Conteúdo. Título topo-esquerda, Texto denso abaixo, Imagem à direita.
        3. LAYOUT_CONTENT_RIGHT: Conteúdo Invertido. Imagem à esquerda, Título e Texto à direita.
        4. LAYOUT_CONTENT_TOP: Conteúdo Horizontal. Título e Texto no topo, Imagem larga na base.
        5. LAYOUT_TOPICS: Tópicos. Título topo-esquerda (estilo conteúdo), 3 colunas com ícone (nome de ícone do Lucide), título e texto curto.
        6. LAYOUT_REFERENCES: Referências. Título topo-esquerda, Lista de fontes, Fundo escuro.

        REGRAS DE DESIGN:
        - Mantenha um estilo visual consistente.
        - Se o tema permitir, use cores profissionais adequadas ao tópico.
        - Use uma paleta de NO MÁXIMO 3 CORES (Primária, Acento, Fundo).
        - Garanta ALTO CONTRASTE e LEITURA (evite cores claras sobre fundos claros).
        - Use **negrito** para termos importantes.
        - NUNCA use emojis.
        - Para 'topics', escolha ícones do Lucide-React (ex: 'Brain', 'Target', 'Lightbulb').
        - Para 'illustrationQuery', forneça apenas 2 ou 3 palavras-chave em inglês que descrevam uma ilustração ou cenário representativo para o slide (ex: 'science, technology', 'classroom, teaching'). Nenhuma palavra escrita na descrição.
        
        SAÍDA: JSON estrito (sem Markdown ao redor) com a estrutura:
        { 
          "presentationTitle": "...", 
          "theme": { 
            "primaryColor": "...", 
            "accentColor": "...", 
            "backgroundColor": "...", 
            "fontTitle": "...", 
            "fontBody": "..."
          }, 
          "slides": [ 
            { "layoutID": "...", "data": { "title": "...", "subtitle": "...", "text": "...", "imagePrompt": "...", "topics": [{ "title": "...", "content": "...", "icon": "..." }], "references": ["..."] } } 
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
      
      const response = await generateContentWithRetry({ model: 'gemini-3-flash-preview', contents: prompt });
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
    
    const taskId = addTask({ type: 'plan', title: `Plano: ${targetTopic}` });
    try {
      const selectedClass = schedules.find(s => s.id === targetClassId);
      const className = selectedClass ? selectedClass.name : 'Geral';
      const toneMap: Record<string, string> = { formal: 'Formal', didactic: 'Didático', technical: 'Técnico', concise: 'Conciso' };
      const complexityMap: Record<string, string> = { basic: 'Básico', intermediate: 'Intermediário', advanced: 'Avançado' };
      const focusMap: Record<string, string> = { practical: 'Exemplos Práticos', theoretical: 'Embasamento Teórico', balanced: 'Equilibrado' };

      const prompt = `Crie um plano de aula detalhado para ${plannerDuration} aulas (de ${plannerLessonTime} minutos cada) sobre: "${targetTopic}". Adapte a linguagem e a profundidade para alunos da turma: "${className}".
      Use o tom ${toneMap[plannerTone]}, nível de complexidade ${complexityMap[plannerComplexity]}, e foco pedagógico ${focusMap[plannerFocus]}.
      Inclua objetivos BNCC, metodologia e avaliação. Formate em Markdown.`;
      
      const response = await generateContentWithRetry({ model: 'gemini-3-flash-preview', contents: prompt });
      const planResult = response.text || '';
      setPlannerPlan(planResult);
      updateTask(taskId, { status: 'completed', result: planResult });
    } catch (error) {
      updateTask(taskId, { status: 'error', error: formatApiError(error, 'Erro ao gerar plano.') });
    }
  };

  const generateResource = async (type: 'activities' | 'slides' | 'exam', optTopic?: string, optClassId?: string) => {
    const targetTopic = optTopic || plannerTopic;
    const targetClassId = optClassId || plannerSelectedClassId;
    if (!targetTopic.trim()) return;

    const taskId = addTask({ type, title: `${type === 'slides' ? 'Slides' : 'Atividades'}: ${targetTopic}` });
    try {
      const selectedClass = schedules.find(c => c.id === targetClassId);
      const className = selectedClass ? selectedClass.name : 'Geral';

      if (type === 'slides') {
        const prompt = getSlidesPrompt(targetTopic, className, plannerTone, plannerComplexity, plannerFocus, plannerGroundingContent, plannerSlideCount);
        const response = await generateContentWithRetry({ model: 'gemini-3-flash-preview', contents: prompt });
        let text = (response.text || '{}').replace(/```json/g, '').replace(/```/g, '').trim();
        try {
          const parsed = JSON.parse(text);
          await Promise.all(parsed.slides.map(async (slide: any) => {
            const q = slide.data.illustrationQuery || slide.data.imagePrompt;
            if (q) {
              slide.data.imageUrl = await fetchPixabayImage(q, 1200, 800);
            }
          }));
          setPlannerPresentationData(parsed);
          updateTask(taskId, { status: 'completed', result: parsed });
        } catch (e) {
          updateTask(taskId, { status: 'error', error: 'Erro ao processar JSON dos slides.' });
        }
      } else {
        const escolaStr = profile.schoolName || '_________________';
        const professorStr = profile.name || '_________________';
        const disciplinaStr = profile.subject || '_________________';
        
        const headerPrompt = `1. COMECE O DOCUMENTO DIRETAMENTE COM ESTE CABEÇALHO (Não escreva nada antes dele):
        **Escola:** ${escolaStr}
        **Professor(a):** ${professorStr}
        **Disciplina:** ${disciplinaStr}
        **Turma:** ${className}
        **Data:** ___/___/___
        **Aluno:** ___________________________________

        2. LOGO ABAIXO DO CABEÇALHO, inclua o título:
        # Atividade sobre ${targetTopic}
        
        3. É PROIBIDO incluir qualquer introdução, saudação, comentários ou texto extra antes ou depois do material.`;

        const prompt = type === 'exam' 
          ? `Gere uma avaliação sobre "${targetTopic}" para a turma "${className}". Inclua 5 questões de múltipla escolha e 2 dissertativas. ${headerPrompt} Formate em Markdown.`
          : `Gere uma lista de ${plannerQuestionCount} atividades sobre "${targetTopic}" para a turma "${className}". ${headerPrompt} Formate em Markdown.`;
          
        const response = await generateContentWithRetry({ model: 'gemini-3-flash-preview', contents: prompt });
        const result = response.text || '';
        if (type === 'exam') setPlannerExam(result);
        else setPlannerActivity(result);
        updateTask(taskId, { status: 'completed', result });
      }
    } catch (error) {
      updateTask(taskId, { status: 'error', error: formatApiError(error, 'Erro ao gerar material.') });
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FE] font-sans text-gray-900 selection:bg-indigo-100 selection:text-indigo-900">
      <div className="max-w-md mx-auto h-screen relative px-6 pt-12 overflow-y-auto no-scrollbar">
        <AnimatePresence mode="wait">
          {screen === 'home' && <HomeScreen key="home" setScreen={setScreen} setPlannerMode={setPlannerMode} classes={classes} setClasses={setClasses} profile={profile} inboxMessages={inboxMessages} notifications={notifications} setNotifications={setNotifications} setSelectedDate={(d: Date) => {
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
                  message: 'Um novo material foi salvo no seu Acervo.',
                  date: Date.now(),
                  read: false
                }]);
              }
            }} 
            notifications={notifications} 
            setNotifications={setNotifications}
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
            getSuggestion={getSuggestion}
            getScheduleBuffer={getScheduleBuffer}
            setPlannerMode={setPlannerMode}
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
            notifications={notifications} 
            setNotifications={setNotifications}
            generatePlan={generatePlan}
            generateResource={generateResource}
            plannerTopic={plannerTopic}
            setPlannerTopic={setPlannerTopic}
            plannerSelectedClassId={plannerSelectedClassId}
            setPlannerSelectedClassId={setPlannerSelectedClassId}
            setPlannerMode={setPlannerMode}
            getScheduleBuffer={getScheduleBuffer}
          />}
          {screen === 'calendar' && <CalendarScreen key="calendar" classes={classes} setClasses={setClasses} schedules={schedules} profile={profile} inboxMessages={inboxMessages} customEvents={customEvents} setCustomEvents={setCustomEvents} selectedDate={selectedDate} setSelectedDate={setSelectedDate} currentMonth={currentMonth} setCurrentMonth={setCurrentMonth} currentYear={currentYear} setCurrentYear={setCurrentYear} setScreen={setScreen} notifications={notifications} setNotifications={setNotifications} />}
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
          {screen === 'profile' && <ProfileScreen key="profile" schedules={schedules} setSchedules={setSchedules} profile={profile} setProfile={setProfile} savedResources={savedResources} setScreen={setScreen} onAddClass={handleAddClassWithTrigger} customEvents={customEvents} setCustomEvents={setCustomEvents} notifications={notifications} setNotifications={setNotifications} onResetAccount={() => {
            setSchedules([]);
            setClasses([]);
            setCustomEvents([]);
            setSavedResources([]);
            setNotifications([]);
            setInboxMessages([{ id: 'welcome', role: 'model', text: 'Olá! Eu sou o assistente do **Prof. Corujão**. Envie ideias rápidas, lembretes ou faça perguntas. Eu organizo tudo para você!', date: Date.now() }]);
            setProfile({ name: 'Professor', subject: 'Sem disciplina', role: 'user', photo: 'https://i.ibb.co/9mG1MVP1/20260417-114358-0000.png' });
            setEstudioContext('');
          }} />}
          {screen === 'estudio' && <EstudioScreen key="estudio" estudioContext={estudioContext} setEstudioContext={setEstudioContext} studioMessages={studioMessages} setStudioMessages={setStudioMessages} profile={profile} setScreen={setScreen} setPlannerMode={setPlannerMode} notifications={notifications} setNotifications={setNotifications} />}
          {screen === 'acervo' && <AcervoScreen key="acervo" savedResources={savedResources} setSavedResources={setSavedResources} profile={profile} setScreen={setScreen} notifications={notifications} setNotifications={setNotifications} />}
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
