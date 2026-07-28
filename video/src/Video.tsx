import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Series,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const FPS = 30;

// durations in frames @30fps (phone clips sped 1.5x, terminal 1.0x)
const D = { intro: 60, s1: 459, s2: 389, s3: 612, s4: 434, outro: 75 };
export const DEMO_DURATION = D.intro + D.s1 + D.s2 + D.s3 + D.s4 + D.outro;

const BG = "#0a0e14";
const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
const AMBER = "#f5a623";
const BLUE = "#4aa8ff";
const GREEN = "#34c759";

// ---------- shared chrome ----------

const ProgressDots: React.FC<{ active: number }> = ({ active }) => (
  <div
    style={{
      position: "absolute",
      top: 54,
      width: "100%",
      display: "flex",
      justifyContent: "center",
      gap: 16,
    }}
  >
    {[1, 2, 3, 4].map((i) => (
      <div
        key={i}
        style={{
          width: i === active ? 40 : 14,
          height: 14,
          borderRadius: 7,
          background: i === active ? "#e8eef5" : "#2a3340",
          transition: "all 0.2s",
        }}
      />
    ))}
  </div>
);

const Banner: React.FC<{ step: number; role: string; color: string; title: string }> = ({
  step,
  role,
  color,
  title,
}) => {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [0, 14], [-30, 0], { extrapolateRight: "clamp" });
  const o = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: 108, width: "100%", textAlign: "center", transform: `translateY(${y}px)`, opacity: o }}>
      <div
        style={{
          display: "inline-block",
          padding: "10px 26px",
          borderRadius: 999,
          background: `${color}22`,
          border: `2px solid ${color}`,
          color,
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 30,
          letterSpacing: 2,
        }}
      >
        STEP {step} · {role}
      </div>
      <div style={{ marginTop: 20, color: "#f2f6fb", fontFamily: FONT, fontWeight: 800, fontSize: 64 }}>
        {title}
      </div>
    </div>
  );
};

type Caption = { text: string; at: number }; // at = fraction [0..1] of scene

const Captions: React.FC<{ captions: Caption[]; duration: number }> = ({ captions, duration }) => {
  const frame = useCurrentFrame();
  const progress = frame / duration;
  let idx = 0;
  for (let i = 0; i < captions.length; i++) if (progress >= captions[i].at) idx = i;
  const c = captions[idx];
  const startF = c.at * duration;
  const opacity = interpolate(frame, [startF, startF + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ position: "absolute", bottom: 150, width: "100%", padding: "0 90px", textAlign: "center" }}>
      <div
        style={{
          display: "inline-block",
          padding: "22px 34px",
          borderRadius: 26,
          background: "rgba(18,24,33,0.86)",
          border: "1px solid #223042",
          color: "#e8eef5",
          fontFamily: FONT,
          fontWeight: 600,
          fontSize: 40,
          lineHeight: 1.28,
          opacity,
        }}
      >
        {c.text}
      </div>
    </div>
  );
};

// ---------- video card ----------

const Card: React.FC<{
  src: string;
  playbackRate: number;
  kind: "phone" | "term";
}> = ({ src, playbackRate, kind }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  const scale = interpolate(s, [0, 1], [0.94, 1]);
  const isPhone = kind === "phone";
  const w = isPhone ? 532 : 980;
  const h = isPhone ? 1150 : 806;
  const top = isPhone ? 336 : 560;
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: (1080 - w) / 2,
        width: w,
        height: h,
        borderRadius: isPhone ? 46 : 22,
        overflow: "hidden",
        border: isPhone ? "6px solid #1b2432" : "1px solid #223042",
        boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
        transform: `scale(${scale})`,
        background: "#000",
      }}
    >
      <OffthreadVideo
        src={src}
        playbackRate={playbackRate}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
};

// ---------- scenes ----------

