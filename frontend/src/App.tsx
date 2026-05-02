import React, { forwardRef, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useSpring, useTransform } from 'motion/react';
import type { PanInfo, Variants } from 'motion/react';
import * as THREE from 'three';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EtheralShadow } from '@/components/ui/etheral-shadow';
import { FallingPattern } from '@/components/ui/falling-pattern';
import { SignInPage } from '@/components/ui/sign-in-flow-1';
import { useAuth, useClerk, useUser } from '@clerk/clerk-react';
import trinetraLogo from './assets/trinetra-logo-transparent.png';
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
  SendHorizontal
} from 'lucide-react';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_ACTIVITY_KEY = 'trinetra_last_activity_at';
const FORCE_CLERK_SIGNOUT_KEY = 'trinetra_force_clerk_signout';
const BOOT_MIN_DURATION_MS = 5000;

// --- Types ---
type AppState = 'BOOT' | 'AUTH' | 'DASHBOARD' | 'HISTORY' | 'INTELLIGENCE' | 'PROTECT' | 'SCAN' | 'METADATA';
type AuthProviderMode = 'clerk' | 'otp' | 'guest';
type PipelineStep =
  | 'INPUT_IMAGE'
  | 'FEATURE_EXTRACTION'
  | 'PROMPT_GEN'
  | 'VECTOR_DB_STORAGE'
  | 'SCAN_TRIGGER'
  | 'DATA_RETRIEVAL'
  | 'LOCAL_DB_SEARCH'
  | 'WEB_SEARCH'
  | 'SIMILARITY_MATCHING'
  | 'ML_DECISION'
  | 'FINAL_OUTPUT';

type PipelineStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error';
type VerdictType = 'Authentic' | 'Manipulated' | 'Suspicious' | 'Match Found' | 'NO EXTERNAL MATCH' | 'Error' | null;
type AuthApiResponse = {
  detail?: string;
  error?: string;
  access_token?: string;
  token?: string;
};

const parseAuthResponse = async (response: Response): Promise<AuthApiResponse> => {
  const rawBody = await response.text();
  if (!rawBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as AuthApiResponse;
  } catch {
    return response.ok ? {} : { detail: rawBody };
  }
};

const sectionTransition: Variants = {
  initial: { opacity: 0, y: 18, filter: 'blur(10px)' },
  animate: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: 0.28,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
  exit: {
    opacity: 0,
    y: -12,
    filter: 'blur(6px)',
    transition: {
      duration: 0.18,
      ease: [0.4, 0, 1, 1],
    },
  },
};

interface PipelineData {
  image?: File;
  imagePreview?: string;
  dashboardAssetId?: string;
  clipEmbeddings?: number[];
  blipCaptions?: string[];
  blipCaption?: string;
  uploadedImageAnalysis?: {
    filename?: string;
    captions?: string[];
    embedding?: {
      model?: string;
      type?: string;
      dimensions?: number;
      vector?: number[];
      preview?: number[];
    };
  };
  structuredPrompt?: string;
  vectorDbId?: string;
  localSearchMatch?: boolean;
  localMatchScore?: number;
  localSearchResults?: any[];
  webSearchResults?: any[];
  clipSimilarity?: number;
  pHashSimilarity?: number;
  mlConfidence?: number;
  verdict?: VerdictType;
  comparisonImage?: string;
  matchedImageUrl?: string;
  matchedImageLabel?: string;
  matchedImageSource?: string;
  matchedMediaId?: string;
  matchedPhash?: string;
  webSearchAttempted?: boolean;
  decisionExplanation?: string;
  decisionAction?: string;
  fraudLikelihood?: string;
}

interface PipelineState {
  currentStep: PipelineStep;
  status: PipelineStatus;
  data: PipelineData;
  history: PipelineStep[];
  skippedSteps?: PipelineStep[];
}

interface VeridexResult {
  filename: string;
  engine: string;
  task?: string;
  label: string;
  prediction: 'AI' | 'REAL';
  display_label: string;
  ai_probability: number;
  real_probability: number;
  confidence_score: number;
  threshold: number;
  model: string;
  weights: string;
  raw_score: number;
  component_scores?: {
    cnn: number;
    xgb: number;
    cnn_real?: number;
    feature_vector?: number[];
  };
}

interface VeridexFeedbackJob {
  job_id: string;
  status: 'queued' | 'storing' | 'training' | 'cleaning' | 'completed' | 'failed';
  stage: 'queued' | 'storing' | 'training' | 'cleaning' | 'completed' | 'failed';
  prediction: 'AI' | 'REAL';
  user_feedback: 'AI' | 'REAL';
  error?: string | null;
  completed_at?: string | null;
}

type IntelligenceWorkflowState =
  | 'IDLE'
  | 'ANALYZING'
  | 'RESULT_VISIBLE'
  | 'FEEDBACK_OPEN'
  | 'TRAINING'
  | 'TRAINING_SUCCESS'
  | 'ANALYSIS_ERROR'
  | 'TRAINING_ERROR';

const RESULT_DISPLAY_HOLD_MS = 5000;
const FEEDBACK_JOB_POLL_MS = 1200;
const TRAINING_SUCCESS_HOLD_MS = 1800;

const PIPELINE_STEPS: { id: PipelineStep; label: string; icon: any }[] = [
  { id: 'INPUT_IMAGE', label: 'Input Image', icon: UploadCloud },
  { id: 'FEATURE_EXTRACTION', label: 'Feature Extraction', icon: Layers },
  { id: 'PROMPT_GEN', label: 'Structured Prompt', icon: FileText },
  { id: 'VECTOR_DB_STORAGE', label: 'Vector DB', icon: Database },
  { id: 'SCAN_TRIGGER', label: 'Scan Request', icon: Target },
  { id: 'DATA_RETRIEVAL', label: 'Data Retrieval', icon: RefreshCw },
  { id: 'LOCAL_DB_SEARCH', label: 'Local DB Search', icon: Search },
  { id: 'WEB_SEARCH', label: 'Web Search', icon: Globe },
  { id: 'SIMILARITY_MATCHING', label: 'Similarity Match', icon: Target },
  { id: 'ML_DECISION', label: 'ML Decision', icon: Brain },
  { id: 'FINAL_OUTPUT', label: 'Final Output', icon: CheckCircle2 },
];


const Reticle = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-primary" />
    <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-primary" />
    <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-primary" />
    <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-primary" />
  </div>
);

const SLIDE_DRAG_CONSTRAINTS = { left: 0, right: 154 };
const SLIDE_DRAG_THRESHOLD = 0.9;
const SLIDE_SPRING = {
  stiffness: 520,
  damping: 34,
  mass: 0.45,
};

type SlideSubmitButtonProps = {
  disabled?: boolean;
  idleLabel?: string;
  onSubmit: () => Promise<boolean>;
  onSuccess?: () => void;
  className?: string;
};

const SlideSubmitButton = forwardRef<HTMLButtonElement, SlideSubmitButtonProps>(
  ({ className, disabled, idleLabel = 'Slide to Submit', onSubmit, onSuccess, ...props }, ref) => {
    const [isDragging, setIsDragging] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    const handleX = useSpring(0, SLIDE_SPRING);
    const dragProgress = useTransform(() => handleX.get() / SLIDE_DRAG_CONSTRAINTS.right);
    const fillWidth = useTransform(() => handleX.get() + 44);
    const labelOpacity = useTransform(() => Math.max(0.18, 1 - dragProgress.get() * 0.92));
    const sheenOpacity = useTransform(() => Math.min(0.9, 0.18 + dragProgress.get() * 0.65));

    const resetSlider = useCallback(() => {
      setCompleted(false);
      setStatus('idle');
      setIsDragging(false);
      handleX.set(0);
    }, [handleX]);

    const handleDragStart = useCallback(() => {
      if (disabled || completed) return;
      setIsDragging(true);
    }, [completed, disabled]);

    const handleDrag = useCallback((
      _event: MouseEvent | TouchEvent | PointerEvent,
      info: PanInfo,
    ) => {
      if (disabled || completed) return;
      const newX = Math.max(0, Math.min(info.offset.x, SLIDE_DRAG_CONSTRAINTS.right));
      handleX.set(newX);
    }, [completed, disabled, handleX]);

    const handleDragEnd = useCallback(async () => {
      if (disabled || completed) return;
      setIsDragging(false);

      if (dragProgress.get() < SLIDE_DRAG_THRESHOLD) {
        handleX.set(0);
        return;
      }

      handleX.set(SLIDE_DRAG_CONSTRAINTS.right);
      setCompleted(true);
      setStatus('loading');
      const succeeded = await onSubmit();

      if (succeeded) {
        setStatus('success');
        window.setTimeout(() => {
          onSuccess?.();
        }, 700);
        return;
      }

      setStatus('error');
      window.setTimeout(() => {
        resetSlider();
      }, 1000);
    }, [completed, disabled, dragProgress, handleX, onSubmit, onSuccess, resetSlider]);

    return (
      <motion.div
        animate={{ width: completed ? '8rem' : '13rem' }}
        transition={{ type: 'spring', ...SLIDE_SPRING }}
        className={cn(
          'relative flex h-10 items-center justify-center overflow-hidden rounded-full border border-error/30 bg-surface-container-lowest shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
          disabled && 'opacity-50',
        )}
      >
        {!completed && (
          <>
            <motion.div
              style={{ width: fillWidth }}
              className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#8f1411_0%,#b3261e_55%,#d74235_100%)]"
            />
            <motion.div
              style={{ opacity: sheenOpacity }}
              className="absolute inset-y-[1px] left-[1px] right-[1px] rounded-full bg-[linear-gradient(120deg,rgba(255,255,255,0.18),transparent_30%,transparent_70%,rgba(255,255,255,0.14))]"
            />
            <motion.span
              style={{ opacity: labelOpacity }}
              className="relative z-[1] pl-10 pr-4 font-mono text-[10px] uppercase tracking-[0.24em] text-on-surface"
            >
              {disabled ? 'Complete Required Fields' : idleLabel}
            </motion.span>
          </>
        )}

        {!completed && (
          <motion.div
            drag={disabled ? false : 'x'}
            dragConstraints={SLIDE_DRAG_CONSTRAINTS}
            dragElastic={0.02}
            dragMomentum={false}
            dragTransition={{ bounceStiffness: 900, bounceDamping: 40, power: 0.05, timeConstant: 120 }}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={() => { void handleDragEnd(); }}
            style={{ x: handleX }}
            whileTap={{ scale: 1.03 }}
            className="absolute left-0 z-10 flex items-center justify-start px-1 will-change-transform"
          >
            <button
              ref={ref}
              {...props}
              type="button"
              disabled={disabled || status === 'loading'}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white text-[#8f1411] shadow-[0_8px_20px_rgba(0,0,0,0.28)] transition-transform duration-150',
                isDragging && 'scale-[1.04]',
                className,
              )}
            >
              <SendHorizontal className="size-4" />
            </button>
          </motion.div>
        )}

        {completed && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              ref={ref}
              {...props}
              type="button"
              disabled
              className={cn(
                'h-full w-full rounded-full border border-error/40 bg-[#b3261e] text-white',
                className,
              )}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={status}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {status === 'loading' ? (
                    <Loader2 className="animate-spin" size={20} />
                  ) : status === 'success' ? (
                    <Check size={20} />
                  ) : status === 'error' ? (
                    <X size={20} />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </button>
          </motion.div>
        )}
      </motion.div>
    );
  },
);

SlideSubmitButton.displayName = 'SlideSubmitButton';

