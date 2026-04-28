import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { otpStore } from "@/lib/otpStore";

const COOLDOWN = 60 * 1000;

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    console.log("Request for:", email);

    const existing = otpStore[email];

    if (existing && Date.now() - existing.lastSent < COOLDOWN) {
      const remaining = Math.ceil(
        (COOLDOWN - (Date.now() - existing.lastSent)) / 1000
      );

      return NextResponse.json(
        { error: `Wait ${remaining}s` },
        { status: 429 }
      );
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    console.log("EMAIL_USER:", process.env.EMAIL_USER);
    console.log("Sending email...");

    await transporter.sendMail({
      from: `"ImageProtect 🔐" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your OTP Code",
      html: `
        <div style="text-align:center;font-family:sans-serif">
          <h2>ImageProtect</h2>
          <p>Your OTP:</p>
          <h1>${otp}</h1>
          <p>Valid for 5 minutes</p>
        </div>
      `,
    });

    console.log("OTP sent:", otp);

    otpStore[email] = {
      otp,
      expires: Date.now() + 5 * 60 * 1000,
      lastSent: Date.now(),
    };

    return NextResponse.json({ message: "OTP sent" });
  } catch (err) {
    console.error("ERROR:", err);
    return NextResponse.json(
      { error: "Failed to send OTP" },
      { status: 500 }
    );
  }
}