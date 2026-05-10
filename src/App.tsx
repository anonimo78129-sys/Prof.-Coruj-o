import { useState, useEffect, useRef, useMemo } from 'react';
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