const StepScene: React.FC<{
  step: number;
  role: string;
  color: string;
  title: string;
  src: string;
  playbackRate: number;
  kind: "phone" | "term";
  captions: Caption[];
  duration: number;
}> = (p) => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 0%, #10161f 0%, ${BG} 60%)`, opacity: fade }}>
      <ProgressDots active={p.step} />
      <Banner step={p.step} role={p.role} color={p.color} title={p.title} />
      <Card src={p.src} playbackRate={p.playbackRate} kind={p.kind} />
      <Captions captions={p.captions} duration={p.duration} />
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{ big: string; small: string; accent: string }> = ({ big, small, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 20 });
  const o = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(100% 60% at 50% 40%, #131b26 0%, ${BG} 70%)`,
        justifyContent: "center",
        alignItems: "center",
        opacity: o,
      }}
    >
      <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.9, 1])})`, textAlign: "center", padding: "0 80px" }}>
        <div style={{ fontSize: 70, marginBottom: 20 }}>📶🕒</div>
        <div style={{ color: "#f2f6fb", fontFamily: FONT, fontWeight: 900, fontSize: 96, letterSpacing: -1 }}>{big}</div>
        <div style={{ marginTop: 26, color: accent, fontFamily: FONT, fontWeight: 600, fontSize: 46 }}>{small}</div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- main ----------

export const Demo: React.FC = () => (
  <AbsoluteFill style={{ background: BG }}>
    <Series>
      <Series.Sequence durationInFrames={D.intro}>
        <TitleCard big="NFC TimeSheets" small="Tap a tag. Log the shift. Done." accent={BLUE} />
      </Series.Sequence>

      <Series.Sequence durationInFrames={D.s1}>
        <StepScene
          step={1}
          role="ADMIN"
          color={AMBER}
          title="Register a worker"
          src={staticFile("assets/step1.mp4")}
          playbackRate={1.5}
          kind="phone"
          duration={D.s1}
          captions={[
            { text: "Unlock the admin panel with a PIN", at: 0 },
            { text: "Add the worker — here, “myself”", at: 0.55 },
          ]}
        />
      </Series.Sequence>

      <Series.Sequence durationInFrames={D.s2}>
        <StepScene
          step={2}
          role="ADMIN"
          color={AMBER}
          title="Register a location"
          src={staticFile("assets/step2.mp4")}
          playbackRate={1.5}
          kind="phone"
          duration={D.s2}
          captions={[
            { text: "Scan the NFC tag to capture its ID", at: 0 },
            { text: "Name it “Hoiv 4” — only registered tags count", at: 0.5 },
          ]}
        />
      </Series.Sequence>

      <Series.Sequence durationInFrames={D.s3}>
        <StepScene
          step={3}
          role="WORKER"
          color={BLUE}
          title="Punch in, punch out"
          src={staticFile("assets/step3.mp4")}
          playbackRate={1.5}
          kind="phone"
          duration={D.s3}
          captions={[
            { text: "Pick your name, tap the tag to start", at: 0 },
            { text: "Tap again to finish the shift", at: 0.4 },
            { text: "History shows it: Hoiv 4 · Synced ✓", at: 0.72 },
          ]}
        />
      </Series.Sequence>

      <Series.Sequence durationInFrames={D.s4}>
        <StepScene
          step={4}
          role="PROOF"
          color={GREEN}
          title="It’s on the server"
          src={staticFile("assets/term.mp4")}
          playbackRate={1.0}
          kind="term"
          duration={D.s4}
          captions={[
            { text: "curl the live API…", at: 0 },
            { text: "“myself” @ “Hoiv 4” — confirmed server-side", at: 0.62 },
          ]}
        />
      </Series.Sequence>

      <Series.Sequence durationInFrames={D.outro}>
        <TitleCard big="Server-verified" small="One tap in. One tap out." accent={GREEN} />
      </Series.Sequence>
    </Series>
  </AbsoluteFill>
);