const GuestRestrictionModal = ({
  feature,
  onClose,
}: {
  feature: string;
  onClose: () => void;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="relative w-full max-w-md bg-surface-container border border-error/30 shadow-2xl"
    >
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-error/10 border border-error/30 flex items-center justify-center text-error">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-mono text-sm font-bold uppercase tracking-widest">{feature}</h3>
            <p className="font-mono text-[10px] text-outline uppercase">Guest mode restriction</p>
          </div>
        </div>
        <div className="border border-error/30 bg-error/10 p-4 font-mono text-xs text-error">
          This feature should be used by the Signed Up users. Please sign up to continue.
        </div>
      </div>
      <div className="p-5 border-t border-outline-variant flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </div>
    </motion.div>
  </div>
);

// --- Pipeline Stepper Component ---

interface PipelineStepperProps {
  currentStep: PipelineStep;
  completedSteps: PipelineStep[];
  skippedSteps?: PipelineStep[];
  onStepClick?: (step: PipelineStep) => void;
  isMobile?: boolean;
}

const PipelineStepper: React.FC<PipelineStepperProps> = ({
  currentStep,
  completedSteps,
  skippedSteps = [],
  onStepClick,
  isMobile = false,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const activeIndex = PIPELINE_STEPS.findIndex(s => s.id === currentStep);
      const container = scrollRef.current;
      const stepWidth = 140;
      const scrollPosition = activeIndex * stepWidth - container.clientWidth / 2 + stepWidth / 2;
      container.scrollTo({ left: scrollPosition, behavior: 'smooth' });
    }
  }, [currentStep]);

  const getStepStatus = (stepId: PipelineStep) => {
    if (skippedSteps.includes(stepId)) return 'skipped';
    if (completedSteps.includes(stepId)) return 'completed';
    if (currentStep === stepId) return 'active';
    return 'pending';
  };

  const getStepStateLabel = (status: string) => {
    if (status === 'completed') return 'Done';
    if (status === 'skipped') return 'Skipped';
    if (status === 'active') return 'Live';
    return 'Queued';
  };

  const StepIcon = ({ step, status }: { step: typeof PIPELINE_STEPS[0]; status: string }) => {
    const Icon = step.icon;
    return (
      <div
        className={`w-8 h-8 flex items-center justify-center border-2 transition-all duration-300 ${
          status === 'completed'
            ? 'bg-primary border-primary text-on-primary'
            : status === 'skipped'
            ? 'bg-surface-container-low border-outline text-outline'
            : status === 'active'
            ? 'bg-primary/20 border-primary text-primary animate-pulse'
            : 'bg-surface border-outline-variant text-outline-variant'
        }`}
      >
        {status === 'completed' ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : status === 'skipped' ? (
          <SkipForward className="w-4 h-4" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
      </div>
    );
  };

  if (isMobile) {
    return (
      <div className="space-y-2 py-4">
        {PIPELINE_STEPS.map((step, index) => {
          const status = getStepStatus(step.id);
          const isLast = index === PIPELINE_STEPS.length - 1;
          return (
            <div key={step.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <StepIcon step={step} status={status} />
                {!isLast && (
                  <div
                    className={`w-0.5 h-8 mt-2 transition-colors duration-300 ${
                      status === 'completed' ? 'bg-primary' : 'bg-outline-variant'
                    }`}
                  />
                )}
              </div>
              <div className="flex-1 py-1">
                <p
                  className={`font-mono text-xs uppercase tracking-wider ${
                    status === 'active'
                      ? 'text-primary font-bold'
                      : status === 'completed'
                      ? 'text-on-surface'
                      : 'text-outline'
                  }`}
                >
                  {step.label}
                </p>
                <p className="font-mono text-[9px] uppercase tracking-wider text-outline mt-1">
                  {getStepStateLabel(status)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-0 overflow-x-auto custom-scrollbar py-4 px-2"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {PIPELINE_STEPS.map((step, index) => {
        const status = getStepStatus(step.id);
        const isLast = index === PIPELINE_STEPS.length - 1;
        return (
          <div key={step.id} className="flex items-center shrink-0">
            <div
              onClick={() => onStepClick?.(step.id)}
              className="flex flex-col items-center gap-2 cursor-pointer group w-28"
            >
              <StepIcon step={step} status={status} />
              <div className="min-h-[34px] flex flex-col items-center">
                <span
                  className={`font-mono text-[10px] uppercase tracking-wider text-center leading-tight whitespace-normal ${
                    status === 'active'
                      ? 'text-primary font-bold'
                      : status === 'completed'
                      ? 'text-on-surface'
                      : 'text-outline'
                  }`}
                >
                  {step.label}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-outline/85 mt-1">
                  {getStepStateLabel(status)}
                </span>
              </div>
            </div>
            {!isLast && (
              <div className="w-12 h-0.5 mx-2 relative">
                <div
                  className={`absolute inset-0 transition-all duration-500 ${
                    status === 'completed' ? 'bg-primary' : 'bg-outline-variant'
                  }`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};


// --- Stage View Components ---

interface StageViewProps {
  data?: PipelineData;
  onNext?: () => void;
  onRetry?: () => void;
  isProcessing?: boolean;
}

const PipelineErrorView: React.FC<{
  message?: string;
  onRetry?: () => void;
  onReset?: () => void;
}> = ({ message, onRetry, onReset }) => (
  <div className="p-6">
    <div className="border border-error bg-error/10 p-6 lg:p-8 space-y-5">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-error/60 bg-error/10">
          <AlertTriangle className="h-7 w-7 text-error" />
        </div>
        <div className="space-y-2">
          <h3 className="font-mono text-xl font-bold uppercase tracking-widest text-error">Pipeline Error</h3>
          <p className="font-mono text-[11px] uppercase text-outline">
            The scan could not move past the current stage.
          </p>
          <p className="font-mono text-xs text-on-surface-variant leading-relaxed">
            {message || 'The analysis request failed before the next pipeline stage could begin.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 pt-2 border-t border-error/30">
        <Button variant="primary" onClick={onRetry}>
          <RefreshCw className="w-4 h-4 mr-2" /> Retry Scan
        </Button>
        <Button variant="secondary" onClick={onReset}>
          <ChevronLeft className="w-4 h-4 mr-2" /> Back To Input
        </Button>
      </div>
    </div>
  </div>
);

const InputImageView: React.FC<StageViewProps & { onFileSelect: (file: File, preview: string) => void }> = ({
  data,
  onFileSelect,
  onNext,
  isProcessing,
}) => {
  const [preview, setPreview] = useState<string | null>(data.imagePreview || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    onFileSelect(file, url);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      handleFileSelect(file);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center p-6">
      <div
        className={`w-full max-w-2xl border-2 border-dashed transition-all duration-300 cursor-pointer ${
          preview
            ? 'border-primary/50 bg-surface-container-low'
            : 'border-outline-variant hover:border-primary/50 hover:bg-surface-container/50'
        }`}
        onClick={() => !preview && fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          disabled={!!preview}
        />
        {preview ? (
          <div className="p-6 space-y-4">
            <div className="relative aspect-video border border-outline-variant bg-black overflow-hidden">
              <img src={preview} alt="Input" className="w-full h-full object-contain" />
              <Reticle />
              <motion.div
                className="scan-line"
                animate={{ top: ['0%', '100%', '0%'] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs text-on-surface">{data.image?.name}</p>
              <Button variant="ghost" onClick={() => { setPreview(null); }} className="text-xs">
                <RefreshCw className="w-3 h-3 mr-1" /> Change
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-12 text-center space-y-4">
            <UploadCloud className="w-16 h-16 text-outline mx-auto" />
            <h3 className="font-mono text-sm font-bold uppercase tracking-widest">Drop Image Here</h3>
            <p className="font-mono text-[10px] text-outline uppercase">JPG, PNG, WEBP - Max 50MB</p>
            <Button variant="primary" className="mt-4">Select File</Button>
          </div>
        )}
      </div>
      {preview && (
        <Button
          variant="primary"
          className="mt-6 px-8 py-3"
          onClick={() => onNext?.()}
          disabled={isProcessing}
        >
          <Play className="w-4 h-4 mr-2" /> Start Analysis
        </Button>
      )}
    </div>
  );
};

const formatBytes = (bytes?: number) => {
  if (!bytes) return 'Pending';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
};

const pseudoVectorPreview = (progress: number, count = 18) =>
  Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((index + 1) * 1.73 + progress / 14) * 0.5 + 0.5;
    return Number(((wave * 2 - 1) * (progress / 100)).toFixed(3));
  });

const FeatureExtractionView: React.FC<StageViewProps> = ({ data, isProcessing }) => {
  const [clipProgress, setClipProgress] = useState(0);
  const [blipProgress, setBlipProgress] = useState(0);
  const [imageDimensions, setImageDimensions] = useState('Reading headers');

  useEffect(() => {
    const clipInterval = setInterval(() => {
      setClipProgress(prev => Math.min(prev + 4 + Math.random() * 7, 100));
    }, 260);
    const blipInterval = setInterval(() => {
      setBlipProgress(prev => Math.min(prev + 3 + Math.random() * 6, 100));
    }, 310);
    return () => {
      clearInterval(clipInterval);
      clearInterval(blipInterval);
    };
  }, []);

  useEffect(() => {
    if (!data?.imagePreview) return;
    const image = new Image();
    image.onload = () => setImageDimensions(`${image.naturalWidth} x ${image.naturalHeight}`);
    image.onerror = () => setImageDimensions('Unavailable');
    image.src = data.imagePreview;
  }, [data?.imagePreview]);

  const normalizedProgress = Math.round((clipProgress * 0.62) + (blipProgress * 0.38));
  const embeddingPreview = data?.uploadedImageAnalysis?.embedding?.preview || pseudoVectorPreview(clipProgress);
  const captionTokens = Math.max(1, Math.round((blipProgress / 100) * 24));
  const patchCount = imageDimensions.includes('x')
    ? Math.max(49, Math.round((Number(imageDimensions.split(' x ')[0]) || 512) / 16))
    : 196;

  const extractionRows = [
    {
      label: 'Image decode',
      value: imageDimensions,
      detail: `${data?.image?.type || 'image/*'} | ${formatBytes(data?.image?.size)}`,
      progress: Math.min(100, normalizedProgress * 2.4),
    },
    {
      label: 'RGB normalization',
      value: '224 x 224 tensor',
      detail: 'mean/std normalization | channels: 3',
      progress: Math.min(100, Math.max(0, (clipProgress - 8) * 1.6)),
    },
    {
      label: 'Vision patches',
      value: `${patchCount} patch tokens`,
      detail: 'ViT receptive grid | positional encoding attached',
      progress: Math.min(100, Math.max(0, (clipProgress - 18) * 1.45)),
    },
    {
      label: 'CLIP projection',
      value: `${data?.uploadedImageAnalysis?.embedding?.dimensions || 768} dimensions`,
      detail: `vector preview: [${embeddingPreview.slice(0, 5).map(value => Number(value).toFixed(2)).join(', ')}...]`,
      progress: clipProgress,
    },
    {
      label: 'BLIP caption tokens',
      value: `${captionTokens} tokens`,
      detail: data?.blipCaption || 'Generating semantic caption from visual context',
      progress: blipProgress,
    },
    {
      label: 'pHash / ELA metadata',
      value: normalizedProgress > 72 ? 'Hash + error map ready' : 'Computing forensic signature',
      detail: 'perceptual hash | compression artifact metadata',
      progress: Math.min(100, Math.max(0, (normalizedProgress - 45) * 1.8)),
    },
  ];

  const rowStatus = (progress: number) => {
    if (progress >= 100) return 'done';
    if (progress > 0) return 'active';
    return 'queued';
  };

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-surface-container border border-outline-variant p-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-outline-variant pb-2">
              <Cpu className="w-4 h-4 text-primary" />
              <span className="font-mono text-xs uppercase text-primary">CLIP Embeddings</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between font-mono text-[10px]">
                <span>ViT-L/14 feature projection</span>
                <span>{Math.round(clipProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-surface-container-highest border border-outline-variant">
                <motion.div
                  className="h-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${clipProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <div className="grid grid-cols-6 gap-1 pt-2">
                {embeddingPreview.slice(0, 18).map((value, index) => (
                  <motion.div
                    key={`${index}-${value}`}
                    className="h-8 bg-primary/10 border border-primary/20"
                    initial={{ scaleY: 0.2, opacity: 0.3 }}
                    animate={{ scaleY: Math.max(0.18, Math.abs(Number(value))), opacity: 0.85 }}
                    transition={{ duration: 0.3 }}
                    style={{ transformOrigin: 'bottom' }}
                  />
                ))}
              </div>
              <p className="font-mono text-[9px] text-outline">
                Output: {data?.uploadedImageAnalysis?.embedding?.dimensions || 768}-dimensional semantic vector
              </p>
            </div>
          </div>

          <div className="bg-surface-container border border-outline-variant p-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-outline-variant pb-2">
              <Brain className="w-4 h-4 text-tertiary" />
              <span className="font-mono text-xs uppercase text-tertiary">BLIP Caption</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between font-mono text-[10px]">
                <span>Semantic token decoding</span>
                <span>{Math.round(blipProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-surface-container-highest border border-outline-variant">
                <motion.div
                  className="h-full bg-tertiary"
                  initial={{ width: 0 }}
                  animate={{ width: `${blipProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <div className="bg-surface-container-lowest border border-outline-variant p-3 min-h-20">
                <p className="font-mono text-[9px] text-outline uppercase mb-2">Live Caption Buffer</p>
                <p className="font-mono text-xs text-on-surface-variant leading-relaxed">
                  {data?.blipCaption || `visual subject ${captionTokens > 6 ? 'detected, context expanding' : 'tokens initializing'}...`}
                </p>
              </div>
            </div>
          </div>

          <div className="md:col-span-2 bg-surface-container border border-outline-variant p-4">
            <div className="flex items-center justify-between border-b border-outline-variant pb-2 mb-4">
              <div className="flex items-center gap-2">
                <TerminalIcon className="w-4 h-4 text-primary" />
                <span className="font-mono text-xs uppercase text-primary">Extraction Stream</span>
              </div>
              <span className="font-mono text-[10px] text-outline uppercase">{normalizedProgress}% package build</span>
            </div>
            <div className="space-y-3">
              {extractionRows.map((row) => {
                const status = rowStatus(row.progress);
                return (
                  <div key={row.label} className="grid grid-cols-[24px_1fr_auto] items-center gap-3">
                    <div className={`w-5 h-5 border flex items-center justify-center ${
                      status === 'done'
                        ? 'border-primary bg-primary text-on-primary'
                        : status === 'active'
                        ? 'border-primary text-primary'
                        : 'border-outline-variant text-outline-variant'
                    }`}>
                      {status === 'done' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : status === 'active' ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-[10px] uppercase text-on-surface">{row.label}</span>
                        <span className="font-mono text-[10px] text-primary">{row.value}</span>
                      </div>
                      <p className="font-mono text-[9px] text-outline truncate">{row.detail}</p>
                      <div className="h-1 bg-surface-container-highest mt-2">
                        <motion.div
                          className={status === 'done' ? 'h-full bg-primary' : 'h-full bg-primary/70'}
                          animate={{ width: `${Math.min(100, row.progress)}%` }}
                          transition={{ duration: 0.25 }}
                        />
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-outline">{Math.round(Math.min(100, row.progress))}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="bg-surface-container border border-outline-variant p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-outline-variant pb-2">
            <FileText className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs uppercase text-primary">Feature Package</span>
          </div>
          {[
            ['file', data?.image?.name || 'uploaded image'],
            ['mime', data?.image?.type || 'image/*'],
            ['size', formatBytes(data?.image?.size)],
            ['dimensions', imageDimensions],
            ['clip model', data?.uploadedImageAnalysis?.embedding?.model || 'ViT-L/14'],
            ['caption count', `${data?.blipCaptions?.length || (blipProgress > 96 ? 1 : 0)}`],
            ['status', isProcessing ? 'streaming' : 'ready'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-outline-variant/70 pb-2">
              <span className="font-mono text-[9px] text-outline uppercase">{label}</span>
              <span className="font-mono text-[9px] text-on-surface text-right break-all">{value}</span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
};

const PromptGenView: React.FC<StageViewProps> = ({ data }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (data.structuredPrompt) {
      navigator.clipboard.writeText(data.structuredPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-outline-variant pb-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <span className="font-mono text-xs uppercase text-primary">Generated Prompt</span>
        </div>
        <Button variant="ghost" onClick={handleCopy} className="text-xs">
          {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="bg-surface-container-lowest border border-outline-variant p-4 font-mono text-xs text-on-surface-variant whitespace-pre-wrap max-h-64 overflow-y-auto custom-scrollbar">
        {data.structuredPrompt || 'Generating structured prompt from CLIP embeddings and BLIP caption...'}
      </div>
    </div>
  );
};

const VectorDBView: React.FC<StageViewProps> = ({ data, isProcessing }) => {
  return (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-container border border-outline-variant p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs uppercase">Embeddings Stored</span>
          </div>
          <p className="font-mono text-[10px] text-outline">
            Vector ID: <span className="text-primary">{data.vectorDbId || 'Generating...'}</span>
          </p>
          <p className="font-mono text-[10px] text-outline">
            Dimensions: 768
          </p>
        </div>
        <div className="bg-surface-container border border-outline-variant p-4 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-tertiary" />
            <span className="font-mono text-xs uppercase">Prompt Saved</span>
          </div>
          <p className="font-mono text-[10px] text-outline">
            Status: <span className="text-primary">Indexed</span>
          </p>
        </div>
      </div>
      {isProcessing && (
        <div className="flex items-center gap-3 text-primary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="font-mono text-xs uppercase">Storing in FAISS index...</span>
        </div>
      )}
    </div>
  );
};

const ScanTriggerView: React.FC<StageViewProps> = ({ onNext, isProcessing }) => {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 space-y-6">
      <div className="relative">
        <div className="w-32 h-32 border-4 border-primary/30 rounded-full flex items-center justify-center">
          <motion.div
            className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <Target className="w-12 h-12 text-primary" />
        </div>
      </div>
      <div className="text-center space-y-2">
        <h3 className="font-mono text-lg font-bold uppercase tracking-widest">Ready to Scan</h3>
        <p className="font-mono text-[10px] text-outline">
          {isProcessing
            ? 'Dispatching similarity search across local and web databases'
            : 'Initiate similarity search across local and web databases'}
        </p>
      </div>
      {isProcessing ? (
        <div className="flex items-center gap-3 border border-primary/30 bg-primary/10 px-5 py-3 text-primary">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="font-mono text-[10px] uppercase">Routing feature package into search pipeline</span>
        </div>
      ) : (
        <Button variant="primary" onClick={onNext} disabled={isProcessing} className="px-8 py-3">
          <Play className="w-4 h-4 mr-2" /> Trigger Scan Request
        </Button>
      )}
    </div>
  );
};

const DataRetrievalView: React.FC<StageViewProps> = ({ isProcessing }) => {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 text-primary">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="font-mono text-xs uppercase">Retrieving stored data...</span>
      </div>
      <div className="space-y-2 font-mono text-[10px]">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3 h-3 text-primary" />
          <span>Embedding vector retrieved</span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3 h-3 text-primary" />
          <span>Structured prompt loaded</span>
        </div>
        <div className="flex items-center gap-2">
          {isProcessing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3 h-3 text-primary" />
          )}
          <span>Preparing search query...</span>
        </div>
      </div>
    </div>
  );
};

const LocalDBSearchView: React.FC<StageViewProps & { onNoMatch: () => void }> = ({
  data,
  onNoMatch,
  isProcessing,
}) => {
  const hasMatch = data.localSearchMatch;

  return (
    <div className="p-6 space-y-4">
      {isProcessing && hasMatch === undefined ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-primary">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="font-mono text-xs uppercase">Searching local database...</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="aspect-square bg-surface-container-highest animate-pulse" />
            ))}
          </div>
        </div>
      ) : hasMatch !== undefined ? (
        <div className="space-y-4">
          <div className={`p-4 border ${hasMatch ? 'border-primary/30 bg-primary/5' : 'border-outline-variant bg-surface-container'}`}>
            <div className="flex items-center gap-3">
              {hasMatch ? (
                <CheckCircle2 className="w-6 h-6 text-primary" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-tertiary" />
              )}
              <div>
                <p className="font-mono text-sm font-bold uppercase">
                  {hasMatch ? 'Match Found' : 'No Local Match'}
                </p>
                <p className="font-mono text-[10px] text-outline">
                  {hasMatch
                    ? isProcessing
                      ? 'Registry match confirmed. Routing into decision engine'
                      : 'Similar image found in local database'
                    : isProcessing
                    ? 'Local registry clear. Escalating to web search'
                    : 'Proceeding to web search'}
                </p>
              </div>
            </div>
          </div>
          {!hasMatch && !isProcessing && (
            <Button variant="primary" onClick={onNoMatch} className="w-full">
              <Globe className="w-4 h-4 mr-2" /> Initiate Web Search
            </Button>
          )}
          {!hasMatch && isProcessing && (
            <div className="flex items-center gap-3 border border-tertiary/30 bg-tertiary/10 px-4 py-3 text-tertiary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="font-mono text-[10px] uppercase">Packaging candidate graph for external source search</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

interface WebCandidate {
  id: string;
  label: string;
  domain: string;
  score: number;
  isValid: boolean;
  isSelected: boolean;
}

type WebSearchPhase = 'discovery' | 'validation' | 'focus-lock';

const WEB_SEARCH_DURATION_MS = 5200;
const FEATURE_EXTRACTION_MIN_MS = 1800;
const STAGE_TRANSITION_FAST_MS = 700;
const STAGE_TRANSITION_MEDIUM_MS = 1050;
const STAGE_TRANSITION_SLOW_MS = 1450;
const FETCH_TIMEOUT_MS = 120000;

const WEB_DOMAINS = [
  'lens.google',
  'images.bing',
  'yandex.img',
  'pinterest',
  'behance',
  'dribbble',
  'artstation',
  'instagram',
  'flickr',
  'wikimedia',
  'shopify',
  'etsy',
  'unsplash',
  'reddit',
  'tumblr',
  'medium',
  'cdn cache',
  'portfolio',
  'archive',
  'marketplace',
  'gallery',
  'news img',
  'cloudfront',
  'creator site',
  'reverse api',
];

const buildWebCandidates = (data?: PipelineData): WebCandidate[] => {
  const resultScore = data?.verdict === 'NO EXTERNAL MATCH'
    ? 0
    : Number(data?.webSearchResults?.[0]?.similarity || 0) * 100 || Number(data?.clipSimilarity || 86);
  const validIndexes = new Set([3, 7, 11, 16, 21]);
  const selectedIndex = 11;

  return Array.from({ length: 25 }, (_, index) => {
    const isValid = validIndexes.has(index);
    const score = isValid
      ? Math.max(72, Math.min(98, resultScore - Math.abs(selectedIndex - index) * 1.7 + (index % 3) * 1.2))
      : 24 + ((index * 13) % 39);
    return {
      id: `IMG-${String(index + 1).padStart(2, '0')}`,
      label: index === selectedIndex && data?.matchedImageLabel ? String(data.matchedImageLabel).slice(0, 18) : `Candidate ${index + 1}`,
      domain: WEB_DOMAINS[index],
      score,
      isValid,
      isSelected: index === selectedIndex,
    };
  });
};

const createCandidateTexture = (candidate: WebCandidate) => {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 256;
  textureCanvas.height = 176;
  const context = textureCanvas.getContext('2d');
  if (!context) return null;

  const accent = candidate.isSelected ? '#ffb4ab' : candidate.isValid ? '#ff6b61' : '#98cfe3';
  const gradient = context.createLinearGradient(0, 0, 256, 176);
  gradient.addColorStop(0, candidate.isValid ? '#231313' : '#101a22');
  gradient.addColorStop(1, '#050709');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 176);

  context.strokeStyle = accent;
  context.lineWidth = candidate.isSelected ? 8 : 4;
  context.strokeRect(8, 8, 240, 160);

  context.fillStyle = `${accent}33`;
  for (let index = 0; index < 5; index += 1) {
    context.fillRect(28 + index * 40, 42 + ((index * 17) % 42), 24, 56 - ((index * 9) % 24));
  }

  context.fillStyle = '#e5e1e4';
  context.font = '700 24px monospace';
  context.fillText(candidate.id, 24, 38);
  context.font = '500 16px monospace';
  context.fillStyle = '#c0c8cc';
  context.fillText(candidate.domain.toUpperCase(), 24, 142);
  context.fillStyle = accent;
  context.fillText(`${candidate.score.toFixed(1)}%`, 176, 142);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const WebSearchGraph3D: React.FC<{
  candidates: WebCandidate[];
  isProcessing?: boolean;
  durationMs?: number;
}> = ({ candidates, isProcessing, durationMs = WEB_SEARCH_DURATION_MS }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.set(0, 0.4, 8.2);

    const group = new THREE.Group();
    scene.add(group);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0x98cfe3, 3.2, 18);
    pointLight.position.set(2, 3, 5);
    scene.add(pointLight);

    const centerGeometry = new THREE.SphereGeometry(0.22, 32, 32);
    const centerMaterial = new THREE.MeshBasicMaterial({ color: 0x98cfe3 });
    const centerMesh = new THREE.Mesh(centerGeometry, centerMaterial);
    group.add(centerMesh);

    const haloGeometry = new THREE.TorusGeometry(0.42, 0.01, 12, 64);
    const haloMaterial = new THREE.MeshBasicMaterial({ color: 0x98cfe3, transparent: true, opacity: 0.68 });
    const haloMesh = new THREE.Mesh(haloGeometry, haloMaterial);
    group.add(haloMesh);

    const blueMaterial = new THREE.LineBasicMaterial({ color: 0x2f9dff, transparent: true, opacity: 0.38 });
    const redMaterial = new THREE.LineBasicMaterial({ color: 0xff5a52, transparent: true, opacity: 0.95 });
    const selectedMaterial = new THREE.MeshBasicMaterial({ color: 0xffb4ab, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
    const planeGeometry = new THREE.PlaneGeometry(0.66, 0.46);
    const ringGeometry = new THREE.TorusGeometry(0.48, 0.018, 12, 72);

    const redLines: THREE.Line[] = [];
    const planes: THREE.Mesh[] = [];
    const rings: THREE.Mesh[] = [];
    const textures: THREE.Texture[] = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const baseCameraPosition = new THREE.Vector3(0, 0.4, 8.2);
    const focusCameraPosition = new THREE.Vector3(0, 0.9, 5.3);
    let selectedPosition: THREE.Vector3 | null = null;

    candidates.forEach((candidate, index) => {
      const y = 1 - (index / Math.max(1, candidates.length - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0.05, 1 - y * y));
      const theta = index * goldenAngle;
      const position = new THREE.Vector3(
        Math.cos(theta) * radiusAtY * 3.4,
        y * 2.15,
        Math.sin(theta) * radiusAtY * 2.7
      );

      const blueGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), position]);
      group.add(new THREE.Line(blueGeometry, blueMaterial));

      if (candidate.isValid) {
        const points = Array.from({ length: 42 }, (_, pointIndex) => position.clone().multiplyScalar(pointIndex / 41));
        const redGeometry = new THREE.BufferGeometry().setFromPoints(points);
        redGeometry.setDrawRange(0, 1);
        const redLine = new THREE.Line(redGeometry, redMaterial);
        redLine.userData.totalPoints = points.length;
        redLine.userData.validOrder = redLines.length;
        group.add(redLine);
        redLines.push(redLine);
      }

      const texture = createCandidateTexture(candidate);
      const material = new THREE.MeshBasicMaterial({
        map: texture || undefined,
        color: texture ? 0xffffff : 0x98cfe3,
        transparent: true,
        opacity: candidate.isValid ? 0.96 : 0.76,
        side: THREE.DoubleSide,
      });
      if (texture) textures.push(texture);

      const plane = new THREE.Mesh(planeGeometry, material);
      plane.position.copy(position);
      plane.userData.baseScale = candidate.isSelected ? 1.28 : candidate.isValid ? 1.05 : 0.88;
      plane.userData.selected = candidate.isSelected;
      plane.scale.setScalar(plane.userData.baseScale);
      group.add(plane);
      planes.push(plane);

      if (candidate.isSelected) {
        selectedPosition = position.clone();
        const ring = new THREE.Mesh(ringGeometry, selectedMaterial);
        ring.position.copy(position);
        ring.userData.selected = true;
        group.add(ring);
        rings.push(ring);
      }
    });

    const particlesGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(140 * 3);
    for (let index = 0; index < 140; index += 1) {
      particlePositions[index * 3] = (Math.random() - 0.5) * 8;
      particlePositions[index * 3 + 1] = (Math.random() - 0.5) * 5;
      particlePositions[index * 3 + 2] = (Math.random() - 0.5) * 5;
    }
    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particlesMaterial = new THREE.PointsMaterial({ color: 0x98cfe3, size: 0.018, transparent: true, opacity: 0.46 });
    const particles = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particles);

    const resize = () => {
      const width = Math.max(320, container.clientWidth);
      const height = Math.max(320, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let frameId = 0;
    const startedAt = performance.now();
    const animate = (now: number) => {
      const elapsed = (now - startedAt) / 1000;
      const durationSeconds = durationMs / 1000;
      const normalizedProgress = THREE.MathUtils.clamp(elapsed / durationSeconds, 0, 1);
      const discoveryProgress = THREE.MathUtils.clamp(normalizedProgress / 0.32, 0, 1);
      const validationProgress = THREE.MathUtils.clamp((normalizedProgress - 0.32) / 0.38, 0, 1);
      const focusProgress = THREE.MathUtils.clamp((normalizedProgress - 0.7) / 0.3, 0, 1);

      group.rotation.y = elapsed * (0.07 + discoveryProgress * 0.05);
      group.rotation.x = Math.sin(elapsed * 0.28) * 0.09;
      haloMesh.rotation.z = elapsed * 1.2;
      haloMesh.rotation.x = Math.PI / 2;
      haloMaterial.opacity = 0.38 + focusProgress * 0.3;
      particles.rotation.y = elapsed * 0.018;

      if (selectedPosition) {
        const desiredCamera = baseCameraPosition.clone().lerp(
          focusCameraPosition.clone().add(selectedPosition.clone().multiplyScalar(0.22)),
          THREE.MathUtils.smoothstep(focusProgress, 0, 1)
        );
        camera.position.lerp(desiredCamera, 0.035);
      }
      camera.lookAt(0, 0, 0);

      redLines.forEach((line) => {
        const order = Number(line.userData.validOrder || 0);
        const reveal = THREE.MathUtils.clamp((validationProgress - order * 0.12) / 0.34, 0, 1);
        const total = Number(line.userData.totalPoints || 42);
        line.geometry.setDrawRange(0, Math.max(1, Math.floor(reveal * total)));
      });

      planes.forEach((plane) => {
        plane.lookAt(camera.position);
        const baseScale = Number(plane.userData.baseScale || 1);
        const isSelected = Boolean(plane.userData.selected);
        const pulse = isSelected
          ? 1 + Math.sin(elapsed * 3.5) * (0.05 + focusProgress * 0.1)
          : 1 + Math.sin(elapsed * 1.8 + baseScale) * 0.015;
        const reveal = isSelected ? 0.86 + focusProgress * 0.22 : 0.65 + discoveryProgress * 0.18;
        plane.scale.setScalar(baseScale * pulse * reveal);
      });

      rings.forEach((ring) => {
        ring.lookAt(camera.position);
        const pulse = 1.05 + focusProgress * 0.35 + Math.sin(elapsed * 4.2) * (0.05 + focusProgress * 0.08);
        ring.scale.setScalar(pulse);
        if ('opacity' in ring.material) {
          ring.material.opacity = 0.25 + focusProgress * 0.67;
        }
      });

      centerMesh.scale.setScalar(0.92 + discoveryProgress * 0.22 + Math.sin(elapsed * 2.8) * 0.06);
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.dispose();
      centerGeometry.dispose();
      centerMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      blueMaterial.dispose();
      redMaterial.dispose();
      selectedMaterial.dispose();
      planeGeometry.dispose();
      ringGeometry.dispose();
      particlesGeometry.dispose();
      particlesMaterial.dispose();
      textures.forEach(texture => texture.dispose());
      planes.forEach((plane) => {
        if (Array.isArray(plane.material)) {
          plane.material.forEach(material => material.dispose());
        } else {
          plane.material.dispose();
        }
      });
      scene.clear();
    };
  }, [candidates]);

  return (
    <div ref={containerRef} className="relative h-[430px] min-h-[360px] overflow-hidden border border-outline-variant bg-black">
      <canvas ref={canvasRef} data-testid="web-search-canvas" className="absolute inset-0 w-full h-full" />
      <div className="absolute left-4 top-4 border border-primary/30 bg-black/55 px-3 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-primary">
          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          <span className="font-mono text-[10px] uppercase">{isProcessing ? 'Building search web' : 'Search web resolved'}</span>
        </div>
      </div>
      <div className="absolute right-4 bottom-4 grid grid-cols-3 gap-2 font-mono text-[9px] uppercase">
        <span className="border border-primary/30 bg-primary/10 px-2 py-1 text-primary">25 sources</span>
        <span className="border border-error/30 bg-error/10 px-2 py-1 text-error">5 valid</span>
        <span className="border border-tertiary/30 bg-tertiary/10 px-2 py-1 text-tertiary">1 selected</span>
      </div>
    </div>
  );
};

const WebSearchView: React.FC<StageViewProps> = ({ data, isProcessing }) => {
  const candidates = useMemo(() => buildWebCandidates(data), [data]);
  const selectedCandidate = candidates.find(candidate => candidate.isSelected);
  const validCandidates = candidates.filter(candidate => candidate.isValid);
  const [searchElapsedMs, setSearchElapsedMs] = useState(0);

  useEffect(() => {
    if (!isProcessing) {
      setSearchElapsedMs(WEB_SEARCH_DURATION_MS);
      return;
    }

    setSearchElapsedMs(0);
    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      const elapsed = Math.min(WEB_SEARCH_DURATION_MS, performance.now() - startedAt);
      setSearchElapsedMs(elapsed);
    }, 120);

    return () => window.clearInterval(interval);
  }, [isProcessing]);

  const searchPhase: WebSearchPhase =
    searchElapsedMs < 6500 ? 'discovery' : searchElapsedMs < 14500 ? 'validation' : 'focus-lock';
  const searchProgress = Math.min(100, Math.round((searchElapsedMs / WEB_SEARCH_DURATION_MS) * 100));
  const searchPhaseCopy =
    searchPhase === 'discovery'
      ? 'Building the search lattice and attaching 25 candidate sources'
      : searchPhase === 'validation'
      ? 'Validating candidates and converting trusted links into red forensic paths'
      : 'Locking onto the strongest candidate and sharpening the selected node';
  const searchPhaseSteps: { id: WebSearchPhase; label: string; detail: string }[] = [
    { id: 'discovery', label: 'Discovery', detail: 'Blue web expands across reverse-image and archive sources' },
    { id: 'validation', label: 'Validation', detail: 'Confidence-tested candidates promote into red verified paths' },
    { id: 'focus-lock', label: 'Focus Lock', detail: 'Camera settles on the strongest match and intensifies the signal' },
  ];

  return (
    <div className="p-6 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-outline-variant pb-4">
        <div>
          <h3 className="font-mono text-lg font-bold uppercase tracking-widest">3D Web Source Search</h3>
          <p className="font-mono text-[10px] text-outline uppercase mt-1">
            {searchPhaseCopy}
          </p>
        </div>
        <div className="flex items-center gap-2 text-tertiary">
          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          <span className="font-mono text-[10px] uppercase">
            {isProcessing ? `Reverse search running ${searchProgress}%` : 'Candidate graph complete'}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
        <WebSearchGraph3D candidates={candidates} isProcessing={isProcessing} durationMs={WEB_SEARCH_DURATION_MS} />
        <aside className="bg-surface-container border border-outline-variant p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-outline-variant pb-2">
            <Globe className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs uppercase text-primary">Candidate Validation</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between font-mono text-[9px] uppercase">
              <span className="text-outline">Search Timeline</span>
              <span className="text-primary">{Math.ceil(Math.max(0, WEB_SEARCH_DURATION_MS - searchElapsedMs) / 1000)}s left</span>
            </div>
            <div className="h-2 border border-outline-variant bg-surface-container-lowest">
              <motion.div
                className="h-full bg-primary"
                animate={{ width: `${searchProgress}%` }}
                transition={{ duration: 0.2 }}
              />
            </div>
            <div className="space-y-2">
              {searchPhaseSteps.map((phaseStep, index) => {
                const isActive = phaseStep.id === searchPhase;
                const isDone = searchPhaseSteps.findIndex(item => item.id === searchPhase) > index || !isProcessing && searchProgress >= 100;
                return (
                  <div
                    key={phaseStep.id}
                    className={`border px-3 py-3 ${
                      isActive
                        ? 'border-primary bg-primary/10'
                        : isDone
                        ? 'border-error/30 bg-error/5'
                        : 'border-outline-variant bg-surface-container-lowest'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className={`font-mono text-[10px] uppercase ${isActive ? 'text-primary' : isDone ? 'text-error' : 'text-outline'}`}>
                        {phaseStep.label}
                      </span>
                      <span className="font-mono text-[9px] uppercase text-outline">
                        {isActive ? 'Live' : isDone ? 'Done' : 'Queued'}
                      </span>
                    </div>
                    <p className="font-mono text-[9px] text-on-surface-variant mt-2 leading-relaxed">{phaseStep.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-container-lowest border border-outline-variant p-3">
              <p className="font-mono text-[9px] text-outline uppercase">Images queried</p>
              <p className="font-mono text-2xl font-bold text-primary">25</p>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant p-3">
              <p className="font-mono text-[9px] text-outline uppercase">Valid lines</p>
              <p className="font-mono text-2xl font-bold text-error">{validCandidates.length}</p>
            </div>
          </div>
          {selectedCandidate && (
            <div className="border border-error/40 bg-error/10 p-3">
              <p className="font-mono text-[9px] text-error uppercase mb-1">Selected Match</p>
              <p className="font-mono text-sm text-on-surface break-all">{selectedCandidate.label}</p>
              <p className="font-mono text-[10px] text-error mt-2">{selectedCandidate.score.toFixed(1)}% similarity</p>
            </div>
          )}
          <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-2 pr-1">
            {candidates.map(candidate => (
              <div
                key={candidate.id}
                className={`grid grid-cols-[54px_1fr_auto] items-center gap-2 border px-2 py-2 ${
                  candidate.isSelected
                    ? 'border-error bg-error/10'
                    : candidate.isValid
                    ? 'border-error/30 bg-error/5'
                    : 'border-outline-variant bg-surface-container-lowest'
                }`}
              >
                <span className={`font-mono text-[9px] ${candidate.isValid ? 'text-error' : 'text-primary'}`}>{candidate.id}</span>
                <span className="font-mono text-[9px] text-on-surface-variant truncate">{candidate.domain}</span>
                <span className="font-mono text-[9px] text-outline">{candidate.score.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};

const SimilarityMatchingView: React.FC<StageViewProps> = ({ data, isProcessing }) => {
  const clipSimilarity = Math.max(0, Math.min(100, Number(data?.clipSimilarity || 0)));
  const pHashSimilarity = Math.max(0, Math.min(100, Number(data?.pHashSimilarity || 0)));

  const metricCards = [
    {
      id: 'clip',
      label: 'CLIP Similarity',
      icon: Brain,
      value: clipSimilarity,
      barTone: 'bg-primary',
      valueTone: 'text-primary',
      statusCopy: isProcessing ? 'Semantic vector alignment in progress' : 'Semantic embedding comparison complete',
    },
    {
      id: 'phash',
      label: 'Pixel/pHash Match',
      icon: ImageIcon,
      value: pHashSimilarity,
      barTone: 'bg-tertiary',
      valueTone: 'text-tertiary',
      statusCopy: isProcessing ? 'Pixel signature correlation in progress' : 'Perceptual hash comparison complete',
    },
  ];

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {metricCards.map((card) => {
          const IconComponent = card.icon;
          return (
            <div
              key={card.id}
              className="bg-surface-container border border-outline-variant p-5 lg:p-6 min-h-[170px] flex flex-col justify-between"
            >
              <div className="flex items-center gap-2">
                <IconComponent className={`w-4 h-4 ${card.valueTone}`} />
                <span className="font-mono text-xs uppercase tracking-widest">{card.label}</span>
              </div>

              <div className="space-y-2">
                <div className="flex items-end gap-2">
                  <span className={`font-mono text-5xl leading-none font-bold ${card.valueTone}`}>
                    {card.value.toFixed(1)}%
                  </span>
                  <span className="font-mono text-[10px] uppercase text-outline mb-1">similarity</span>
                </div>
                <p className="font-mono text-[10px] uppercase text-outline">
                  {card.statusCopy}
                </p>
              </div>

              <div className="space-y-2">
                <div className="w-full h-3 border border-outline-variant bg-surface-container-highest">
                  <motion.div
                    className={`h-full ${card.barTone}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${card.value}%` }}
                    transition={{ duration: 0.55, ease: 'easeOut' }}
                  />
                </div>
                <div className="flex items-center justify-between font-mono text-[9px] uppercase text-outline">
                  <span>0%</span>
                  <span>{card.value.toFixed(1)}% confidence</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const MLDecisionView: React.FC<StageViewProps> = ({ data, isProcessing }) => {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 space-y-6">
      <div className="relative">
        <motion.div
          className="w-40 h-40 border-2 border-primary/30 rounded-full"
          animate={{
            boxShadow: isProcessing
              ? ['0 0 20px rgba(152,207,227,0.2)', '0 0 60px rgba(152,207,227,0.6)', '0 0 20px rgba(152,207,227,0.2)']
              : 'none',
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <Brain className="w-16 h-16 text-primary" />
          </div>
        </motion.div>
        {isProcessing && (
          <motion.div
            className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>
      <div className="text-center space-y-2">
        <h3 className="font-mono text-lg font-bold uppercase tracking-widest">ML Decision Engine</h3>
        <p className="font-mono text-[10px] text-outline">
          {isProcessing
            ? 'Analyzing similarity scores and making determination...'
            : `Confidence: ${data.mlConfidence?.toFixed(1) || '--'}%`}
        </p>
      </div>
    </div>
  );
};

interface MatchResult {
  label: string;
  score: number;
  clipScore: number;
  phashScore: number;
  risk: number;
  fraud: string;
  action: string;
  explanation: string;
  source?: string;
  matchedMediaId?: string;
  matchedImageUrl?: string;
  matchedImageLabel?: string;
}

interface ReportFormState {
  reporterName: string;
  reporterEmail: string;
  reporterUserId: string;
  accountJoinedSince: string;
  rightsHolder: string;
  assetId: string;
  assetFilename: string;
  assetMimeType: string;
  assetSizeLabel: string;
  assetSizeBytes: number;
  verdict: string;
  finalScore: number;
  matchedReference: string;
  matchedSource: string;
  targetUrl: string;
  contactEmail: string;
  issueSummary: string;
  notes: string;
  declarationAccepted: boolean;
}

const resolveMatchedAssetPreview = async (matchedMediaId?: string): Promise<string | undefined> => {
  if (!matchedMediaId) {
    return undefined;
  }

  const token = localStorage.getItem('trinetra_access_token') || localStorage.getItem('authToken');
  if (!token) {
    return undefined;
  }

  try {
    const response = await fetch(`/api/dashboard/assets/${matchedMediaId}/preview`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return undefined;
    }
    return typeof payload.preview_url === 'string' ? payload.preview_url : undefined;
  } catch {
    return undefined;
  }
};

const MatchResultCard: React.FC<{ result: MatchResult; blipCaption?: string }> = ({ result, blipCaption }) => {
  const getLabelStyle = (label: string) => {
    switch (label) {
      case 'EXACT MATCH':
        return 'bg-primary/20 border-primary text-primary';
      case 'STRONG MATCH':
        return 'bg-primary/10 border-primary/50 text-primary';
      case 'CROPPED FRAUD':
        return 'bg-error/20 border-error text-error';
      case 'PARTIAL MATCH':
        return 'bg-tertiary/10 border-tertiary/50 text-tertiary';
      default:
        return 'bg-surface-container border-outline-variant text-outline';
    }
  };

  const getActionStyle = (action: string) => {
    switch (action) {
      case 'BLOCK':
        return 'bg-error text-on-error';
      case 'REVIEW':
        return 'bg-tertiary text-on-tertiary-container';
      case 'WEB_SEARCH':
        return 'bg-primary/20 text-primary';
      default:
        return 'bg-surface-container text-on-surface';
    }
  };

  return (
    <div className="bg-surface-container border border-outline-variant p-4 lg:p-5 space-y-4 min-h-[336px] flex flex-col">
      <div className="flex items-center justify-between">
        <span className={`font-mono text-xs font-bold uppercase px-2 py-1 border ${getLabelStyle(result.label)}`}>
          {result.label}
        </span>
        <span className={`font-mono text-[10px] uppercase px-2 py-1 ${getActionStyle(result.action)}`}>
          {result.action}
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="font-mono text-[10px] text-outline">FINAL SCORE</span>
          <span className={`font-mono text-lg font-bold ${
            result.score >= 90 ? 'text-primary' : result.score >= 75 ? 'text-tertiary' : 'text-outline'
          }`}>
            {result.score.toFixed(1)}%
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between font-mono text-[9px] text-outline mb-1">
              <span>CLIP</span>
              <span>{(result.clipScore * 100).toFixed(1)}%</span>
            </div>
            <div className="w-full h-2 bg-surface-container-highest">
              <motion.div
                className="h-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${result.clipScore * 100}%` }}
                transition={{ duration: 0.5, delay: 0.2 }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between font-mono text-[9px] text-outline mb-1">
              <span>pHash</span>
              <span>{(result.phashScore * 100).toFixed(1)}%</span>
            </div>
            <div className="w-full h-2 bg-surface-container-highest">
              <motion.div
                className="h-full bg-tertiary"
                initial={{ width: 0 }}
                animate={{ width: `${result.phashScore * 100}%` }}
                transition={{ duration: 0.5, delay: 0.3 }}
              />
            </div>
          </div>
        </div>
      </div>

      {blipCaption && (
        <div className="bg-surface-container-lowest border border-outline-variant p-3">
          <div className="flex items-start gap-2">
            <Brain className="w-3 h-3 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-mono text-[9px] text-outline uppercase mb-1">BLIP Caption</p>
              <p className="font-mono text-xs text-on-surface-variant italic">"{blipCaption}"</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant p-3 space-y-2 mt-auto">
        <div className="flex justify-between">
          <span className="font-mono text-[9px] text-outline">RISK LEVEL</span>
          <span className={`font-mono text-xs font-bold ${
            result.risk >= 90 ? 'text-error' : result.risk >= 70 ? 'text-tertiary' : 'text-primary'
          }`}>
            {result.risk}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="font-mono text-[9px] text-outline">FRAUD LIKELIHOOD</span>
          <span className="font-mono text-xs">{result.fraud}</span>
        </div>
        {result.explanation && (
          <p className="font-mono text-[9px] text-on-surface-variant pt-2 border-t border-outline-variant">
            {result.explanation}
          </p>
        )}
      </div>

      {result.source && (
        <div className="flex items-center gap-2 text-[10px] text-outline">
          <Globe className="w-3 h-3" />
          <span className="truncate">{result.source}</span>
        </div>
      )}
    </div>
  );
};

const ComparisonView: React.FC<{
  comparisonImage?: string;
  matchedImageUrl?: string;
  matchedImageLabel?: string;
  inputImageUrl?: string;
  onClose: () => void;
}> = ({ comparisonImage, matchedImageUrl, matchedImageLabel, inputImageUrl, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative bg-surface border border-outline-variant p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-mono text-lg font-bold uppercase tracking-widest">Comparison Analysis</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface-container">
            <X className="w-5 h-5" />
          </button>
        </div>
        {(inputImageUrl || matchedImageUrl) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="space-y-2">
              <p className="font-mono text-[10px] text-outline uppercase">Input Image</p>
              <div className="aspect-video border border-outline-variant bg-surface-container-highest overflow-hidden flex items-center justify-center">
                {inputImageUrl ? (
                  <img src={inputImageUrl} alt="Input" className="w-full h-full object-contain" />
                ) : (
                  <p className="font-mono text-[10px] text-outline">No input preview</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <p className="font-mono text-[10px] text-outline uppercase">Matched Local DB Image</p>
              <div className="aspect-video border border-outline-variant bg-surface-container-highest overflow-hidden flex items-center justify-center">
                {matchedImageUrl ? (
                  <img src={matchedImageUrl} alt={matchedImageLabel || 'Matched image'} className="w-full h-full object-contain" />
                ) : (
                  <p className="font-mono text-[10px] text-outline">No matched image available</p>
                )}
              </div>
              {matchedImageLabel && (
                <p className="font-mono text-[10px] text-on-surface-variant break-all">{matchedImageLabel}</p>
              )}
            </div>
          </div>
        )}
        {comparisonImage ? (
          <div className="relative border border-outline-variant">
            <img src={comparisonImage} alt="Comparison" className="w-full h-auto" />
            <Reticle />
          </div>
        ) : (
          <div className="aspect-video bg-surface-container-highest flex items-center justify-center">
            <div className="text-center space-y-2">
              <ImageIcon className="w-12 h-12 text-outline mx-auto" />
              <p className="font-mono text-sm text-outline">No comparison image available</p>
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

const FinalOutputView: React.FC<{
  verdict?: VerdictType;
  matchResult?: MatchResult;
  comparisonImage?: string;
  inputImageUrl?: string;
  blipCaption?: string;
  uploadedImageAnalysis?: PipelineData['uploadedImageAnalysis'];
  onNext?: () => void;
  onReport?: () => void;
  onViewComparison?: () => void;
  onExportReport?: () => void;
  onProtect?: () => void;
}> = ({ verdict, matchResult, comparisonImage, inputImageUrl, blipCaption, uploadedImageAnalysis, onNext, onReport, onViewComparison, onExportReport, onProtect }) => {
  const effectiveLabel = (matchResult?.label || verdict || 'Pending').toString().toUpperCase();
  const isHighRiskLabel = ['MATCH FOUND', 'EXACT MATCH', 'MANIPULATED', 'CROPPED FRAUD'].includes(effectiveLabel);
  const isWarningLabel = ['SUSPICIOUS', 'WEAK'].includes(effectiveLabel);
  const bannerTone = isHighRiskLabel
    ? 'border-error/70 bg-[linear-gradient(90deg,rgba(255,138,128,0.10),rgba(255,138,128,0.03))] text-error'
    : isWarningLabel
    ? 'border-tertiary/70 bg-[linear-gradient(90deg,rgba(246,187,133,0.12),rgba(246,187,133,0.03))] text-tertiary'
    : 'border-primary/70 bg-[linear-gradient(90deg,rgba(152,207,227,0.12),rgba(152,207,227,0.03))] text-primary';
  const bannerSummary =
    effectiveLabel === 'NO EXTERNAL MATCH'
      ? 'Web search completed without a reliable external match.'
      : effectiveLabel === 'PARTIAL MATCH'
      ? 'Moderate match - manual review recommended'
      : effectiveLabel === 'STRONG MATCH'
      ? 'Strong match detected - escalation recommended'
      : effectiveLabel === 'MATCH FOUND' || effectiveLabel === 'EXACT MATCH'
      ? 'High confidence local registry match detected'
      : effectiveLabel === 'CROPPED FRAUD'
      ? 'Possible cropped or transformed misuse detected'
      : effectiveLabel === 'SUSPICIOUS'
      ? 'Suspicious similarity signal detected during analysis'
      : 'Pipeline completed with the strongest available evidence.';
  const Icon = isHighRiskLabel ? XCircle : isWarningLabel ? AlertTriangle : CheckCircle2;
  const matchedReferenceHeading =
    matchResult?.source === 'local_db'
      ? 'Matched Local DB Image'
      : 'Matched Reference';
  const inputLabel = uploadedImageAnalysis?.filename || 'source_image.jpg';
  const matchedLabel = matchResult?.matchedImageLabel || matchResult?.source || 'reference_match.jpg';
  const canOpenComparison = Boolean(comparisonImage || matchResult?.matchedImageUrl);
  const canReport = (matchResult?.score || 0) >= 80;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="p-6 space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`border-2 p-6 lg:p-7 ${bannerTone}`}
        >
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-current/50 bg-black/15">
              <Icon className="w-10 h-10" />
            </div>
            <div>
              <h2 className="font-mono text-xl font-bold uppercase tracking-widest">
                {effectiveLabel}
              </h2>
              <p className="font-mono text-[10px] uppercase text-outline mt-2">
                {bannerSummary}
              </p>
            </div>
          </div>
        </motion.div>

        {matchResult && (
          <div className="grid grid-cols-1 xl:grid-cols-[1.02fr_1.08fr] gap-6">
            <MatchResultCard result={matchResult} blipCaption={blipCaption} />

            <div className="bg-surface-container border border-outline-variant p-4 lg:p-5 space-y-4 min-h-[336px]">
              <div className="flex items-center justify-between border-b border-outline-variant pb-2">
                <span className="font-mono text-xs uppercase tracking-widest text-primary">Visual Comparison</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="aspect-[16/10] bg-surface-container-highest border border-outline-variant flex items-center justify-center overflow-hidden">
                  {inputImageUrl ? (
                    <img src={inputImageUrl} alt="Input preview" className="w-full h-full object-contain" />
                  ) : (
                    <div className="text-center space-y-2">
                      <ImageIcon className="w-8 h-8 text-outline mx-auto" />
                      <p className="font-mono text-[10px] text-outline">source_image.jpg</p>
                    </div>
                  )}
                </div>
                <div className="aspect-[16/10] bg-surface-container-highest border border-outline-variant flex items-center justify-center overflow-hidden">
                  {matchResult?.matchedImageUrl ? (
                    <img src={matchResult.matchedImageUrl} alt={matchResult.matchedImageLabel || 'Matched reference image'} className="w-full h-full object-contain" />
                  ) : comparisonImage ? (
                    <img src={comparisonImage} alt="Comparison preview" className="w-full h-full object-contain" />
                  ) : (
                    <div className="text-center space-y-2">
                      <ImageIcon className="w-8 h-8 text-outline mx-auto" />
                      <p className="font-mono text-[10px] text-outline">comparison.jpg</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[9px] font-mono">
                <div className="bg-surface-container-lowest p-2 border border-outline-variant">
                  <p className="text-outline">INPUT</p>
                  <p className="text-on-surface truncate">{inputLabel}</p>
                </div>
                <div className="bg-surface-container-lowest p-2 border border-outline-variant">
                  <p className="text-outline uppercase">{matchedReferenceHeading}</p>
                  <p className="text-on-surface truncate" title={matchedLabel}>{matchedLabel}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {uploadedImageAnalysis && (
          <div className="bg-surface-container border border-outline-variant p-4 lg:p-5 space-y-5">
            <div className="flex items-center gap-2 border-b border-outline-variant pb-3">
              <Fingerprint className="w-4 h-4 text-primary" />
              <span className="font-mono text-xs uppercase tracking-widest text-primary">Uploaded Image Analysis</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 font-mono text-[10px]">
              <div className="bg-surface-container-lowest border border-outline-variant p-3 space-y-1">
                <p className="text-outline uppercase">File</p>
                <p className="text-on-surface break-all">{uploadedImageAnalysis.filename || 'uploaded-image'}</p>
              </div>
              <div className="bg-surface-container-lowest border border-outline-variant p-3 space-y-1">
                <p className="text-outline uppercase">Embedding Model</p>
                <p className="text-on-surface">{uploadedImageAnalysis.embedding?.model || 'CLIP'}</p>
              </div>
              <div className="bg-surface-container-lowest border border-outline-variant p-3 space-y-1">
                <p className="text-outline uppercase">Vector Type / Dimensions</p>
                <p className="text-on-surface">{uploadedImageAnalysis.embedding?.type || 'full_image'} / {uploadedImageAnalysis.embedding?.dimensions || 0}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-4">
              <div className="bg-surface-container-lowest border border-outline-variant p-3 space-y-3 min-h-[276px]">
                <p className="font-mono text-[10px] text-outline uppercase tracking-widest">Generated Captions</p>
                <div className="space-y-2">
                  {(uploadedImageAnalysis.captions || []).length > 0 ? (
                    uploadedImageAnalysis.captions?.map((caption, index) => (
                      <div key={`${caption}-${index}`} className="border border-outline-variant bg-surface p-2">
                        <p className="font-mono text-[9px] text-outline uppercase">Caption {index + 1}</p>
                        <p className="font-mono text-xs text-on-surface-variant">{caption}</p>
                      </div>
                    ))
                  ) : (
                    <p className="font-mono text-xs text-outline">No captions generated</p>
                  )}
                </div>
              </div>
              <div className="bg-surface-container-lowest border border-outline-variant p-3 space-y-3 min-h-[276px]">
                <p className="font-mono text-[10px] text-outline uppercase tracking-widest">Embedding Preview</p>
                <pre className="h-[216px] overflow-y-auto custom-scrollbar whitespace-pre-wrap text-[10px] text-on-surface-variant bg-black/30 border border-outline-variant p-3">
{JSON.stringify({
  dimensions: uploadedImageAnalysis.embedding?.dimensions || 0,
  vector_preview: uploadedImageAnalysis.embedding?.preview || uploadedImageAnalysis.embedding?.vector?.slice(0, 16) || [],
}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-4 pt-4 border-t border-outline-variant">
          {canReport && (
            <Button variant="danger" onClick={onReport}>
              <AlertTriangle className="w-4 h-4 mr-2" /> Report
            </Button>
          )}
          <Button variant="primary" onClick={onExportReport}>
            <Download className="w-4 h-4 mr-2" /> Export Report
          </Button>
          <Button variant="outline" onClick={onProtect}>
            <Shield className="w-4 h-4 mr-2" /> Protect Asset
          </Button>
          {canOpenComparison && (
            <Button variant="outline" onClick={onViewComparison}>
              <Eye className="w-4 h-4 mr-2" /> View Comparison
            </Button>
          )}
          <Button variant="ghost" onClick={onNext}>
            <Play className="w-4 h-4 mr-2" /> New Scan
          </Button>
        </div>
      </div>
    </div>
  );
};

const BrandMark = ({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) => {
  const sizes = {
    sm: 'h-10 w-10',
    md: 'h-14 w-14',
    lg: 'h-20 w-20',
  };

  return (
    <img
      src={trinetraLogo}
      alt="Trinetra logo"
      className={`${sizes[size]} object-contain ${className}`}
    />
  );
};

// --- Sub-Screens ---

const LegacyAuthScreen = ({ onLogin }: { onLogin: () => void }) => {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGuestLoading, setIsGuestLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSendOtp = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage({ type: 'error', text: 'Enter your email address first.' });
      return;
    }

    try {
      setIsSendingOtp(true);
      setMessage(null);
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const result = await parseAuthResponse(response);
      if (!response.ok) {
        throw new Error(result.detail || result.error || 'Failed to send OTP');
      }
      setOtpSent(true);
      setMessage({ type: 'success', text: `OTP sent to ${normalizedEmail}. Check your inbox.` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to send OTP' });
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !otp.trim()) {
      setMessage({ type: 'error', text: 'Enter your email and the OTP.' });
      return;
    }

    try {
      setIsVerifying(true);
      setMessage(null);
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, otp: otp.trim() }),
      });
      const result = await parseAuthResponse(response);
      if (!response.ok) {
        throw new Error(result.detail || result.error || 'OTP verification failed');
      }
      localStorage.setItem('trinetra_access_token', result.access_token || result.token || '');
      localStorage.setItem('trinetra_user_email', normalizedEmail);
      setMessage({ type: 'success', text: 'Verification successful. Starting secure session...' });
      setTimeout(() => onLogin(), 400);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'OTP verification failed' });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleGuestLogin = async () => {
    try {
      setIsGuestLoading(true);
      setMessage(null);
      localStorage.removeItem('trinetra_access_token');
      localStorage.setItem('trinetra_user_email', 'guest@local');
      localStorage.setItem('trinetra_guest_mode', 'true');
      setMessage({ type: 'success', text: 'Guest session ready. Entering workspace...' });
      setTimeout(() => onLogin(), 250);
    } finally {
      setIsGuestLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-surface overflow-hidden">
      <div className="absolute inset-0 opacity-80">
        <EtheralShadow
          className="h-full w-full"
          color="rgba(137, 170, 185, 0.92)"
          animation={{ scale: 84, speed: 78 }}
          noise={{ opacity: 0.22, scale: 1.15 }}
          sizing="fill"
        />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(19,19,21,0.28),rgba(19,19,21,0.88)_48%,rgba(9,9,11,0.97)_100%)]" />
      <div className="relative flex h-full items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm border border-outline-variant bg-surface/84 p-8 space-y-8 backdrop-blur-md"
        >
          <div className="flex flex-col items-center gap-6">
            <div className="relative flex h-24 w-24 items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-outline opacity-50" />
              <div className="absolute inset-[18px] rounded-full border border-primary animate-pulse" />
              <BrandMark size="lg" className="relative z-10 rounded-full shadow-[0_0_24px_rgba(152,207,227,0.22)]" />
            </div>
            <div className="text-center space-y-1">
              <h1 className="font-mono text-lg font-bold tracking-[0.2em] text-on-surface uppercase">TRINETRA SYSTEM</h1>
              <p className="font-mono text-[10px] text-error uppercase tracking-widest">EMAIL OTP AUTHENTICATION</p>
            </div>
          </div>
          <div className="w-full h-px bg-outline-variant opacity-30" />
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="font-mono text-[10px] text-outline flex items-center gap-2">
                <Fingerprint className="w-3 h-3" /> WORK EMAIL
              </label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                className="w-full bg-surface-container-lowest/95 border border-outline-variant py-3 px-4 font-mono text-sm text-on-surface focus:outline-none focus:border-primary transition-colors sharp-edge"
                placeholder="analyst@company.com"
                autoFocus
              />
            </div>

            <Button className="w-full py-4 text-sm" onClick={handleSendOtp} disabled={isSendingOtp || isVerifying || isGuestLoading}>
              {isSendingOtp ? 'SENDING OTP...' : otpSent ? 'RESEND OTP' : 'SEND OTP'}
            </Button>

            <div className="space-y-2">
              <label className="font-mono text-[10px] text-outline flex items-center gap-2">
                <Shield className="w-3 h-3" /> ONE-TIME PASSWORD
              </label>
              <input
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                className="w-full bg-surface-container-lowest/95 border border-outline-variant py-3 px-4 font-mono text-sm tracking-[0.35em] text-on-surface focus:outline-none focus:border-primary transition-colors sharp-edge"
                placeholder="000000"
              />
            </div>

            {message && (
              <div className={`border p-3 font-mono text-[10px] uppercase tracking-wide ${
                message.type === 'success'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-error/40 bg-error/10 text-error'
              }`}>
                {message.text}
              </div>
            )}

            <Button className="w-full py-4 text-sm" onClick={handleVerifyOtp} disabled={!otpSent || isVerifying || isSendingOtp || isGuestLoading}>
              {isVerifying ? 'VERIFYING...' : 'INITIALIZE SESSION'}
            </Button>

            <Button
              variant="secondary"
              className="w-full py-4 text-sm"
              onClick={handleGuestLogin}
              disabled={isSendingOtp || isVerifying || isGuestLoading}
            >
              {isGuestLoading ? 'ENTERING AS GUEST...' : 'CONTINUE AS GUEST'}
            </Button>
          </div>
          <div className="pt-4 border-t border-outline-variant/20 space-y-2 text-center">
            <div className="flex items-center justify-center gap-2 text-outline">
              <Shield className="w-3 h-3" />
              <span className="font-mono text-[9px] uppercase tracking-wider">OTP delivery and verification secured</span>
            </div>
            <p className="font-mono text-[8px] text-outline-variant uppercase tracking-widest">All attempts are logged & monitored</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

const BootScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [frameLoadedAt, setFrameLoadedAt] = useState<number | null>(null);

  useEffect(() => {
    if (frameLoadedAt === null) {
      return;
    }

    const elapsed = Date.now() - frameLoadedAt;
    const remaining = Math.max(0, BOOT_MIN_DURATION_MS - elapsed);
    const bootTimer = window.setTimeout(() => {
      onComplete();
    }, remaining);

    return () => {
      window.clearTimeout(bootTimer);
    };
  }, [frameLoadedAt, onComplete]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 overflow-hidden bg-black"
    >
      <iframe
        src="/frontend/loading.html"
        title="Trinetra Loading Screen"
        className="h-full w-full border-0"
        onLoad={() => setFrameLoadedAt(Date.now())}
      />
    </motion.div>
  );
};

interface DashboardAsset {
  id: string;
  filename: string;
  mime_type: string;
  created_at: string;
  phash: string;
  preview_url: string;
  is_local_only?: boolean;
  is_registry_only?: boolean;
  protected_asset_id?: string | number;
  protected_owner?: string;
  protected_fingerprint?: string;
  protected_status?: string;
  protected_issued_at?: string;
  protected_captions?: string[];
  scan?: {
    status: string;
    total_matches: number;
    max_risk: string;
    scan_duration_ms: number;
  } | null;
}

interface DashboardSummaryPayload {
  user: {
    email?: string;
    id: string;
    joined_at?: number | string;
  };
  summary: {
    total_assets: number;
    completed_scans: number;
    total_matches: number;
    highest_risk: string;
  };
  recent_assets: DashboardAsset[];
}

interface UserProfileRecord {
  displayName: string;
  age: string;
  sex: string;
  accountJoinedSince: string;
  userId: string;
  profileArtSeed: string;
}

const profileArtLibrary = [
  'https://images.unsplash.com/photo-1515405295579-ba7b45403062?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=600&q=80',
];

const randomChoice = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const buildRandomUserId = () => `TRI-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const getProfileStorageKey = (email: string) => `trinetra_profile_${email.toLowerCase()}`;

const ensureUserProfile = (email: string, joinedAt?: string | number): UserProfileRecord => {
  const existing = localStorage.getItem(getProfileStorageKey(email));
  if (existing) {
    return JSON.parse(existing) as UserProfileRecord;
  }

  const profile: UserProfileRecord = {
    displayName: email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    age: String(21 + Math.floor(Math.random() * 12)),
    sex: randomChoice(['Female', 'Male', 'Non-binary']),
    accountJoinedSince: joinedAt ? new Date(typeof joinedAt === 'number' ? joinedAt * 1000 : joinedAt).toLocaleDateString() : new Date().toLocaleDateString(),
    userId: buildRandomUserId(),
    profileArtSeed: randomChoice(profileArtLibrary),
  };
  localStorage.setItem(getProfileStorageKey(email), JSON.stringify(profile));
  return profile;
};

const fetchWithStoredAuth = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const token = localStorage.getItem('trinetra_access_token');
  const email = localStorage.getItem('trinetra_user_email');
  const headers = new Headers(init.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (email && email !== 'guest@local') {
    headers.set('X-Trinetra-User-Email', email);
  }
  return fetch(input, { ...init, headers });
};

const isServiceUnavailableMessage = (message: string) =>
  /failed to fetch|networkerror|network request failed|load failed|ecconnrefused|fetch failed/i.test(message);

const PROTECTED_ASSET_CACHE_PREFIX = 'trinetra_protected_assets_';
const PROTECTED_CERTIFICATE_CACHE_PREFIX = 'trinetra_protected_certificate_';

const getProtectedAssetCacheKey = (email: string) => `${PROTECTED_ASSET_CACHE_PREFIX}${email.toLowerCase()}`;
const getProtectedCertificateCacheKey = (email: string) => `${PROTECTED_CERTIFICATE_CACHE_PREFIX}${email.toLowerCase()}`;

const readProtectedAssetCache = (email: string): DashboardAsset[] => {
  if (!email || typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(getProtectedAssetCacheKey(email));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((asset) => ({
      ...asset,
      is_local_only: true,
      scan: asset.scan || null,
    }));
  } catch {
    return [];
  }
};

const writeProtectedAssetCache = (email: string, assets: DashboardAsset[]) => {
  if (!email || typeof window === 'undefined') return;
  window.localStorage.setItem(getProtectedAssetCacheKey(email), JSON.stringify(assets));
};

const readProtectedCertificateCache = (email: string): Record<string, Partial<DashboardAsset>> => {
  if (!email || typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(getProtectedCertificateCacheKey(email));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, Partial<DashboardAsset>> : {};
  } catch {
    return {};
  }
};

const writeProtectedCertificateCache = (email: string, cache: Record<string, Partial<DashboardAsset>>) => {
  if (!email || typeof window === 'undefined') return;
  window.localStorage.setItem(getProtectedCertificateCacheKey(email), JSON.stringify(cache));
};

const upsertProtectedCertificateCache = (email: string, asset: DashboardAsset) => {
  const cache = readProtectedCertificateCache(email);
  const metadata: Partial<DashboardAsset> = {
    protected_asset_id: asset.protected_asset_id,
    protected_owner: asset.protected_owner,
    protected_fingerprint: asset.protected_fingerprint,
    protected_status: asset.protected_status,
    protected_issued_at: asset.protected_issued_at,
    protected_captions: asset.protected_captions,
  };

  if (asset.id) {
    cache[`id:${asset.id}`] = { ...(cache[`id:${asset.id}`] || {}), ...metadata };
  }
  if (asset.phash) {
    cache[`phash:${asset.phash}`] = { ...(cache[`phash:${asset.phash}`] || {}), ...metadata };
  }

  writeProtectedCertificateCache(email, cache);
};

const upsertProtectedAssetCache = (email: string, asset: DashboardAsset) => {
  const existing = readProtectedAssetCache(email);
  const next = [asset, ...existing.filter((item) => item.phash !== asset.phash && item.id !== asset.id)]
    .map((item) => ({ ...item, is_local_only: true }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  writeProtectedAssetCache(email, next);
};

const resolveMatchedPreviewFromProtectedCache = (
  matchedMediaId?: string,
  matchedPhash?: string,
): { previewUrl?: string; label?: string } => {
  if (typeof window === 'undefined') {
    return {};
  }

  const userEmail = localStorage.getItem('trinetra_user_email') || 'unknown';
  const protectedAssets = readProtectedAssetCache(userEmail);
  const matchedAsset = protectedAssets.find((asset) => {
    const assetId = String(asset.id || '');
    const protectedAssetId = String(asset.protected_asset_id || '');
    const mediaId = String(matchedMediaId || '');
    const phash = String(matchedPhash || '');

    return (
      (!!mediaId && mediaId !== '0' && (assetId === mediaId || protectedAssetId === mediaId)) ||
      (!!phash && asset.phash === phash)
    );
  });

  if (!matchedAsset?.preview_url) {
    return {};
  }

  return {
    previewUrl: matchedAsset.preview_url,
    label: matchedAsset.filename,
  };
};

const removeProtectedAssetCacheItem = (email: string, assetId: string) => {
  const existing = readProtectedAssetCache(email);
  const nextAssets = existing.filter((item) => item.id !== assetId);
  writeProtectedAssetCache(email, nextAssets);

  const certificateCache = readProtectedCertificateCache(email);
  delete certificateCache[`id:${assetId}`];
  writeProtectedCertificateCache(email, certificateCache);
};

const mergeDashboardAssets = (remoteAssets: DashboardAsset[], localAssets: DashboardAsset[]) => {
  const certificateCache = typeof window === 'undefined'
    ? {}
    : readProtectedCertificateCache(localStorage.getItem('trinetra_user_email') || 'unknown');
  const localByPhash = new Map(localAssets.filter((asset) => asset.phash).map((asset) => [asset.phash, asset]));
  const merged = [
    ...remoteAssets.map((asset) => {
      const localMatch = asset.phash ? localByPhash.get(asset.phash) : undefined;
      const cachedMetadata = (asset.id && certificateCache[`id:${asset.id}`]) || (asset.phash && certificateCache[`phash:${asset.phash}`]) || {};
      return {
        ...asset,
        is_local_only: false,
        protected_asset_id: localMatch?.protected_asset_id || cachedMetadata.protected_asset_id,
        protected_owner: localMatch?.protected_owner || cachedMetadata.protected_owner,
        protected_fingerprint: localMatch?.protected_fingerprint || cachedMetadata.protected_fingerprint,
        protected_status: localMatch?.protected_status || cachedMetadata.protected_status,
        protected_issued_at: localMatch?.protected_issued_at || cachedMetadata.protected_issued_at,
        protected_captions: localMatch?.protected_captions || cachedMetadata.protected_captions,
      };
    }),
    ...localAssets
      .filter((asset) => !asset.phash || !remoteAssets.some((remoteAsset) => remoteAsset.phash === asset.phash))
      .map((asset) => ({ ...asset, is_local_only: true })),
  ];

  return merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
};

const ProtectedAssetBadge = ({ compact = false }: { compact?: boolean }) => (
  <span className={`inline-flex items-center gap-1 border border-primary/30 bg-primary/10 font-mono uppercase text-primary ${compact ? 'px-2 py-0.5 text-[8px]' : 'px-2.5 py-1 text-[9px]'}`}>
    <Shield className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
    Protected
  </span>
);

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Failed to read image preview.'));
    reader.readAsDataURL(file);
  });

const createAssetFingerprint = async (selectedFile: File) => {
  const digest = await crypto.subtle.digest('SHA-256', await selectedFile.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `TRI-${hash.match(/.{1,4}/g)?.slice(0, 8).join('-') || hash.slice(0, 32)}`;
};

const parseApiResponse = async <T,>(response: Response): Promise<T | null> => {
  const raw = await response.text();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    if (!response.ok) {
      throw new Error(raw);
    }
    throw new Error('Received an invalid server response.');
  }
};

const withCacheBusting = (url?: string) => {
  if (!url) return undefined;
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
};

const linkAssetToDashboard = async (file: File) => {
  const assetFormData = new FormData();
  assetFormData.append('file', file);
  const assetResponse = await fetchWithStoredAuth('/assets/upload', {
    method: 'POST',
    body: assetFormData,
  });
  const assetResult = await parseApiResponse<{ detail?: string; asset?: { id?: string | number } }>(assetResponse);
  if (!assetResponse.ok) {
    throw new Error((assetResult && 'detail' in assetResult ? assetResult.detail : undefined) || 'Failed to link protected asset to your dashboard');
  }
  return assetResult?.asset?.id;
};

const triggerAssetTakedown = async (assetId: string) => {
  const response = await fetchWithStoredAuth(`/takedown/${assetId}`, {
    method: 'POST',
  });
  const result = await parseApiResponse<{ detail?: string; contact_email?: string; target_url?: string }>(response);
  if (!response.ok) {
    throw new Error((result && 'detail' in result ? result.detail : undefined) || 'Failed to trigger takedown');
  }
  return result;
};

const submitScanReport = async (payload: {
  reporter_name: string;
  reporter_email: string;
  reporter_user_id?: string;
  account_joined_since?: string;
  rights_holder: string;
  asset_id?: string;
  asset_filename: string;
  asset_mime_type?: string;
  asset_size_bytes?: number;
  verdict?: string;
  final_score: number;
  matched_reference?: string;
  matched_source?: string;
  target_url: string;
  contact_email?: string;
  issue_summary: string;
  notes?: string;
  declaration_accepted: boolean;
}) => {
  const response = await fetchWithStoredAuth('/takedown/report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const result = await parseApiResponse<{ detail?: string; contact_email?: string; target_url?: string }>(response);
  if (!response.ok) {
    throw new Error((result && 'detail' in result ? result.detail : undefined) || 'Failed to submit report');
  }
  return result;
};

const cacheProtectedAssetForDashboard = async (
  userEmail: string,
  file: File,
  phash?: string,
  registryAssetId?: string | number,
  protectedAssetId?: string | number,
  owner?: string,
  fingerprint?: string,
  status?: string,
  captions?: string[],
) => {
  if (!userEmail || userEmail === 'unknown' || userEmail === 'guest@local') return;

  const previewUrl = await fileToDataUrl(file);
  const safePhash = phash || `local-${file.name}-${file.size}`;
  const assetRecord = {
    id: String(registryAssetId || `local-protected-${safePhash}`),
    filename: file.name,
    mime_type: file.type || 'image/*',
    created_at: new Date().toISOString(),
    phash: safePhash,
    preview_url: previewUrl,
    is_local_only: true,
    protected_asset_id: protectedAssetId,
    protected_owner: owner,
    protected_fingerprint: fingerprint,
    protected_status: status,
    protected_issued_at: new Date().toLocaleString(),
    protected_captions: captions || [],
    scan: null,
  } satisfies DashboardAsset;

  upsertProtectedAssetCache(userEmail, assetRecord);
  upsertProtectedCertificateCache(userEmail, assetRecord);
};

const ResultsDashboard = () => {
  const [dashboard, setDashboard] = useState<DashboardSummaryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendWarning, setBackendWarning] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [takedownId, setTakedownId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [localAssetRevision, setLocalAssetRevision] = useState(0);
  const isGuest = localStorage.getItem('trinetra_guest_mode') === 'true';
  const userEmail = localStorage.getItem('trinetra_user_email') || 'unknown';
  const hasLoadedRef = useRef(false);

  const loadDashboard = useCallback(async () => {
    if (isGuest) {
      setIsLoading(false);
      setDashboard(null);
      return;
    }

    if (!localStorage.getItem('trinetra_access_token')) {
      setError('No authenticated session found.');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setBackendWarning(null);
      setActionMessage(null);
      const response = await fetchWithStoredAuth('/api/dashboard/summary');
      const result = await parseApiResponse<DashboardSummaryPayload | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error((result && 'detail' in result ? result.detail : undefined) || 'Failed to load dashboard');
      }
      if (!result || !('user' in result)) {
        throw new Error('Dashboard response was empty.');
      }
      setDashboard(result);
      if (result.user?.email) {
        ensureUserProfile(result.user.email, result.user.joined_at);
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load dashboard';
      if (isServiceUnavailableMessage(message)) {
        setDashboard(null);
        setError(null);
        setBackendWarning('Dashboard backend is offline. Showing locally protected assets only.');
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isGuest]);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void loadDashboard();
  }, [loadDashboard]);

  const handleDeleteAsset = useCallback(async (asset: DashboardAsset) => {
    try {
      setDeletingId(asset.id);
      setError(null);
      setActionMessage(null);
      if (asset.is_local_only) {
        removeProtectedAssetCacheItem(userEmail, asset.id);
        setLocalAssetRevision((value) => value + 1);
        return;
      }
      const response = await fetchWithStoredAuth(`/assets/${asset.id}`, { method: 'DELETE' });
      const result = await parseApiResponse<{ detail?: string }>(response);
      if (!response.ok) {
        throw new Error((result && 'detail' in result ? result.detail : undefined) || 'Failed to delete asset');
      }
      await loadDashboard();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete asset');
    } finally {
      setDeletingId(null);
    }
  }, [loadDashboard, userEmail]);

  const handleTakedown = useCallback(async (asset: DashboardAsset) => {
    try {
      setTakedownId(asset.id);
      setActionMessage(null);
      const result = await triggerAssetTakedown(asset.id);
      setActionMessage({
        type: 'success',
        text: `Takedown notice sent to ${result?.contact_email || 'the detected contact'} for ${result?.target_url || 'the matched asset'}.`,
      });
    } catch (takedownError) {
      setActionMessage({
        type: 'error',
        text: takedownError instanceof Error ? takedownError.message : 'Failed to trigger takedown',
      });
    } finally {
      setTakedownId(null);
    }
  }, []);

  const riskTone = (risk?: string) => {
    switch ((risk || '').toLowerCase()) {
      case 'critical':
      case 'high':
        return 'text-error border-error/30 bg-error/10';
      case 'medium':
        return 'text-tertiary border-tertiary/30 bg-tertiary/10';
      default:
        return 'text-primary border-primary/30 bg-primary/10';
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <header className="flex justify-between items-end border-b border-outline-variant pb-4">
          <div>
            <h1 className="font-mono text-2xl font-bold tracking-tight">ANALYSIS RESULTS</h1>
            <p className="font-mono text-[11px] text-outline uppercase mt-1">Loading authenticated dashboard...</p>
          </div>
        </header>
        <div className="bg-surface-container border border-outline-variant p-8 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="font-mono text-xs uppercase text-primary">Fetching user assets and scans</span>
        </div>
      </div>
    );
  }

  if (isGuest) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <header className="flex justify-between items-end border-b border-outline-variant pb-4">
          <div>
            <h1 className="font-mono text-2xl font-bold tracking-tight">ANALYSIS RESULTS</h1>
            <p className="font-mono text-[11px] text-outline uppercase mt-1">Guest Mode</p>
          </div>
        </header>
        <div className="bg-surface-container border border-outline-variant p-8 space-y-3">
          <p className="font-mono text-sm uppercase tracking-widest text-on-surface">No Data Available In Guest Mode</p>
          <p className="font-mono text-[11px] text-outline uppercase">Please sign up to view dashboard assets and history.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <header className="flex justify-between items-end border-b border-outline-variant pb-4">
          <div>
            <h1 className="font-mono text-2xl font-bold tracking-tight">ANALYSIS RESULTS</h1>
            <p className="font-mono text-[11px] text-outline uppercase mt-1">Dashboard unavailable</p>
          </div>
        </header>
        <div className="bg-surface-container border border-error/30 bg-error/10 p-8 space-y-3">
          <p className="font-mono text-sm uppercase tracking-widest text-error">Failed to load dashboard</p>
          <p className="font-mono text-[11px] text-error/90 uppercase">{error}</p>
        </div>
      </div>
    );
  }

  void localAssetRevision;
  const remoteAssets = dashboard?.recent_assets || [];
  const localAssets = isGuest ? [] : readProtectedAssetCache(userEmail);
  const recentAssets = mergeDashboardAssets(remoteAssets, localAssets);
  const remotePhashes = new Set(remoteAssets.map((asset) => asset.phash).filter(Boolean));
  const localOnlyCount = localAssets.filter((asset) => !asset.phash || !remotePhashes.has(asset.phash)).length;
  const summary = {
    total_assets: (dashboard?.summary.total_assets || 0) + localOnlyCount,
    completed_scans: dashboard?.summary.completed_scans || 0,
    total_matches: dashboard?.summary.total_matches || 0,
    highest_risk: dashboard?.summary.highest_risk || 'low',
  };
  const featuredAsset = recentAssets[0];
  const featuredCertificate = featuredAsset ? dashboardAssetToCertificate(featuredAsset) : null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-end border-b border-outline-variant pb-4">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight">ANALYSIS RESULTS</h1>
          <p className="font-mono text-[11px] text-outline uppercase mt-1">{userEmail}</p>
        </div>
        <Button variant="secondary" className="flex items-center gap-2 px-3 py-1.5" onClick={() => void loadDashboard()}>
          <RefreshCw className="w-3.5 h-3.5" /> REFRESH
        </Button>
      </header>
      {backendWarning ? (
        <div className="border border-tertiary/40 bg-tertiary/10 p-3 font-mono text-xs text-tertiary">
          {backendWarning}
        </div>
      ) : null}
      {actionMessage ? (
        <div className={`border p-3 font-mono text-xs ${actionMessage.type === 'success' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-error/40 bg-error/10 text-error'}`}>
          {actionMessage.text}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface-container border border-outline-variant p-4 space-y-4">
            <div className="relative aspect-square border border-outline-variant bg-black flex items-center justify-center overflow-hidden">
              {featuredAsset?.preview_url ? (
                <img
                  src={featuredAsset.preview_url}
                  className="w-full h-full object-cover opacity-80"
                  alt={featuredAsset.filename}
                />
              ) : (
                <div className="text-center space-y-2">
                  <ImageIcon className="w-10 h-10 text-outline mx-auto" />
                  <p className="font-mono text-[10px] text-outline uppercase">No uploaded assets</p>
                </div>
              )}
              <Reticle />
              <div className="absolute top-1/2 left-0 w-full h-[1px] bg-primary/30 z-10" />
              <div className="absolute top-0 left-1/2 w-[1px] h-full bg-primary/30 z-10" />
            </div>

            <div className="flex items-center justify-between">
              <div className={`px-3 py-1 flex items-center gap-2 border ${riskTone(summary.highest_risk)}`}>
                <AlertTriangle className="w-4 h-4" />
                <span className="font-mono font-bold text-sm tracking-widest uppercase">[ {summary.highest_risk || 'low'} ]</span>
              </div>
              <div className="text-right">
                <div className="font-mono text-[9px] text-outline uppercase">Tracked Assets</div>
                <div className="font-mono text-xl text-primary font-bold">{summary.total_assets || 0}</div>
              </div>
            </div>
            {featuredCertificate ? (
              <Button variant="secondary" className="w-full justify-center text-[10px]" onClick={() => void downloadProtectionCertificate(featuredCertificate)}>
                <Download className="w-3.5 h-3.5 mr-2" />
                Download Certificate
              </Button>
            ) : null}
          </div>

          <div className="bg-surface-container border border-outline-variant p-4">
            <h3 className="font-mono text-[10px] text-outline uppercase border-b border-outline-variant pb-2 mb-3">Latest Asset Data</h3>
            <div className="space-y-2 text-[11px] font-mono">
              <div className="flex justify-between">
                <span className="text-outline uppercase">Filename</span>
                <span className="text-on-surface truncate ml-4">{featuredAsset?.filename || 'N/A'}</span>
              </div>
              {featuredAsset?.is_local_only ? (
                <div className="flex justify-between items-center">
                  <span className="text-outline uppercase">Status</span>
                  <ProtectedAssetBadge compact />
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-outline uppercase">Uploaded</span>
                <span className="text-on-surface">{featuredAsset ? new Date(featuredAsset.created_at).toLocaleString() : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-outline uppercase">pHash</span>
                <span className="text-on-surface truncate ml-4">{featuredAsset?.phash || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-outline uppercase">Scan Status</span>
                <span className="text-on-surface font-bold uppercase">{featuredAsset?.scan?.status || 'Not scanned'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center justify-between border-b border-outline-variant pb-2">
            <h2 className="font-mono text-[10px] text-outline uppercase">Recent User Assets</h2>
            <span className="font-mono text-[10px] text-outline">{recentAssets.length} RECORDS</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recentAssets.length > 0 ? recentAssets.map((asset) => (
              <div key={asset.id} className="bg-surface-container border border-outline-variant p-2 flex gap-3 hover:bg-surface-container-high transition-colors">
                <div className="w-20 h-20 bg-surface-container-lowest border border-outline-variant shrink-0 overflow-hidden">
                  {asset.preview_url ? (
                    <img
                      src={asset.preview_url}
                      className="w-full h-full object-cover opacity-75"
                      alt={asset.filename}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-surface-container-lowest">
                      <ImageIcon className="h-6 w-6 text-outline" />
                    </div>
                  )}
                </div>
                <div className="flex-1 flex flex-col justify-between py-1 overflow-hidden">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-mono text-[12px] text-primary truncate uppercase">{asset.filename}</h4>
                      {asset.is_local_only ? <ProtectedAssetBadge compact /> : null}
                    </div>
                    <p className="font-mono text-[10px] text-outline truncate">{new Date(asset.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center justify-between mt-2 gap-2">
                    <div className="flex items-center gap-1 text-primary uppercase">
                      <Cpu className="w-3 h-3" />
                      <span className="font-mono text-[11px]">{asset.scan?.total_matches || 0} matches</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!asset.is_local_only && (asset.scan?.total_matches || 0) > 0 ? (
                        <button
                          onClick={() => void handleTakedown(asset)}
                          disabled={takedownId === asset.id}
                          className="font-mono text-[9px] uppercase text-tertiary border border-tertiary/30 px-2 py-1 hover:bg-tertiary/10 disabled:opacity-50"
                        >
                          {takedownId === asset.id ? 'Sending' : 'Takedown'}
                        </button>
                      ) : null}
                      {dashboardAssetToCertificate(asset) ? (
                        <button
                          onClick={() => void downloadProtectionCertificate(dashboardAssetToCertificate(asset)!)}
                          className="font-mono text-[9px] uppercase text-primary border border-primary/30 px-2 py-1 hover:bg-primary/10"
                        >
                          Certificate
                        </button>
                      ) : null}
                      <span className={`font-mono text-[9px] uppercase ${asset.scan?.max_risk === 'high' || asset.scan?.max_risk === 'critical' ? 'text-error' : asset.scan?.max_risk === 'medium' ? 'text-tertiary' : 'text-outline'}`}>
                        {asset.scan?.max_risk || 'no risk'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )) : (
              <div className="md:col-span-2 bg-surface-container border border-outline-variant p-8 text-center space-y-3">
                <ImageIcon className="w-10 h-10 text-outline mx-auto" />
                <p className="font-mono text-sm uppercase tracking-widest text-on-surface">No uploaded assets yet</p>
                <p className="font-mono text-[10px] text-outline uppercase">Upload and scan an image to populate your dashboard.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const IntelligenceScanning = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<VeridexResult | null>(null);
  const [workflowState, setWorkflowState] = useState<IntelligenceWorkflowState>('IDLE');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [trainingJob, setTrainingJob] = useState<VeridexFeedbackJob | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const isGuest = localStorage.getItem('trinetra_guest_mode') === 'true';

  useEffect(() => () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  useEffect(() => {
    if (workflowState !== 'RESULT_VISIBLE' || !result) return;

    const feedbackTimer = window.setTimeout(() => {
      setWorkflowState('FEEDBACK_OPEN');
    }, RESULT_DISPLAY_HOLD_MS);

    return () => {
      window.clearTimeout(feedbackTimer);
    };
  }, [result, workflowState]);

  useEffect(() => {
    if (workflowState !== 'TRAINING_SUCCESS') return;

    const successTimer = window.setTimeout(() => {
      setTrainingJob(null);
      setWorkflowState('IDLE');
    }, TRAINING_SUCCESS_HOLD_MS);

    return () => {
      window.clearTimeout(successTimer);
    };
  }, [workflowState]);

  useEffect(() => {
    if (workflowState !== 'TRAINING' || !trainingJob?.job_id) return;

    let isCancelled = false;

    const pollJob = async () => {
      try {
        const response = await fetch(`/api/intelligence/veridex/feedback/jobs/${trainingJob.job_id}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || payload.detail || 'Failed to fetch training status');
        }

        if (isCancelled) return;
        setTrainingJob(payload);

        if (payload.status === 'completed') {
          setTrainingError(null);
          setWorkflowState('TRAINING_SUCCESS');
        } else if (payload.status === 'failed') {
          setTrainingError(payload.error || 'Veridex training failed');
          setWorkflowState('TRAINING_ERROR');
        }
      } catch (pollError) {
        if (isCancelled) return;
        setTrainingError(pollError instanceof Error ? pollError.message : 'Failed to fetch training status');
        setWorkflowState('TRAINING_ERROR');
      }
    };

    void pollJob();
    const intervalId = window.setInterval(() => {
      void pollJob();
    }, FEEDBACK_JOB_POLL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [trainingJob?.job_id, workflowState]);

  const selectFile = (file: File) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setResult(null);
    setError(null);
    setTrainingError(null);
    setTrainingJob(null);
    setWorkflowState('IDLE');
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file?.type.startsWith('image/')) {
      selectFile(file);
    }
  };

  const runVeridex = async () => {
    if (!selectedFile || isGuest) return;

    try {
      setIsAnalyzing(true);
      setWorkflowState('ANALYZING');
      setError(null);
      setTrainingError(null);
      setTrainingJob(null);
      setResult(null);

      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch('/api/intelligence/veridex/analyze', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || payload.detail || 'Veridex analysis failed');
      }

      setResult(payload);
      setWorkflowState('RESULT_VISIBLE');
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : 'Veridex analysis failed');
      setWorkflowState('ANALYSIS_ERROR');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const labelTone = result?.prediction === 'AI'
    ? 'border-error bg-error/10 text-error'
    : 'border-primary bg-primary/10 text-primary';

  const formatProbability = (value?: number) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '--';
    return `${(value * 100).toFixed(1)}%`;
  };

  const workflowStatus = useMemo(() => {
    switch (workflowState) {
      case 'ANALYZING':
        return 'Running';
      case 'RESULT_VISIBLE':
        return 'Result Ready';
      case 'FEEDBACK_OPEN':
        return 'Awaiting Feedback';
      case 'TRAINING':
        return 'Training';
      case 'TRAINING_SUCCESS':
        return 'Training Complete';
      case 'TRAINING_ERROR':
        return 'Training Error';
      case 'ANALYSIS_ERROR':
        return 'Analysis Error';
      default:
        return 'Ready';
    }
  }, [workflowState]);

  const feedbackCopy = useMemo(() => {
    if (!result) return null;

    if (result.prediction === 'AI') {
      return {
        question: 'Is the feedback correct?',
        yesLabel: 'Yes, It is AI / Suspicious',
        noLabel: 'No, It is Real',
        yesValue: 'AI' as const,
        noValue: 'REAL' as const,
      };
    }

    return {
      question: 'Is the feedback correct?',
      yesLabel: 'Yes, It is Real',
      noLabel: 'No, It is AI / Suspicious',
      yesValue: 'REAL' as const,
      noValue: 'AI' as const,
    };
  }, [result]);

  const trainingStageLabel = useMemo(() => {
    switch (trainingJob?.stage) {
      case 'storing':
        return 'Storing temporary feedback sample';
      case 'training':
        return 'Retraining xgb_fusion.pkl';
      case 'cleaning':
        return 'Cleaning temporary feedback data';
      case 'completed':
        return 'Training complete';
      case 'failed':
        return 'Training failed';
      default:
        return 'Queueing training job';
    }
  }, [trainingJob?.stage]);

  const resetWorkflowOverlay = () => {
    setTrainingError(null);
    setTrainingJob(null);
    setWorkflowState('IDLE');
  };

  const handleSkipFeedback = () => {
    setTrainingError(null);
    setTrainingJob(null);
    setWorkflowState('IDLE');
  };

  const submitFeedback = async (userFeedback: 'AI' | 'REAL') => {
    if (!selectedFile || !result) return;

    try {
      setTrainingError(null);
      setTrainingJob(null);
      setWorkflowState('TRAINING');

      const formData = new FormData();
      formData.append('image', selectedFile);
      formData.append('prediction', result.prediction);
      formData.append('user_feedback', userFeedback);
      formData.append('confidence_score', String(result.confidence_score));
      formData.append('ai_probability', String(result.ai_probability));
      formData.append('real_probability', String(result.real_probability));
      if (typeof result.component_scores?.cnn === 'number') {
        formData.append('classifier_score', String(result.component_scores.cnn));
      }

      const response = await fetch('/api/intelligence/veridex/feedback', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || payload.detail || 'Failed to submit Veridex feedback');
      }

      setTrainingJob(payload);
    } catch (feedbackError) {
      setTrainingError(feedbackError instanceof Error ? feedbackError.message : 'Failed to submit Veridex feedback');
      setWorkflowState('TRAINING_ERROR');
    }
  };

  const showWorkflowOverlay = ['FEEDBACK_OPEN', 'TRAINING', 'TRAINING_SUCCESS', 'TRAINING_ERROR'].includes(workflowState);
  const hasActiveWorkflow = ['RESULT_VISIBLE', 'FEEDBACK_OPEN', 'TRAINING', 'TRAINING_SUCCESS'].includes(workflowState);
  const runDisabled = isGuest || !selectedFile || isAnalyzing || hasActiveWorkflow || showWorkflowOverlay;

  return (
    <div className="relative h-full">
      <div className={cn(
        'h-full grid grid-cols-1 xl:grid-cols-2 gap-6 animate-in fade-in duration-500 items-stretch',
        isGuest && 'pointer-events-none select-none blur-[3px] opacity-45',
      )}>
      <div className="h-full">
        <div className="bg-surface-container border border-outline-variant p-6 h-full min-h-[720px] flex flex-col">
          <div className="border-b border-outline-variant pb-3">
            <h2 className="font-mono text-sm font-bold uppercase tracking-widest">Veridex Intelligence</h2>
            <p className="font-mono text-[10px] text-outline uppercase mt-1">Real vs AI detection powered by the Veridex CNN</p>
          </div>

          <label
            className={`mt-5 flex flex-1 min-h-[320px] items-center border-2 border-dashed transition-colors cursor-pointer ${isDragging ? 'border-primary bg-primary/5' : 'border-outline-variant hover:border-primary/50'}`}
            onDrop={handleDrop}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) selectFile(file);
              }}
            />
            <div className="w-full p-8 text-center space-y-3">
              <UploadCloud className="w-12 h-12 text-outline mx-auto" />
              <p className="font-mono text-sm uppercase tracking-widest">{selectedFile ? 'Replace Intelligence Image' : 'Upload Intelligence Image'}</p>
              <p className="font-mono text-[10px] text-outline uppercase">JPG, PNG, WEBP or drag and drop</p>
            </div>
          </label>

          {selectedFile && (
            <div className="mt-5 bg-surface-container-lowest border border-outline-variant p-3 font-mono text-[10px]">
              <p className="text-outline uppercase">Selected File</p>
              <p className="text-on-surface break-all">{selectedFile.name}</p>
            </div>
          )}

          <Button variant="primary" onClick={runVeridex} disabled={runDisabled} className="w-full py-3 mt-5">
            {isAnalyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Cpu className="w-4 h-4 mr-2" />}
            {isAnalyzing ? 'Running...' : 'Run'}
          </Button>

          {error && (
            <div className="mt-5 border border-error/40 bg-error/10 text-error p-3 font-mono text-xs">
              {error}
            </div>
          )}

          <div className="bg-surface-container-lowest border border-outline-variant p-4 font-mono text-[11px] space-y-3 mt-5">
            <div className="flex justify-between items-center border-b border-outline-variant pb-2">
              <span className="text-outline uppercase text-[9px] tracking-widest">Engine Status</span>
              <span className={`text-[9px] uppercase ${workflowState === 'ANALYZING' || workflowState === 'TRAINING' ? 'text-primary animate-pulse' : workflowState === 'ANALYSIS_ERROR' || workflowState === 'TRAINING_ERROR' ? 'text-error' : 'text-on-surface-variant'}`}>
                {workflowStatus}
              </span>
            </div>
            <div className="space-y-1 text-on-surface-variant">
              <div>Model: Veridex CNN (ResNet50)</div>
              <div>Mode: Strict ResNet50 to XGBoost classification</div>
              <div>Weights: `resnet50_veridex.pt` to `xgb_fusion.pkl`</div>
              <div>Runtime: Temporary feedback workflow</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-surface-container border border-outline-variant p-4 flex flex-col min-h-[720px] h-full overflow-hidden">
        <div className="flex items-start justify-between border-b border-outline-variant pb-3 mb-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-outline">Intelligence Preview</p>
            <p className="font-mono text-[10px] text-outline uppercase mt-1 tracking-[0.14em]">CNN inference and confidence breakdown</p>
          </div>
          {result && (
            <span className={`font-mono text-[10px] uppercase px-3 py-1 border tracking-[0.14em] ${labelTone}`}>
              {result.label}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <div className="bg-black relative forensic-grid border border-outline/70 shadow-[inset_0_0_0_1px_rgba(138,146,150,0.16),0_0_0_1px_rgba(64,72,75,0.28)] overflow-hidden min-h-[260px] xl:min-h-[280px] max-h-[300px]">
            {previewUrl ? (
              <>
                <img src={previewUrl} alt="Veridex input" className="w-full h-full object-contain" />
                <Reticle />
                {isAnalyzing && (
                  <motion.div
                    className="scan-line"
                    animate={{ top: ['0%', '100%', '0%'] }}
                    transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }}
                  />
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-center p-6">
                <div className="space-y-3">
                  <ImageIcon className="w-12 h-12 text-outline mx-auto" />
                  <p className="font-mono text-sm uppercase tracking-[0.18em] text-outline">Awaiting Image</p>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
            <div className="bg-surface-container-lowest border border-outline/60 shadow-[inset_0_0_0_1px_rgba(138,146,150,0.12)] p-4 min-w-0 overflow-hidden min-h-[108px] flex flex-col justify-between">
              <p className="font-mono text-[10px] text-outline uppercase tracking-[0.14em]">AI Probability</p>
              <p className="mt-3 font-mono text-[clamp(1.55rem,2vw,2.1rem)] leading-none text-error font-bold tracking-tight whitespace-nowrap">
                {formatProbability(result?.ai_probability)}
              </p>
            </div>
            <div className="bg-surface-container-lowest border border-outline/60 shadow-[inset_0_0_0_1px_rgba(138,146,150,0.12)] p-4 min-w-0 overflow-hidden min-h-[108px] flex flex-col justify-between">
              <p className="font-mono text-[10px] text-outline uppercase tracking-[0.14em]">Real Probability</p>
              <p className="mt-3 font-mono text-[clamp(1.55rem,2vw,2.1rem)] leading-none text-primary font-bold tracking-tight whitespace-nowrap">
                {formatProbability(result?.real_probability)}
              </p>
            </div>
          </div>

          <div className="bg-surface-container-lowest border border-outline/60 shadow-[inset_0_0_0_1px_rgba(138,146,150,0.12)] p-4 space-y-3">
            <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-outline">
              <span>Threshold</span>
              <span>{result ? `${(result.threshold * 100).toFixed(0)}%` : '70%'}</span>
            </div>
            <div className="relative w-full h-2 bg-surface-container-highest border border-outline-variant/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)] overflow-hidden">
              <div
                className="h-full bg-primary/60 transition-all duration-500"
                style={{ width: `${((result?.threshold ?? 0.7) * 100).toFixed(1)}%` }}
              />
              <div
                className="absolute top-1/2 h-4 w-[2px] -translate-y-1/2 bg-primary shadow-[0_0_8px_rgba(166,213,255,0.45)]"
                style={{ left: `calc(${((result?.threshold ?? 0.7) * 100).toFixed(1)}% - 1px)` }}
              />
              {result ? (
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-y-1/2 border border-error bg-error shadow-[0_0_12px_rgba(255,179,171,0.35)] transition-all duration-500"
                  style={{ left: `calc(${(result.ai_probability * 100).toFixed(1)}% - 6px)` }}
                />
              ) : null}
            </div>
            <div className="flex justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-outline">
              <span>{result ? 'AI Score' : 'Threshold Guide'}</span>
              <span>{result ? formatProbability(result.ai_probability) : 'Awaiting result'}</span>
            </div>
          </div>

          <div className="bg-surface-container-lowest border border-outline/60 shadow-[inset_0_0_0_1px_rgba(138,146,150,0.12)] p-4 font-mono text-[10px] space-y-3 flex-1">
            <div>
              <p className="text-outline uppercase tracking-[0.16em]">Engine</p>
              <p className="text-on-surface mt-2 text-[11px] uppercase tracking-[0.08em]">{result?.engine || 'Veridex'}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-outline uppercase tracking-[0.14em]">Model</p>
                <p className="text-on-surface mt-2 break-words">{result?.model || 'Strict Veridex Chain'}</p>
              </div>
              <div>
                <p className="text-outline uppercase tracking-[0.14em]">Weights</p>
                <p className="text-on-surface mt-2 break-all">{result?.weights || 'resnet50_veridex.pt'}</p>
              </div>
              <div>
                <p className="text-outline uppercase tracking-[0.14em]">Raw Score</p>
                <p className="text-on-surface mt-2">{result?.raw_score ?? '--'}</p>
              </div>
              <div>
                <p className="text-outline uppercase tracking-[0.14em]">File</p>
                <p className="text-on-surface mt-2 break-all">{result?.filename || selectedFile?.name || 'N/A'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      {isGuest && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <div className="max-w-xl border border-primary/30 bg-surface-container/95 backdrop-blur-sm p-6 text-center space-y-3">
            <Shield className="w-10 h-10 text-primary mx-auto" />
            <p className="font-mono text-sm uppercase tracking-widest text-on-surface">Signed Up Users Only</p>
            <p className="font-mono text-[10px] text-outline uppercase">This feature should be used by the Signed Up users.</p>
          </div>
        </div>
      )}

      <AnimatePresence>
        {!isGuest && showWorkflowOverlay && (
          <motion.div
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/72 backdrop-blur-sm p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-xl border border-outline bg-surface-container p-6 font-mono shadow-[0_0_0_1px_rgba(138,146,150,0.14),0_24px_80px_rgba(0,0,0,0.5)]"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
            >
              {workflowState === 'FEEDBACK_OPEN' && feedbackCopy && result && (
                <div className="space-y-5">
                  <div className="border-b border-outline-variant pb-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-outline">Feedback Collection</p>
                    <h3 className="mt-2 text-lg uppercase tracking-[0.14em] text-on-surface">{feedbackCopy.question}</h3>
                    <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-on-surface-variant">
                      Result shown: Image Detected: {result.display_label}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <Button variant="primary" onClick={() => void submitFeedback(feedbackCopy.yesValue)} className="w-full justify-center py-3">
                      {feedbackCopy.yesLabel}
                    </Button>
                    <Button variant="secondary" onClick={() => void submitFeedback(feedbackCopy.noValue)} className="w-full justify-center py-3">
                      {feedbackCopy.noLabel}
                    </Button>
                    <Button variant="ghost" onClick={handleSkipFeedback} className="w-full justify-center py-3">
                      <SkipForward className="mr-2 h-4 w-4" />
                      Skip
                    </Button>
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-outline">
                    Skip closes the workflow without storing data or retraining the model.
                  </p>
                </div>
              )}

              {workflowState === 'TRAINING' && (
                <div className="space-y-5">
                  <div className="border-b border-outline-variant pb-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-outline">Training Pipeline</p>
                    <h3 className="mt-2 text-lg uppercase tracking-[0.14em] text-on-surface">Training Loading Screen</h3>
                    <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-on-surface-variant">{trainingStageLabel}</p>
                  </div>
                  <div className="flex items-center gap-3 border border-outline/60 bg-surface-container-lowest p-4">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <div className="space-y-1 text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">
                      <p>Status: {trainingJob?.status || 'queued'}</p>
                      <p>Model: xgb_fusion.pkl only</p>
                      <p>Cleanup: temporary image and feedback record deleted after training</p>
                    </div>
                  </div>
                </div>
              )}

              {workflowState === 'TRAINING_SUCCESS' && (
                <div className="space-y-5">
                  <div className="border-b border-outline-variant pb-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-outline">Training Complete</p>
                    <h3 className="mt-2 text-lg uppercase tracking-[0.14em] text-primary">Veridex Retraining Finished</h3>
                    <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-on-surface-variant">
                      Temporary feedback data was used, cleaned up, and the workflow is returning to idle.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 border border-primary/30 bg-primary/10 p-4 text-primary">
                    <CheckCircle2 className="h-5 w-5" />
                    <div className="space-y-1 text-[10px] uppercase tracking-[0.14em]">
                      <p>Status: completed</p>
                      <p>Model updated: xgb_fusion.pkl</p>
                      <p>Cleanup complete</p>
                    </div>
                  </div>
                </div>
              )}

              {workflowState === 'TRAINING_ERROR' && (
                <div className="space-y-5">
                  <div className="border-b border-outline-variant pb-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-outline">Training Error</p>
                    <h3 className="mt-2 text-lg uppercase tracking-[0.14em] text-error">Veridex retraining failed</h3>
                    <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-on-surface-variant">
                      Temporary feedback cleanup was attempted before returning the workflow to idle.
                    </p>
                  </div>
                  <div className="border border-error/40 bg-error/10 p-4 text-xs text-error">
                    {trainingError || 'An unknown training error occurred.'}
                  </div>
                  <Button variant="primary" onClick={resetWorkflowOverlay} className="w-full justify-center py-3">
                    Close and Return to Idle
                  </Button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const HistoryTable = () => {
  const [historyData, setHistoryData] = useState<DashboardSummaryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendWarning, setBackendWarning] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [takedownId, setTakedownId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [localAssetRevision, setLocalAssetRevision] = useState(0);
  const isGuest = localStorage.getItem('trinetra_guest_mode') === 'true';
  const userEmail = localStorage.getItem('trinetra_user_email') || 'unknown';
  const hasLoadedRef = useRef(false);

  const loadHistory = useCallback(async () => {
    if (isGuest) {
      setIsLoading(false);
      setHistoryData(null);
      return;
    }

    if (!localStorage.getItem('trinetra_access_token')) {
      setError('No authenticated session found.');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setBackendWarning(null);
      setActionMessage(null);
      const response = await fetchWithStoredAuth('/api/dashboard/summary?limit=50');
      const result = await parseApiResponse<DashboardSummaryPayload | { detail?: string }>(response);
      if (!response.ok) {
        throw new Error((result && 'detail' in result ? result.detail : undefined) || 'Failed to load history');
      }
      if (!result || !('recent_assets' in result)) {
        throw new Error('History response was empty.');
      }
      setHistoryData(result);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load history';
      if (isServiceUnavailableMessage(message)) {
        setHistoryData(null);
        setError(null);
        setBackendWarning('History backend is offline. Showing locally protected assets only.');
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isGuest]);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void loadHistory();
  }, [loadHistory]);

  const handleDeleteAsset = useCallback(async (asset: DashboardAsset) => {
    try {
      setDeletingId(asset.id);
      setError(null);
      setActionMessage(null);
      if (asset.is_local_only) {
        removeProtectedAssetCacheItem(userEmail, asset.id);
        setLocalAssetRevision((value) => value + 1);
        return;
      }
      const response = await fetchWithStoredAuth(`/assets/${asset.id}`, { method: 'DELETE' });
      const result = await parseApiResponse<{ detail?: string }>(response);
      if (!response.ok) {
        throw new Error((result && 'detail' in result ? result.detail : undefined) || 'Failed to delete history record');
      }
      await loadHistory();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete history record');
    } finally {
      setDeletingId(null);
    }
  }, [loadHistory, userEmail]);

  const handleTakedown = useCallback(async (asset: DashboardAsset) => {
    try {
      setTakedownId(asset.id);
      setActionMessage(null);
      const result = await triggerAssetTakedown(asset.id);
      setActionMessage({
        type: 'success',
        text: `Takedown notice sent to ${result?.contact_email || 'the detected contact'} for ${result?.target_url || 'the matched asset'}.`,
      });
    } catch (takedownError) {
      setActionMessage({
        type: 'error',
        text: takedownError instanceof Error ? takedownError.message : 'Failed to trigger takedown',
      });
    } finally {
      setTakedownId(null);
    }
  }, []);

  void localAssetRevision;
  const records = mergeDashboardAssets(historyData?.recent_assets || [], isGuest ? [] : readProtectedAssetCache(userEmail));

  const riskTone = (risk?: string) => {
    switch ((risk || '').toLowerCase()) {
      case 'critical':
      case 'high':
        return 'text-error';
      case 'medium':
        return 'text-tertiary';
      default:
        return 'text-primary';
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 transition-all duration-300">
      <header className="border-b border-outline-variant pb-4">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight uppercase">Asset History</h1>
          <p className="font-mono text-[11px] text-outline uppercase mt-1">Forensic record of analyzed digital assets.</p>
        </div>
      </header>
      {actionMessage ? (
        <div className={`border p-3 font-mono text-xs ${actionMessage.type === 'success' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-error/40 bg-error/10 text-error'}`}>
          {actionMessage.text}
        </div>
      ) : null}
      {backendWarning ? (
        <div className="border border-tertiary/40 bg-tertiary/10 p-3 font-mono text-xs text-tertiary">
          {backendWarning}
        </div>
      ) : null}

      <div className="border border-outline-variant bg-surface-container-lowest font-mono overflow-hidden">
        <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b border-outline-variant bg-surface-container-low text-[10px] text-outline uppercase font-bold">
          <div className="col-span-1">Preview</div>
          <div className="col-span-3">Filename</div>
          <div className="col-span-2">Risk</div>
          <div className="col-span-3">Matches / Status</div>
          <div className="col-span-2">Date</div>
          <div className="col-span-1 text-right">Type</div>
        </div>
        {isLoading ? (
          <div className="p-10 flex items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <p className="font-mono text-xs uppercase text-primary">Loading user history</p>
          </div>
        ) : isGuest ? (
          <div className="p-10 text-center space-y-3">
            <History className="w-10 h-10 text-outline mx-auto" />
            <p className="font-mono text-sm uppercase tracking-widest text-on-surface">No Data Available In Guest Mode</p>
            <p className="font-mono text-[10px] text-outline uppercase">Please sign up to view real asset history.</p>
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-3">
            <XCircle className="w-10 h-10 text-error mx-auto" />
            <p className="font-mono text-sm uppercase tracking-widest text-error">History Unavailable</p>
            <p className="font-mono text-[10px] text-error uppercase">{error}</p>
          </div>
        ) : records.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <History className="w-10 h-10 text-outline mx-auto" />
            <p className="font-mono text-sm uppercase tracking-widest text-on-surface">No History Records</p>
            <p className="font-mono text-[10px] text-outline uppercase">Uploaded and scanned assets for this user will appear here.</p>
          </div>
        ) : (
          <div>
            {records.map((asset) => (
              <div
                key={asset.id}
                className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 border-b border-outline-variant last:border-b-0 items-center hover:bg-surface-container transition-colors"
              >
                <div className="md:col-span-1">
                  <div className="w-14 h-14 overflow-hidden border border-outline-variant bg-surface-container-low mx-auto md:mx-0">
                    {asset.preview_url ? (
                      <img src={asset.preview_url} alt={asset.filename} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-surface-container-lowest">
                        <ImageIcon className="h-5 w-5 text-outline" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="md:col-span-3 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-[11px] text-on-surface uppercase truncate">{asset.filename}</p>
                    {asset.is_local_only || asset.is_registry_only ? <ProtectedAssetBadge compact /> : null}
                  </div>
                  <p className="font-mono text-[10px] text-outline truncate">{asset.id}</p>
                </div>
                <div className="md:col-span-2">
                  <p className={`font-mono text-[10px] uppercase font-bold ${riskTone(asset.scan?.max_risk)}`}>
                    {asset.scan?.max_risk || 'not scanned'}
                  </p>
                </div>
                <div className="md:col-span-3">
                  <p className="font-mono text-[10px] text-on-surface uppercase">
                    {asset.scan ? `${asset.scan.total_matches} matches` : '0 matches'}
                  </p>
                  <p className="font-mono text-[10px] text-outline uppercase">
                    {asset.scan?.status || 'pending'}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <p className="font-mono text-[10px] text-on-surface">{new Date(asset.created_at).toLocaleString()}</p>
                </div>
                <div className="md:col-span-1 text-right space-y-2">
                  <span className="font-mono text-[10px] text-outline uppercase block">{asset.mime_type.replace('image/', '')}</span>
                  {!asset.is_local_only && (asset.scan?.total_matches || 0) > 0 ? (
                    <button
                      onClick={() => void handleTakedown(asset)}
                      disabled={takedownId === asset.id}
                      className="font-mono text-[9px] uppercase text-tertiary border border-tertiary/30 px-2 py-1 hover:bg-tertiary/10 disabled:opacity-50"
                    >
                      {takedownId === asset.id ? 'Sending' : 'Takedown'}
                    </button>
                  ) : null}
                  <button
                    onClick={() => void handleDeleteAsset(asset)}
                    disabled={deletingId === asset.id}
                    className="font-mono text-[9px] uppercase text-error border border-error/30 px-2 py-1 hover:bg-error/10 disabled:opacity-50"
                  >
                    {deletingId === asset.id ? 'Deleting' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Pipeline Controller Component ---

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const buildVectorDbId = (file: File) =>
  `vec-${file.name.replace(/[^a-z0-9]/gi, '').slice(0, 10).toLowerCase() || 'asset'}-${String(file.size).slice(-5)}`;

const buildStructuredPrompt = (file: File, captions: string[], matchSource?: string) => {
  const summary = captions.length ? captions.join(' | ') : 'No caption extracted yet';
  return [
    'TASK: IMAGE AUTHENTICITY ANALYSIS',
    `ASSET: ${file.name}`,
    `MIME: ${file.type || 'image/*'}`,
    `SIZE: ${formatBytes(file.size)}`,
    `VISUAL SUMMARY: ${summary}`,
    `SEARCH TARGET: ${matchSource || 'local-first then web graph'}`,
    'OUTPUT REQUIREMENTS:',
    '- compare semantic embedding against registry candidates',
    '- escalate to web graph if local registry confidence is insufficient',
    '- preserve strongest source and candidate rationale for final decision',
  ].join('\n');
};

const isValidHttpUrl = (value?: string) => {
  if (!value?.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const isValidEmail = (value?: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());

const buildScanReportForm = (data: PipelineData, matchResult?: MatchResult): ReportFormState => {
  const userEmail = localStorage.getItem('trinetra_user_email') || '';
  const profile = userEmail ? ensureUserProfile(userEmail) : null;
  const detectedTargetUrl =
    (typeof data.webSearchResults?.[0]?.url === 'string' && data.webSearchResults[0].url) ||
    (data.matchedImageSource === 'web' && isValidHttpUrl(data.matchedImageUrl) ? data.matchedImageUrl : '') ||
    '';
  const reporterName = profile?.displayName || userEmail.split('@')[0] || 'Reporter';
  const verdict = matchResult?.label || data.verdict || 'Pending';

  return {
    reporterName,
    reporterEmail: userEmail,
    reporterUserId: profile?.userId || localStorage.getItem('trinetra_clerk_id') || '',
    accountJoinedSince: profile?.accountJoinedSince || '',
    rightsHolder: reporterName,
    assetId: data.dashboardAssetId || '',
    assetFilename: data.image?.name || data.uploadedImageAnalysis?.filename || 'uploaded-image',
    assetMimeType: data.image?.type || 'image/*',
    assetSizeLabel: formatBytes(data.image?.size),
    assetSizeBytes: data.image?.size || 0,
    verdict: String(verdict),
    finalScore: Number(matchResult?.score || data.mlConfidence || 0),
    matchedReference: data.matchedImageLabel || matchResult?.matchedImageLabel || 'Unavailable',
    matchedSource: data.matchedImageSource || matchResult?.source || 'Unavailable',
    targetUrl: detectedTargetUrl,
    contactEmail: '',
    issueSummary: data.decisionExplanation || 'Potential unauthorized image reuse detected during scan review.',
    notes: '',
    declarationAccepted: false,
  };
};

const PipelineWorkflow: React.FC<{ onNavigateToDashboard?: () => void }> = ({ onNavigateToDashboard }) => {
  const [pipelineState, setPipelineState] = useState<PipelineState>({
    currentStep: 'INPUT_IMAGE',
    status: 'idle',
    data: {},
    history: [],
    skippedSteps: [],
  });
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [guestRestrictionFeature, setGuestRestrictionFeature] = useState<string | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showReportSubmittedModal, setShowReportSubmittedModal] = useState(false);
  const [reportForm, setReportForm] = useState<ReportFormState | null>(null);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportMessage, setReportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showProtectModal, setShowProtectModal] = useState(false);
  const [protectOwnerName, setProtectOwnerName] = useState('protected_asset');
  const [isProtecting, setIsProtecting] = useState(false);
  const [protectMessage, setProtectMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const isGuest = localStorage.getItem('trinetra_guest_mode') === 'true';

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const updatePipelineData = useCallback((updates: Partial<PipelineData>) => {
    setPipelineState(prev => ({
      ...prev,
      data: { ...prev.data, ...updates },
    }));
  }, []);

  const advanceToStep = useCallback((step: PipelineStep) => {
    setPipelineState(prev => ({
      ...prev,
      currentStep: step,
      history: [...prev.history, prev.currentStep],
    }));
  }, []);

  const simulatePipelineProgress = useCallback(async () => {
    const file = pipelineState.data.image;
    if (!file) return;

    setPipelineState(prev => ({ ...prev, status: 'running' }));
    advanceToStep('FEATURE_EXTRACTION');
    const featurePhaseStartedAt = Date.now();

    try {
      const formData = new FormData();
      formData.append('file', file);
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch('/api/analyze-image', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const result = await parseApiResponse<Record<string, any>>(response);
      if (!response.ok) {
        throw new Error(
          (result && typeof result === 'object' && ('error' in result || 'detail' in result)
            ? String(result.error || result.detail)
            : undefined) || `Pipeline analysis failed (${response.status})`
        );
      }
      if (!result) {
        throw new Error('Pipeline returned an empty response.');
      }

      await wait(Math.max(0, FEATURE_EXTRACTION_MIN_MS - (Date.now() - featurePhaseStartedAt)));
      const comparisonImage = withCacheBusting(result.visual);
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
      const matchedMediaId =
        result.matched_media_id ||
        result.matchedMediaId ||
        result.matched_id ||
        result.local_match?.media_id ||
        result.local_match?.mediaId ||
        result.local_match?.id;
      const matchedPhash =
        result.matched_phash ||
        result.matchedPhash ||
        result.local_match?.phash;
      const matchedImageLabel =
        result.evidence?.matched_file ||
        result.matched_file ||
        result.match?.filename ||
        result.match?.title ||
        result.title ||
        result.source ||
        result.source_url;
      let matchedImageUrl = withCacheBusting(matchedImageUrlRaw);
      if (!matchedImageUrl && matchedMediaId && String(matchedMediaId) !== '0') {
        const resolvedPreviewUrl = await resolveMatchedAssetPreview(String(matchedMediaId));
        matchedImageUrl = withCacheBusting(resolvedPreviewUrl);
      }
      const cachedMatchedPreview = !matchedImageUrl
        ? resolveMatchedPreviewFromProtectedCache(
            matchedMediaId ? String(matchedMediaId) : undefined,
            matchedPhash ? String(matchedPhash) : undefined,
          )
        : {};
      if (!matchedImageUrl && cachedMatchedPreview.previewUrl) {
        matchedImageUrl = cachedMatchedPreview.previewUrl;
      }
      const captions = result.uploaded_image_analysis?.captions || result.blip_captions || [];
      const primaryCaption = captions[0] || '';
      const structuredPrompt = buildStructuredPrompt(file, captions, result.source);
      const vectorDbId = buildVectorDbId(file);
      const clipSimilarity = result.clip_score ?? result.score;
      const pHashSimilarity = result.phash_score ?? result.score * 0.8;
      const baseUpdates: Partial<PipelineData> = {
        structuredPrompt,
        vectorDbId,
        blipCaption: primaryCaption,
        blipCaptions: captions,
        uploadedImageAnalysis: result.uploaded_image_analysis,
        comparisonImage,
        matchedImageUrl,
        matchedImageLabel: matchedImageLabel || cachedMatchedPreview.label,
        matchedImageSource: result.source,
        matchedMediaId: matchedMediaId ? String(matchedMediaId) : undefined,
        matchedPhash: matchedPhash ? String(matchedPhash) : undefined,
        clipSimilarity,
        pHashSimilarity,
        webSearchAttempted: result.web_search_attempted !== false,
        decisionExplanation: result.explanation,
        decisionAction: result.action,
        fraudLikelihood: result.fraud,
      };

      updatePipelineData(baseUpdates);
      advanceToStep('PROMPT_GEN');
      await wait(STAGE_TRANSITION_MEDIUM_MS);
      advanceToStep('VECTOR_DB_STORAGE');
      await wait(STAGE_TRANSITION_FAST_MS);
      advanceToStep('SCAN_TRIGGER');
      await wait(STAGE_TRANSITION_FAST_MS);
      advanceToStep('DATA_RETRIEVAL');
      await wait(STAGE_TRANSITION_MEDIUM_MS);
      advanceToStep('LOCAL_DB_SEARCH');

      if (result.match_found) {
        updatePipelineData({
          ...baseUpdates,
          localSearchMatch: true,
          localMatchScore: result.score,
          localSearchResults: [{ source: 'registry', label: matchedImageLabel || 'Protected asset hit', similarity: result.score / 100 }],
          verdict: 'Match Found',
          mlConfidence: result.score,
          pHashSimilarity: result.phash_score || result.score * 0.9,
        });
        setPipelineState(prev => ({ ...prev, skippedSteps: ['WEB_SEARCH', 'SIMILARITY_MATCHING'] }));
        await wait(STAGE_TRANSITION_SLOW_MS);
        advanceToStep('ML_DECISION');
        await wait(STAGE_TRANSITION_MEDIUM_MS);
        advanceToStep('FINAL_OUTPUT');
      } else if (result.label === 'NO EXTERNAL MATCH') {
        updatePipelineData({
          ...baseUpdates,
          localSearchMatch: false,
          localSearchResults: [],
          webSearchResults: [],
          clipSimilarity,
          pHashSimilarity,
          verdict: 'NO EXTERNAL MATCH',
          mlConfidence: result.score ?? 0,
          matchedImageSource: result.source || baseUpdates.matchedImageSource,
        });
        const webSearchAttempted = result.web_search_attempted !== false;
        setPipelineState(prev => ({ ...prev, skippedSteps: webSearchAttempted ? [] : ['WEB_SEARCH', 'SIMILARITY_MATCHING'] }));
        if (webSearchAttempted) {
          await wait(STAGE_TRANSITION_FAST_MS);
          advanceToStep('WEB_SEARCH');
          await wait(Math.max(STAGE_TRANSITION_SLOW_MS, WEB_SEARCH_DURATION_MS - 300));
          advanceToStep('SIMILARITY_MATCHING');
          await wait(STAGE_TRANSITION_MEDIUM_MS);
        } else {
          await wait(STAGE_TRANSITION_SLOW_MS);
        }
        advanceToStep('ML_DECISION');
        await wait(STAGE_TRANSITION_MEDIUM_MS);
        advanceToStep('FINAL_OUTPUT');
      } else {
        updatePipelineData({
          ...baseUpdates,
          localSearchMatch: false,
          localSearchResults: [],
          webSearchResults: result.source === 'web' ? [{ url: result.source_url, similarity: result.score / 100 }] : [],
          clipSimilarity,
          pHashSimilarity,
          verdict: result.label,
          mlConfidence: result.score,
        });
        setPipelineState(prev => ({ ...prev, skippedSteps: [] }));
        await wait(STAGE_TRANSITION_FAST_MS);
        advanceToStep('WEB_SEARCH');
        await wait(WEB_SEARCH_DURATION_MS);
        advanceToStep('SIMILARITY_MATCHING');
        await wait(STAGE_TRANSITION_MEDIUM_MS);
        advanceToStep('ML_DECISION');
        await wait(STAGE_TRANSITION_MEDIUM_MS);
        advanceToStep('FINAL_OUTPUT');
      }

      setPipelineState(prev => ({ ...prev, status: 'complete' }));

    } catch (error) {
      console.error('Pipeline error:', error);
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'Pipeline request timed out while extracting features.'
        : error instanceof Error
        ? error.message
        : 'Pipeline analysis failed';
      updatePipelineData({
        verdict: 'Error',
        decisionExplanation: message,
      });
      setPipelineState((prev: PipelineState) => ({ ...prev, status: 'error' }));
    }
  }, [pipelineState.data.image, updatePipelineData, advanceToStep]);

  const handleFileSelect = (file: File, preview: string) => {
    updatePipelineData({ image: file, imagePreview: preview });
  };

  const handleReset = () => {
    setShowComparison(false);
    setGuestRestrictionFeature(null);
    setShowReportModal(false);
    setShowReportSubmittedModal(false);
    setReportForm(null);
    setReportMessage(null);
    setShowProtectModal(false);
    setProtectMessage(null);
    setPipelineState({
      currentStep: 'INPUT_IMAGE',
      status: 'idle',
      data: {},
      history: [],
      skippedSteps: [],
    });
  };

  const buildMatchResult = (data: PipelineData): MatchResult | undefined => (
    data.verdict && data.verdict !== 'Error' ? {
      label: data.verdict === 'Manipulated' ? 'EXACT MATCH' : data.verdict === 'Authentic' ? 'AUTHENTIC' : data.verdict,
      score: typeof data.mlConfidence === 'number' ? data.mlConfidence : 0,
      clipScore: typeof data.clipSimilarity === 'number' ? data.clipSimilarity / 100 : 0,
      phashScore: typeof data.pHashSimilarity === 'number' ? data.pHashSimilarity / 100 : 0,
      risk: typeof data.mlConfidence === 'number' ? data.mlConfidence : 0,
      fraud: data.fraudLikelihood || (data.verdict === 'NO EXTERNAL MATCH' || data.verdict === 'Authentic' ? 'LOW' : (data.mlConfidence && data.mlConfidence > 80 ? 'HIGH' : 'MEDIUM')),
      action: data.decisionAction || (data.verdict === 'NO EXTERNAL MATCH' || data.verdict === 'Authentic' ? 'PASS' : (data.mlConfidence && data.mlConfidence > 90 ? 'BLOCK' : 'REVIEW')),
      explanation: data.decisionExplanation || (data.localSearchMatch ? 'Local DB similarity >=80%' : data.webSearchAttempted ? 'Web search completed without a reliable external match.' : 'Similarity analysis completed'),
      source: data.matchedImageSource,
      matchedMediaId: data.matchedMediaId,
      matchedImageUrl: data.matchedImageUrl,
      matchedImageLabel: data.matchedImageLabel,
    } : undefined
  );

  const updateReportFormField = useCallback(<K extends keyof ReportFormState,>(field: K, value: ReportFormState[K]) => {
    setReportForm(prev => (prev ? { ...prev, [field]: value } : prev));
    setReportMessage(null);
  }, []);

  const openReportModal = useCallback(() => {
    if (isGuest) {
      setGuestRestrictionFeature('Report');
      return;
    }
    setProtectMessage(null);
    setReportMessage(null);
    setShowReportSubmittedModal(false);
    setReportForm(buildScanReportForm(pipelineState.data, buildMatchResult(pipelineState.data)));
    setShowReportModal(true);
  }, [isGuest, pipelineState.data]);

  const handleSubmitReport = useCallback(async () => {
    if (localStorage.getItem('trinetra_guest_mode') === 'true') {
      setReportMessage({ type: 'error', text: 'Sign in to submit a report and trigger takedown.' });
      return false;
    }

    if (!reportForm) {
      setReportMessage({ type: 'error', text: 'Report form is not ready yet.' });
      return false;
    }

    if (!reportForm.reporterEmail.trim()) {
      setReportMessage({ type: 'error', text: 'Reporter email is required.' });
      return false;
    }

    if (!isValidEmail(reportForm.reporterEmail)) {
      setReportMessage({ type: 'error', text: 'Reporter email must be a valid email address.' });
      return false;
    }

    if (!reportForm.contactEmail.trim()) {
      setReportMessage({ type: 'error', text: 'Official contact email is required.' });
      return false;
    }

    if (!isValidEmail(reportForm.contactEmail)) {
      setReportMessage({ type: 'error', text: 'Official contact email must be a valid email address.' });
      return false;
    }

    if (!reportForm.targetUrl.trim()) {
      setReportMessage({ type: 'error', text: 'Target URL is required.' });
      return false;
    }

    if (!isValidHttpUrl(reportForm.targetUrl)) {
      setReportMessage({ type: 'error', text: 'Target URL must be a valid http or https link.' });
      return false;
    }

    if (!reportForm.issueSummary.trim()) {
      setReportMessage({ type: 'error', text: 'Issue summary is required.' });
      return false;
    }

    if (!reportForm.declarationAccepted) {
      setReportMessage({ type: 'error', text: 'Please confirm the declaration before submitting.' });
      return false;
    }

    try {
      setIsSubmittingReport(true);
      setReportMessage(null);
      const result = await submitScanReport({
        reporter_name: reportForm.reporterName.trim(),
        reporter_email: reportForm.reporterEmail.trim(),
        reporter_user_id: reportForm.reporterUserId.trim() || undefined,
        account_joined_since: reportForm.accountJoinedSince.trim() || undefined,
        rights_holder: reportForm.reporterName.trim() || reportForm.rightsHolder.trim(),
        asset_id: reportForm.assetId.trim() || undefined,
        asset_filename: reportForm.assetFilename,
        asset_mime_type: reportForm.assetMimeType || undefined,
        asset_size_bytes: reportForm.assetSizeBytes || undefined,
        verdict: reportForm.verdict,
        final_score: reportForm.finalScore,
        matched_reference: reportForm.matchedReference || undefined,
        matched_source: reportForm.matchedSource || undefined,
        target_url: reportForm.targetUrl.trim(),
        contact_email: reportForm.contactEmail.trim(),
        issue_summary: reportForm.issueSummary.trim(),
        notes: reportForm.notes.trim() || undefined,
        declaration_accepted: reportForm.declarationAccepted,
      });
      setReportMessage(null);
      return true;
    } catch (error) {
      setReportMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to submit report',
      });
      return false;
    } finally {
      setIsSubmittingReport(false);
    }
  }, [reportForm]);

  const handleReportSubmitSuccess = useCallback(() => {
    setShowReportModal(false);
    setShowReportSubmittedModal(true);
  }, []);

  const handleCloseReportSubmitted = useCallback(() => {
    setShowReportSubmittedModal(false);
    setReportForm(null);
    setReportMessage(null);
    onNavigateToDashboard?.();
  }, [onNavigateToDashboard]);

  const canSubmitReport = Boolean(
    reportForm?.reporterEmail.trim() &&
    isValidEmail(reportForm?.reporterEmail) &&
    reportForm?.contactEmail.trim() &&
    isValidEmail(reportForm?.contactEmail) &&
    reportForm?.targetUrl.trim() &&
    isValidHttpUrl(reportForm?.targetUrl) &&
    reportForm?.issueSummary.trim() &&
    reportForm?.declarationAccepted &&
    !isSubmittingReport,
  );

  const handleExportReport = (data: PipelineData, matchResult?: MatchResult) => {
    const generatedAt = new Date();
    const captions = data.blipCaptions || data.uploadedImageAnalysis?.captions || [];
    const embeddingPreview = data.uploadedImageAnalysis?.embedding?.preview || [];
    const formatPercent = (value?: number) => `${(value ?? 0).toFixed(2)}%`;
    const normalizedVerdict = data.verdict || 'Pending';
    const finalLabel = matchResult?.label || normalizedVerdict;
    const matchReference = data.matchedImageLabel || matchResult?.matchedImageLabel || 'N/A';
    const matchSource = data.localSearchMatch
      ? 'Local protected asset database'
      : data.matchedImageSource || matchResult?.source || 'External source';
    const summaryLine =
      normalizedVerdict === 'Match Found'
        ? 'A protected asset match was detected during analysis.'
        : normalizedVerdict === 'NO EXTERNAL MATCH'
        ? 'No external match was detected for the submitted image.'
        : normalizedVerdict === 'Manipulated'
        ? 'A high-confidence similarity event was detected and flagged for review.'
        : normalizedVerdict === 'Suspicious'
        ? 'The submitted image triggered a suspicious similarity signal.'
        : 'Analysis completed with the available detection data.';
    const separator = '='.repeat(78);
    const subSeparator = '-'.repeat(78);
    const lines = [
      separator,
      'TRINETRA DIGITAL ASSET ANALYSIS REPORT',
      separator,
      `Generated On        : ${generatedAt.toLocaleString()}`,
      `Report Timestamp    : ${generatedAt.toISOString()}`,
      `Case Status         : ${normalizedVerdict}`,
      '',
      subSeparator,
      'EXECUTIVE SUMMARY',
      subSeparator,
      summaryLine,
      '',
      subSeparator,
      'SUBMITTED ASSET',
      subSeparator,
      `File Name           : ${data.image?.name || 'uploaded-image'}`,
      `Detection Verdict   : ${finalLabel}`,
      `Confidence Score    : ${formatPercent(data.mlConfidence)}`,
      `Source Match        : ${matchSource}`,
      `Matched Reference   : ${matchReference}`,
      '',
      subSeparator,
      'ANALYSIS METRICS',
      subSeparator,
      `CLIP Similarity     : ${formatPercent(data.clipSimilarity)}`,
      `pHash Similarity    : ${formatPercent(data.pHashSimilarity)}`,
      `Risk Level          : ${matchResult?.fraud || 'N/A'}`,
      `Recommended Action  : ${matchResult?.action || 'N/A'}`,
      `Decision Rationale  : ${matchResult?.explanation || 'N/A'}`,
      '',
      subSeparator,
      'VISUAL / SEMANTIC OBSERVATIONS',
      subSeparator,
      `Generated Captions  : ${captions.length ? captions.join(' | ') : 'N/A'}`,
      '',
      subSeparator,
      'TECHNICAL DETAILS',
      subSeparator,
      `Embedding Model     : ${data.uploadedImageAnalysis?.embedding?.model || 'N/A'}`,
      `Embedding Type      : ${data.uploadedImageAnalysis?.embedding?.type || 'N/A'}`,
      `Embedding Dimension : ${data.uploadedImageAnalysis?.embedding?.dimensions || 0}`,
      `Vector Preview      : ${embeddingPreview.length ? JSON.stringify(embeddingPreview) : 'N/A'}`,
      `Comparison Artifact : ${data.comparisonImage || 'N/A'}`,
      '',
      subSeparator,
      'END OF REPORT',
      subSeparator,
      'Generated by Trinetra for digital asset comparison and authenticity review.',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trinetra-report-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleProtectAsset = async () => {
    const file = pipelineState.data.image;
    if (!file) {
      setProtectMessage({ type: 'error', text: 'No scanned image is available to protect.' });
      return;
    }

    const artistName = protectOwnerName.trim();
    if (!artistName) {
      setProtectMessage({ type: 'error', text: 'Enter an artist or owner name.' });
      return;
    }

    try {
      setIsProtecting(true);
      setProtectMessage(null);
      const fingerprint = await createAssetFingerprint(file);
      const formData = new FormData();
      formData.append('artist_name', artistName);
      formData.append('user_email', localStorage.getItem('trinetra_user_email') || '');
      formData.append('file', file);

      const response = await fetch('/register', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error || 'Failed to protect asset');
      }

      if (localStorage.getItem('trinetra_guest_mode') !== 'true') {
        try {
          const registryAssetId = await linkAssetToDashboard(file);
          if (registryAssetId) {
            updatePipelineData({ dashboardAssetId: String(registryAssetId) });
          }
          await cacheProtectedAssetForDashboard(
            localStorage.getItem('trinetra_user_email') || 'unknown',
            file,
            result.phash,
            registryAssetId,
            result.asset_id || result.deduplicated_id,
            artistName,
            fingerprint,
            result.status === 'duplicate' ? 'Duplicate protected asset' : 'Registered protected asset',
            result.blip_captions,
          );
        } catch (linkError) {
          await cacheProtectedAssetForDashboard(
            localStorage.getItem('trinetra_user_email') || 'unknown',
            file,
            result.phash,
            undefined,
            result.asset_id || result.deduplicated_id,
            artistName,
            fingerprint,
            result.status === 'duplicate' ? 'Duplicate protected asset' : 'Registered protected asset',
            result.blip_captions,
          );
          const baseMessage = result.status === 'duplicate'
            ? `Asset already protected. Existing ID: ${result.deduplicated_id}`
            : `Asset protected successfully. Asset ID: ${result.asset_id}`;
          setProtectMessage({
            type: 'success',
            text: `${baseMessage}. Dashboard linking is unavailable right now, but protection was completed.`,
          });
          return;
        }
      }

      const message = result.status === 'duplicate'
        ? `Asset already protected. Existing ID: ${result.deduplicated_id}`
        : `Asset protected successfully. Asset ID: ${result.asset_id}`;
      setProtectMessage({ type: 'success', text: message });
    } catch (error) {
      setProtectMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to protect asset' });
    } finally {
      setIsProtecting(false);
    }
  };

  const renderCurrentStage = () => {
    const { currentStep, data } = pipelineState;
    const isProcessing = pipelineState.status === 'running';

    if (pipelineState.status === 'error') {
      return (
        <PipelineErrorView
          message={data.decisionExplanation}
          onRetry={() => {
            setProtectMessage(null);
            setPipelineState(prev => ({
              ...prev,
              currentStep: 'INPUT_IMAGE',
              status: 'idle',
              history: [],
              skippedSteps: [],
              data: {
                ...prev.data,
                verdict: undefined,
                decisionExplanation: undefined,
              },
            }));
            window.setTimeout(() => {
              void simulatePipelineProgress();
            }, 0);
          }}
          onReset={handleReset}
        />
      );
    }

    switch (currentStep) {
      case 'INPUT_IMAGE':
        return <InputImageView data={data} onFileSelect={handleFileSelect} onNext={() => simulatePipelineProgress()} isProcessing={isProcessing} />;
      case 'FEATURE_EXTRACTION':
        return <FeatureExtractionView data={data} isProcessing={isProcessing} />;
      case 'PROMPT_GEN':
        return <PromptGenView data={data} />;
      case 'VECTOR_DB_STORAGE':
        return <VectorDBView data={data} isProcessing={isProcessing} />;
      case 'SCAN_TRIGGER':
        return <ScanTriggerView onNext={() => simulatePipelineProgress()} isProcessing={isProcessing} />;
      case 'DATA_RETRIEVAL':
        return <DataRetrievalView isProcessing={isProcessing} />;
      case 'LOCAL_DB_SEARCH':
        return <LocalDBSearchView data={data} onNoMatch={() => advanceToStep('WEB_SEARCH')} isProcessing={isProcessing} />;
      case 'WEB_SEARCH':
        return <WebSearchView data={data} isProcessing={isProcessing} />;
      case 'SIMILARITY_MATCHING':
        return <SimilarityMatchingView data={data} isProcessing={isProcessing} />;
      case 'ML_DECISION':
        return <MLDecisionView data={data} isProcessing={isProcessing} />;
      case 'FINAL_OUTPUT': {
        const matchResult = buildMatchResult(data);
        const comparisonImage = matchResult ? data.comparisonImage : undefined;
        return (
          <FinalOutputView
            verdict={data.verdict}
            matchResult={matchResult}
            comparisonImage={comparisonImage}
            inputImageUrl={data.imagePreview}
            blipCaption={data.blipCaption}
            uploadedImageAnalysis={data.uploadedImageAnalysis}
            onNext={handleReset}
            onReport={openReportModal}
            onViewComparison={() => setShowComparison(true)}
            onExportReport={() => {
              if (isGuest) {
                setGuestRestrictionFeature('Export Report');
                return;
              }
              handleExportReport(data, matchResult);
            }}
            onProtect={() => {
              if (isGuest) {
                setGuestRestrictionFeature('Protect Asset');
                return;
              }
              setProtectMessage(null);
              setShowProtectModal(true);
            }}
          />
        );
      }
      default:
        return null;
    }
  };

  const completedSteps = pipelineState.history;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-outline-variant shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 hover:bg-surface-container rounded"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div>
            <h1 className="font-mono text-lg font-bold uppercase tracking-widest">Pipeline Workflow</h1>
            <p className="font-mono text-[10px] text-outline uppercase hidden sm:block">
              Image Authenticity Analysis Pipeline
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[10px] uppercase px-2 py-1 border ${
            pipelineState.status === 'running'
              ? 'text-primary border-primary/30 bg-primary/5 animate-pulse'
              : pipelineState.status === 'complete'
              ? 'text-primary border-primary/40 bg-primary/15'
              : 'text-outline border-outline-variant'
          }`}>
            {pipelineState.status}
          </span>
        </div>
      </header>

      {/* Pipeline Stepper */}
      <div className="border-b border-outline-variant bg-surface-container/30 shrink-0">
        <PipelineStepper
          currentStep={pipelineState.currentStep}
          completedSteps={completedSteps}
          skippedSteps={pipelineState.skippedSteps}
          isMobile={isMobile}
        />
      </div>

      {/* Stage Content */}
      <main className="flex-1 overflow-y-auto custom-scrollbar">
        <AnimatePresence mode="wait">
          <motion.div
            key={pipelineState.currentStep}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {renderCurrentStage()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && isMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-surface border-r border-outline-variant">
            <MobileSidebarContent onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}
      {showComparison && (
        <ComparisonView
          comparisonImage={pipelineState.data.comparisonImage}
          matchedImageUrl={pipelineState.data.matchedImageUrl}
          matchedImageLabel={pipelineState.data.matchedImageLabel}
          inputImageUrl={pipelineState.data.imagePreview}
          onClose={() => setShowComparison(false)}
        />
      )}
      {guestRestrictionFeature && (
        <GuestRestrictionModal
          feature={guestRestrictionFeature}
          onClose={() => setGuestRestrictionFeature(null)}
        />
      )}
      {showReportModal && reportForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !isSubmittingReport && setShowReportModal(false)} />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="relative w-full max-w-4xl bg-surface-container border border-error/30 shadow-2xl"
          >
            <div className="p-5 border-b border-outline-variant flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-error/10 border border-error/30 flex items-center justify-center text-error">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-mono text-sm font-bold uppercase tracking-widest">Report Match</h3>
                  <p className="font-mono text-[10px] text-outline uppercase">Similarity threshold met for takedown intake</p>
                </div>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                disabled={isSubmittingReport}
                className="p-2 text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[80vh] overflow-y-auto custom-scrollbar p-5 space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 font-mono text-[10px]">
                <div className="bg-surface-container-lowest border border-outline-variant p-4 space-y-3">
                  <p className="text-error uppercase tracking-widest">Image Information</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border border-outline-variant p-3">
                      <p className="text-outline uppercase">Filename</p>
                      <p className="text-on-surface break-all mt-1">{reportForm.assetFilename}</p>
                    </div>
                    <div className="border border-outline-variant p-3">
                      <p className="text-outline uppercase">Final Score</p>
                      <p className="text-error mt-1">{reportForm.finalScore.toFixed(1)}%</p>
                    </div>
                    <div className="border border-outline-variant p-3">
                      <p className="text-outline uppercase">Type</p>
                      <p className="text-on-surface mt-1">{reportForm.assetMimeType}</p>
                    </div>
                    <div className="border border-outline-variant p-3">
                      <p className="text-outline uppercase">File Size</p>
                      <p className="text-on-surface mt-1">{reportForm.assetSizeLabel}</p>
                    </div>
                    <div className="border border-outline-variant p-3">
                      <p className="text-outline uppercase">Verdict</p>
                      <p className="text-on-surface mt-1">{reportForm.verdict}</p>
                    </div>
                    <div className="border border-outline-variant p-3">
                      <p className="text-outline uppercase">Matched Source</p>
                      <p className="text-on-surface mt-1">{reportForm.matchedSource}</p>
                    </div>
                  </div>
                  <div className="border border-outline-variant p-3">
                    <p className="text-outline uppercase">Matched Reference</p>
                    <p className="text-on-surface break-all mt-1">{reportForm.matchedReference}</p>
                  </div>
                  <div className="border border-outline-variant p-3">
                    <p className="text-outline uppercase">Dashboard Asset ID</p>
                    <p className="text-on-surface break-all mt-1">{reportForm.assetId || 'Not linked'}</p>
                  </div>
                </div>

                <div className="bg-surface-container-lowest border border-outline-variant p-4 space-y-3">
                  <p className="text-primary uppercase tracking-widest">User Information</p>
                  <div className="block space-y-2">
                    <span className="text-outline uppercase">Reporter Name</span>
                    <div className="w-full bg-surface border border-outline-variant px-4 py-3 font-mono text-sm text-on-surface">
                      {reportForm.reporterName || 'Unavailable'}
                    </div>
                  </div>
                  <div className="block space-y-2">
                    <span className="text-outline uppercase">Reporter Email</span>
                    <div className="w-full bg-surface border border-outline-variant px-4 py-3 font-mono text-sm text-on-surface">
                      {reportForm.reporterEmail || 'Unavailable'}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="block space-y-2">
                      <span className="text-outline uppercase">User ID</span>
                      <div className="w-full bg-surface border border-outline-variant px-4 py-3 font-mono text-sm text-on-surface break-all">
                        {reportForm.reporterUserId || 'Unavailable'}
                      </div>
                    </div>
                    <div className="block space-y-2">
                      <span className="text-outline uppercase">Joined Since</span>
                      <div className="w-full bg-surface border border-outline-variant px-4 py-3 font-mono text-sm text-on-surface">
                        {reportForm.accountJoinedSince || 'Unavailable'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <label className="block space-y-2">
                  <span className="font-mono text-[10px] text-outline uppercase">Reported URL</span>
                  <input
                    type="url"
                    value={reportForm.targetUrl}
                    onChange={(event) => updateReportFormField('targetUrl', event.target.value)}
                    disabled={isSubmittingReport}
                    className={cn(
                      'w-full bg-surface-container-lowest border px-4 py-3 font-mono text-sm text-on-surface outline-none focus:border-error transition-colors disabled:opacity-60',
                      reportForm.targetUrl.trim() && !isValidHttpUrl(reportForm.targetUrl)
                        ? 'border-error/70'
                        : 'border-outline-variant',
                    )}
                    placeholder="https://example.com/infringing-image"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="font-mono text-[10px] text-outline uppercase">Official Contact Email</span>
                  <input
                    type="email"
                    value={reportForm.contactEmail}
                    onChange={(event) => updateReportFormField('contactEmail', event.target.value)}
                    disabled={isSubmittingReport}
                    className={cn(
                      'w-full bg-surface-container-lowest border px-4 py-3 font-mono text-sm text-on-surface outline-none focus:border-error transition-colors disabled:opacity-60',
                      reportForm.contactEmail.trim() && !isValidEmail(reportForm.contactEmail)
                        ? 'border-error/70'
                        : 'border-outline-variant',
                    )}
                    placeholder="legal@example.com"
                  />
                </label>
              </div>

              <label className="block space-y-2">
                <span className="font-mono text-[10px] text-outline uppercase">Issue Summary</span>
                <textarea
                  value={reportForm.issueSummary}
                  readOnly
                  className="min-h-[110px] w-full resize-none bg-surface-container-lowest border border-outline-variant px-4 py-3 font-mono text-sm text-on-surface outline-none"
                />
              </label>

              <label className="block space-y-2">
                <span className="font-mono text-[10px] text-outline uppercase">Additional Notes</span>
                <textarea
                  value={reportForm.notes}
                  onChange={(event) => updateReportFormField('notes', event.target.value)}
                  disabled={isSubmittingReport}
                  className="min-h-[110px] w-full resize-y bg-surface-container-lowest border border-outline-variant px-4 py-3 font-mono text-sm text-on-surface outline-none focus:border-error transition-colors disabled:opacity-60"
                  placeholder="Any licensing context, ownership notes, or enforcement instructions..."
                />
              </label>

              <label className="flex items-start gap-3 border border-outline-variant bg-surface-container-lowest p-4">
                <input
                  type="checkbox"
                  checked={reportForm.declarationAccepted}
                  onChange={(event) => updateReportFormField('declarationAccepted', event.target.checked)}
                  disabled={isSubmittingReport}
                  className="mt-1 h-4 w-4 accent-[var(--color-error)]"
                />
                <span className="font-mono text-[11px] text-on-surface">
                  I confirm that this report is being submitted in good faith and that the provided ownership and contact details are accurate to the best of my knowledge.
                </span>
              </label>

              {reportMessage && (
                <div className={`border p-3 font-mono text-xs ${
                  reportMessage.type === 'success'
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-error/40 bg-error/10 text-error'
                }`}>
                  {reportMessage.text}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-outline-variant flex flex-wrap justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowReportModal(false)} disabled={isSubmittingReport}>
                Cancel
              </Button>
              <SlideSubmitButton
                disabled={!canSubmitReport}
                onSubmit={handleSubmitReport}
                onSuccess={handleReportSubmitSuccess}
                idleLabel="Slide to Takedown"
              />
            </div>
          </motion.div>
        </div>
      )}
      {showReportSubmittedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="relative w-full max-w-md bg-surface-container border border-primary/30 shadow-2xl"
          >
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-mono text-sm font-bold uppercase tracking-widest">Report Submitted</h3>
                  <p className="font-mono text-[10px] text-outline uppercase">Your takedown report has been sent successfully</p>
                </div>
              </div>
              <div className="border border-primary/30 bg-primary/10 p-4 font-mono text-xs text-primary">
                Your report is submitted.
              </div>
            </div>
            <div className="p-5 border-t border-outline-variant flex justify-end">
              <Button variant="primary" onClick={handleCloseReportSubmitted}>
                Close
              </Button>
            </div>
          </motion.div>
        </div>
      )}
      {showProtectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !isProtecting && setShowProtectModal(false)} />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="relative w-full max-w-xl bg-surface-container border border-outline-variant shadow-2xl"
          >
            <div className="p-5 border-b border-outline-variant flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-mono text-sm font-bold uppercase tracking-widest">Protect Asset</h3>
                  <p className="font-mono text-[10px] text-outline uppercase">Register uploaded image fingerprint</p>
                </div>
              </div>
              <button
                onClick={() => setShowProtectModal(false)}
                disabled={isProtecting}
                className="p-2 text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-surface-container-lowest border border-outline-variant p-3 font-mono text-[10px]">
                <p className="text-outline uppercase">Image</p>
                <p className="text-on-surface break-all">{pipelineState.data.image?.name || 'uploaded-image'}</p>
              </div>

              <label className="block space-y-2">
                <span className="font-mono text-[10px] text-outline uppercase">Artist / Owner Name</span>
                <input
                  value={protectOwnerName}
                  onChange={(event) => setProtectOwnerName(event.target.value)}
                  disabled={isProtecting}
                  className="w-full bg-surface-container-lowest border border-outline-variant px-4 py-3 font-mono text-sm text-on-surface outline-none focus:border-primary transition-colors disabled:opacity-60"
                  placeholder="protected_asset"
                  autoFocus
                />
              </label>

              {protectMessage && (
                <div className={`border p-3 font-mono text-xs ${
                  protectMessage.type === 'success'
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-error/40 bg-error/10 text-error'
                }`}>
                  {protectMessage.text}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-outline-variant flex flex-wrap justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowProtectModal(false)} disabled={isProtecting}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleProtectAsset} disabled={isProtecting}>
                {isProtecting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Shield className="w-4 h-4 mr-2" />
                )}
                {isProtecting ? 'Protecting...' : 'Protect'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const MobileSidebarContent: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<AppState>('SCAN');
  const isGuest = localStorage.getItem('trinetra_guest_mode') === 'true';

  const NavItem = ({ id, label, icon: Icon }: { id: AppState; label: string; icon: any }) => (
    <button
      onClick={() => {
        setActiveTab(id);
        onClose();
      }}
      className={`w-full flex items-center gap-3 px-4 py-3 font-mono text-xs uppercase tracking-tighter transition-all group ${
        activeTab === id
          ? 'bg-primary/10 text-primary border-l-2 border-primary'
          : 'text-outline hover:text-on-surface-variant hover:bg-surface-container'
      }`}
    >
      <Icon className={`w-4 h-4 ${activeTab === id ? 'text-primary' : 'text-outline group-hover:text-on-surface-variant'}`} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-outline-variant space-y-4">
        <div className="flex items-center gap-3">
          <BrandMark size="sm" />
          <div>
            <div className="font-mono text-sm font-bold tracking-widest">TRINETRA</div>
            <div className="font-mono text-[10px] text-outline">ID: ALPHA-09</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 py-4">
        <NavItem id="DASHBOARD" label="Dashboard" icon={Search} />
        <NavItem id="SCAN" label="Pipeline" icon={UploadCloud} />
        <NavItem id="HISTORY" label="History" icon={History} />
        <NavItem id="INTELLIGENCE" label="Intelligence" icon={Cpu} />
      </nav>
      <div className="p-4 border-t border-outline-variant">
        {!isGuest && <NavItem id="METADATA" label="Settings" icon={Settings} />}
        <button className="w-full flex items-center gap-3 px-4 py-3 font-mono text-xs uppercase text-error hover:bg-error-container/10 transition-all mt-1">
          <LogOut className="w-4 h-4" />
          <span>Terminate</span>
        </button>
      </div>
    </div>
  );
};

const ScanInterface = ({ onNavigateToDashboard }: { onNavigateToDashboard?: () => void }) => {
  return <PipelineWorkflow onNavigateToDashboard={onNavigateToDashboard} />;
};

const SettingsInterface = () => {
  const [email] = useState(localStorage.getItem('trinetra_user_email') || '');
  const [profile, setProfile] = useState<UserProfileRecord | null>(email ? ensureUserProfile(email) : null);
  const [draftProfile, setDraftProfile] = useState<UserProfileRecord | null>(email ? ensureUserProfile(email) : null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const isGuest = localStorage.getItem('trinetra_guest_mode') === 'true';

  useEffect(() => {
    if (profile) {
      setDraftProfile(profile);
    }
  }, [profile]);

  const updateDraftProfile = (field: keyof UserProfileRecord, value: string) => {
    if (!draftProfile) return;
    setDraftProfile({ ...draftProfile, [field]: value });
    setSaveMessage(null);
  };

  const saveProfile = () => {
    if (!draftProfile || !email) return;
    setProfile(draftProfile);
    localStorage.setItem(getProfileStorageKey(email), JSON.stringify(draftProfile));
    setSaveMessage('Profile saved');
  };

  if (isGuest) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-surface-container border border-outline-variant p-8 text-center space-y-3 max-w-xl">
          <Settings className="w-10 h-10 text-outline mx-auto" />
          <p className="font-mono text-sm uppercase tracking-widest text-on-surface">Settings Unavailable</p>
          <p className="font-mono text-[10px] text-outline uppercase">Sign in or sign up to access profile settings.</p>
        </div>
      </div>
    );
  }

  if (!profile || !draftProfile || !email) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-surface-container border border-outline-variant p-8 text-center space-y-3">
          <Settings className="w-10 h-10 text-outline mx-auto" />
          <p className="font-mono text-sm uppercase tracking-widest text-on-surface">No Profile Loaded</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="border-b border-outline-variant pb-4">
        <h1 className="font-mono text-2xl font-bold tracking-tight uppercase">Settings</h1>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6">
        <aside className="bg-surface-container border border-outline-variant overflow-hidden">
          <div className="aspect-[4/5] overflow-hidden border-b border-outline-variant">
            <img src={profile.profileArtSeed} alt="Profile art" className="h-full w-full object-cover" />
          </div>
          <div className="p-5 space-y-3 font-mono">
            <div>
              <p className="text-xs uppercase tracking-widest text-primary">{draftProfile.displayName}</p>
              <p className="text-[10px] uppercase text-outline">{email}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[10px] uppercase">
              <div className="border border-outline-variant p-3">
                <p className="text-outline">User ID</p>
                <p className="text-on-surface mt-1 break-all">{draftProfile.userId}</p>
              </div>
              <div className="border border-outline-variant p-3">
                <p className="text-outline">Joined Since</p>
                <p className="text-on-surface mt-1">{draftProfile.accountJoinedSince}</p>
              </div>
            </div>
          </div>
        </aside>

        <section className="bg-surface-container border border-outline-variant p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="font-mono text-[10px] text-outline uppercase">Name</span>
              <input value={draftProfile.displayName} onChange={(e) => updateDraftProfile('displayName', e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant px-4 py-3 font-mono text-sm text-on-surface outline-none focus:border-primary transition-colors" />
            </label>
            <label className="space-y-2">
              <span className="font-mono text-[10px] text-outline uppercase">Age</span>
              <input value={draftProfile.age} onChange={(e) => updateDraftProfile('age', e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant px-4 py-3 font-mono text-sm text-on-surface outline-none focus:border-primary transition-colors" />
            </label>
            <div className="space-y-2">
              <span className="font-mono text-[10px] text-outline uppercase">Sex</span>
              <div className="flex flex-wrap gap-3 rounded-[20px] border border-outline-variant bg-surface-container-lowest px-4 py-3">
                {['Female', 'Male', 'Non-binary'].map((option) => (
                  <label key={option} className="flex items-center gap-2 font-mono text-sm text-on-surface">
                    <input
                      type="radio"
                      name="sex"
                      value={option}
                      checked={draftProfile.sex === option}
                      onChange={(e) => updateDraftProfile('sex', e.target.value)}
                      className="h-4 w-4 accent-[var(--color-primary)]"
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border border-primary/30 bg-primary/10 px-4 py-3 font-mono text-[11px] text-primary uppercase">
            <span>{saveMessage || 'Update your profile details and save when ready.'}</span>
            <Button variant="primary" onClick={saveProfile} className="px-5 py-2 text-[10px]">Save</Button>
          </div>
        </section>
      </div>
    </div>
  );
};

interface ProtectionCertificate {
  owner: string;
  fingerprint: string;
  assetId?: string | number;
  registryAssetId?: string | number;
  status: string;
  filename: string;
  fileType: string;
  fileSize: string;
  dimensions: string;
  issuedAt: string;
  phash?: string;
  captions?: string[];
}

const buildCertificateFilename = (owner: string, assetId?: string | number) => {
  const safeOwner = owner.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Owner';
  const safeAssetId = String(assetId || 'unknown').replace(/[^A-Za-z0-9_-]+/g, '_');
  return `${safeOwner}_${safeAssetId}.txt`;
};

const downloadProtectionCertificate = async (certificate: ProtectionCertificate) => {
  const captions = certificate.captions?.length ? certificate.captions : ['No captions available'];
  const lines = [
    'TRINETRA PROTECTION CERTIFICATE',
    '================================',
    '',
    `Owner / Artist Name : ${certificate.owner}`,
    `Asset ID            : ${certificate.assetId || 'Pending'}`,
    `Registry Asset ID   : ${certificate.registryAssetId || 'Not linked'}`,
    `Status              : ${certificate.status}`,
    `Filename            : ${certificate.filename}`,
    `File Type           : ${certificate.fileType}`,
    `File Size           : ${certificate.fileSize}`,
    `Dimensions          : ${certificate.dimensions}`,
    `Issued At           : ${certificate.issuedAt}`,
    `Fingerprint         : ${certificate.fingerprint}`,
    `pHash               : ${certificate.phash || 'Not returned'}`,
    '',
    'CAPTIONS',
    '--------',
    ...captions,
    '',
    'NOTICE',
    '------',
    'This file certifies that the above image was protected through Trinetra and linked to the active user account when available.',
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildCertificateFilename(certificate.owner, certificate.assetId);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const dashboardAssetToCertificate = (asset: DashboardAsset): ProtectionCertificate | null => {
  if (!asset.is_local_only && !asset.protected_fingerprint && !asset.protected_owner) {
    return null;
  }

  const fallbackFingerprint = `TRI-ARCHIVE-${asset.phash.replace(/[^a-z0-9]/gi, '').slice(0, 20).toUpperCase() || asset.id.slice(0, 12).toUpperCase()}`;
  return {
    owner: asset.protected_owner || 'Owner',
    fingerprint: asset.protected_fingerprint || fallbackFingerprint,
    assetId: asset.protected_asset_id || asset.id,
    registryAssetId: asset.is_local_only ? 'Not linked' : asset.id,
    status: asset.protected_status || 'Registered protected asset',
    filename: asset.filename,
    fileType: asset.mime_type,
    fileSize: 'Archived in dashboard',
    dimensions: 'Archived in dashboard',
    issuedAt: asset.protected_issued_at || new Date(asset.created_at).toLocaleString(),
    phash: asset.phash,
    captions: asset.protected_captions || [],
  };
};

const ProtectInterface = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [certificate, setCertificate] = useState<ProtectionCertificate | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isGuest = localStorage.getItem('trinetra_guest_mode') === 'true';

  const readDimensions = (imageUrl: string) => new Promise<string>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(`${image.naturalWidth} x ${image.naturalHeight}`);
    image.onerror = () => resolve('Unavailable');
    image.src = imageUrl;
  });

  const handleFile = (selectedFile: File) => {
    if (!selectedFile.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Select a valid image file.' });
      return;
    }

    if (preview) {
      URL.revokeObjectURL(preview);
    }

    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));
    setCertificate(null);
    setMessage(null);
  };

  const handleRegister = async () => {
    if (isGuest) {
      setMessage({ type: 'error', text: 'This feature should be used by the Signed Up users.' });
      return;
    }

    if (!file || !preview) {
      setMessage({ type: 'error', text: 'Upload an image before registering an asset.' });
      return;
    }

    const owner = ownerName.trim();
    if (!owner) {
      setMessage({ type: 'error', text: 'Enter the asset owner or artist name.' });
      return;
    }

    try {
      setIsRegistering(true);
      setMessage(null);
      const [fingerprint, dimensions] = await Promise.all([
        createAssetFingerprint(file),
        readDimensions(preview),
      ]);

      const formData = new FormData();
      formData.append('artist_name', owner);
      formData.append('user_email', localStorage.getItem('trinetra_user_email') || '');
      formData.append('file', file);

      const response = await fetch('/register', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error || 'Registration failed');
      }

      const status = result.status === 'duplicate' ? 'Duplicate protected asset' : 'Registered protected asset';
      let registryAssetId: string | number | undefined;
      if (!isGuest) {
        try {
          registryAssetId = await linkAssetToDashboard(file);
        } catch {
          registryAssetId = undefined;
        }
        await cacheProtectedAssetForDashboard(
          localStorage.getItem('trinetra_user_email') || 'unknown',
          file,
          result.phash,
          registryAssetId,
          result.asset_id || result.deduplicated_id,
          owner,
          fingerprint,
          status,
          result.blip_captions,
        );
      }

      setCertificate({
        owner,
        fingerprint,
        assetId: result.asset_id || result.deduplicated_id,
        registryAssetId,
        status,
        filename: file.name,
        fileType: file.type || 'image',
        fileSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
        dimensions,
        issuedAt: new Date().toLocaleString(),
        phash: result.phash,
        captions: result.blip_captions,
      });
      setMessage({
        type: 'success',
        text: `${status}. Certificate fingerprint issued.${isGuest ? '' : registryAssetId ? ' Asset linked to your dashboard.' : ' Dashboard linking is unavailable right now, but protection was completed.'}`,
      });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Registration failed' });
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="h-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-outline-variant pb-4">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight">PROTECT ASSET</h1>
          <p className="font-mono text-[11px] text-outline uppercase mt-1">Register image ownership and issue a fingerprint certificate</p>
        </div>
        <div className="flex items-center gap-2 border border-primary/30 bg-primary/10 px-3 py-2 text-primary">
          <Fingerprint className="w-4 h-4" />
          <span className="font-mono text-[10px] uppercase">Certification Ready</span>
        </div>
      </header>

      <div className="relative">
        <div className={cn('grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6', isGuest && 'pointer-events-none select-none blur-[3px] opacity-45')}>
        <section className="bg-surface-container border border-outline-variant p-5 space-y-5">
          <div
            className="border-2 border-dashed border-outline-variant bg-surface-container-lowest hover:border-primary/60 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = event.dataTransfer.files[0];
              if (dropped) handleFile(dropped);
            }}
            onDragOver={(event) => event.preventDefault()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])}
            />
            {preview ? (
              <div className="p-4 space-y-3">
                <div className="relative aspect-video bg-black border border-outline-variant overflow-hidden">
                  <img src={preview} alt="Asset preview" className="w-full h-full object-contain" />
                  <Reticle />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] uppercase">
                  <span className="text-on-surface break-all">{file?.name}</span>
                  <Button variant="ghost" className="text-xs" onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }}>
                    <RefreshCw className="w-3 h-3 mr-1" /> Change
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center space-y-4">
                <Shield className="w-16 h-16 text-primary mx-auto" />
                <h3 className="font-mono text-sm font-bold uppercase tracking-widest">Register Image Asset</h3>
                <p className="font-mono text-[10px] text-outline uppercase">Drop an image or select from this device</p>
                <Button variant="primary">Select Image</Button>
              </div>
            )}
          </div>

          <label className="block space-y-2">
            <span className="font-mono text-[10px] text-outline uppercase">Owner / Artist Name</span>
            <input
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant px-4 py-3 font-mono text-sm text-on-surface outline-none focus:border-primary transition-colors"
              placeholder="Enter registered owner"
            />
          </label>

          {message && (
            <div className={`border p-3 font-mono text-xs ${
              message.type === 'success'
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-error/40 bg-error/10 text-error'
            }`}>
              {message.text}
            </div>
          )}

          <Button variant="primary" onClick={handleRegister} disabled={isRegistering} className="px-8 py-3">
            {isRegistering ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Fingerprint className="w-4 h-4 mr-2" />}
            {isRegistering ? 'Registering...' : 'Register And Certify'}
          </Button>
        </section>

        <aside className="bg-surface-container border border-outline-variant p-5 space-y-4">
          <div className="flex items-center gap-3 border-b border-outline-variant pb-4">
            <div className="w-10 h-10 bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-mono text-sm font-bold uppercase tracking-widest">Certificate</h2>
              <p className="font-mono text-[10px] text-outline uppercase">Unique image fingerprint</p>
            </div>
          </div>

          {certificate ? (
            <div className="space-y-4">
              <div className="bg-black border border-primary/40 p-4">
                <p className="font-mono text-[10px] text-outline uppercase mb-2">Fingerprint Code</p>
                <p className="font-mono text-sm text-primary break-all leading-relaxed">{certificate.fingerprint}</p>
              </div>
              <Button variant="primary" className="w-full" onClick={() => void downloadProtectionCertificate(certificate)}>
                <Download className="w-4 h-4 mr-2" />
                Download Certificate
              </Button>
              {[
                ['Status', certificate.status],
                ['Owner', certificate.owner],
                ['Asset ID', certificate.assetId || 'Pending'],
                ['Registry Asset ID', certificate.registryAssetId || 'Not linked'],
                ['Filename', certificate.filename],
                ['Type', certificate.fileType],
                ['Size', certificate.fileSize],
                ['Dimensions', certificate.dimensions],
                ['Issued', certificate.issuedAt],
                ['pHash', certificate.phash || 'Not returned'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-outline-variant/70 pb-2 font-mono text-[10px] uppercase">
                  <span className="text-outline">{label}</span>
                  <span className="text-on-surface text-right break-all">{value}</span>
                </div>
              ))}
              {certificate.captions?.length ? (
                <div className="font-mono text-[10px] uppercase text-outline space-y-2">
                  <span>Image Details</span>
                  {certificate.captions.map((caption) => (
                    <p key={caption} className="text-on-surface-variant normal-case leading-relaxed">{caption}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="min-h-80 flex flex-col items-center justify-center text-center gap-3 text-outline">
              <Fingerprint className="w-12 h-12" />
              <p className="font-mono text-[10px] uppercase leading-relaxed">A certificate will appear here after registration.</p>
            </div>
          )}
        </aside>
        </div>
        {isGuest && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="max-w-xl border border-primary/30 bg-surface-container/95 backdrop-blur-sm p-6 text-center space-y-3">
              <Shield className="w-10 h-10 text-primary mx-auto" />
              <p className="font-mono text-sm uppercase tracking-widest text-on-surface">Signed Up Users Only</p>
              <p className="font-mono text-[10px] text-outline uppercase">This feature should be used by the Signed Up users.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const getStoredAuthMode = (): AuthProviderMode => {
  if (typeof window === 'undefined') return 'otp';

  const storedMode = window.localStorage.getItem('trinetra_auth_mode');
  if (storedMode === 'clerk' || storedMode === 'otp' || storedMode === 'guest') {
    return storedMode;
  }

  return window.localStorage.getItem('trinetra_guest_mode') === 'true' ? 'guest' : 'otp';
};

const markSessionActivity = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SESSION_ACTIVITY_KEY, String(Date.now()));
};

const hasActiveStoredSession = () => {
  if (typeof window === 'undefined') return false;

  const authMode = getStoredAuthMode();
  if (authMode === 'guest') return false;

  const token = window.localStorage.getItem('trinetra_access_token');
  const lastActivityRaw = window.localStorage.getItem(SESSION_ACTIVITY_KEY);
  if (!token || !lastActivityRaw) return false;

  const lastActivity = Number(lastActivityRaw);
  if (!Number.isFinite(lastActivity)) return false;

  return Date.now() - lastActivity < INACTIVITY_TIMEOUT_MS;
};

const clearStoredSession = () => {
  if (typeof window === 'undefined') return;

  window.localStorage.removeItem('trinetra_access_token');
  window.localStorage.removeItem('trinetra_user_email');
  window.localStorage.removeItem('trinetra_guest_mode');
  window.localStorage.removeItem('trinetra_auth_mode');
  window.localStorage.removeItem('trinetra_clerk_id');
  window.localStorage.removeItem(SESSION_ACTIVITY_KEY);
};

function ClerkAuthScreen({ onLogin }: { onLogin: (mode: AuthProviderMode) => void }) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const clerk = useClerk();

  useEffect(() => {
    const syncClerkSession = async () => {
      if (localStorage.getItem(FORCE_CLERK_SIGNOUT_KEY) === 'true') {
        localStorage.removeItem(FORCE_CLERK_SIGNOUT_KEY);
        await clerk.signOut();
        return;
      }

      if (!user || !isLoaded) return;

      const token = await getToken();
      if (token) {
        localStorage.removeItem('trinetra_guest_mode');
        localStorage.setItem('trinetra_access_token', token);
        markSessionActivity();
      }
      localStorage.setItem('trinetra_user_email', user.primaryEmailAddress?.emailAddress || '');
      localStorage.setItem('trinetra_clerk_id', user.id);
      localStorage.setItem('trinetra_auth_mode', 'clerk');
      onLogin('clerk');
    };

    void syncClerkSession();
  }, [clerk, getToken, isLoaded, onLogin, user]);

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SignInPage
      onSuccess={() => onLogin(getStoredAuthMode())}
      onGoogleSignIn={() => clerk.openSignIn({})}
      googleButtonLabel="Continue with Google"
    />
  );
}

function AuthScreen({ onLogin }: { onLogin: (mode: AuthProviderMode) => void }) {
  if (PUBLISHABLE_KEY) {
    return <ClerkAuthScreen onLogin={onLogin} />;
  }

  return <SignInPage onSuccess={() => onLogin(getStoredAuthMode())} />;
}

function ClerkTerminateButton({ onTerminate, onClose }: { onTerminate: () => void; onClose?: () => void }) {
  const clerk = useClerk();

  const handleClick = async () => {
    await clerk.signOut();
    onTerminate();
    onClose?.();
  };

  return (
    <button
      onClick={() => { void handleClick(); }}
      className="w-full flex items-center gap-3 px-4 py-3 font-mono text-xs uppercase text-error hover:bg-error-container/10 transition-all mt-1"
    >
      <LogOut className="w-4 h-4" />
      <span className="hidden lg:inline">Terminate</span>
    </button>
  );
}

// --- Main App Logic ---

export default function App() {
  const [activeTab, setActiveTab] = useState<AppState>(() => {
    if (typeof window !== 'undefined' && window.sessionStorage.getItem('trinetra_entry_boot_done') === 'true') {
      window.sessionStorage.removeItem('trinetra_entry_boot_done');
      return hasActiveStoredSession() ? 'DASHBOARD' : 'AUTH';
    }
    return 'BOOT';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [authMode, setAuthMode] = useState<AuthProviderMode>(() => getStoredAuthMode());
  const isGuestSession = authMode === 'guest';
  const isFullscreenScreen = activeTab === 'BOOT' || activeTab === 'AUTH';

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleLogin = useCallback((mode: AuthProviderMode) => {
    setAuthMode(mode);
    markSessionActivity();
    setSidebarOpen(false);
    setActiveTab('DASHBOARD');
  }, []);

  const handleTerminate = useCallback((reason: 'manual' | 'inactivity' = 'manual') => {
    if (reason === 'inactivity' && authMode === 'clerk') {
      localStorage.setItem(FORCE_CLERK_SIGNOUT_KEY, 'true');
    }
    clearStoredSession();
    setAuthMode('guest');
    setSidebarOpen(false);
    setActiveTab('AUTH');
  }, [authMode]);

  useEffect(() => {
    const syncSessionFromStorage = () => {
      if (hasActiveStoredSession()) {
        setAuthMode(getStoredAuthMode());
      } else if (getStoredAuthMode() !== 'guest') {
        clearStoredSession();
        setAuthMode('guest');
      }
    };

    syncSessionFromStorage();
  }, []);

  useEffect(() => {
    if (authMode === 'guest') return;

    const activityEvents: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    const handleActivity = () => markSessionActivity();
    const checkForTimeout = () => {
      if (!hasActiveStoredSession()) {
        handleTerminate('inactivity');
      }
    };

    activityEvents.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }));
    window.addEventListener('focus', handleActivity);
    document.addEventListener('visibilitychange', checkForTimeout);
    const intervalId = window.setInterval(checkForTimeout, 15000);
    checkForTimeout();

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
      window.removeEventListener('focus', handleActivity);
      document.removeEventListener('visibilitychange', checkForTimeout);
      window.clearInterval(intervalId);
    };
  }, [authMode, handleTerminate]);

  const NavItem = ({ id, label, icon: Icon, onClick }: { id: AppState, label: string, icon: any, onClick?: () => void }) => (
    <button
      onClick={onClick || (() => setActiveTab(id))}
      className={`w-full flex items-center gap-3 px-4 py-3 font-mono text-xs uppercase tracking-tighter transition-all group ${
        activeTab === id
          ? 'bg-primary/10 text-primary border-l-2 border-primary'
          : 'text-outline hover:text-on-surface-variant hover:bg-surface-container'
      }`}
    >
      <Icon className={`w-4 h-4 ${activeTab === id ? 'text-primary' : 'text-outline group-hover:text-on-surface-variant'}`} />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );

  const SidebarContent = ({ onClose }: { onClose?: () => void }) => (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-outline-variant space-y-4">
        <div className="flex items-center gap-3">
          <BrandMark size="sm" />
          <div className="hidden lg:block">
            <div className="font-mono text-sm font-bold tracking-widest">TRINETRA</div>
            <div className="font-mono text-[10px] text-outline">ID: ALPHA-09</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4">
        <NavItem id="DASHBOARD" label="Dashboard" icon={Search} onClick={() => { setActiveTab('DASHBOARD'); onClose?.(); }} />
        <NavItem id="PROTECT" label="Protect" icon={Shield} onClick={() => { setActiveTab('PROTECT'); onClose?.(); }} />
        <NavItem id="SCAN" label="Scan" icon={UploadCloud} onClick={() => { setActiveTab('SCAN'); onClose?.(); }} />
        <NavItem id="HISTORY" label="History" icon={History} onClick={() => { setActiveTab('HISTORY'); onClose?.(); }} />
        <NavItem id="INTELLIGENCE" label="Intelligence" icon={Cpu} onClick={() => { setActiveTab('INTELLIGENCE'); onClose?.(); }} />
      </nav>

      <div className="p-4 border-t border-outline-variant">
        {!isGuestSession && <NavItem id="METADATA" label="Settings" icon={Settings} onClick={() => { setActiveTab('METADATA'); onClose?.(); }} />}
        {PUBLISHABLE_KEY && authMode === 'clerk' ? (
          <ClerkTerminateButton onTerminate={handleTerminate} onClose={onClose} />
        ) : (
          <button
            onClick={() => { handleTerminate(); onClose?.(); }}
            className="w-full flex items-center gap-3 px-4 py-3 font-mono text-xs uppercase text-error hover:bg-error-container/10 transition-all mt-1"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden lg:inline">Terminate</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-black text-on-surface overflow-hidden">
      {/* Desktop Sidebar */}
      {!isFullscreenScreen && (
        <aside className="hidden lg:flex w-64 border-r border-outline-variant flex-col shrink-0">
          <SidebarContent />
        </aside>
      )}

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && !isFullscreenScreen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-surface border-r border-outline-variant">
            <SidebarContent onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <FallingPattern
            className="h-full w-full opacity-100"
            color="rgba(152, 207, 227, 0.34)"
            backgroundColor="rgba(0, 0, 0, 0.82)"
            duration={135}
            blurIntensity="0.14em"
            density={0.92}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(152,207,227,0.16),transparent_36%),linear-gradient(180deg,rgba(0,0,0,0.02),rgba(0,0,0,0.16))]" />
        </div>
        {/* Content */}
        <main className={`relative z-10 flex-1 overflow-y-auto custom-scrollbar ${isFullscreenScreen ? '' : 'p-4 lg:p-8'}`}>
          <div className={`${isFullscreenScreen ? 'h-full w-full' : 'max-w-6xl mx-auto h-full'}`}>
            <AnimatePresence mode="wait" initial={false}>
              {activeTab === 'BOOT' && (
                <motion.div
                  key="boot"
                  variants={sectionTransition}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="h-full"
                >
                  <BootScreen onComplete={() => setActiveTab(hasActiveStoredSession() ? 'DASHBOARD' : 'AUTH')} />
                </motion.div>
              )}
              {activeTab === 'AUTH' && (
                <motion.div
                  key="auth"
                  variants={sectionTransition}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="h-full"
                >
                  <AuthScreen onLogin={handleLogin} />
                </motion.div>
              )}
              {activeTab === 'DASHBOARD' && (
                <motion.div
                  key="results"
                  variants={sectionTransition}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="h-full"
                >
                  <ResultsDashboard />
                </motion.div>
              )}
              {activeTab === 'HISTORY' && (
                <motion.div
                  key="history"
                  variants={sectionTransition}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="h-full"
                >
                  <HistoryTable />
                </motion.div>
              )}
              {activeTab === 'INTELLIGENCE' && (
                <motion.div
                  key="intelligence"
                  variants={sectionTransition}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="h-full"
                >
                  <IntelligenceScanning />
                </motion.div>
              )}
              {activeTab === 'PROTECT' && (
                <motion.div
                  key="protect"
                  variants={sectionTransition}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="h-full"
                >
                  <ProtectInterface />
                </motion.div>
              )}
              {activeTab === 'SCAN' && (
                <motion.div
                  key="scan"
                  variants={sectionTransition}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="h-full"
                >
                  <ScanInterface onNavigateToDashboard={() => setActiveTab('DASHBOARD')} />
                </motion.div>
              )}
              {activeTab === 'METADATA' && (
                <motion.div
                  key="settings"
                  variants={sectionTransition}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="h-full"
                >
                  <SettingsInterface />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
