export const otpStore: Record<
  string,
  {
    otp: string;
    expires: number;
    lastSent: number;
  }
> = {};