"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Menu, X } from "lucide-react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useRouter } from "next/navigation";

type Uniforms = {
  [key: string]: {
    value: number[] | number[][] | number;
    type: string;
  };
};

interface ShaderProps {
  source: string;
  uniforms: Uniforms;
  maxFps?: number;
}

type AuthMode = "signin" | "signup";
type AuthMessage = { type: "success" | "error"; text: string } | null;

export const CanvasRevealEffect = ({
  animationSpeed = 10,
  opacities = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1],
  colors = [[0, 255, 255]],
  containerClassName,
  dotSize,
  showGradient = true,
  reverse = false,
}: {
  animationSpeed?: number;
  opacities?: number[];
  colors?: number[][];
  containerClassName?: string;
  dotSize?: number;
  showGradient?: boolean;
  reverse?: boolean;
}) => {
  return (
    <div className={cn("relative h-full w-full", containerClassName)}>
      <div className="h-full w-full">
        <DotMatrix
          colors={colors}
          dotSize={dotSize ?? 3}
          opacities={opacities}
          shader={`
            ${reverse ? "u_reverse_active" : "false"}_;
            animation_speed_factor_${animationSpeed.toFixed(1)}_;
          `}
          center={["x", "y"]}
        />
      </div>
      {showGradient ? (
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />
      ) : null}
    </div>
  );
};

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

interface DotMatrixProps {
  colors?: number[][];
  opacities?: number[];
  totalSize?: number;
  dotSize?: number;
  shader?: string;
  center?: ("x" | "y")[];
}

const DotMatrix: React.FC<DotMatrixProps> = ({
  colors = [[0, 0, 0]],
  opacities = [0.04, 0.04, 0.04, 0.04, 0.04, 0.08, 0.08, 0.08, 0.08, 0.14],
  totalSize = 20,
  dotSize = 2,
  shader = "",
  center = ["x", "y"],
}) => {
  const uniforms = React.useMemo(() => {
    let colorsArray = [colors[0], colors[0], colors[0], colors[0], colors[0], colors[0]];
    if (colors.length === 2) {
      colorsArray = [colors[0], colors[0], colors[0], colors[1], colors[1], colors[1]];
    } else if (colors.length === 3) {
      colorsArray = [colors[0], colors[0], colors[1], colors[1], colors[2], colors[2]];
    }

    return {
      u_colors: {
        value: colorsArray.map((color) => [color[0] / 255, color[1] / 255, color[2] / 255]),
        type: "uniform3fv",
      },
      u_opacities: {
        value: opacities,
        type: "uniform1fv",
      },
      u_total_size: {
        value: totalSize,
        type: "uniform1f",
      },
      u_dot_size: {
        value: dotSize,
        type: "uniform1f",
      },
      u_reverse: {
        value: shader.includes("u_reverse_active") ? 1 : 0,
        type: "uniform1i",
      },
    };
  }, [colors, opacities, totalSize, dotSize, shader]);

  return <Shader source={`
        precision mediump float;
        in vec2 fragCoord;

        uniform float u_time;
        uniform float u_opacities[10];
        uniform vec3 u_colors[6];
        uniform float u_total_size;
        uniform float u_dot_size;
        uniform vec2 u_resolution;
        uniform int u_reverse;

        out vec4 fragColor;

        float PHI = 1.61803398874989484820459;
        float random(vec2 xy) {
            return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
        }
        float map(float value, float min1, float max1, float min2, float max2) {
            return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
        }

        void main() {
            vec2 st = fragCoord.xy;
            ${center.includes("x") ? "st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));" : ""}
            ${center.includes("y") ? "st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));" : ""}

            float opacity = step(0.0, st.x);
            opacity *= step(0.0, st.y);

            vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

            float frequency = 5.0;
            float show_offset = random(st2);
            float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
            opacity *= u_opacities[int(rand * 10.0)];
            opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
            opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

            vec3 color = u_colors[int(show_offset * 6.0)];

            float animation_speed_factor = 0.5;
            vec2 center_grid = u_resolution / 2.0 / u_total_size;
            float dist_from_center = distance(center_grid, st2);
            float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);
            float max_grid_dist = distance(center_grid, vec2(0.0, 0.0));
            float timing_offset_outro = (max_grid_dist - dist_from_center) * 0.02 + (random(st2 + 42.0) * 0.2);

            float current_timing_offset;
            if (u_reverse == 1) {
                current_timing_offset = timing_offset_outro;
                opacity *= 1.0 - step(current_timing_offset, u_time * animation_speed_factor);
                opacity *= clamp((step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
            } else {
                current_timing_offset = timing_offset_intro;
                opacity *= step(current_timing_offset, u_time * animation_speed_factor);
                opacity *= clamp((1.0 - step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
            }

            fragColor = vec4(color, opacity);
            fragColor.rgb *= fragColor.a;
        }`} uniforms={uniforms} maxFps={60} />;
};

