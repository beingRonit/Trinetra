import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Variants } from 'motion/react';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { EtheralShadow } from '@/components/ui/etheral-shadow';
import { SignInPage } from '@/components/ui/sign-in-flow-1';
import { SignOutButton, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import trinetraLogo from './assets/trinetra-logo.jpeg';
import {
  Shield,
  Terminal as TerminalIcon,
  Search,
  History,
  Cpu,
  Settings,
  LineChart,
  Fingerprint,
  LogOut,
  Bell,
  HelpCircle,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Play,
  UploadCloud,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Image as ImageIcon,
  Menu,
  X,
  Database,
  Globe,
  Target,
  Brain,
  FileText,
  Layers,
  RefreshCw,
  SkipForward,
  Eye,
  Copy,
  Check,
  ScanSearch as Scan
} from 'lucide-react';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';

type AuthMode = 'clerk' | 'otp' | 'guest';

interface DashboardSummaryResponse {
  user: { email?: string | null; id: string };
  summary: {
    total_assets: number;
    completed_scans: number;
    total_matches: number;
    highest_risk: string;
  };
  recent_assets: Array<{
    id: string;
    filename: string;
    mime_type: string;
    created_at: string;
    phash: string;
    preview_url?: string | null;
    scan?: {
      status: string;
      total_matches: number;
      max_risk: string;
      scan_duration_ms: number;
    } | null;
  }>;
}

function ClerkAuthScreen({ onLogin }: { onLogin: (mode: AuthMode) => void }) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const clerk = useClerk();

  useEffect(() => {
    const syncClerkSession = async () => {
      if (!user || !isLoaded) return;

      const token = await getToken();
      if (token) {
        localStorage.setItem('trinetra_access_token', token);
      }
      localStorage.setItem('trinetra_user_email', user.primaryEmailAddress?.emailAddress || '');
      localStorage.setItem('trinetra_clerk_id', user.id);
      localStorage.setItem('trinetra_auth_mode', 'clerk');
      onLogin('clerk');
    };

    void syncClerkSession();
  }, [getToken, user, isLoaded, onLogin]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SignInPage
      onSuccess={() => onLogin('otp')}
      onGoogleSignIn={() => clerk.openSignIn({})}
      googleButtonLabel="Continue with Clerk"
    />
  );
}

function AuthScreen({ onLogin }: { onLogin: (mode: AuthMode) => void }) {
  if (PUBLISHABLE_KEY) {
    return <ClerkAuthScreen onLogin={onLogin} />;
  }

  return <SignInPage onSuccess={() => onLogin('otp')} />;
}

function getStoredAccessToken() {
  return localStorage.getItem('trinetra_access_token');
}

