import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { otpStore } from "@/lib/otpStore";

export async function POST(req: Request) {
  const { email, otp } = await req.json();

  const record = otpStore[email];

  if (!record) {
    return NextResponse.json({ error: "No OTP found" }, { status: 400 });
  }

  if (Date.now() > record.expires) {
    return NextResponse.json({ error: "OTP expired" }, { status: 400 });
  }

  if (record.otp !== otp) {
    return NextResponse.json({ error: "Invalid OTP" }, { status: 400 });
  }

  delete otpStore[email];

  const token = jwt.sign(
    { email },
    process.env.JWT_SECRET as string,
    { expiresIn: "1d" }
  );

  return NextResponse.json({ token });
}