const ShaderMaterial = ({
  source,
  uniforms,
}: {
  source: string;
  maxFps?: number;
  uniforms: Uniforms;
}) => {
  const { size } = useThree();
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const material = ref.current.material as THREE.ShaderMaterial;
    material.uniforms.u_time.value = clock.getElapsedTime();
    material.uniforms.u_resolution.value = new THREE.Vector2(size.width * 2, size.height * 2);
  });

  const getUniforms = () => {
    const preparedUniforms: Record<string, { value: unknown; type?: string }> = {};

    for (const uniformName in uniforms) {
      const uniform = uniforms[uniformName];

      switch (uniform.type) {
        case "uniform1f":
        case "uniform1i":
        case "uniform1fv":
          preparedUniforms[uniformName] = { value: uniform.value, type: uniform.type.replace("uniform", "").toLowerCase() };
          break;
        case "uniform3fv":
          preparedUniforms[uniformName] = {
            value: (uniform.value as number[][]).map((v) => new THREE.Vector3().fromArray(v)),
            type: "3fv",
          };
          break;
        case "uniform2f":
          preparedUniforms[uniformName] = {
            value: new THREE.Vector2().fromArray(uniform.value as number[]),
            type: "2f",
          };
          break;
        default:
          break;
      }
    }

    preparedUniforms.u_time = { value: 0, type: "1f" };
    preparedUniforms.u_resolution = { value: new THREE.Vector2(size.width * 2, size.height * 2) };
    return preparedUniforms;
  };

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: `
          precision mediump float;
          in vec2 coordinates;
          uniform vec2 u_resolution;
          out vec2 fragCoord;
          void main() {
            float x = position.x;
            float y = position.y;
            gl_Position = vec4(x, y, 0.0, 1.0);
            fragCoord = (position.xy + vec2(1.0)) * 0.5 * u_resolution;
            fragCoord.y = u_resolution.y - fragCoord.y;
          }
        `,
        fragmentShader: source,
        uniforms: getUniforms(),
        glslVersion: THREE.GLSL3,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneFactor,
      }),
    [size.width, size.height, source],
  );

  return (
    <mesh ref={ref}>
      <planeGeometry args={[2, 2]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
};

const Shader: React.FC<ShaderProps> = ({ source, uniforms, maxFps = 60 }) => {
  return (
    <Canvas className="absolute inset-0 h-full w-full" frameloop={maxFps >= 60 ? "always" : "demand"}>
      <ShaderMaterial source={source} uniforms={uniforms} maxFps={maxFps} />
    </Canvas>
  );
};

const FourDotLogo = () => (
  <div className="relative flex h-5 w-5 items-center justify-center">
    <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary opacity-90" />
    <span className="absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary opacity-90" />
    <span className="absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary opacity-90" />
    <span className="absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary opacity-90" />
  </div>
);

function MiniNavbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="fixed left-1/2 top-6 z-20 flex w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 items-center justify-between rounded-full border border-outline-variant bg-surface/70 px-5 py-3 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/25 bg-primary/10">
          <FourDotLogo />
        </div>
        <div className="hidden sm:block">
          <div className="font-mono text-sm font-bold tracking-[0.24em] text-on-surface">TRINETRA</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-outline">Secure Access</div>
        </div>
      </div>

      <button
        className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant bg-surface-container text-on-surface transition-colors hover:border-primary/40 hover:text-primary sm:hidden"
        onClick={() => setIsOpen((value) => !value)}
        aria-label={isOpen ? "Close Menu" : "Open Menu"}
      >
        {isOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>
    </header>
  );
}