async function fetchWithStoredAuth(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = getStoredAccessToken();
  const headers = new Headers(init.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

// --- Types ---
type AppState = 'BOOT' | 'AUTH' | 'DASHBOARD' | 'HISTORY' | 'INTELLIGENCE' | 'PROTECT' | 'SCAN' | 'METADATA';
type PipelineStep =
  | 'INPUT_IMAGE'
  | 'FEATURE_EXTRACTION'
  | 'SEARCH_RESULTS'
  | 'COMPARISON'
  | 'ANALYSIS'
  | 'VERIFY'
  | 'COMPLETE'
  | 'ERROR';

interface PipelineState {
  status: PipelineStep;
  progress: number;
  currentStep: string;
  imageFile: File | null;
  imageUrl: string | null;
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('BOOT');
  const [authMode, setAuthMode] = useState<AuthMode>('guest');
  const [pipelineState, setPipelineState] = useState<PipelineState>({
    status: 'INPUT_IMAGE',
    progress: 0,
    currentStep: 'Waiting for input...',
    imageFile: null,
    imageUrl: null,
  });
  const [fileInputRef] = useState<React.RefObject<HTMLInputElement | null>>(useRef<HTMLInputElement>(null));
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [uploadedImageAnalysis, setUploadedImageAnalysis] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'INTELLIGENCE' | 'HISTORY' | 'PROTECT' | 'SCAN'>('INTELLIGENCE');
  const [metadata, setMetadata] = useState<any>(null);
  const [lastAnalysis, setLastAnalysis] = useState<any>(null);
  const [uploadHistory, setUploadHistory] = useState<any[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState('');
  const [matchedImageUrl, setMatchedImageUrl] = useState<string | null>(null);
  const [matchedImageLabel, setMatchedImageLabel] = useState<string>('');
  const [comparisonImage, setComparisonImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummaryResponse | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);

  const loadDashboardSummary = useCallback(async () => {
    if (localStorage.getItem('trinetra_guest_mode') === 'true') {
      setDashboardSummary(null);
      setDashboardError(null);
      return;
    }

    setIsDashboardLoading(true);
    setDashboardError(null);
    try {
      const response = await fetchWithStoredAuth('/api/dashboard/summary');
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || 'Failed to load account summary');
      }

      setDashboardSummary(result);
      if (result.user?.email) {
        setCurrentUserEmail(result.user.email);
        localStorage.setItem('trinetra_user_email', result.user.email);
      }
    } catch (fetchError) {
      setDashboardSummary(null);
      setDashboardError(fetchError instanceof Error ? fetchError.message : 'Failed to load account summary');
    } finally {
      setIsDashboardLoading(false);
    }
  }, []);

  const advanceToStep = (step: PipelineStep) => {
    setPipelineState(prev => ({
      ...prev,
      status: step,
      progress: (() => {
        switch (step) {
          case 'INPUT_IMAGE': return 0;
          case 'FEATURE_EXTRACTION': return 20;
          case 'SEARCH_RESULTS': return 40;
          case 'COMPARISON': return 60;
          case 'ANALYSIS': return 80;
          case 'VERIFY': return 90;
          case 'COMPLETE': return 100;
          case 'ERROR': return 0;
          default: return 0;
        }
      })(),
    }));
  };

  const processImage = async (file: File) => {
    setError(null);
    setPipelineState({
      status: 'FEATURE_EXTRACTION',
      progress: 10,
      currentStep: 'Extracting features...',
      imageFile: file,
      imageUrl: URL.createObjectURL(file),
    });
    advanceToStep('FEATURE_EXTRACTION');
    
    setCurrentImage(URL.createObjectURL(file));
    setPipelineState(prev => ({ ...prev, status: 'SEARCH_RESULTS', progress: 40, currentStep: 'Searching...' }));
    advanceToStep('SEARCH_RESULTS');
    setPipelineState(prev => ({ ...prev, status: 'COMPARISON', progress: 60, currentStep: 'Comparing...' }));
    advanceToStep('COMPARISON');
    setPipelineState(prev => ({ ...prev, status: 'ANALYSIS', progress: 80, currentStep: 'Analyzing...' }));
    advanceToStep('ANALYSIS');

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/analyze-image', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      setResults(result.all_results || []);
      setUploadedImageAnalysis(result.uploaded_image_analysis);
      setMatchedImageUrl(result.visual || null);
      setMatchedImageLabel(result.label || '');
      const simScore = typeof result.score === 'number' ? result.score / 100 : 0;
      setLastAnalysis(result);
      setComparisonImage(result.visual || null);
      advanceToStep('COMPLETE');
      setPipelineState(prev => ({ ...prev, progress: 100, status: 'COMPLETE' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      setPipelineState(prev => ({ ...prev, status: 'ERROR' }));
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setCurrentImage(URL.createObjectURL(file));
      setPipelineState(prev => ({ ...prev, imageFile: file, imageUrl: URL.createObjectURL(file) }));
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCurrentImage(URL.createObjectURL(file));
      setPipelineState(prev => ({ ...prev, imageFile: file, imageUrl: URL.createObjectURL(file) }));
    }
  }, []);

  const handleDashboardClick = () => {
    setAppState('DASHBOARD');
    setMenuOpen(false);
  };
  
  const handleHistoryClick = () => {
    setAppState('HISTORY');
    setMenuOpen(false);
  };
  
  const handleIntelligenceClick = () => {
    setAppState('INTELLIGENCE');
    setMenuOpen(false);
  };
  
  const handleProtectClick = () => {
    setAppState('PROTECT');
    setMenuOpen(false);
  };
  
  const handleScanClick = () => {
    setAppState('SCAN');
    setMenuOpen(false);
  };

  const handleAnalyze = async () => {
    if (!pipelineState.imageFile) return;
    
    setIsAnalyzing(true);
    setCurrentStep('Starting analysis...');
    setPipelineState(prev => ({ ...prev, status: 'FEATURE_EXTRACTION', progress: 5 }));
    advanceToStep('FEATURE_EXTRACTION');
    
    setCurrentStep('Extracting CLIP embeddings...');
    await wait(800);
    setPipelineState(prev => ({ ...prev, progress: 25 }));
    advanceToStep('SEARCH_RESULTS');
    
    setCurrentStep('Searching for matches...');
    await wait(1200);
    setPipelineState(prev => ({ ...prev, progress: 45 }));
    await processImage(pipelineState.imageFile);
    setPipelineState(prev => ({ ...prev, status: 'COMPLETE', progress: 100 }));
    setIsAnalyzing(false);
  };

  const handleLogin = (mode: AuthMode) => {
    setAuthMode(mode);
    const savedEmail = localStorage.getItem('trinetra_user_email');
    if (savedEmail) {
      setCurrentUserEmail(savedEmail);
    }
    void loadDashboardSummary();
    setAppState('DASHBOARD');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setCurrentImage(URL.createObjectURL(file));
      setPipelineState(prev => ({ ...prev, imageFile: file, imageUrl: URL.createObjectURL(file) }));
    }
  };

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const handleLogout = () => {
    localStorage.removeItem('trinetra_access_token');
    localStorage.removeItem('trinetra_user_email');
    localStorage.removeItem('trinetra_guest_mode');
    localStorage.removeItem('trinetra_auth_mode');
    setAppState('AUTH');
    setCurrentUserEmail('');
    setResults([]);
    setLastAnalysis(null);
    setDashboardSummary(null);
    setDashboardError(null);
  };

  const handleImageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setCurrentImage(URL.createObjectURL(file));
      setPipelineState({
        status: 'INPUT_IMAGE',
        progress: 0,
        currentStep: 'Image loaded',
        imageFile: file,
        imageUrl: URL.createObjectURL(file),
      });
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleAnalyzeClick = async () => {
    if (!pipelineState.imageFile) {
      setError('Please select an image first');
      return;
    }

    setIsAnalyzing(true);
    advanceToStep('FEATURE_EXTRACTION');

    try {
      const formData = new FormData();
      formData.append('file', pipelineState.imageFile);

      const response = await fetch('/api/analyze-image', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      await wait(Math.max(0, 3200));
      const comparisonImage = result.visual ? `${result.visual}?t=${Date.now()}` : undefined;
      const matchedImageUrlRaw =
        result.matched_image_url ||
        result.matchedImageUrl ||
        result.source_url ||
        result.image_url ||
        result.imageUrl ||
        result.evidence?.matched_image_url ||
        result.evidence?.matchedImageUrl ||
        result.match?.image_url ||
        result.match?.imageUrl ||
        result.local_match?.image_url ||
        result.local_match?.imageUrl;
      const matchedImageLabel = '';

      setLastAnalysis(result);
      setUploadedImageAnalysis(result.uploaded_image_analysis);
      setMatchedImageUrl(matchedImageUrlRaw);
      setComparisonImage(comparisonImage);
      setMatchedImageLabel(matchedImageLabel);
      setResults(result.all_results || []);
      advanceToStep('COMPLETE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      advanceToStep('ERROR');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileChangeWrapper = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setCurrentImage(url);
      setPipelineState({
        status: 'INPUT_IMAGE',
        progress: 0,
        currentStep: 'Image selected',
        imageFile: file,
        imageUrl: url,
      });
    }
  };

  const handleStartAnalysis = async () => {
    if (!pipelineState.imageFile) {
      setError('No image selected');
      return;
    }
    await handleAnalyzeClick();
  };

  return (
    <div className="min-h-screen bg-surface text-on-surface font-sans">
      <AnimatePresence mode="wait">
        {appState === 'BOOT' && (
          <BootScreen key="boot" onComplete={() => setAppState('AUTH')} />
        )}
        {appState === 'AUTH' && (
          <AuthScreen key="auth" onLogin={handleLogin} />
        )}
        {appState !== 'BOOT' && appState !== 'AUTH' && (
          <MainLayout
            key="main"
            appState={appState}
            setAppState={setAppState}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            currentUserEmail={currentUserEmail}
            onLogout={handleLogout}
            authMode={authMode}
          >
            <AnimatePresence mode="wait">
              {appState === 'DASHBOARD' && (
                <DashboardContent
                  key="dashboard"
                  summary={dashboardSummary}
                  loading={isDashboardLoading}
                  error={dashboardError}
                  onRefresh={loadDashboardSummary}
                />
              )}
              {appState === 'INTELLIGENCE' && (
                <IntelligenceContent
                  key="intelligence"
                  pipelineState={pipelineState}
                  currentImage={currentImage}
                  results={results}
                  uploadedImageAnalysis={uploadedImageAnalysis}
                  isAnalyzing={isAnalyzing}
                  handleFileChange={handleFileChange}
                  handleAnalyzeClick={handleStartAnalysis}
                  advanceToStep={advanceToStep}
                  error={error}
                  setError={setError}
                  comparisonImage={comparisonImage}
                  matchedImageUrl={matchedImageUrl}
                  matchedImageLabel={matchedImageLabel}
                  lastAnalysis={lastAnalysis}
                  isDragging={isDragging}
                  onImageDrop={handleImageDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClearImage={() => setCurrentImage(null)}
                />
              )}
              {appState === 'PROTECT' && <ProtectContent key="protect" />}
              {appState === 'HISTORY' && <HistoryContent key="history" />}
              {appState === 'SCAN' && <ScanContent key="scan" />}
            </AnimatePresence>
          </MainLayout>
        )}
      </AnimatePresence>
    </div>
  );
}

function MainLayout({ children, appState, setAppState, menuOpen, setMenuOpen, currentUserEmail, onLogout, authMode }: any) {
  return (
    <div className="flex min-h-screen">
      <aside className={`fixed left-0 top-0 h-full w-64 bg-surface border-r border-outline-variant z-50 transform transition-transform ${menuOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0`}>
        <div className="p-4 border-b border-outline-variant">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-mono text-sm font-bold tracking-wider">TRINETRA</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-outline">Secure</div>
            </div>
          </div>
          <div className="text-xs text-on-surface-variant mt-2 truncate">{currentUserEmail}</div>
        </div>
        <nav className="p-2 space-y-1">
          <NavButton active={appState === 'DASHBOARD'} onClick={() => setAppState('DASHBOARD')}>
            <TerminalIcon className="h-4 w-4" />
            Dashboard
          </NavButton>
          <NavButton active={appState === 'INTELLIGENCE'} onClick={() => setAppState('INTELLIGENCE')}>
            <Search className="h-4 w-4" />
            Intelligence
          </NavButton>
          <NavButton active={appState === 'HISTORY'} onClick={() => setAppState('HISTORY')}>
            <History className="h-4 w-4" />
            History
          </NavButton>
          <NavButton active={appState === 'PROTECT'} onClick={() => setAppState('PROTECT')}>
            <Shield className="h-4 w-4" />
            Protect
          </NavButton>
          <NavButton active={appState === 'SCAN'} onClick={() => setAppState('SCAN')}>
            <Scan className="h-4 w-4" />
            Scan
          </NavButton>
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-outline-variant">
          {authMode === 'clerk' && PUBLISHABLE_KEY ? (
            <SignOutButton>
              <button onClick={onLogout} className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-error w-full">
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </SignOutButton>
          ) : (
            <button onClick={onLogout} className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-error w-full">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          )}
        </div>
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  );
}

function NavButton({ children, active, onClick }: any) {
  return (
    <button onClick={onClick} className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors ${active ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`}>
      {children}
    </button>
  );
}

function BootScreen({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2500);
    return () => clearTimeout(timer);
  }, [onComplete]);
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
        <div className="flex items-center gap-4 mb-8">
          <div className="h-20 w-20 rounded-2xl bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
            <Shield className="h-10 w-10 text-primary" />
          </div>
        </div>
        <motion.div className="font-mono text-3xl font-bold tracking-[0.3em] mb-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          TRINETRA
        </motion.div>
        <motion.div className="font-mono text-xs uppercase tracking-[0.2em] text-outline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
          Secure Image Authenticity
        </motion.div>
      </motion.div>
      <motion.div className="mt-12" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </motion.div>
    </div>
  );
}

function DashboardContent({ summary, loading, error, onRefresh }: { summary: DashboardSummaryResponse | null; loading: boolean; error: string | null; onRefresh: () => void }) {
  const stats = summary?.summary;

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-on-surface-variant">
            {summary?.user?.email || 'Signed in account'} {summary?.user?.id ? `• ${summary.user.id}` : ''}
          </p>
        </div>
        <button onClick={onRefresh} className="btn-primary inline-flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>
      {loading ? <div className="mb-6 text-sm text-on-surface-variant">Loading account summary...</div> : null}
      {error ? <div className="mb-6 rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error">{error}</div> : null}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard title="Protected Assets" value={String(stats?.total_assets ?? 0)} icon={<Shield className="h-5 w-5" />} />
        <StatsCard title="Completed Scans" value={String(stats?.completed_scans ?? 0)} icon={<Scan className="h-5 w-5" />} />
        <StatsCard title="Matches Found" value={String(stats?.total_matches ?? 0)} icon={<CheckCircle2 className="h-5 w-5" />} />
      </div>
      {summary?.recent_assets?.length ? (
        <div className="mt-8 rounded-2xl border border-outline-variant bg-surface-container p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Assets</h2>
            <span className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">
              Highest risk: {stats?.highest_risk ?? 'low'}
            </span>
          </div>
          <div className="space-y-3">
            {summary.recent_assets.slice(0, 5).map((asset) => (
              <div key={asset.id} className="flex items-center justify-between rounded-xl border border-outline-variant/70 bg-surface px-4 py-3">
                <div>
                  <div className="font-medium">{asset.filename}</div>
                  <div className="text-xs text-on-surface-variant">{asset.mime_type}</div>
                </div>
                <div className="text-right text-xs text-on-surface-variant">
                  <div>{asset.scan?.status || 'pending'}</div>
                  <div>{asset.scan?.total_matches ?? 0} matches</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!loading && !error && !summary ? (
        <div className="mt-8 rounded-2xl border border-outline-variant bg-surface-container p-6 text-sm text-on-surface-variant">
          Sign in with Clerk to load your Supabase-backed account summary.
        </div>
      ) : null}
    </div>
  );
}

function StatsCard({ title, value, icon }: any) {
  return (
    <div className="bg-surface-container rounded-2xl p-6 border border-outline-variant">
      <div className="text-on-surface-variant text-sm mb-2">{title}</div>
      <div className="flex items-center justify-between">
        <div className="text-3xl font-bold">{value}</div>
        <div className="text-primary">{icon}</div>
      </div>
    </div>
  );
}

function IntelligenceContent({ pipelineState, currentImage, results, uploadedImageAnalysis, isAnalyzing, handleFileChange, handleAnalyzeClick, advanceToStep, error, setError, comparisonImage, matchedImageUrl, matchedImageLabel, lastAnalysis, isDragging, onImageDrop, onDragOver, onDragLeave, onClearImage }: any) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Intelligence</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h2 className="text-sm text-on-surface-variant mb-4">Upload Image</h2>
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-outline-variant'}`}
            onDrop={onImageDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
          >
            {currentImage ? (
              <div className="relative">
                <img src={currentImage} alt="Upload" className="max-h-64 mx-auto rounded-lg" />
                <button onClick={onClearImage} className="absolute top-2 right-2 p-2 bg-surface rounded-full">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div>
                <UploadCloud className="h-12 w-12 mx-auto mb-4 text-outline" />
                <p className="text-on-surface-variant mb-4">Drag and drop an image here</p>
                <label className="btn-primary cursor-pointer inline-block">
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                  Select Image
                </label>
              </div>
            )}
          </div>
          {error && <div className="mt-4 p-3 bg-error/10 text-error rounded-lg">{error}</div>}
          <button
            onClick={handleAnalyzeClick}
            disabled={!pipelineState.imageFile || isAnalyzing}
            className="btn-primary w-full mt-4"
          >
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
            {isAnalyzing ? 'Analyzing...' : 'Analyze Image'}
          </button>
          {pipelineState.currentStep && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-on-surface-variant mb-1">
                <span>{pipelineState.currentStep}</span>
                <span>{pipelineState.progress}%</span>
              </div>
              <div className="h-2 bg-surface-container rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${pipelineState.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
        <div>
          <h2 className="text-sm text-on-surface-variant mb-4">Analysis Results</h2>
          {lastAnalysis ? (
            <div className="space-y-4">
              <div className={`p-4 rounded-xl border ${Number(lastAnalysis.score) > 75 ? 'bg-error/10 border-error/30' : Number(lastAnalysis.score) > 50 ? 'bg-warning/10 border-warning/30' : 'bg-success/10 border-success/30'}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-mono text-sm text-on-surface-variant">Confidence</span>
                  <span className="font-mono text-2xl font-bold">{lastAnalysis.score}%</span>
                </div>
                <div className="text-sm">{lastAnalysis.label}</div>
              </div>
              {uploadedImageAnalysis && (
                <div className="bg-surface-container rounded-xl p-4 border border-outline-variant">
                  <div className="text-sm font-bold mb-2">Image Analysis</div>
                  <div className="text-xs text-on-surface-variant">
                    <p>Model: {uploadedImageAnalysis.embedding?.model || 'N/A'}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-on-surface-variant text-center py-8">No analysis yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProtectContent() {
  return <div className="p-8"><h1 className="text-2xl font-bold mb-4">Protect</h1></div>;
}

function HistoryContent() {
  return <div className="p-8"><h1 className="text-2xl font-bold mb-4">History</h1></div>;
}

function ScanContent() {
  return <div className="p-8"><h1 className="text-2xl font-bold mb-4">Scan</h1></div>;
}