const LegalLinks = () => (
  <p className="pt-10 text-xs leading-6 text-outline">
    By signing in, you agree to the <a href="#" className="underline transition-colors hover:text-on-surface">MSA</a>,{" "}
    <a href="#" className="underline transition-colors hover:text-on-surface">Product Terms</a>,{" "}
    <a href="#" className="underline transition-colors hover:text-on-surface">Policies</a>,{" "}
    <a href="#" className="underline transition-colors hover:text-on-surface">Privacy Notice</a>, and{" "}
    <a href="#" className="underline transition-colors hover:text-on-surface">Cookie Notice</a>.
  </p>
);

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code" | "success">("email");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [initialCanvasVisible, setInitialCanvasVisible] = useState(true);
  const [reverseCanvasVisible, setReverseCanvasVisible] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGuestLoading, setIsGuestLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [message, setMessage] = useState<AuthMessage>(null);
  const normalizedEmail = email.trim().toLowerCase();

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedEmail) {
      setMessage({ type: "error", text: "Enter your email address first." });
      return;
    }

    try {
      setIsSendingOtp(true);
      setMessage(null);
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to send OTP");
      }

      setOtpSent(true);
      setStep("code");
      setMessage({
        type: "success",
        text: `${mode === "signup" ? "Verification code sent to create your account." : "Verification code sent."} Check ${normalizedEmail}.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to send OTP" });
    } finally {
      setIsSendingOtp(false);
    }
  };

  useEffect(() => {
    if (step === "code") {
      window.setTimeout(() => {
        codeInputRefs.current[0]?.focus();
      }, 500);
    }
  }, [step]);

  const handleCodeChange = (index: number, value: string) => {
    const nextValue = value.replace(/\D/g, "");
    if (nextValue.length > 1) return;

    const nextCode = [...code];
    nextCode[index] = nextValue;
    setCode(nextCode);

    if (nextValue && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
  };

  const handleBackClick = () => {
    setStep("email");
    setCode(["", "", "", "", ""]);
    setReverseCanvasVisible(false);
    setInitialCanvasVisible(true);
    setMessage(null);
  };

  const triggerSuccessTransition = () => {
    setReverseCanvasVisible(true);
    window.setTimeout(() => setInitialCanvasVisible(false), 50);
    window.setTimeout(() => setStep("success"), 2000);
    window.setTimeout(() => router.push("/"), 2500);
  };

  const handleVerifyCode = async () => {
    const otp = code.join("");
    if (!normalizedEmail || otp.length !== 6) {
      setMessage({ type: "error", text: "Enter your email and the 6-digit verification code." });
      return;
    }

    try {
      setIsVerifying(true);
      setMessage(null);
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, otp }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "OTP verification failed");
      }

      localStorage.setItem("trinetra_access_token", result.token);
      localStorage.setItem("trinetra_user_email", normalizedEmail);
      setMessage({
        type: "success",
        text: mode === "signup" ? "Account verified. Starting secure workspace..." : "Verification successful. Starting secure workspace...",
      });
      triggerSuccessTransition();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "OTP verification failed" });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleGuestLogin = async () => {
    try {
      setIsGuestLoading(true);
      setMessage(null);
      localStorage.setItem("trinetra_user_email", "guest@local");
      localStorage.setItem("trinetra_guest_mode", "true");
      setMessage({ type: "success", text: "Guest session ready. Entering workspace..." });
      window.setTimeout(() => {
        router.push("/");
      }, 250);
    } finally {
      setIsGuestLoading(false);
    }
  };

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode);
    setStep("email");
    setCode(["", "", "", "", "", ""]);
    setOtpSent(false);
    setMessage(null);
    setReverseCanvasVisible(false);
    setInitialCanvasVisible(true);
  };

  return (
    <div className={cn("relative flex min-h-screen w-full flex-col overflow-hidden bg-surface text-on-surface")}>
      <div className="absolute inset-0 z-0">
        {initialCanvasVisible ? (
          <div className="absolute inset-0">
            <CanvasRevealEffect
              animationSpeed={3}
              containerClassName="bg-surface"
              colors={[[152, 207, 227], [246, 187, 133]]}
              dotSize={6}
              reverse={false}
            />
          </div>
        ) : null}

        {reverseCanvasVisible ? (
          <div className="absolute inset-0">
            <CanvasRevealEffect
              animationSpeed={4}
              containerClassName="bg-surface"
              colors={[[152, 207, 227], [246, 187, 133]]}
              dotSize={6}
              reverse
            />
          </div>
        ) : null}

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(19,19,21,0.08)_0%,rgba(19,19,21,0.82)_60%,rgba(19,19,21,1)_100%)]" />
        <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-surface to-transparent" />
      </div>

      <div className="relative z-10 flex flex-1 flex-col">
        <MiniNavbar />

        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center px-6 pb-10 pt-28 sm:px-8">
            <div className="w-full max-w-sm rounded-[28px] border border-outline-variant/80 bg-surface-container/60 p-7 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-md">
              <AnimatePresence mode="wait">
                {step === "email" ? (
                  <motion.div
                    key="email-step"
                    initial={{ opacity: 0, x: -60 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -60 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="space-y-6 text-center"
                  >
                    <div className="space-y-2">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                        <FourDotLogo />
                      </div>
                      <div className="mx-auto inline-flex rounded-full border border-outline-variant bg-surface-container-low p-1">
                        <button
                          type="button"
                          onClick={() => handleModeChange("signin")}
                          className={`rounded-full px-4 py-2 text-sm transition-colors ${mode === "signin" ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"}`}
                        >
                          Sign in
                        </button>
                        <button
                          type="button"
                          onClick={() => handleModeChange("signup")}
                          className={`rounded-full px-4 py-2 text-sm transition-colors ${mode === "signup" ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"}`}
                        >
                          Sign up
                        </button>
                      </div>
                      <h1 className="text-[2.25rem] font-bold leading-[1.1] tracking-tight text-on-surface">
                        {mode === "signup" ? "Create your access" : "Welcome back"}
                      </h1>
                      <p className="text-lg font-light text-on-surface-variant">
                        {mode === "signup" ? "Register for Trinetra with email verification" : "Sign in to Trinetra"}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="h-px flex-1 bg-outline-variant" />
                        <span className="text-sm text-outline">or</span>
                        <div className="h-px flex-1 bg-outline-variant" />
                      </div>

                      <form onSubmit={handleEmailSubmit}>
                        <div className="relative">
                          <input
                            type="email"
                            placeholder="analyst@company.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full rounded-full border border-outline-variant bg-surface-container-low px-4 py-3 text-center text-on-surface outline-none transition-colors placeholder:text-outline focus:border-primary/40"
                            required
                          />
                          <button
                            type="submit"
                            disabled={isSendingOtp || isVerifying || isGuestLoading}
                            className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSendingOtp ? <span className="text-xs">...</span> : <ArrowRight className="h-4 w-4" />}
                          </button>
                        </div>
                      </form>

                      {message ? (
                        <div
                          className={`rounded-2xl border px-4 py-3 text-sm ${
                            message.type === "success"
                              ? "border-primary/35 bg-primary/10 text-primary"
                              : "border-error/35 bg-error/10 text-error"
                          }`}
                        >
                          {message.text}
                        </div>
                      ) : null}

                      <button
                        type="button"
                        onClick={handleGuestLogin}
                        disabled={isSendingOtp || isVerifying || isGuestLoading}
                        className="w-full rounded-full border border-outline-variant bg-transparent py-3 text-sm text-on-surface-variant transition-colors hover:border-primary/35 hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isGuestLoading ? "Entering as guest..." : "Continue as Guest"}
                      </button>
                    </div>

                    <LegalLinks />
                  </motion.div>
                ) : step === "code" ? (
                  <motion.div
                    key="code-step"
                    initial={{ opacity: 0, x: 60 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 60 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="space-y-6 text-center"
                  >
                    <div className="space-y-2">
                      <h1 className="text-[2.25rem] font-bold leading-[1.1] tracking-tight text-on-surface">Check your code</h1>
                      <p className="text-lg font-light text-on-surface-variant">
                        {mode === "signup" ? "Enter the verification code to activate your account" : "Enter the 6-digit verification code"}
                      </p>
                    </div>

                    <div className="w-full">
                      <div className="relative rounded-full border border-outline-variant bg-surface-container-low px-5 py-4">
                        <div className="flex items-center justify-center">
                          {code.map((digit, i) => (
                            <div key={i} className="flex items-center">
                              <div className="relative">
                                <input
                                  ref={(el) => {
                                    codeInputRefs.current[i] = el;
                                  }}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  maxLength={1}
                                  value={digit}
                                  onChange={(e) => handleCodeChange(i, e.target.value)}
                                  onKeyDown={(e) => handleKeyDown(i, e)}
                                  className="w-8 appearance-none border-none bg-transparent text-center text-xl text-on-surface outline-none"
                                  style={{ caretColor: "transparent" }}
                                />
                                {!digit ? (
                                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                    <span className="text-xl text-outline">0</span>
                                  </div>
                                ) : null}
                              </div>
                              {i < 5 ? <span className="text-xl text-outline-variant">|</span> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <motion.p
                        className="cursor-pointer text-sm text-on-surface-variant transition-colors hover:text-on-surface"
                        onClick={() => {
                          void handleEmailSubmit({ preventDefault: () => undefined } as React.FormEvent);
                        }}
                        whileHover={{ scale: 1.02 }}
                        transition={{ duration: 0.2 }}
                      >
                        {isSendingOtp ? "Sending..." : otpSent ? "Resend code" : "Send code"}
                      </motion.p>
                    </div>

                    {message ? (
                      <div
                        className={`rounded-2xl border px-4 py-3 text-sm ${
                          message.type === "success"
                            ? "border-primary/35 bg-primary/10 text-primary"
                            : "border-error/35 bg-error/10 text-error"
                        }`}
                      >
                        {message.text}
                      </div>
                    ) : null}

                    <div className="flex w-full gap-3">
                      <motion.button
                        onClick={handleBackClick}
                        className="w-[30%] rounded-full border border-primary/30 bg-primary text-on-primary px-8 py-3 font-medium transition-colors hover:bg-primary/90"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{ duration: 0.2 }}
                      >
                        Back
                      </motion.button>
                      <motion.button
                        onClick={() => {
                          void handleVerifyCode();
                        }}
                        className={`flex-1 rounded-full border py-3 font-medium transition-all duration-300 ${
                          code.every((d) => d !== "")
                            ? "cursor-pointer border-primary/30 bg-primary text-on-primary hover:bg-primary/90"
                            : "cursor-not-allowed border-outline-variant bg-surface-container-low text-outline"
                        }`}
                        disabled={!code.every((d) => d !== "") || isVerifying || isSendingOtp}
                      >
                        {isVerifying ? "Verifying..." : mode === "signup" ? "Create account" : "Continue"}
                      </motion.button>
                    </div>

                    <div className="pt-10">
                      <LegalLinks />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="success-step"
                    initial={{ opacity: 0, y: 50 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut", delay: 0.3 }}
                    className="space-y-6 text-center"
                  >
                    <div className="space-y-2">
                      <h1 className="text-[2.25rem] font-bold leading-[1.1] tracking-tight text-on-surface">You&apos;re in</h1>
                      <p className="text-lg font-light text-on-surface-variant">Welcome to the workspace</p>
                    </div>

                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.5 }}
                      className="py-10"
                    >
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary text-on-primary shadow-[0_0_32px_rgba(152,207,227,0.35)]">
                        <Check className="h-8 w-8" />
                      </div>
                    </motion.div>

                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 1 }}
                      className="text-sm text-on-surface-variant"
                    >
                      Redirecting to dashboard...
                    </motion.p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
